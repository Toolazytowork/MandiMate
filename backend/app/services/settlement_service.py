"""Delivery & quality check, settlement maths, payments and farmer payouts (DOMAIN_RULES §6).

Per member: ``dispatched_kg`` = the weight picked up (0 for a skipped stop) or, when no pickup was
confirmed, the member's quantity; ``rejected = delivered − accepted``;
``shortage = dispatched − delivered`` (never below 0). Per farmer payout::

    gross            = price × accepted_kg
    transport_share  = transport_total × dispatched_kg / Σ dispatched_kg
    handling_share   = offer.handling_charge_per_kg × accepted_kg + LOADING_PER_KG × dispatched_kg
    commission_share = commission_pct / 100 × gross
    net              = gross − transport_share − handling_share − commission_share
    net_per_kg       = net / dispatched_kg
    uplift_per_kg    = net_per_kg − baseline_net_per_kg

Every component is rounded half-up to the paisa and ``net`` is computed from the rounded
components, so each payout adds up exactly. Transport shares are apportioned by the largest
remainder so they sum exactly to the booked quote (₹0 for ``buyer_pickup``). Members with nothing
dispatched get no payout.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import timedelta
from decimal import ROUND_DOWN, Decimal
from typing import TYPE_CHECKING

from sqlalchemy import exists, select, update

from app import schemas
from app.core.errors import conflict, forbidden, not_found
from app.core.time import today_ist, utcnow
from app.models import (
    Delivery,
    Demand,
    Dispute,
    FarmerPayout,
    Lot,
    LotMember,
    MarketPrice,
    Payment,
    Settlement,
    TransportRequest,
    User,
)
from app.services import lot_service, market_service, pricing
from app.services.audit import audit
from app.services.codes import next_code
from app.services.notify import coordinator_ids_for, notify
from app.services.presenters import farmer_display_name
from app.services.transport_service import (
    active_members,
    invalid_input,
    is_staff,
    load_lot_for_participant,
    money,
    opt_money,
    org_or_name,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

DELIVERY_TOLERANCE = Decimal("1.02")
"""Delivered weight may exceed the dispatched weight by up to 2% (scale differences)."""
PAID_TOLERANCE = Decimal("0.01")
"""A settlement is paid once the buyer has paid within a paisa of the gross amount."""
OPEN_DISPUTE_STATUSES = ("open", "under_review")
UNPAID_STATUSES = ("pending", "partially_paid", "overdue", "disputed")
DELIVERABLE_MANDIMATE = ("transport_booked", "in_transit")
_CENT = Decimal("0.01")
_ZERO = Decimal("0.00")


# ─────────────────────────────── Maths ───────────────────────────────


def dispatched_kg(member: LotMember) -> Decimal:
    """Picked-up weight when a pickup was recorded, else the member's quantity."""
    return member.dispatched_kg if member.dispatched_kg is not None else member.quantity_kg


def allocate_by_weight(total: Decimal, weights: Sequence[Decimal]) -> list[Decimal]:
    """Split ``total`` (₹) in proportion to ``weights``, to the paisa, summing exactly to it.

    Largest-remainder method: every share is floored to the paisa and the leftover paise go to
    the largest fractional remainders (ties: first in order).
    """
    total = pricing.round_money(total)
    weight_sum = sum(weights, Decimal(0))
    if weight_sum <= 0 or total == 0:
        return [_ZERO for _ in weights]
    exact = [total * weight / weight_sum for weight in weights]
    shares = [value.quantize(_CENT, rounding=ROUND_DOWN) for value in exact]
    leftover = int((total - sum(shares, Decimal(0))) / _CENT)
    order = sorted(range(len(exact)), key=lambda i: exact[i] - shares[i], reverse=True)
    for index in order[:leftover]:
        shares[index] += _CENT
    return shares


