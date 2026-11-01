"""Offers and negotiation (DOMAIN_RULES §2 "Offer"): create, counter, accept, reject, withdraw,
farmer consent on lot deals, lazy expiry and presentation.

| Status | Awaiting | Allowed |
|---|---|---|
| ``pending`` | seller | seller counters / accepts / rejects; buyer withdraws |
| ``countered`` | buyer | buyer accepts / counters back / rejects / withdraws |
| ``proposed`` | farmers | each member farmer consents (coordinator may record it); buyer withdraws |

The offer row always holds the **current** terms; the negotiation thread holds the history and
every action (system entries for automatic ones) appends to it. "Seller side" is the owner farmer
for ``harvest`` offers and a coordinator/admin for ``lot`` offers.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Iterable, Sequence
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import TYPE_CHECKING, Literal

from sqlalchemy import ColumnElement, and_, or_, select, true, update

from app import schemas
from app.core.errors import forbidden, not_found
from app.core.time import IST, today_ist, utcnow
from app.models import (
    Demand,
    Harvest,
    Lot,
    LotMember,
    NegotiationEntry,
    Offer,
    OfferConsent,
    Settlement,
    User,
)
from app.models.enums import OPEN_OFFER_STATUSES, NotificationType
from app.services import lot_service
from app.services.audit import audit
from app.services.codes import next_code
from app.services.lot_service import (
    active_members,
    available_kg_map,
    buyer_name,
    conflict,
    field_error,
    is_privileged,
    kg,
    lot_total_kg,
    reject_offers,
)
from app.services.notify import coordinator_ids_for, notify
from app.services.presenters import farmer_display_name, mask_name
from app.services.pricing import format_number, format_rupees, round_money, to_decimal

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

Side = Literal["buyer", "seller"]

NEGOTIABLE_STATUSES = ("pending", "countered")
DIRECT_ACCEPT_HARVEST_STATUSES = ("listed", "pooled", "committed")
"""A direct offer stays acceptable while the harvest has kg outside accepted deals."""
SYSTEM_NAME = "MandiMate"
SCALE_STEP = Decimal("0.1")
"""Member quantities scaled down pro-rata are rounded to 1 decimal."""
DEFAULT_LIST_LIMIT = 100

# ─────────────────────────────── Helpers ───────────────────────────────


def scale_quantity(quantity: Decimal, accepted_kg: Decimal, total_kg: Decimal) -> Decimal:
    """A member's share when ``accepted_kg`` of a ``total_kg`` lot is sold (pro-rata, 1 dp)."""
    if total_kg <= 0 or accepted_kg >= total_kg:
        return quantity
    scaled = (quantity * accepted_kg / total_kg).quantize(SCALE_STEP, rounding=ROUND_HALF_UP)
    return min(quantity, round_money(scaled))


def offer_side(offer: Offer, user: User) -> Side | None:
    """Which side of the negotiation ``user`` is on, if any."""
    if user.role == "buyer" and offer.buyer_id == user.id:
        return "buyer"
    if offer.target_type == "harvest":
        harvest = offer.harvest
        if user.role == "farmer" and harvest is not None and harvest.farmer_id == user.id:
            return "seller"
        return None
    if is_privileged(user):
        return "seller"
    return None


def _offer_link(offer_id: uuid.UUID, role: str) -> str:
    area = {"farmer": "farmer", "buyer": "buyer"}.get(role, "coordinator")
    return f"/app/{area}/offers/{offer_id}"


async def load_offer(db: AsyncSession, offer_id: uuid.UUID) -> Offer | None:
    return await db.scalar(
        select(Offer).where(Offer.id == offer_id).execution_options(populate_existing=True)
    )


async def _reload(db: AsyncSession, offer: Offer) -> Offer:
    await db.flush()
    reloaded = await load_offer(db, offer.id)
    assert reloaded is not None
    return reloaded


def _entry(
    offer: Offer,
    author: User | None,
    action: str,
    *,
    price: Decimal | None = None,
    quantity: Decimal | None = None,
    payment_terms_days: int | None = None,
    message: str | None = None,
) -> NegotiationEntry:
    return NegotiationEntry(
        offer_id=offer.id,
        author_id=author.id if author is not None else None,
        author_role=author.role if author is not None else "system",
        action=action,
        price_per_kg=price,
        quantity_kg=quantity,
        payment_terms_days=payment_terms_days,
        message=message,
    )


async def _seller_recipients(db: AsyncSession, offer: Offer) -> dict[str, list[uuid.UUID]]:
    """Seller-side users to notify, grouped by role (for role-specific links)."""
    if offer.target_type == "harvest":
        assert offer.harvest is not None
        return {"farmer": [offer.harvest.farmer_id]}
    lot = offer.lot
    assert lot is not None
    farmer_ids = [member.farmer_id for member in active_members(lot)]
    coordinators = await coordinator_ids_for(db, farmer_ids)
    if lot.coordinator_id is not None:
        coordinators = [lot.coordinator_id, *coordinators]
    return {"farmer": farmer_ids, "coordinator": list(dict.fromkeys(coordinators))}


