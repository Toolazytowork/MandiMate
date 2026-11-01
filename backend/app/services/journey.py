"""The 8-step deal journey (DOMAIN_RULES §7).

Every lot (and every harvest, through its most advanced active lot) moves through the same eight
steps: listed → grouped → offers → compared → consent → transport → delivered → settled. A step
is ``complete`` (or ``skipped`` — transport for ``buyer_pickup`` deals), the first step that is
neither is ``current`` and the rest are ``upcoming``. Timestamps are real event times read from
the lot, its offers and negotiation thread, transport stops, delivery and settlement.

The facts behind the steps are loaded in bulk (:func:`load_lot_facts`) so lot lists compute every
journey step with a fixed number of queries.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import and_, func, or_, select

from app import schemas
from app.models import (
    AuditLog,
    Delivery,
    Harvest,
    Lot,
    LotMember,
    NegotiationEntry,
    Offer,
    OfferConsent,
    Settlement,
    TransportQuote,
    TransportRequest,
    TransportStop,
)
from app.services.pricing import format_number, format_rupees, vehicle_label

if TYPE_CHECKING:
    from collections.abc import Sequence

    from sqlalchemy.ext.asyncio import AsyncSession

JOURNEY_STEPS: tuple[tuple[schemas.JourneyKey, str], ...] = (
    ("listed", "Listed"),
    ("grouped", "Grouped into a lot"),
    ("offers", "Offers received"),
    ("compared", "Offers compared"),
    ("consent", "Deal agreed"),
    ("transport", "Pickup"),
    ("delivered", "Delivered"),
    ("settled", "Settled"),
)

LOT_STATUS_RANK: dict[str, int] = {
    "cancelled": -1,
    "forming": 0,
    "awaiting_consent": 1,
    "open_for_offers": 2,
    "offer_accepted": 3,
    "transport_booked": 4,
    "in_transit": 5,
    "delivered": 6,
    "settled": 7,
}
"""Progress order of lot statuses (cancelled lots are not active)."""

OPENED_ACTION = "lot.opened"
"""Audit action written whenever a lot becomes ``open_for_offers`` (manually or automatically)."""

NEGOTIATION_STEP_ACTIONS = ("counter", "propose", "accept")
ACTIVE_REQUEST_EXCLUDED = ("cancelled",)
BOOKED_REQUEST_STATUSES = ("booked", "in_progress", "completed")


@dataclass
class LotFacts:
    """Everything outside the ``Lot`` row that the journey and the lot presenter need."""

    offers_count: int = 0
    first_offer_at: datetime | None = None
    best_price_per_kg: Decimal | None = None
    negotiation_at: datetime | None = None
    """First counter, proposal or acceptance."""
    latest_negotiation: tuple[str, Decimal | None] | None = None
    """(action, price) of the most recent counter, proposal or acceptance."""
    open_statuses: set[str] = field(default_factory=set)
    """Statuses of the lot's offers."""
    consent_progress: tuple[int, int] | None = None
    """(accepted, total) consents of a ``proposed`` offer on the lot."""
    opened_at: datetime | None = None
    transport_request_id: uuid.UUID | None = None
    transport_status: str | None = None
    transport_vehicle: str | None = None
    first_pickup_at: datetime | None = None
    delivery_recorded_at: datetime | None = None
    settlement_id: uuid.UUID | None = None
    settlement_status: str | None = None
    settlement_gross: Decimal | None = None
    settlement_due_date: date | None = None
    settlement_paid_at: datetime | None = None


def _plural(count: int, singular: str, plural: str | None = None) -> str:
    return f"{count} {singular if count == 1 else (plural or singular + 's')}"


def _short_date(value: date) -> str:
    """``28 Oct``."""
    return f"{value.day} {value.strftime('%b')}"


def buyer_display_name(org: str | None, full_name: str) -> str:
    """Buyers are shown by their organisation when they have one."""
    return org or full_name