async def _booked_transport_total(db: AsyncSession, lot: Lot) -> Decimal:
    """The booked quote's total for ``mandimate_delivery`` lots; 0 for ``buyer_pickup``."""
    if lot.pickup_terms != "mandimate_delivery":
        return _ZERO
    req = await db.scalar(
        select(TransportRequest)
        .where(
            TransportRequest.lot_id == lot.id,
            TransportRequest.status != "cancelled",
            TransportRequest.booked_quote_id.is_not(None),
        )
        .limit(1)
    )
    if req is None or req.booked_quote is None:
        return _ZERO
    return req.booked_quote.price_total


async def create_settlement_from_delivery(db: AsyncSession, lot: Lot, actor: User) -> Settlement:
    """Create the settlement and per-farmer payouts once a lot's delivery is recorded."""
    offer = lot.accepted_offer
    if offer is None:
        raise conflict("This lot has no accepted offer to settle")
    existing = await db.scalar(select(Settlement).where(Settlement.lot_id == lot.id))
    if existing is not None:
        raise conflict("This lot already has a settlement")

    price = offer.price_per_kg
    handling_rate = offer.handling_charge_per_kg
    commission_pct = offer.commission_pct
    members = active_members(lot)
    dispatched = [dispatched_kg(member) for member in members]
    transport_total = await _booked_transport_total(db, lot)
    transport_shares = allocate_by_weight(transport_total, dispatched)

    market_prices: dict[str | None, MarketPrice | None] = {}
    payouts: list[FarmerPayout] = []
    total_accepted = _ZERO
    for member, member_dispatched, transport_share in zip(
        members, dispatched, transport_shares, strict=True
    ):
        accepted = member.accepted_kg or _ZERO
        total_accepted += accepted
        if member_dispatched <= 0:
            continue
        gross = pricing.round_money(price * accepted)
        handling = pricing.round_money(
            handling_rate * accepted + pricing.LOADING_PER_KG * member_dispatched
        )
        commission = pricing.round_money(commission_pct / 100 * gross)
        net = gross - transport_share - handling - commission
        net_per_kg = pricing.round_money(net / member_dispatched)

        district = member.harvest.district
        if district not in market_prices:
            market_prices[district] = await market_service.latest_market_price(
                db, lot.crop_id, district
            )
        market_price = market_prices[district]
        baseline_per_kg: Decimal | None = None
        if market_price is not None:
            baseline = pricing.baseline_net_proceeds(
                quantity_kg=member_dispatched,
                market_price_per_kg=market_price.modal_price_per_kg,
                default_rejection_pct=lot.crop.default_rejection_pct,
                is_illustrative=market_price.is_illustrative,
                market_name=market_price.market_name,
            )
            if baseline is not None:
                baseline_per_kg = pricing.to_decimal(baseline.net_per_kg)

        payouts.append(
            FarmerPayout(
                member=member,
                farmer=member.farmer,
                dispatched_kg=pricing.round_money(member_dispatched),
                accepted_kg=pricing.round_money(accepted),
                rejected_kg=pricing.round_money(member.rejected_kg or _ZERO),
                gross_amount=gross,
                transport_share=transport_share,
                handling_share=handling,
                commission_share=commission,
                net_amount=pricing.round_money(net),
                net_per_kg=net_per_kg,
                baseline_net_per_kg=baseline_per_kg,
                uplift_per_kg=(
                    pricing.round_money(net_per_kg - baseline_per_kg)
                    if baseline_per_kg is not None
                    else None
                ),
                status="pending",
            )
        )

    def total(field: str) -> Decimal:
        return pricing.round_money(sum((getattr(p, field) for p in payouts), _ZERO))

    settlement = Settlement(
        code=await next_code(db, "settlement"),
        lot=lot,
        offer=offer,
        buyer=offer.buyer,
        price_per_kg=price,
        total_accepted_kg=pricing.round_money(total_accepted),
        gross_amount=total("gross_amount"),
        transport_cost=total("transport_share"),
        handling_cost=total("handling_share"),
        commission_amount=total("commission_share"),
        net_to_farmers=total("net_amount"),
        amount_paid=_ZERO,
        payment_status="pending",
        due_date=today_ist() + timedelta(days=offer.payment_terms_days),
        payouts=payouts,
        payments=[],
    )
    db.add(settlement)
    await db.flush()
    await audit(
        db,
        actor,
        "settlement.create",
        "settlement",
        settlement.id,
        f"Settlement {settlement.code} for lot {lot.code}: buyer owes "
        f"{pricing.format_rupees(settlement.gross_amount)}, farmers net "
        f"{pricing.format_rupees(settlement.net_to_farmers)}",
        {
            "lot_id": lot.id,
            "gross_amount": settlement.gross_amount,
            "transport_cost": settlement.transport_cost,
            "net_to_farmers": settlement.net_to_farmers,
            "due_date": settlement.due_date,
        },
    )
    await refresh_settlement_status(db, settlement)
    return settlement