async def _notify_side(
    db: AsyncSession,
    offer: Offer,
    side: Side,
    title: str,
    body: str,
    *,
    type_: NotificationType = "offer",
) -> None:
    if side == "buyer":
        groups = {"buyer": [offer.buyer_id]}
    else:
        groups = await _seller_recipients(db, offer)
    for role, user_ids in groups.items():
        await notify(db, user_ids, type_, title, body, link=_offer_link(offer.id, role))


async def _supply_limit_kg(db: AsyncSession, offer_target: Lot | Harvest) -> Decimal:
    """Most an offer may ask for: the lot's total, or the harvest's available kilograms."""
    if isinstance(offer_target, Lot):
        return lot_total_kg(offer_target)
    return (await available_kg_map(db, [offer_target.id])).get(offer_target.id, Decimal(0))


def _target(offer: Offer) -> Lot | Harvest:
    target = offer.lot if offer.target_type == "lot" else offer.harvest
    assert target is not None
    return target


# ─────────────────────────────── Presentation ───────────────────────────────


async def buyer_reliability_map(
    db: AsyncSession, buyer_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, float | None]:
    """% of each buyer's settlements past their due date that were paid in full on time."""
    ids = list(dict.fromkeys(buyer_ids))
    result: dict[uuid.UUID, float | None] = dict.fromkeys(ids)
    if not ids:
        return result
    rows = (
        await db.execute(
            select(
                Settlement.buyer_id,
                Settlement.payment_status,
                Settlement.paid_at,
                Settlement.due_date,
            ).where(Settlement.buyer_id.in_(ids), Settlement.due_date < today_ist())
        )
    ).all()
    counts: dict[uuid.UUID, list[int]] = defaultdict(lambda: [0, 0])
    for buyer_id, status, paid_at, due_date in rows:
        counts[buyer_id][1] += 1
        if status == "paid" and paid_at is not None and paid_at.astimezone(IST).date() <= due_date:
            counts[buyer_id][0] += 1
    for buyer_id, (on_time, total) in counts.items():
        result[buyer_id] = round(on_time / total * 100, 1)
    return result


def _author_name(entry: NegotiationEntry, viewer: User) -> str:
    author = entry.author
    if author is None:
        return SYSTEM_NAME
    if author.role == "farmer":
        return farmer_display_name(author, viewer)
    if author.role == "buyer":
        return buyer_name(author)
    return author.full_name


def _present(offer: Offer, viewer: User, reliability: float | None) -> schemas.Offer:
    buyer = offer.buyer
    return schemas.Offer(
        id=offer.id,
        code=offer.code,
        buyer_id=offer.buyer_id,
        buyer_name=buyer_name(buyer),
        buyer_verified=buyer.verification_status == "verified",
        buyer_reliability_pct=reliability,
        target_type=offer.target_type,
        lot_id=offer.lot_id,
        lot_code=offer.lot.code if offer.lot is not None else None,
        harvest_id=offer.harvest_id,
        demand_id=offer.demand_id,
        crop_id=offer.crop_id,
        crop_name=offer.crop.name,
        grade=offer.grade,
        price_per_kg=float(offer.price_per_kg),
        quantity_kg=float(offer.quantity_kg),
        pickup_terms=offer.pickup_terms,
        delivery_location=offer.delivery_location,
        delivery_latitude=offer.delivery_latitude,
        delivery_longitude=offer.delivery_longitude,
        payment_terms_days=offer.payment_terms_days,
        max_rejection_pct=float(offer.max_rejection_pct),
        quality_spec=offer.quality_spec,
        handling_charge_per_kg=float(offer.handling_charge_per_kg),
        commission_pct=float(offer.commission_pct),
        valid_until=offer.valid_until,
        status=offer.status,
        awaiting=offer.awaiting,
        notes=offer.notes,
        negotiation=[
            schemas.NegotiationEntry(
                id=entry.id,
                author_id=entry.author_id,
                author_name=_author_name(entry, viewer),
                author_role=entry.author_role,
                action=entry.action,
                price_per_kg=float(entry.price_per_kg) if entry.price_per_kg is not None else None,
                quantity_kg=float(entry.quantity_kg) if entry.quantity_kg is not None else None,
                payment_terms_days=entry.payment_terms_days,
                message=entry.message,
                created_at=entry.created_at,
            )
            for entry in offer.negotiation
        ],
        consents=[
            schemas.OfferConsent(
                member_id=consent.member_id,
                farmer_id=consent.farmer_id,
                farmer_name=farmer_display_name(consent.farmer, viewer),
                quantity_kg=float(consent.quantity_kg),
                decision=consent.decision,
                decided_at=consent.decided_at,
                is_mine=consent.farmer_id == viewer.id,
            )
            for consent in offer.consents
        ],
        created_at=offer.created_at,
        updated_at=offer.updated_at,
    )


async def offers_out(
    db: AsyncSession, offers: Sequence[Offer], viewer: User
) -> list[schemas.Offer]:
    """Batch version of :func:`offer_out`."""
    reliability = await buyer_reliability_map(db, [offer.buyer_id for offer in offers])
    return [_present(offer, viewer, reliability.get(offer.buyer_id)) for offer in offers]


async def offer_out(db: AsyncSession, offer: Offer, viewer: User) -> schemas.Offer:
    """The API ``Offer`` as ``viewer`` may see it."""
    return (await offers_out(db, [offer], viewer))[0]


# ─────────────────────────────── Expiry & visibility ───────────────────────────────