async def load_lot_facts(db: AsyncSession, lots: Sequence[Lot]) -> dict[uuid.UUID, LotFacts]:
    """Bulk-load offers, negotiation, transport, delivery and settlement facts for ``lots``."""
    facts: dict[uuid.UUID, LotFacts] = {lot.id: LotFacts() for lot in lots}
    if not lots:
        return facts
    lot_ids = list(facts)

    # Solo lots also count the direct offers made on their single harvest.
    solo_harvest_to_lot: dict[uuid.UUID, uuid.UUID] = {}
    for lot in lots:
        if lot.is_solo and lot.members:
            solo_harvest_to_lot[lot.members[0].harvest_id] = lot.id

    offer_filter = Offer.lot_id.in_(lot_ids)
    if solo_harvest_to_lot:
        offer_filter = or_(
            offer_filter,
            and_(
                Offer.target_type == "harvest",
                Offer.harvest_id.in_(list(solo_harvest_to_lot)),
            ),
        )
    offer_rows = (
        await db.execute(
            select(
                Offer.id,
                Offer.lot_id,
                Offer.harvest_id,
                Offer.target_type,
                Offer.status,
                Offer.price_per_kg,
                Offer.created_at,
            ).where(offer_filter)
        )
    ).all()
    offer_lot: dict[uuid.UUID, uuid.UUID] = {}
    proposed_offer_ids: list[uuid.UUID] = []
    for offer_id, lot_id, harvest_id, target_type, status, price, created_at in offer_rows:
        owner = lot_id if lot_id in facts else None
        if owner is None and target_type == "harvest":
            owner = solo_harvest_to_lot.get(harvest_id)
        if owner is None:
            continue
        offer_lot[offer_id] = owner
        lot_facts = facts[owner]
        lot_facts.offers_count += 1
        lot_facts.open_statuses.add(status)
        if lot_facts.first_offer_at is None or created_at < lot_facts.first_offer_at:
            lot_facts.first_offer_at = created_at
        if status not in ("withdrawn", "expired") and (
            lot_facts.best_price_per_kg is None or price > lot_facts.best_price_per_kg
        ):
            lot_facts.best_price_per_kg = price
        if status == "proposed":
            proposed_offer_ids.append(offer_id)

    if offer_lot:
        entry_rows = (
            await db.execute(
                select(
                    NegotiationEntry.offer_id,
                    NegotiationEntry.action,
                    NegotiationEntry.price_per_kg,
                    NegotiationEntry.created_at,
                )
                .where(
                    NegotiationEntry.offer_id.in_(list(offer_lot)),
                    NegotiationEntry.action.in_(NEGOTIATION_STEP_ACTIONS),
                )
                .order_by(NegotiationEntry.created_at, NegotiationEntry.id)
            )
        ).all()
        for offer_id, action, price, created_at in entry_rows:
            lot_facts = facts[offer_lot[offer_id]]
            if lot_facts.negotiation_at is None:
                lot_facts.negotiation_at = created_at
            lot_facts.latest_negotiation = (action, price)

    if proposed_offer_ids:
        consent_rows = (
            await db.execute(
                select(OfferConsent.offer_id, OfferConsent.decision).where(
                    OfferConsent.offer_id.in_(proposed_offer_ids)
                )
            )
        ).all()
        progress: dict[uuid.UUID, list[int]] = defaultdict(lambda: [0, 0])
        for offer_id, decision in consent_rows:
            counts = progress[offer_lot[offer_id]]
            counts[1] += 1
            if decision == "accepted":
                counts[0] += 1
        for lot_id, (accepted, total) in progress.items():
            facts[lot_id].consent_progress = (accepted, total)

    opened_rows = (
        await db.execute(
            select(AuditLog.entity_id, func.min(AuditLog.created_at))
            .where(
                AuditLog.entity_type == "lot",
                AuditLog.action == OPENED_ACTION,
                AuditLog.entity_id.in_([str(lot_id) for lot_id in lot_ids]),
            )
            .group_by(AuditLog.entity_id)
        )
    ).all()
    for entity_id, opened_at in opened_rows:
        facts[uuid.UUID(entity_id)].opened_at = opened_at

    request_rows = (
        await db.execute(
            select(
                TransportRequest.id,
                TransportRequest.lot_id,
                TransportRequest.status,
                TransportRequest.suggested_vehicle_type,
                TransportQuote.vehicle_type,
            )
            .outerjoin(TransportQuote, TransportQuote.id == TransportRequest.booked_quote_id)
            .where(
                TransportRequest.lot_id.in_(lot_ids),
                TransportRequest.status.not_in(ACTIVE_REQUEST_EXCLUDED),
            )
            .order_by(TransportRequest.created_at, TransportRequest.id)
        )
    ).all()
    for request_id, lot_id, status, suggested, booked_vehicle in request_rows:
        lot_facts = facts[lot_id]  # latest request wins (rows are oldest first)
        lot_facts.transport_request_id = request_id
        lot_facts.transport_status = status
        lot_facts.transport_vehicle = booked_vehicle or suggested

    pickup_rows = (
        await db.execute(
            select(TransportRequest.lot_id, func.min(TransportStop.picked_up_at))
            .join(TransportStop, TransportStop.request_id == TransportRequest.id)
            .where(
                TransportRequest.lot_id.in_(lot_ids),
                TransportStop.picked_up_at.is_not(None),
            )
            .group_by(TransportRequest.lot_id)
        )
    ).all()
    for lot_id, picked_at in pickup_rows:
        facts[lot_id].first_pickup_at = picked_at

    delivery_rows = (
        await db.execute(
            select(Delivery.lot_id, Delivery.recorded_at).where(Delivery.lot_id.in_(lot_ids))
        )
    ).all()
    for lot_id, recorded_at in delivery_rows:
        facts[lot_id].delivery_recorded_at = recorded_at

    settlement_rows = (
        await db.execute(
            select(
                Settlement.id,
                Settlement.lot_id,
                Settlement.payment_status,
                Settlement.gross_amount,
                Settlement.due_date,
                Settlement.paid_at,
            ).where(Settlement.lot_id.in_(lot_ids))
        )
    ).all()
    for settlement_id, lot_id, status, gross, due_date, paid_at in settlement_rows:
        lot_facts = facts[lot_id]
        lot_facts.settlement_id = settlement_id
        lot_facts.settlement_status = status
        lot_facts.settlement_gross = gross
        lot_facts.settlement_due_date = due_date
        lot_facts.settlement_paid_at = paid_at
    return facts