# ───────────────────────────── Status ──────────────────────────────


async def mark_overdue_settlements(db: AsyncSession) -> None:
    """Lazily flag unpaid settlements past their due date as ``overdue`` (one UPDATE)."""
    await db.execute(
        update(Settlement)
        .where(
            Settlement.payment_status.in_(("pending", "partially_paid")),
            Settlement.due_date < today_ist(),
        )
        .values(payment_status="overdue")
        .execution_options(synchronize_session="fetch")
    )


async def refresh_settlement_status(db: AsyncSession, s: Settlement) -> None:
    """Recompute payment status (paid, overdue, disputed) and settle the lot when complete.

    ``disputed`` while a dispute on the lot is open or under review; otherwise ``paid`` once the
    buyer paid within a paisa of the gross amount, ``overdue`` past the due date, then
    ``partially_paid`` / ``pending``. When paid and every payout is paid the lot is settled.
    """
    disputed = await db.scalar(
        select(
            exists().where(Dispute.lot_id == s.lot_id, Dispute.status.in_(OPEN_DISPUTE_STATUSES))
        )
    )
    fully_paid = s.amount_paid >= s.gross_amount - PAID_TOLERANCE
    if fully_paid and s.paid_at is None:
        s.paid_at = max((payment.paid_at for payment in s.payments), default=utcnow())
    elif not fully_paid:
        s.paid_at = None
    if disputed:
        status = "disputed"
    elif fully_paid:
        status = "paid"
    elif s.due_date < today_ist():
        status = "overdue"
    elif s.amount_paid > 0:
        status = "partially_paid"
    else:
        status = "pending"
    if s.payment_status != status:
        s.payment_status = status
    await db.flush()
    if status == "paid" and all(p.status == "paid" for p in s.payouts):
        lot = s.lot
        if lot.status == "delivered":
            await _settle_lot(db, s)


async def _settle_lot(db: AsyncSession, s: Settlement) -> None:
    lot = s.lot
    lot.status = "settled"
    lot.settled_at = utcnow()
    demand_id = s.offer.demand_id or lot.demand_id
    if demand_id is not None:
        demand = await db.get(Demand, demand_id)
        if demand is not None and demand.status in ("open", "matched"):
            demand.status = "fulfilled"
    await db.flush()
    for harvest_id in dict.fromkeys(member.harvest_id for member in active_members(lot)):
        await lot_service.sync_harvest_status(db, harvest_id)
    await audit(
        db,
        None,
        "lot.settle",
        "lot",
        lot.id,
        f"Lot {lot.code} settled: buyer paid and every farmer payout is paid",
        {"settlement_id": s.id},
    )


# ─────────────────────────── Presentation ──────────────────────────