async def expire_stale_offers(db: AsyncSession) -> int:
    """Mark ``pending``/``countered`` offers past ``valid_until`` as ``expired``; return the count."""
    now = utcnow()
    expired_ids = (
        await db.scalars(
            update(Offer)
            .where(Offer.status.in_(NEGOTIABLE_STATUSES), Offer.valid_until < now)
            .values(status="expired", awaiting=None, updated_at=now)
            .returning(Offer.id)
            .execution_options(synchronize_session="fetch")
        )
    ).all()
    for offer_id in expired_ids:
        db.add(
            NegotiationEntry(
                offer_id=offer_id,
                author_id=None,
                author_role="system",
                action="note",
                message="Offer expired: it was not accepted before its validity ended",
            )
        )
    if expired_ids:
        await db.flush()
    return len(expired_ids)


def _visibility_condition(viewer: User) -> ColumnElement[bool]:
    if is_privileged(viewer):
        return true()
    if viewer.role == "buyer":
        return Offer.buyer_id == viewer.id
    if viewer.role == "farmer":
        own_harvests = select(Harvest.id).where(Harvest.farmer_id == viewer.id)
        own_lots = select(LotMember.lot_id).where(LotMember.farmer_id == viewer.id)
        return or_(
            and_(Offer.target_type == "harvest", Offer.harvest_id.in_(own_harvests)),
            and_(Offer.target_type == "lot", Offer.lot_id.in_(own_lots)),
        )
    return Offer.id.is_(None)  # transporters see no offers


def can_view_offer(offer: Offer, viewer: User) -> bool:
    if is_privileged(viewer):
        return True
    if viewer.role == "buyer":
        return offer.buyer_id == viewer.id
    if viewer.role == "farmer":
        if offer.target_type == "harvest":
            return offer.harvest is not None and offer.harvest.farmer_id == viewer.id
        return offer.lot is not None and any(
            member.farmer_id == viewer.id for member in offer.lot.members
        )
    return False


async def get_offer_for_viewer(db: AsyncSession, offer_id: uuid.UUID, viewer: User) -> Offer:
    """Load an offer the viewer may see (404 otherwise), expiring stale offers first."""
    await expire_stale_offers(db)
    offer = await load_offer(db, offer_id)
    if offer is None or not can_view_offer(offer, viewer):
        raise not_found("Offer")
    return offer


async def list_offers(
    db: AsyncSession,
    viewer: User,
    *,
    status: str | None = None,
    lot_id: uuid.UUID | None = None,
    harvest_id: uuid.UUID | None = None,
    limit: int = DEFAULT_LIST_LIMIT,
) -> list[Offer]:
    """Offers visible to ``viewer``, newest first (stale offers are expired first)."""
    if viewer.role == "transporter":
        raise forbidden("Transporters do not take part in offers")
    await expire_stale_offers(db)
    statement = select(Offer).where(_visibility_condition(viewer))
    if status is not None:
        statement = statement.where(Offer.status == status)
    if lot_id is not None:
        statement = statement.where(Offer.lot_id == lot_id)
    if harvest_id is not None:
        statement = statement.where(Offer.harvest_id == harvest_id)
    statement = statement.order_by(Offer.created_at.desc(), Offer.id.desc()).limit(limit)
    return list((await db.scalars(statement)).all())


# ─────────────────────────────── Create ───────────────────────────────


async def _has_open_offer(
    db: AsyncSession, buyer: User, *, lot_id: uuid.UUID | None, harvest_id: uuid.UUID | None
) -> bool:
    statement = select(Offer.id).where(
        Offer.buyer_id == buyer.id, Offer.status.in_(OPEN_OFFER_STATUSES)
    )
    if lot_id is not None:
        statement = statement.where(Offer.target_type == "lot", Offer.lot_id == lot_id)
    else:
        statement = statement.where(Offer.target_type == "harvest", Offer.harvest_id == harvest_id)
    return (await db.scalar(statement.limit(1))) is not None