def _active_members(lot: Lot) -> list[LotMember]:
    return [member for member in lot.members if member.consent_status != "declined"]


def build_steps(lot: Lot, facts: LotFacts) -> list[schemas.JourneyStep]:
    """The eight steps of ``lot`` from its row and loaded facts."""
    rank = LOT_STATUS_RANK[lot.status]
    active = _active_members(lot)
    accepted = [member for member in active if member.consent_status == "accepted"]
    total_kg = sum((member.quantity_kg for member in active), Decimal(0))
    accepted_offer = lot.accepted_offer

    # (complete, skipped, at, detail) per step.
    results: list[tuple[bool, bool, datetime | None, str | None]] = []

    # 1 · listed
    results.append(
        (True, False, lot.created_at, f"{_plural(len(lot.members), 'harvest')} · {lot.code}")
    )

    # 2 · grouped
    grouped = lot.is_solo or (
        bool(accepted)
        and (rank >= LOT_STATUS_RANK["open_for_offers"] or facts.opened_at is not None)
    )
    if grouped:
        consented = [member.consented_at for member in accepted if member.consented_at]
        grouped_at = facts.opened_at or (
            lot.created_at if lot.is_solo or not consented else max(consented)
        )
        grouped_detail = (
            f"{_plural(len(active), 'farmer')} · {format_number(total_kg)} kg"
            if not lot.is_solo
            else f"Direct sale · {format_number(total_kg)} kg"
        )
    else:
        grouped_at = None
        grouped_detail = (
            f"{len(accepted)} of {_plural(len(active), 'farmer')} consented"
            if active
            else "Waiting for farmers to join"
        )
    results.append((grouped, False, grouped_at, grouped_detail))

    # 3 · offers
    has_offers = facts.offers_count > 0
    offers_detail = None
    if has_offers:
        offers_detail = _plural(facts.offers_count, "offer")
        if facts.best_price_per_kg is not None:
            offers_detail += f" · best {format_rupees(facts.best_price_per_kg)}/kg"
    results.append((has_offers, False, facts.first_offer_at, offers_detail))

    # 4 · compared
    compared = facts.negotiation_at is not None or bool(
        facts.open_statuses & {"countered", "proposed", "accepted"}
    )
    compared_detail = None
    if facts.latest_negotiation is not None:
        action, price = facts.latest_negotiation
        price_text = f" at {format_rupees(price)}/kg" if price is not None else ""
        compared_detail = {
            "counter": f"Countered{price_text}",
            "propose": f"Proposed to farmers{price_text}",
            "accept": f"Agreed{price_text}",
        }[action]
    elif has_offers:
        compared_detail = "Compare net earnings of each offer"
    results.append((compared, False, facts.negotiation_at, compared_detail))

    # 5 · consent (deal agreed)
    agreed = lot.accepted_offer_id is not None or rank >= LOT_STATUS_RANK["offer_accepted"]
    consent_detail = None
    consent_at = None
    if accepted_offer is not None:
        consent_at = accepted_offer.accepted_at
        buyer = accepted_offer.buyer
        consent_detail = (
            f"Accepted {buyer_display_name(buyer.organization_name, buyer.full_name)} "
            f"at {format_rupees(accepted_offer.price_per_kg)}/kg"
        )
    elif facts.consent_progress is not None:
        done, total = facts.consent_progress
        consent_detail = f"{done} of {_plural(total, 'farmer')} consented"
    results.append((agreed, False, consent_at, consent_detail))

    # 6 · transport
    if lot.pickup_terms == "buyer_pickup":
        results.append((False, True, None, "Buyer collects from the collection point"))
    else:
        picked = facts.first_pickup_at is not None or rank >= LOT_STATUS_RANK["in_transit"]
        if picked and facts.first_pickup_at is not None:
            transport_detail = f"Picked up {_short_date(facts.first_pickup_at.date())}"
        elif facts.transport_status in BOOKED_REQUEST_STATUSES and facts.transport_vehicle:
            transport_detail = (
                f"{vehicle_label(facts.transport_vehicle)} booked · "  # type: ignore[arg-type]
                f"Pickup {_short_date(lot.pickup_date)}"
            )
        else:
            transport_detail = f"Pickup {_short_date(lot.pickup_date)}"
        results.append((picked, False, facts.first_pickup_at, transport_detail))

    # 7 · delivered
    delivered_at = facts.delivery_recorded_at or lot.delivered_at
    delivered = delivered_at is not None or rank >= LOT_STATUS_RANK["delivered"]
    delivered_detail = None
    accepted_kg = [m.accepted_kg for m in active if m.accepted_kg is not None]
    delivered_kg = [m.delivered_kg for m in active if m.delivered_kg is not None]
    if delivered and accepted_kg:
        delivered_detail = (
            f"{format_number(sum(accepted_kg, Decimal(0)))} kg accepted of "
            f"{format_number(sum(delivered_kg, Decimal(0)))} kg delivered"
        )
    results.append((delivered, False, delivered_at, delivered_detail))

    # 8 · settled
    settled = lot.status == "settled"
    settled_at = lot.settled_at or facts.settlement_paid_at
    settled_detail = None
    if facts.settlement_id is not None:
        if settled:
            settled_detail = f"{format_rupees(facts.settlement_gross or 0)} settled"
        elif facts.settlement_status == "paid":
            settled_detail = "Buyer paid · farmer payouts in progress"
        elif facts.settlement_due_date is not None:
            settled_detail = f"Payment due {_short_date(facts.settlement_due_date)}"
    results.append((settled, False, settled_at if settled else None, settled_detail))

    steps: list[schemas.JourneyStep] = []
    current_assigned = False
    for (key, label), (number, (complete, skipped, at, detail)) in zip(
        JOURNEY_STEPS, enumerate(results, start=1), strict=True
    ):
        status: schemas.JourneyStepStatus
        if skipped:
            status = "skipped"
        elif complete:
            status = "complete"
        elif not current_assigned:
            status = "current"
            current_assigned = True
        else:
            status = "upcoming"
        steps.append(
            schemas.JourneyStep(
                step=number,
                key=key,
                label=label,
                status=status,
                at=at if status == "complete" else None,
                detail=detail,
            )
        )
    return steps