def _payout_out(payout: FarmerPayout, viewer: User) -> schemas.FarmerPayout:
    return schemas.FarmerPayout(
        id=payout.id,
        settlement_id=payout.settlement_id,
        farmer_id=payout.farmer_id,
        farmer_name=farmer_display_name(payout.farmer, viewer),
        accepted_kg=money(payout.accepted_kg),
        rejected_kg=money(payout.rejected_kg),
        gross_amount=money(payout.gross_amount),
        transport_share=money(payout.transport_share),
        handling_share=money(payout.handling_share),
        commission_share=money(payout.commission_share),
        net_amount=money(payout.net_amount),
        net_per_kg=money(payout.net_per_kg),
        baseline_net_per_kg=opt_money(payout.baseline_net_per_kg),
        uplift_per_kg=opt_money(payout.uplift_per_kg),
        status=payout.status,
        reference=payout.reference,
        paid_at=payout.paid_at,
    )


def _settlement_out(s: Settlement, viewer: User) -> schemas.Settlement:
    payouts = s.payouts
    if viewer.role == "farmer":
        payouts = [payout for payout in payouts if payout.farmer_id == viewer.id]
    return schemas.Settlement(
        id=s.id,
        code=s.code,
        lot_id=s.lot_id,
        lot_code=s.lot.code,
        offer_id=s.offer_id,
        buyer_id=s.buyer_id,
        buyer_name=org_or_name(s.buyer),
        crop_name=s.lot.crop.name,
        price_per_kg=money(s.price_per_kg),
        total_accepted_kg=money(s.total_accepted_kg),
        gross_amount=money(s.gross_amount),
        transport_cost=money(s.transport_cost),
        handling_cost=money(s.handling_cost),
        commission_amount=money(s.commission_amount),
        net_to_farmers=money(s.net_to_farmers),
        amount_paid=money(s.amount_paid),
        payment_status=s.payment_status,
        due_date=s.due_date,
        paid_at=s.paid_at,
        payouts=[_payout_out(payout, viewer) for payout in payouts],
        payments=[
            schemas.PaymentRecord(
                id=payment.id,
                amount=money(payment.amount),
                reference=payment.reference,
                paid_at=payment.paid_at,
                recorded_by_name=(
                    payment.recorded_by.full_name if payment.recorded_by else "MandiMate"
                ),
            )
            for payment in s.payments
        ],
        created_at=s.created_at,
    )


async def settlement_out(db: AsyncSession, s: Settlement, viewer: User) -> schemas.Settlement:
    """The API ``Settlement`` as ``viewer`` may see it (farmers see only their own payout)."""
    return _settlement_out(s, viewer)


def settlements_out(items: Sequence[Settlement], viewer: User) -> list[schemas.Settlement]:
    return [_settlement_out(s, viewer) for s in items]


# ───────────────────────────── Queries ─────────────────────────────


def _can_view_settlement(s: Settlement, viewer: User) -> bool:
    if is_staff(viewer):
        return True
    if viewer.role == "buyer":
        return s.buyer_id == viewer.id
    if viewer.role == "farmer":
        return any(payout.farmer_id == viewer.id for payout in s.payouts)
    return False


async def get_settlement_for_viewer(
    db: AsyncSession, settlement_id: uuid.UUID, viewer: User
) -> Settlement:
    """A settlement the viewer may see (status refreshed lazily); 404 otherwise."""
    s = await db.get(Settlement, settlement_id)
    if s is None or not _can_view_settlement(s, viewer):
        raise not_found("Settlement")
    await refresh_settlement_status(db, s)
    return s


async def list_settlements(
    db: AsyncSession,
    viewer: User,
    *,
    payment_status: schemas.PaymentStatus | None = None,
    limit: int = 100,
) -> list[Settlement]:
    await mark_overdue_settlements(db)
    query = select(Settlement)
    if viewer.role == "buyer":
        query = query.where(Settlement.buyer_id == viewer.id)
    elif viewer.role == "farmer":
        query = query.where(
            Settlement.id.in_(
                select(FarmerPayout.settlement_id).where(FarmerPayout.farmer_id == viewer.id)
            )
        )
    elif not is_staff(viewer):
        return []
    if payment_status is not None:
        query = query.where(Settlement.payment_status == payment_status)
    query = query.order_by(Settlement.created_at.desc(), Settlement.id.desc()).limit(limit)
    return list(await db.scalars(query))