async def create_offer(db: AsyncSession, req: schemas.OfferCreateRequest, buyer: User) -> Offer:
    """``POST /offers``: a buyer's offer on an open lot or a listed harvest."""
    if req.valid_until <= utcnow():
        raise field_error(("body", "valid_until"), "The offer must be valid until a future time")
    quantity = kg(req.quantity_kg)

    target: Lot | Harvest
    if req.target_type == "lot":
        assert req.lot_id is not None
        lot = await lot_service.get_lot_for_viewer(db, req.lot_id, buyer)
        if lot.status != "open_for_offers":
            raise conflict("Lot is not open for offers", "lot_not_open")
        target = lot
        target_label = f"lot {lot.code}"
    else:
        assert req.harvest_id is not None
        harvest = await db.get(Harvest, req.harvest_id)
        if harvest is None or harvest.status not in ("listed", "pooled"):
            raise not_found("Harvest")
        if harvest.status != "listed":
            raise conflict("This harvest is not open for direct offers", "harvest_not_open")
        target = harvest
        target_label = f"your {harvest.crop.name.lower()} harvest"

    if await _has_open_offer(
        db,
        buyer,
        lot_id=req.lot_id if req.target_type == "lot" else None,
        harvest_id=req.harvest_id,
    ):
        raise conflict(
            "You already have an open offer on this "
            + ("lot" if req.target_type == "lot" else "harvest"),
            "duplicate_offer",
        )
    limit = await _supply_limit_kg(db, target)
    if limit <= 0:
        raise conflict("Nothing is left to buy here", "nothing_available")
    if quantity > limit:
        raise conflict(
            f"Only {format_number(limit)} kg is available; offer at most that quantity",
            "quantity_exceeds_supply",
        )
    if req.demand_id is not None:
        demand = await db.get(Demand, req.demand_id)
        if demand is None or demand.buyer_id != buyer.id:
            raise not_found("Demand")
        if demand.crop_id != target.crop_id:
            raise conflict("The demand is for a different crop", "demand_mismatch")
        if demand.status in ("cancelled", "expired", "fulfilled"):
            raise conflict(f"The demand is {demand.status}", "demand_closed")

    price = round_money(to_decimal(req.price_per_kg))
    offer = Offer(
        code=await next_code(db, "offer"),
        buyer_id=buyer.id,
        target_type=req.target_type,
        lot_id=req.lot_id if req.target_type == "lot" else None,
        harvest_id=req.harvest_id if req.target_type == "harvest" else None,
        demand_id=req.demand_id,
        crop_id=target.crop_id,
        grade=target.grade,
        price_per_kg=price,
        quantity_kg=quantity,
        pickup_terms=req.pickup_terms,
        delivery_location=req.delivery_location,
        delivery_latitude=req.delivery_latitude,
        delivery_longitude=req.delivery_longitude,
        payment_terms_days=req.payment_terms_days,
        max_rejection_pct=round_money(to_decimal(req.max_rejection_pct)),
        quality_spec=req.quality_spec,
        handling_charge_per_kg=round_money(to_decimal(req.handling_charge_per_kg)),
        commission_pct=Decimal(0),
        valid_until=req.valid_until,
        status="pending",
        awaiting="seller",
        notes=req.notes,
    )
    db.add(offer)
    await db.flush()
    db.add(
        _entry(
            offer,
            buyer,
            "offer",
            price=price,
            quantity=quantity,
            payment_terms_days=req.payment_terms_days,
            message=req.notes,
        )
    )
    offer = await _reload(db, offer)
    await audit(
        db,
        buyer,
        "offer.create",
        "offer",
        offer.id,
        f"{buyer_name(buyer)} offered {format_rupees(price)}/kg for {format_number(quantity)} kg "
        f"on {target_label.replace('your ', '')} ({offer.code})",
        {"code": offer.code, "price_per_kg": price, "quantity_kg": quantity},
    )
    await _notify_side(
        db,
        offer,
        "seller",
        f"New offer {offer.code}",
        f"{buyer_name(buyer)} offers {format_rupees(price)}/kg for {format_number(quantity)} kg "
        f"on {target_label}.",
    )
    return offer


# ─────────────────────────────── Negotiation ───────────────────────────────


async def _ensure_negotiable(db: AsyncSession, offer: Offer, actor: User) -> Side:
    """The actor's side, after checking the offer is open, unexpired and awaiting them."""
    side = offer_side(offer, actor)
    if side is None:
        raise forbidden("Only the buyer or the seller side can act on this offer")
    if offer.status in NEGOTIABLE_STATUSES and offer.valid_until <= utcnow():
        await expire_stale_offers(db)
    if offer.status == "expired":
        await db.commit()  # keep the (lazy) expiry although the action fails
        raise conflict("This offer has expired", "offer_expired")
    if offer.status not in NEGOTIABLE_STATUSES:
        raise conflict(
            f"This offer is {offer.status} and can no longer be negotiated", "offer_not_negotiable"
        )
    if offer.awaiting != side:
        raise forbidden(f"Waiting for the {offer.awaiting} to respond")
    return side


def _other(side: Side) -> Side:
    return "seller" if side == "buyer" else "buyer"


def _actor_label(offer: Offer, actor: User, side: Side) -> str:
    if side == "buyer":
        return buyer_name(actor)
    if offer.target_type == "harvest":
        return mask_name(actor.full_name)
    return f"{actor.full_name} (MandiMate coordinator)"


async def counter_offer(
    db: AsyncSession, offer: Offer, req: schemas.CounterRequest, actor: User
) -> Offer:
    """``POST /offers/{id}/counter`` by the side that is awaited."""
    side = await _ensure_negotiable(db, offer, actor)
    quantity = kg(req.quantity_kg) if req.quantity_kg is not None else offer.quantity_kg
    if req.quantity_kg is not None:
        limit = await _supply_limit_kg(db, _target(offer))
        if quantity > limit:
            raise conflict(
                f"Only {format_number(limit)} kg is available", "quantity_exceeds_supply"
            )
    price = round_money(to_decimal(req.price_per_kg))
    offer.price_per_kg = price
    offer.quantity_kg = quantity
    if req.payment_terms_days is not None:
        offer.payment_terms_days = req.payment_terms_days
    offer.status = "countered" if side == "seller" else "pending"
    offer.awaiting = _other(side)
    db.add(
        _entry(
            offer,
            actor,
            "counter",
            price=price,
            quantity=quantity,
            payment_terms_days=offer.payment_terms_days,
            message=req.message,
        )
    )
    offer = await _reload(db, offer)
    await audit(
        db,
        actor,
        "offer.counter",
        "offer",
        offer.id,
        f"{actor.full_name} countered {offer.code} at {format_rupees(price)}/kg for "
        f"{format_number(quantity)} kg",
        {"price_per_kg": price, "quantity_kg": quantity, "side": side},
    )
    await _notify_side(
        db,
        offer,
        _other(side),
        f"Counter-offer on {offer.code}",
        f"{_actor_label(offer, actor, side)} countered at {format_rupees(price)}/kg for "
        f"{format_number(quantity)} kg.",
    )
    return offer