def step_number(steps: Sequence[schemas.JourneyStep]) -> int:
    """Number of the first step that is neither complete nor skipped (8 when all are done)."""
    for step in steps:
        if step.status not in ("complete", "skipped"):
            return step.step
    return len(JOURNEY_STEPS)


async def journey_steps(db: AsyncSession, lots: Sequence[Lot]) -> dict[uuid.UUID, int]:
    """``journey_step`` of many lots with a fixed number of queries."""
    facts = await load_lot_facts(db, lots)
    return {lot.id: step_number(build_steps(lot, facts[lot.id])) for lot in lots}


async def lot_timeline(db: AsyncSession, lot: Lot) -> list[schemas.JourneyStep]:
    """The eight journey steps of a lot with their status, time and detail."""
    facts = await load_lot_facts(db, [lot])
    return build_steps(lot, facts[lot.id])


async def most_advanced_lot(db: AsyncSession, harvest_id: uuid.UUID) -> Lot | None:
    """The harvest's most advanced non-cancelled lot in which its farmer has not declined."""
    lots = (
        await db.scalars(
            select(Lot)
            .join(LotMember, LotMember.lot_id == Lot.id)
            .where(
                LotMember.harvest_id == harvest_id,
                LotMember.consent_status != "declined",
                Lot.status != "cancelled",
            )
        )
    ).all()
    if not lots:
        return None
    return max(lots, key=lambda lot: (LOT_STATUS_RANK[lot.status], lot.created_at))