# ───────────────────────────── Payments ────────────────────────────


async def record_payment(
    db: AsyncSession, actor: User, settlement_id: uuid.UUID, body: schemas.RecordPaymentRequest
) -> Settlement:
    """Record money received from the buyer (buyer owner or coordinator)."""
    s = await db.get(Settlement, settlement_id)
    if s is None or not _can_view_settlement(s, actor):
        raise not_found("Settlement")
    if not (is_staff(actor) or (actor.role == "buyer" and s.buyer_id == actor.id)):
        raise forbidden("Only the buyer or a coordinator can record payments")
    outstanding = s.gross_amount - s.amount_paid
    if outstanding <= PAID_TOLERANCE:
        raise conflict("This settlement is already paid in full")
    amount = pricing.to_decimal(body.amount)
    if amount > outstanding + PAID_TOLERANCE:
        raise invalid_input(
            ("body", "amount"),
            f"Amount is more than the outstanding {pricing.format_rupees(outstanding)}",
            body.amount,
        )
    now = utcnow()
    paid_at = body.paid_at or now
    if paid_at > now + timedelta(minutes=5):
        raise invalid_input(("body", "paid_at"), "Payment date cannot be in the future")
    amount = pricing.round_money(amount)
    payment = Payment(
        amount=amount,
        reference=body.reference,
        paid_at=paid_at,
        recorded_by_id=actor.id,
        recorded_by=actor,
    )
    s.payments.append(payment)
    s.amount_paid = pricing.round_money(s.amount_paid + amount)
    await db.flush()
    await refresh_settlement_status(db, s)

    lot = s.lot
    await notify(
        db,
        await coordinator_ids_for(db, [member.farmer_id for member in active_members(lot)]),
        "payment",
        f"Payment received: {pricing.format_rupees(amount)}",
        f"{org_or_name(s.buyer)} paid {pricing.format_rupees(amount)} for lot {lot.code} "
        f"({pricing.format_rupees(s.amount_paid)} of {pricing.format_rupees(s.gross_amount)}).",
        f"/app/coordinator/settlements/{s.id}",
    )
    await audit(
        db,
        actor,
        "settlement.payment",
        "settlement",
        s.id,
        f"Recorded payment of {pricing.format_rupees(amount)} on {s.code}",
        {"amount": amount, "reference": body.reference, "paid_at": paid_at},
    )
    return s


async def mark_payout_paid(
    db: AsyncSession,
    coordinator: User,
    settlement_id: uuid.UUID,
    payout_id: uuid.UUID,
    body: schemas.MarkPayoutPaidRequest,
) -> Settlement:
    """Record that MandiMate remitted a farmer's net; settles the lot when it was the last one."""
    s = await db.get(Settlement, settlement_id)
    if s is None:
        raise not_found("Settlement")
    payout = next((p for p in s.payouts if p.id == payout_id), None)
    if payout is None:
        raise not_found("Payout")
    await refresh_settlement_status(db, s)
    if s.payment_status != "paid":
        raise conflict("Payouts can be marked paid only after the buyer has paid in full")
    if payout.status == "paid":
        raise conflict("This payout is already marked paid")
    payout.status = "paid"
    payout.reference = body.reference
    payout.paid_at = utcnow()
    payout.marked_paid_by_id = coordinator.id
    await db.flush()

    lot = s.lot
    await notify(
        db,
        [payout.farmer_id],
        "payment",
        f"Payment sent: {pricing.format_rupees(payout.net_amount)}",
        f"Your net earnings of {pricing.format_rupees(payout.net_amount)} for lot {lot.code} "
        f"({pricing.format_number(payout.accepted_kg)} kg accepted) have been paid.",
        "/app/farmer/earnings",
    )
    await audit(
        db,
        coordinator,
        "payout.paid",
        "farmer_payout",
        payout.id,
        f"Marked payout of {pricing.format_rupees(payout.net_amount)} to "
        f"{payout.farmer.full_name} paid ({s.code})",
        {"settlement_id": s.id, "reference": body.reference, "net_amount": payout.net_amount},
    )
    await refresh_settlement_status(db, s)
    return s