async def reject_offer(
    db: AsyncSession, offer: Offer, req: schemas.OfferActionRequest, actor: User
) -> Offer:
    """``POST /offers/{id}/reject`` by the side that is awaited."""
    side = await _ensure_negotiable(db, offer, actor)
    offer.status = "rejected"
    offer.awaiting = None
    db.add(_entry(offer, actor, "reject", message=req.message))
    offer = await _reload(db, offer)
    await audit(
        db,
        actor,
        "offer.reject",
        "offer",
        offer.id,
        f"{actor.full_name} rejected {offer.code}",
        {"side": side, "message": req.message},
    )
    await _notify_side(
        db,
        offer,
        _other(side),
        f"Offer {offer.code} rejected",
        f"{_actor_label(offer, actor, side)} rejected the offer"
        + (f": {req.message}" if req.message else "."),
    )
    return offer


async def withdraw_offer(
    db: AsyncSession, offer: Offer, req: schemas.OfferActionRequest, actor: User
) -> Offer:
    """``POST /offers/{id}/withdraw``: the buyer withdraws before acceptance."""
    if offer_side(offer, actor) != "buyer":
        raise forbidden("Only the buyer who made the offer can withdraw it")
    if offer.status not in OPEN_OFFER_STATUSES:
        raise conflict(f"This offer is {offer.status} and cannot be withdrawn", "offer_closed")
    was_proposed = offer.status == "proposed"
    offer.status = "withdrawn"
    offer.awaiting = None
    db.add(_entry(offer, actor, "withdraw", message=req.message))
    offer = await _reload(db, offer)
    await audit(
        db,
        actor,
        "offer.withdraw",
        "offer",
        offer.id,
        f"{buyer_name(actor)} withdrew {offer.code}",
        {"message": req.message},
    )
    await _notify_side(
        db,
        offer,
        "seller",
        f"Offer {offer.code} withdrawn",
        f"{buyer_name(actor)} withdrew the offer"
        + (" while farmers were reviewing it" if was_proposed else "")
        + (f": {req.message}" if req.message else "."),
    )
    return offer


# ─────────────────────────────── Acceptance ───────────────────────────────


async def accept_offer(
    db: AsyncSession, offer: Offer, req: schemas.OfferActionRequest, actor: User
) -> Offer:
    """``POST /offers/{id}/accept``: harvest offers are accepted (solo lot); lot offers go to
    the member farmers for consent (``proposed``)."""
    side = await _ensure_negotiable(db, offer, actor)
    db.add(
        _entry(
            offer,
            actor,
            "accept",
            price=offer.price_per_kg,
            quantity=offer.quantity_kg,
            payment_terms_days=offer.payment_terms_days,
            message=req.message,
        )
    )
    if offer.target_type == "harvest":
        harvest = offer.harvest
        assert harvest is not None
        if harvest.status not in DIRECT_ACCEPT_HARVEST_STATUSES:
            raise conflict("This harvest is no longer open for direct offers", "harvest_not_open")
        harvest = (await lot_service.lock_harvests(db, [harvest.id]))[0]
        room = (await lot_service.direct_sale_kg_map(db, [harvest.id])).get(harvest.id, Decimal(0))
        if room <= 0:
            raise conflict("Nothing is left of this harvest", "nothing_available")
        shortfall = min(offer.quantity_kg, room) - await _supply_limit_kg(db, harvest)
        if shortfall > 0:
            await _withdraw_from_pools(db, offer, harvest, shortfall, actor)
            offer = await _reload(db, offer)
        await audit(
            db,
            actor,
            "offer.accept",
            "offer",
            offer.id,
            f"{actor.full_name} accepted {offer.code}",
            {"side": side, "message": req.message},
        )
        return await _finalize_acceptance(db, offer, actor)

    lot = offer.lot
    assert lot is not None
    if lot.status != "open_for_offers":
        raise conflict("Lot is not open for offers", "lot_not_open")
    other_proposed = await db.scalar(
        select(Offer.code).where(
            Offer.lot_id == lot.id, Offer.status == "proposed", Offer.id != offer.id
        )
    )
    if other_proposed is not None:
        raise conflict(
            f"Offer {other_proposed} is already awaiting the farmers' consent",
            "another_offer_proposed",
        )
    members = [member for member in lot.members if member.consent_status == "accepted"]
    if not members:
        raise conflict("No farmer in this lot can take part in the deal", "no_accepted_members")
    total = sum((member.quantity_kg for member in members), Decimal(0))
    accepted_kg = min(offer.quantity_kg, total)
    offer.status = "proposed"
    offer.awaiting = "farmers"
    for index, member in enumerate(members):
        db.add(
            OfferConsent(
                offer_id=offer.id,
                member_id=member.id,
                farmer_id=member.farmer_id,
                quantity_kg=scale_quantity(member.quantity_kg, accepted_kg, total),
                decision="pending",
                created_at=utcnow() + timedelta(microseconds=index),
            )
        )
    db.add(
        _entry(
            offer,
            None,
            "propose",
            price=offer.price_per_kg,
            quantity=accepted_kg,
            payment_terms_days=offer.payment_terms_days,
            message=f"Sent to {len(members)} farmers for consent",
        )
    )
    offer = await _reload(db, offer)
    await audit(
        db,
        actor,
        "offer.propose",
        "offer",
        offer.id,
        f"{actor.full_name} accepted {offer.code}; awaiting consent of {len(members)} farmers",
        {"side": side, "accepted_kg": accepted_kg, "message": req.message},
    )
    for consent in offer.consents:
        await notify(
            db,
            [consent.farmer_id],
            "consent",
            "Review the deal and consent",
            f"{buyer_name(offer.buyer)} offers {format_rupees(offer.price_per_kg)}/kg for lot "
            f"{lot.code}; your share is {format_number(consent.quantity_kg)} kg.",
            link=_offer_link(offer.id, "farmer"),
        )
    if side == "seller":
        await _notify_side(
            db,
            offer,
            "buyer",
            f"Offer {offer.code} accepted by the coordinator",
            "The farmers in the lot are now reviewing the deal.",
        )
    else:
        await _notify_side(
            db,
            offer,
            "seller",
            f"{buyer_name(offer.buyer)} accepted your counter on {offer.code}",
            "The deal has been sent to the farmers for consent.",
        )
    return offer