async def harvest_timeline(db: AsyncSession, harvest: Harvest) -> list[schemas.JourneyStep]:
    """The journey of a harvest, following its most advanced active lot."""
    listed_detail = f"{format_number(harvest.quantity_kg)} kg {harvest.crop.name.lower()} listed"
    lot = await most_advanced_lot(db, harvest.id)
    if lot is not None:
        steps = await lot_timeline(db, lot)
        steps[0] = steps[0].model_copy(update={"at": harvest.created_at, "detail": listed_detail})
        return steps

    direct_offers = await db.scalar(
        select(func.count(Offer.id)).where(
            Offer.target_type == "harvest",
            Offer.harvest_id == harvest.id,
            Offer.status.in_(("pending", "countered", "proposed")),
        )
    )
    grouped_detail = "Not in a lot yet"
    if direct_offers:
        grouped_detail += f" · {_plural(direct_offers, 'direct offer')}"
    steps: list[schemas.JourneyStep] = []
    for number, (key, label) in enumerate(JOURNEY_STEPS, start=1):
        if number == 1:
            status: schemas.JourneyStepStatus = "complete"
            at: datetime | None = harvest.created_at
            detail: str | None = listed_detail
        elif key == "grouped":
            status, at, detail = "current", None, grouped_detail
        else:
            status, at, detail = "upcoming", None, None
        steps.append(
            schemas.JourneyStep(
                step=number, key=key, label=label, status=status, at=at, detail=detail
            )
        )
    return steps


async def compute_journey_step(db: AsyncSession, lot: Lot) -> int:
    """Number (1..8) of the first journey step that is neither complete nor skipped."""
    return step_number(await lot_timeline(db, lot))