# ───────────────────────────── Delivery ────────────────────────────


async def delivery_out(
    db: AsyncSession, lot: Lot, delivery: Delivery, viewer: User, *, reveal: bool = False
) -> schemas.DeliveryRecord:
    settlement_id = await db.scalar(select(Settlement.id).where(Settlement.lot_id == lot.id))
    items: list[schemas.DeliveryItem] = []
    totals = dict.fromkeys(("dispatched", "delivered", "accepted", "rejected", "shortage"), _ZERO)
    for member in active_members(lot):
        if member.delivered_kg is None:
            continue
        dispatched = dispatched_kg(member)
        delivered = member.delivered_kg
        accepted = member.accepted_kg or _ZERO
        rejected = member.rejected_kg if member.rejected_kg is not None else delivered - accepted
        shortage = max(dispatched - delivered, _ZERO)
        for key, value in (
            ("dispatched", dispatched),
            ("delivered", delivered),
            ("accepted", accepted),
            ("rejected", rejected),
            ("shortage", shortage),
        ):
            totals[key] += value
        items.append(
            schemas.DeliveryItem(
                member_id=member.id,
                farmer_name=farmer_display_name(member.farmer, viewer, reveal=reveal),
                dispatched_kg=money(dispatched),
                delivered_kg=money(delivered),
                accepted_kg=money(accepted),
                rejected_kg=money(rejected),
                shortage_kg=money(shortage),
                rejection_reason=member.rejection_reason,
            )
        )
    recorder = delivery.recorded_by
    return schemas.DeliveryRecord(
        lot_id=lot.id,
        lot_code=lot.code,
        recorded_by_name=recorder.full_name if recorder is not None else "MandiMate",
        inspector_name=delivery.inspector_name,
        recorded_at=delivery.recorded_at,
        notes=delivery.notes,
        items=items,
        total_dispatched_kg=money(totals["dispatched"]),
        total_delivered_kg=money(totals["delivered"]),
        total_accepted_kg=money(totals["accepted"]),
        total_rejected_kg=money(totals["rejected"]),
        total_shortage_kg=money(totals["shortage"]),
        settlement_id=settlement_id,
    )


async def get_delivery_for_viewer(
    db: AsyncSession, lot_id: uuid.UUID, viewer: User
) -> schemas.DeliveryRecord:
    lot, access = await load_lot_for_participant(db, lot_id, viewer)
    delivery = await db.scalar(select(Delivery).where(Delivery.lot_id == lot.id))
    if delivery is None:
        raise not_found("Delivery")
    return await delivery_out(db, lot, delivery, viewer, reveal=access.is_booked_transporter)