async def _withdraw_from_pools(
    db: AsyncSession, offer: Offer, harvest: Harvest, needed_kg: Decimal, actor: User
) -> Decimal:
    """Free ``needed_kg`` of ``harvest`` for direct offer ``offer`` (DOMAIN_RULES §3).

    Withdraws the farmer from pools that have no accepted offer, newest first, until enough kg
    are free: member consent ``declined`` ("Sold directly to <buyer>"), that member's open deal
    consents declined (deals resolved), lot status refreshed, coordinator notified, audited.
    A pool with an accepted offer is never touched. Returns the kilograms freed.
    """
    buyer = buyer_name(offer.buyer)
    note = f"Sold directly to {buyer}"
    farmer = harvest.farmer
    lot_ids = (
        await db.scalars(
            select(Lot.id)
            .join(LotMember, LotMember.lot_id == Lot.id)
            .where(
                LotMember.harvest_id == harvest.id,
                LotMember.consent_status != "declined",
                Lot.status != "cancelled",
                Lot.accepted_offer_id.is_(None),
            )
            .order_by(Lot.created_at.desc(), Lot.id.desc())
        )
    ).all()
    freed = Decimal(0)
    now = utcnow()
    for lot_id in dict.fromkeys(lot_ids):
        if freed >= needed_kg:
            break
        lot = await lot_service.load_lot(db, lot_id)
        assert lot is not None
        lot = await lot_service.lock_lot(db, lot)
        if lot.accepted_offer_id is not None or lot.status == "cancelled":
            continue
        members = [
            member
            for member in lot.members
            if member.harvest_id == harvest.id and member.consent_status != "declined"
        ]
        if not members:
            continue
        withdrawn_kg = sum((member.quantity_kg for member in members), Decimal(0))
        for member in members:
            member.consent_status = "declined"
            member.consented_at = now
            member.consent_note = note
            member.consent_recorded_by_id = None
        freed += withdrawn_kg
        deals = (
            await db.scalars(
                select(Offer).where(Offer.lot_id == lot.id, Offer.status == "proposed")
            )
        ).all()
        member_ids = {member.id for member in members}
        for deal in deals:
            for consent in deal.consents:
                if consent.member_id in member_ids and consent.decision != "declined":
                    consent.decision = "declined"
                    consent.decided_at = now
                    consent.note = note
                    consent.recorded_by_id = None
                    db.add(
                        _entry(
                            deal,
                            None,
                            "consent",
                            quantity=consent.quantity_kg,
                            message=f"{mask_name(farmer.full_name)} declined: {note}",
                        )
                    )
        await audit(
            db,
            actor,
            "lot.member_withdrawn",
            "lot",
            lot.id,
            f"{farmer.full_name} withdrew {format_number(withdrawn_kg)} kg from lot {lot.code}: "
            f"{note} ({offer.code})",
            {
                "member_ids": sorted(member_ids),
                "harvest_id": harvest.id,
                "offer_id": offer.id,
                "quantity_kg": withdrawn_kg,
            },
        )
        await db.flush()
        for deal in deals:
            await _resolve_consents(db, await _reload(db, deal), actor)
        lot = await lot_service.reload_lot(db, lot)
        await lot_service.refresh_after_withdrawal(db, lot)
        await lot_service.notify_lot_coordinators(
            db,
            lot,
            f"{farmer.full_name} left lot {lot.code}",
            f"{format_number(withdrawn_kg)} kg were sold directly to {buyer} ({offer.code}); "
            f"the lot now holds {format_number(lot_total_kg(lot))} kg.",
        )
    return freed