async def record_delivery(
    db: AsyncSession, actor: User, lot_id: uuid.UUID, body: schemas.DeliveryRecordRequest
) -> tuple[Lot, Delivery]:
    """Record weights and the quality check at the buyer, then create the settlement."""
    lot, access = await load_lot_for_participant(db, lot_id, actor)
    if not (is_staff(actor) or access.is_accepted_buyer):
        raise forbidden("Only the buyer of the accepted offer or a coordinator can record delivery")
    if await db.scalar(select(exists().where(Delivery.lot_id == lot.id))):
        raise conflict("Delivery has already been recorded for this lot")
    if lot.pickup_terms == "buyer_pickup":
        if lot.status != "offer_accepted":
            raise conflict(
                "Delivery can be recorded once the offer is accepted and not yet delivered"
            )
    elif lot.status not in DELIVERABLE_MANDIMATE:
        raise conflict("Delivery can be recorded once transport is booked or the lot is in transit")

    members = active_members(lot)
    by_id = {member.id: member for member in members}
    item_ids = [item.member_id for item in body.items]
    unknown = [str(member_id) for member_id in item_ids if member_id not in by_id]
    if unknown:
        raise invalid_input(("body", "items"), "Unknown lot member in delivery items", unknown)
    missing = [str(member_id) for member_id in by_id if member_id not in set(item_ids)]
    if missing:
        raise invalid_input(
            ("body", "items"), "Record the delivery of every farmer in the lot", missing
        )
    for index, item in enumerate(body.items):
        member = by_id[item.member_id]
        limit = dispatched_kg(member) * DELIVERY_TOLERANCE
        if pricing.to_decimal(item.delivered_kg) > limit:
            raise invalid_input(
                ("body", "items", index, "delivered_kg"),
                f"Delivered quantity cannot exceed {pricing.format_number(limit)} kg "
                f"(dispatched {pricing.format_number(dispatched_kg(member))} kg + 2%)",
                item.delivered_kg,
            )

    for item in body.items:
        member = by_id[item.member_id]
        delivered = pricing.round_money(item.delivered_kg)
        accepted = pricing.round_money(item.accepted_kg)
        member.dispatched_kg = pricing.round_money(dispatched_kg(member))
        member.delivered_kg = delivered
        member.accepted_kg = accepted
        member.rejected_kg = pricing.round_money(delivered - accepted)
        member.rejection_reason = item.rejection_reason
    now = utcnow()
    delivery = Delivery(
        lot=lot,
        recorded_by_id=actor.id,
        recorded_by=actor,
        inspector_name=body.inspector_name,
        notes=body.notes,
        recorded_at=now,
    )
    db.add(delivery)
    lot.status = "delivered"
    lot.delivered_at = now
    await db.flush()
    for harvest_id in dict.fromkeys(member.harvest_id for member in members):
        await lot_service.sync_harvest_status(db, harvest_id)

    settlement = await create_settlement_from_delivery(db, lot, actor)

    accepted_total = sum((m.accepted_kg or _ZERO for m in members), _ZERO)
    delivered_total = sum((m.delivered_kg or _ZERO for m in members), _ZERO)
    for member in members:
        await notify(
            db,
            [member.farmer_id],
            "delivery",
            f"Delivered: lot {lot.code}",
            f"{pricing.format_number(member.delivered_kg or 0)} kg of your {lot.crop.name} reached "
            f"the buyer; {pricing.format_number(member.accepted_kg or 0)} kg accepted.",
            f"/app/farmer/lots/{lot.id}",
        )
    summary = (
        f"{pricing.format_number(delivered_total)} kg delivered, "
        f"{pricing.format_number(accepted_total)} kg accepted. Settlement {settlement.code}: "
        f"{pricing.format_rupees(settlement.gross_amount)} due by "
        f"{settlement.due_date.strftime('%d %b %Y')}."
    )
    await notify(
        db,
        await coordinator_ids_for(db, [member.farmer_id for member in members]),
        "delivery",
        f"Delivery recorded: lot {lot.code}",
        summary,
        f"/app/coordinator/settlements/{settlement.id}",
    )
    await notify(
        db,
        [settlement.buyer_id],
        "delivery",
        f"Delivery recorded: lot {lot.code}",
        summary,
        "/app/buyer/payments",
    )
    await audit(
        db,
        actor,
        "delivery.record",
        "lot",
        lot.id,
        f"Recorded delivery of lot {lot.code}: {pricing.format_number(delivered_total)} kg "
        f"delivered, {pricing.format_number(accepted_total)} kg accepted",
        {
            "items": [item.model_dump() for item in body.items],
            "inspector_name": body.inspector_name,
            "settlement_id": settlement.id,
        },
    )
    return lot, delivery