async def _solo_coordinator_id(db: AsyncSession, farmer: User) -> uuid.UUID | None:
    if farmer.fpo_id is None:
        return None
    return await db.scalar(
        select(User.id)
        .where(User.role == "coordinator", User.fpo_id == farmer.fpo_id, User.is_active.is_(True))
        .order_by(User.created_at, User.id)
        .limit(1)
    )


async def _create_solo_lot(
    db: AsyncSession, offer: Offer, harvest: Harvest, quantity: Decimal, actor: User | None
) -> Lot:
    """The single-harvest lot that carries an accepted direct offer through logistics."""
    farmer = harvest.farmer
    coordinates = next(
        (
            (lat, lng)
            for lat, lng in (
                (harvest.latitude, harvest.longitude),
                (farmer.latitude, farmer.longitude),
            )
            if lat is not None and lng is not None
        ),
        None,
    )
    if coordinates is None:
        raise conflict(
            "The harvest has no location; add the farm location before accepting",
            "location_missing",
        )
    now = utcnow()
    lot = Lot(
        code=await next_code(db, "lot", harvest.crop.code),
        crop_id=harvest.crop_id,
        grade=harvest.grade,
        demand_id=offer.demand_id,
        target_quantity_kg=quantity,
        collection_point_name=harvest.village or farmer.village or f"{farmer.full_name}'s farm",
        collection_latitude=coordinates[0],
        collection_longitude=coordinates[1],
        district=harvest.district,
        state=harvest.state,
        pickup_date=max(today_ist(), harvest.available_from),
        status="offer_accepted",
        is_solo=True,
        coordinator_id=await _solo_coordinator_id(db, farmer),
        created_by_id=actor.id if actor is not None else None,
        pickup_terms=offer.pickup_terms,
        members=[
            LotMember(
                harvest_id=harvest.id,
                farmer_id=harvest.farmer_id,
                quantity_kg=quantity,
                distance_km=Decimal("0.0"),
                consent_status="accepted",
                consented_at=now,
                consent_note=f"Direct offer {offer.code} accepted",
            )
        ],
    )
    db.add(lot)
    await db.flush()
    await audit(
        db,
        actor,
        "lot.create",
        "lot",
        lot.id,
        f"Solo lot {lot.code} created for direct offer {offer.code}: {format_number(quantity)} kg",
        {"code": lot.code, "offer_id": offer.id, "harvest_id": harvest.id, "is_solo": True},
    )
    return lot


async def _finalize_acceptance(db: AsyncSession, offer: Offer, actor: User | None) -> Offer:
    """Offer ``accepted``: lot ``offer_accepted`` (solo lot for a harvest offer), member
    quantities scaled to the accepted quantity, other open offers rejected, demand matched."""
    now = utcnow()
    if offer.target_type == "harvest":
        harvest = offer.harvest
        assert harvest is not None
        accepted_kg = min(offer.quantity_kg, await _supply_limit_kg(db, harvest))
        lot = await _create_solo_lot(db, offer, harvest, accepted_kg, actor)
        offer.lot_id = lot.id
        others = (
            await db.scalars(
                select(Offer).where(
                    Offer.target_type == "harvest",
                    Offer.harvest_id == harvest.id,
                    Offer.id != offer.id,
                    Offer.status.in_(OPEN_OFFER_STATUSES),
                )
            )
        ).all()
        closed_message = f"Another offer for this harvest ({offer.code}) was accepted"
    else:
        lot = offer.lot
        assert lot is not None
        members = active_members(lot)
        total = lot_total_kg(lot)
        accepted_kg = min(offer.quantity_kg, total)
        consents = {consent.member_id: consent for consent in offer.consents}
        for member in members:
            member.quantity_kg = scale_quantity(member.quantity_kg, accepted_kg, total)
            if member.id in consents:
                consents[member.id].quantity_kg = member.quantity_kg
        others = (
            await db.scalars(
                select(Offer).where(
                    Offer.lot_id == lot.id,
                    Offer.id != offer.id,
                    Offer.status.in_(OPEN_OFFER_STATUSES),
                )
            )
        ).all()
        closed_message = f"Another offer for lot {lot.code} ({offer.code}) was accepted"

    offer.quantity_kg = accepted_kg
    offer.status = "accepted"
    offer.awaiting = None
    offer.accepted_at = now
    lot.status = "offer_accepted"
    lot.accepted_offer_id = offer.id
    lot.pickup_terms = offer.pickup_terms
    if lot.demand_id is None:
        lot.demand_id = offer.demand_id
    await reject_offers(db, others, closed_message)
    if offer.demand_id is not None:
        demand = await db.get(Demand, offer.demand_id)
        if demand is not None and demand.status == "open":
            demand.status = "matched"
    await db.flush()
    for member in lot.members:
        await lot_service.sync_harvest_status(db, member.harvest_id)

    offer = await _reload(db, offer)
    lot = await lot_service.load_lot(db, lot.id)
    assert lot is not None
    await audit(
        db,
        actor,
        "offer.accepted",
        "offer",
        offer.id,
        f"Deal {offer.code} agreed: {format_number(accepted_kg)} kg at "
        f"{format_rupees(offer.price_per_kg)}/kg with {buyer_name(offer.buyer)} (lot {lot.code})",
        {
            "lot_id": lot.id,
            "accepted_kg": accepted_kg,
            "price_per_kg": offer.price_per_kg,
            "rejected_offers": [other.code for other in others],
        },
    )
    deal = (
        f"{format_number(accepted_kg)} kg at {format_rupees(offer.price_per_kg)}/kg "
        f"(lot {lot.code})"
    )
    await notify(
        db,
        [offer.buyer_id],
        "offer",
        f"Deal agreed: {offer.code}",
        f"Your offer was accepted: {deal}.",
        link=f"/app/buyer/orders/{lot.id}",
    )
    for member in active_members(lot):
        await notify(
            db,
            [member.farmer_id],
            "offer",
            f"Deal agreed with {buyer_name(offer.buyer)}",
            f"You are selling {format_number(member.quantity_kg)} kg at "
            f"{format_rupees(offer.price_per_kg)}/kg (lot {lot.code}).",
            link=lot_service.farmer_link(lot.id),
        )
    return offer


async def record_offer_consent(
    db: AsyncSession,
    offer: Offer,
    req: schemas.ConsentRequest,
    actor: User,
    member_id: uuid.UUID | None = None,
) -> Offer:
    """``POST /offers/{id}/consent``: a member farmer (or a coordinator, assisted) decides."""
    assisted = is_privileged(actor)
    if assisted:
        if member_id is None:
            raise field_error(
                ("query", "member_id"), "Choose the lot member whose consent you are recording"
            )
        consents = [consent for consent in offer.consents if consent.member_id == member_id]
        if not consents:
            raise not_found("Lot member")
    elif actor.role == "farmer":
        consents = [
            consent
            for consent in offer.consents
            if consent.farmer_id == actor.id and member_id in (None, consent.member_id)
        ]
        if not consents and offer.status == "proposed":
            raise forbidden("This deal does not include your harvest")
    else:
        raise forbidden("Only the lot's farmers or a coordinator can consent to a deal")
    if offer.status != "proposed":
        raise conflict("This offer is not awaiting farmer consent", "offer_not_proposed")
    pending = [consent for consent in consents if consent.decision == "pending"]
    if not pending:
        raise conflict("This consent has already been recorded", "consent_already_recorded")

    now = utcnow()
    verb = "accepted" if req.decision == "accepted" else "declined"
    for consent in pending:
        consent.decision = req.decision
        consent.decided_at = now
        consent.note = req.note
        consent.recorded_by_id = actor.id if assisted else None
        if req.decision == "declined":
            member = consent.member
            member.consent_status = "declined"
            member.consented_at = now
            member.consent_note = f"Declined deal {offer.code}" + (
                f": {req.note}" if req.note else ""
            )
            member.consent_recorded_by_id = actor.id if assisted else None
        farmer = consent.farmer
        db.add(
            _entry(
                offer,
                actor,
                "consent",
                quantity=consent.quantity_kg,
                message=(
                    f"{mask_name(farmer.full_name)} {verb}"
                    + (" (recorded by a coordinator)" if assisted else "")
                    + (f": {req.note}" if req.note else "")
                ),
            )
        )
        summary = (
            f"Assisted consent: {actor.full_name} recorded that {farmer.full_name} {verb} "
            f"deal {offer.code}"
            if assisted
            else f"{farmer.full_name} {verb} deal {offer.code}"
        )
        await audit(
            db,
            actor,
            "offer.assisted_consent" if assisted else "offer.consent",
            "offer",
            offer.id,
            summary,
            {"member_id": consent.member_id, "decision": req.decision, "note": req.note},
        )
        if assisted:
            await notify(
                db,
                [consent.farmer_id],
                "consent",
                f"Consent recorded for deal {offer.code}",
                f"{actor.full_name} recorded that you {verb} the deal.",
                link=_offer_link(offer.id, "farmer"),
            )
    await db.flush()
    for consent in pending:
        if consent.decision == "declined":
            await lot_service.sync_harvest_status(db, consent.member.harvest_id)

    return await _resolve_consents(db, await _reload(db, offer), actor)


async def _resolve_consents(db: AsyncSession, offer: Offer, actor: User | None) -> Offer:
    """Once no consent is pending: finalize with the farmers who accepted, or reject the deal."""
    if offer.status != "proposed" or any(c.decision == "pending" for c in offer.consents):
        return offer
    if any(consent.decision == "accepted" for consent in offer.consents):
        return await _finalize_acceptance(db, offer, actor)

    offer.status = "rejected"
    offer.awaiting = None
    db.add(_entry(offer, None, "reject", message="Every farmer declined the deal"))
    offer = await _reload(db, offer)
    await audit(
        db,
        actor,
        "offer.reject",
        "offer",
        offer.id,
        f"Deal {offer.code} rejected: every farmer declined",
        {"automatic": True},
    )
    await _notify_side(
        db,
        offer,
        "buyer",
        f"Offer {offer.code} declined",
        "The farmers in the lot declined the deal.",
    )
    lot = offer.lot
    if lot is not None and lot.coordinator_id is not None:
        await notify(
            db,
            [lot.coordinator_id],
            "offer",
            f"Deal {offer.code} declined by every farmer",
            f"Lot {lot.code} has no farmers left for this deal.",
            link=_offer_link(offer.id, "coordinator"),
        )
    return offer
