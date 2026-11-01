"""Lots: visibility, presentation, pooling, member consent and status bookkeeping (DOMAIN_RULES §2).

Lot lifecycle handled here::

    forming ──(join / members added)──► awaiting_consent ──(no pending, ≥1 accepted)──► open_for_offers
       └──────────────(coordinator POST /open)───────────────────────────────────────►┘
    forming|awaiting_consent|open_for_offers|offer_accepted ──(coordinator cancel)──► cancelled

Offer acceptance (``offer_accepted``) lives in ``offer_service``. Harvest statuses always mirror
their most advanced active lot (:func:`sync_harvest_status`).
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Iterable, Sequence
from datetime import timedelta
from decimal import Decimal
from typing import TYPE_CHECKING

from fastapi import status as http_status
from fastapi.exceptions import RequestValidationError
from sqlalchemy import ColumnElement, and_, or_, select, true

from app import schemas
from app.core.errors import DomainError, forbidden, not_found
from app.core.time import today_ist, utcnow
from app.models import (
    Crop,
    Demand,
    Harvest,
    Lot,
    LotMember,
    NegotiationEntry,
    Offer,
    TransportQuote,
    TransportRequest,
    User,
)
from app.models.enums import OPEN_OFFER_STATUSES, NotificationType
from app.services import harvest_service, journey
from app.services.audit import audit
from app.services.codes import next_code
from app.services.notify import coordinator_ids_for, notify
from app.services.presenters import farmer_display_name
from app.services.pricing import format_number, road_km, round_money, to_decimal

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.services.journey import LotFacts

PRIVILEGED_ROLES = frozenset({"coordinator", "admin"})
POOLABLE_HARVEST_STATUSES = ("listed", "pooled")
JOINABLE_LOT_STATUSES = ("forming", "awaiting_consent")
CANCELLABLE_LOT_STATUSES = ("forming", "awaiting_consent", "open_for_offers", "offer_accepted")
BOOKED_REQUEST_STATUSES = ("booked", "in_progress", "completed")

HARVEST_STATUS_FOR_LOT: dict[str, str] = {
    "forming": "pooled",
    "awaiting_consent": "pooled",
    "open_for_offers": "pooled",
    "offer_accepted": "committed",
    "transport_booked": "committed",
    "in_transit": "picked_up",
    "delivered": "delivered",
    "settled": "settled",
}
"""Harvest status that mirrors a (non-cancelled) lot status."""
LOT_DRIVEN_HARVEST_STATUSES = frozenset(HARVEST_STATUS_FOR_LOT.values())

DID_NOT_RESPOND = "Did not respond"
SYSTEM_AUTHOR = "MandiMate"
DEFAULT_LIST_LIMIT = 100
MAX_LIST_LIMIT = 500

# ─────────────────────────────── Small helpers ───────────────────────────────


def conflict(detail: str, code: str = "conflict") -> DomainError:
    """409 with a specific, stable error code."""
    return DomainError(http_status.HTTP_409_CONFLICT, detail, code)


def field_error(location: Sequence[str | int], message: str) -> RequestValidationError:
    """A 422 pointing at one request field, rendered like any other validation issue."""
    return RequestValidationError(
        [{"type": "value_error", "loc": tuple(location), "msg": message, "input": None}]
    )


def is_privileged(user: User) -> bool:
    return user.role in PRIVILEGED_ROLES


def buyer_name(buyer: User) -> str:
    """Buyers are shown by their organisation when they have one."""
    return journey.buyer_display_name(buyer.organization_name, buyer.full_name)


def kg(value: float | Decimal | int) -> Decimal:
    """Request kilograms (float) → ``Decimal`` rounded to 2 dp."""
    return round_money(to_decimal(value))


def active_members(lot: Lot) -> list[LotMember]:
    """Members whose consent is not ``declined``."""
    return [member for member in lot.members if member.consent_status != "declined"]


def lot_total_kg(lot: Lot) -> Decimal:
    return sum((member.quantity_kg for member in active_members(lot)), Decimal(0))


def farmer_link(lot_id: uuid.UUID) -> str:
    return f"/app/farmer/lots/{lot_id}"


def coordinator_link(lot_id: uuid.UUID) -> str:
    return f"/app/coordinator/lots/{lot_id}"


async def load_lot(db: AsyncSession, lot_id: uuid.UUID) -> Lot | None:
    """A lot with its relationships freshly (re)loaded."""
    return await db.scalar(
        select(Lot).where(Lot.id == lot_id).execution_options(populate_existing=True)
    )


async def reload_lot(db: AsyncSession, lot: Lot) -> Lot:
    """Flush pending changes and reload ``lot`` so its relationships reflect them."""
    await db.flush()
    reloaded = await load_lot(db, lot.id)
    assert reloaded is not None
    return reloaded


async def lock_lot(db: AsyncSession, lot: Lot) -> Lot:
    """Row-lock ``lot`` for the rest of the transaction and reload it with committed state.

    Concurrent status changes of one lot (consent, open, cancel, offer acceptance) then run one
    after another instead of both acting on the same stale status.
    """
    await db.execute(select(Lot.id).where(Lot.id == lot.id).with_for_update())
    return await reload_lot(db, lot)


async def lock_harvests(db: AsyncSession, harvest_ids: Iterable[uuid.UUID]) -> list[Harvest]:
    """Row-lock harvests (in id order, to avoid deadlocks) and return them freshly loaded.

    Taken before checking available kilograms, so two concurrent poolings / acceptances of the
    same harvest cannot both pass the check and over-commit it.
    """
    ids = sorted(set(harvest_ids))
    if not ids:
        return []
    return list(
        (
            await db.scalars(
                select(Harvest)
                .where(Harvest.id.in_(ids))
                .order_by(Harvest.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).all()
    )


async def available_kg_map(
    db: AsyncSession, harvest_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, Decimal]:
    """Available kilograms per harvest (DOMAIN_RULES §2), via ``harvest_service``."""
    ids = list(dict.fromkeys(harvest_ids))
    if not ids:
        return {}
    return await harvest_service.available_kg_map(db, ids)


async def direct_sale_kg_map(
    db: AsyncSession, harvest_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, Decimal]:
    """Kilograms of each harvest a direct buyer can still get (DOMAIN_RULES §3 "Selling options").

    Harvest quantity minus kg committed (consent ≠ declined) to non-cancelled lots that already
    have an accepted offer. Kg pooled in lots **without** an accepted deal still count: accepting
    a direct offer withdraws them from those pools. Unknown ids are omitted; never negative.
    """
    ids = list(dict.fromkeys(harvest_ids))
    if not ids:
        return {}
    quantities = (
        await db.execute(select(Harvest.id, Harvest.quantity_kg).where(Harvest.id.in_(ids)))
    ).all()
    committed: dict[uuid.UUID, Decimal] = defaultdict(lambda: Decimal(0))
    rows = (
        await db.execute(
            select(LotMember.harvest_id, LotMember.quantity_kg)
            .join(Lot, Lot.id == LotMember.lot_id)
            .where(
                LotMember.harvest_id.in_(ids),
                LotMember.consent_status != "declined",
                Lot.status != "cancelled",
                Lot.accepted_offer_id.is_not(None),
            )
        )
    ).all()
    for harvest_id, quantity in rows:
        committed[harvest_id] += quantity
    return {
        harvest_id: max(quantity - committed[harvest_id], Decimal(0))
        for harvest_id, quantity in quantities
    }


async def reject_offers(
    db: AsyncSession, offers: Iterable[Offer], message: str, *, notify_buyers: bool = True
) -> list[Offer]:
    """Close open offers as ``rejected`` with a system negotiation entry (and tell the buyers)."""
    closed: list[Offer] = []
    for offer in offers:
        if offer.status not in OPEN_OFFER_STATUSES:
            continue
        offer.status = "rejected"
        offer.awaiting = None
        db.add(
            NegotiationEntry(
                offer_id=offer.id,
                author_id=None,
                author_role="system",
                action="reject",
                message=message,
            )
        )
        closed.append(offer)
    if notify_buyers:
        for offer in closed:
            await notify(
                db,
                [offer.buyer_id],
                "offer",
                f"Offer {offer.code} closed",
                message,
                link=f"/app/buyer/offers/{offer.id}",
            )
    return closed


async def notify_lot_coordinators(
    db: AsyncSession, lot: Lot, title: str, body: str, *, type_: NotificationType = "lot"
) -> None:
    recipients = [lot.coordinator_id] if lot.coordinator_id else []
    if not recipients:
        recipients = await coordinator_ids_for(db, [m.farmer_id for m in lot.members])
    await notify(db, recipients, type_, title, body, link=coordinator_link(lot.id))


# ─────────────────────────────── Presentation ───────────────────────────────


async def _booked_transporters(
    db: AsyncSession, lot_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, set[uuid.UUID]]:
    """Transporters holding the booked quote of each lot's transport request."""
    if not lot_ids:
        return {}
    rows = (
        await db.execute(
            select(TransportRequest.lot_id, TransportQuote.transporter_id)
            .join(TransportQuote, TransportQuote.id == TransportRequest.booked_quote_id)
            .where(
                TransportRequest.lot_id.in_(list(lot_ids)),
                TransportRequest.status.in_(BOOKED_REQUEST_STATUSES),
            )
        )
    ).all()
    booked: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    for lot_id, transporter_id in rows:
        booked[lot_id].add(transporter_id)
    return booked


def _member_out(member: LotMember, viewer: User, *, reveal: bool) -> schemas.LotMember:
    harvest = member.harvest
    return schemas.LotMember(
        id=member.id,
        lot_id=member.lot_id,
        harvest_id=member.harvest_id,
        farmer_id=member.farmer_id,
        farmer_name=farmer_display_name(member.farmer, viewer, reveal=reveal),
        village=harvest.village,
        quantity_kg=float(member.quantity_kg),
        distance_km=float(member.distance_km) if member.distance_km is not None else None,
        harvest_quality_status=harvest.quality_status,
        consent_status=member.consent_status,
        consented_at=member.consented_at,
        delivered_kg=float(member.delivered_kg) if member.delivered_kg is not None else None,
        accepted_kg=float(member.accepted_kg) if member.accepted_kg is not None else None,
        rejected_kg=float(member.rejected_kg) if member.rejected_kg is not None else None,
        rejection_reason=member.rejection_reason,
        is_mine=member.farmer_id == viewer.id,
    )


def _present(lot: Lot, facts: LotFacts, viewer: User, *, reveal: bool) -> schemas.Lot:
    steps = journey.build_steps(lot, facts)
    accepted_offer = lot.accepted_offer
    active = active_members(lot)
    return schemas.Lot(
        id=lot.id,
        code=lot.code,
        crop_id=lot.crop_id,
        crop_name=lot.crop.name,
        grade=lot.grade,
        demand_id=lot.demand_id,
        target_quantity_kg=float(lot.target_quantity_kg),
        total_quantity_kg=float(round_money(lot_total_kg(lot))),
        collection_point_name=lot.collection_point_name,
        collection_latitude=lot.collection_latitude,
        collection_longitude=lot.collection_longitude,
        district=lot.district,
        state=lot.state,
        pickup_date=lot.pickup_date,
        status=lot.status,
        journey_step=journey.step_number(steps),
        is_solo=lot.is_solo,
        coordinator_id=lot.coordinator_id,
        coordinator_name=lot.coordinator.full_name if lot.coordinator is not None else None,
        members=[_member_out(member, viewer, reveal=reveal) for member in lot.members],
        member_count=len(active),
        offers_count=facts.offers_count,
        accepted_offer_id=lot.accepted_offer_id,
        buyer_name=buyer_name(accepted_offer.buyer) if accepted_offer is not None else None,
        price_per_kg=float(accepted_offer.price_per_kg) if accepted_offer is not None else None,
        pickup_terms=lot.pickup_terms,
        transport_request_id=facts.transport_request_id,
        settlement_id=facts.settlement_id,
        match_explanation=lot.match_explanation,
        created_at=lot.created_at,
        updated_at=lot.updated_at,
    )


async def lots_out(db: AsyncSession, lots: Sequence[Lot], viewer: User) -> list[schemas.Lot]:
    """Batch version of :func:`lot_out` (a fixed number of queries for any number of lots)."""
    if not lots:
        return []
    facts = await journey.load_lot_facts(db, lots)
    booked = (
        await _booked_transporters(db, [lot.id for lot in lots])
        if viewer.role == "transporter"
        else {}
    )
    return [
        _present(lot, facts[lot.id], viewer, reveal=viewer.id in booked.get(lot.id, set()))
        for lot in lots
    ]


async def lot_out(db: AsyncSession, lot: Lot, viewer: User) -> schemas.Lot:
    """The API ``Lot`` as ``viewer`` may see it (member names masked per DOMAIN_RULES §1)."""
    return (await lots_out(db, [lot], viewer))[0]


def _summary(lot: Lot, facts: LotFacts) -> schemas.LotSummary:
    accepted_offer = lot.accepted_offer
    return schemas.LotSummary(
        id=lot.id,
        code=lot.code,
        crop_name=lot.crop.name,
        grade=lot.grade,
        total_quantity_kg=float(round_money(lot_total_kg(lot))),
        member_count=len(active_members(lot)),
        status=lot.status,
        journey_step=journey.step_number(journey.build_steps(lot, facts)),
        pickup_date=lot.pickup_date,
        buyer_name=buyer_name(accepted_offer.buyer) if accepted_offer is not None else None,
        price_per_kg=float(accepted_offer.price_per_kg) if accepted_offer is not None else None,
    )


async def lot_summaries(db: AsyncSession, lots: Sequence[Lot]) -> list[schemas.LotSummary]:
    """Batch version of :func:`lot_summary`."""
    facts = await journey.load_lot_facts(db, lots)
    return [_summary(lot, facts[lot.id]) for lot in lots]


async def lot_summary(db: AsyncSession, lot: Lot) -> schemas.LotSummary:
    """Compact ``LotSummary`` used by dashboards and pipelines."""
    return (await lot_summaries(db, [lot]))[0]


# ─────────────────────────────── Visibility ───────────────────────────────


def _visibility_condition(viewer: User, *, mine: bool = False) -> ColumnElement[bool]:
    """SQL condition selecting the lots ``viewer`` may see (DOMAIN_RULES §1 / API contract)."""
    if viewer.role == "farmer":
        own = Lot.id.in_(select(LotMember.lot_id).where(LotMember.farmer_id == viewer.id))
        if mine:
            return own
        listed_crops = select(Harvest.crop_id).where(
            Harvest.farmer_id == viewer.id, Harvest.status.in_(POOLABLE_HARVEST_STATUSES)
        )
        joinable = and_(Lot.status.in_(JOINABLE_LOT_STATUSES), Lot.crop_id.in_(listed_crops))
        return or_(own, joinable)
    if viewer.role == "buyer":
        with_offers = Lot.id.in_(
            select(Offer.lot_id).where(Offer.buyer_id == viewer.id, Offer.lot_id.is_not(None))
        )
        if mine:
            return with_offers
        return or_(with_offers, Lot.status == "open_for_offers")
    if viewer.role == "transporter":
        return Lot.id.in_(
            select(TransportRequest.lot_id)
            .join(TransportQuote, TransportQuote.request_id == TransportRequest.id)
            .where(TransportQuote.transporter_id == viewer.id)
        )
    if mine:
        return Lot.coordinator_id == viewer.id
    return true()


async def can_view_lot(db: AsyncSession, lot: Lot, viewer: User) -> bool:
    if is_privileged(viewer):
        return True
    found = await db.scalar(select(Lot.id).where(Lot.id == lot.id, _visibility_condition(viewer)))
    return found is not None


async def get_lot_for_viewer(db: AsyncSession, lot_id: uuid.UUID, viewer: User) -> Lot:
    """Load a lot the viewer may see, raising 404 when it is missing or not visible."""
    lot = await load_lot(db, lot_id)
    if lot is None or not await can_view_lot(db, lot, viewer):
        raise not_found("Lot")
    return lot


async def list_lots(
    db: AsyncSession,
    viewer: User,
    *,
    status: str | None = None,
    crop_id: uuid.UUID | None = None,
    mine: bool = False,
    limit: int = DEFAULT_LIST_LIMIT,
) -> list[Lot]:
    """Lots visible to ``viewer``, newest first."""
    statement = select(Lot).where(_visibility_condition(viewer, mine=mine))
    if status is not None:
        statement = statement.where(Lot.status == status)
    if crop_id is not None:
        statement = statement.where(Lot.crop_id == crop_id)
    statement = statement.order_by(Lot.created_at.desc(), Lot.id.desc()).limit(limit)
    return list((await db.scalars(statement)).all())


# ─────────────────────────────── Bookkeeping ───────────────────────────────


async def sync_harvest_status(db: AsyncSession, harvest_id: uuid.UUID) -> None:
    """Make the harvest status mirror its most advanced active lot (or ``listed``)."""
    harvest = await db.get(Harvest, harvest_id)
    if harvest is None:
        return
    lot_statuses = (
        await db.scalars(
            select(Lot.status)
            .join(LotMember, LotMember.lot_id == Lot.id)
            .where(
                LotMember.harvest_id == harvest_id,
                LotMember.consent_status != "declined",
                Lot.status != "cancelled",
            )
        )
    ).all()
    if lot_statuses:
        most_advanced = max(lot_statuses, key=lambda value: journey.LOT_STATUS_RANK[value])
        harvest.status = HARVEST_STATUS_FOR_LOT[most_advanced]  # type: ignore[assignment]
    elif harvest.status in LOT_DRIVEN_HARVEST_STATUSES:
        harvest.status = "listed"


async def _sync_members(db: AsyncSession, lot: Lot) -> None:
    for harvest_id in dict.fromkeys(member.harvest_id for member in lot.members):
        await sync_harvest_status(db, harvest_id)


async def mark_lot_opened(db: AsyncSession, lot: Lot, actor: User | None, summary: str) -> None:
    """Move ``lot`` to ``open_for_offers`` and record when (the journey reads this entry)."""
    lot.status = "open_for_offers"
    await audit(
        db,
        actor,
        journey.OPENED_ACTION,
        "lot",
        lot.id,
        summary,
        {"code": lot.code, "total_quantity_kg": lot_total_kg(lot)},
    )


async def refresh_lot_status(db: AsyncSession, lot: Lot) -> None:
    """Apply automatic lot transitions (e.g. all consents in ⇒ ``open_for_offers``)."""
    if lot.status not in JOINABLE_LOT_STATUSES:
        return
    decisions = [member.consent_status for member in lot.members]
    if "pending" in decisions:
        lot.status = "awaiting_consent"
    elif "accepted" in decisions:
        await mark_lot_opened(
            db, lot, None, f"Lot {lot.code} opened for offers: every farmer has responded"
        )
        await notify_lot_coordinators(
            db,
            lot,
            f"Lot {lot.code} is open for offers",
            f"All farmers responded; {format_number(lot_total_kg(lot))} kg is ready for buyers.",
        )
    else:
        lot.status = "forming"
    await db.flush()
    await _sync_members(db, lot)


async def refresh_after_withdrawal(db: AsyncSession, lot: Lot) -> None:
    """Re-derive ``lot``'s status after members were withdrawn (e.g. sold directly elsewhere).

    Lots still collecting consent follow :func:`refresh_lot_status`; an open lot left without any
    farmer goes back to ``forming`` and its open offers are closed. Harvest statuses are re-synced.
    """
    if lot.status in JOINABLE_LOT_STATUSES:
        await refresh_lot_status(db, lot)
        return
    if lot.status == "open_for_offers" and not active_members(lot):
        lot.status = "forming"
        open_offers = (
            await db.scalars(
                select(Offer).where(Offer.lot_id == lot.id, Offer.status.in_(OPEN_OFFER_STATUSES))
            )
        ).all()
        await reject_offers(db, open_offers, f"Lot {lot.code} has no farmers left")
    await db.flush()
    await _sync_members(db, lot)


# ─────────────────────────────── Membership ───────────────────────────────


def _validate_member(
    harvest: Harvest,
    *,
    crop_id: uuid.UUID,
    grade: str,
    quantity_kg: Decimal,
    available_kg: Decimal,
) -> None:
    """Membership rules: same crop, poolable harvest, same grade, enough kilograms available.

    An ``ungraded`` harvest may join a graded lot only flagged for inspection before pickup
    (its quality status becomes ``pending_inspection`` when it was self-reported).
    """
    label = f"{harvest.crop.name} harvest of {format_number(harvest.quantity_kg)} kg"
    if harvest.crop_id != crop_id:
        raise conflict(f"The {label} is a different crop from this lot", "crop_mismatch")
    if harvest.status not in POOLABLE_HARVEST_STATUSES:
        raise conflict(
            f"The {label} is not available for pooling (status: {harvest.status})",
            "harvest_not_available",
        )
    if harvest.sell_by < today_ist():
        # A listing past its sell-by date is expired even before the lazy expiry marks it.
        raise conflict(
            f"The {label} is past its sell-by date and cannot be pooled",
            "harvest_not_available",
        )
    if harvest.grade != grade:
        if harvest.grade == "ungraded":
            if harvest.quality_status == "self_reported":
                harvest.quality_status = "pending_inspection"
        else:
            raise conflict(
                f"Grade {harvest.grade} produce cannot be pooled into a grade {grade} lot",
                "grade_mismatch",
            )
    if quantity_kg > available_kg:
        raise conflict(
            f"Only {format_number(available_kg)} kg of the {label} is still available",
            "insufficient_quantity",
        )


def _distance_to_collection(
    harvest: Harvest, lot_latitude: float, lot_longitude: float
) -> Decimal | None:
    if harvest.latitude is None or harvest.longitude is None:
        return None
    return road_km(harvest.latitude, harvest.longitude, lot_latitude, lot_longitude)


async def create_lot(db: AsyncSession, req: schemas.LotCreateRequest, actor: User) -> Lot:
    """``POST /lots``: a lot awaiting its members' consent (``forming`` without members)."""
    crop = await db.get(Crop, req.crop_id)
    if crop is None:
        raise not_found("Crop")
    if req.pickup_date < today_ist():
        raise field_error(("body", "pickup_date"), "Pickup date cannot be in the past")
    if req.demand_id is not None:
        demand = await db.get(Demand, req.demand_id)
        if demand is None:
            raise not_found("Demand")
        if demand.crop_id != crop.id:
            raise conflict("The demand is for a different crop", "demand_mismatch")
        if demand.status in ("cancelled", "expired", "fulfilled"):
            raise conflict(f"The demand is {demand.status}", "demand_closed")

    harvest_ids = [member.harvest_id for member in req.members]
    harvests = {harvest.id: harvest for harvest in await lock_harvests(db, harvest_ids)}
    if len(harvests) != len(set(harvest_ids)):
        raise not_found("Harvest")
    available = await available_kg_map(db, harvest_ids)

    now = utcnow()
    members: list[LotMember] = []
    for index, entry in enumerate(req.members):
        harvest = harvests[entry.harvest_id]
        quantity = kg(entry.quantity_kg)
        _validate_member(
            harvest,
            crop_id=crop.id,
            grade=req.grade,
            quantity_kg=quantity,
            available_kg=available.get(harvest.id, Decimal(0)),
        )
        members.append(
            LotMember(
                harvest_id=harvest.id,
                farmer_id=harvest.farmer_id,
                quantity_kg=quantity,
                distance_km=_distance_to_collection(
                    harvest, req.collection_latitude, req.collection_longitude
                ),
                consent_status="pending",
                created_at=now + timedelta(microseconds=index),
            )
        )

    lot = Lot(
        code=await next_code(db, "lot", crop.code),
        crop_id=crop.id,
        grade=req.grade,
        demand_id=req.demand_id,
        target_quantity_kg=kg(req.target_quantity_kg),
        collection_point_name=req.collection_point_name,
        collection_latitude=req.collection_latitude,
        collection_longitude=req.collection_longitude,
        district=req.district,
        state=req.state,
        pickup_date=req.pickup_date,
        status="awaiting_consent" if members else "forming",
        is_solo=False,
        coordinator_id=actor.id,
        created_by_id=actor.id,
        match_explanation=req.match_explanation,
        members=members,
    )
    db.add(lot)
    await db.flush()
    lot = await reload_lot(db, lot)
    await _sync_members(db, lot)

    total = lot_total_kg(lot)
    await audit(
        db,
        actor,
        "lot.create",
        "lot",
        lot.id,
        f"Created lot {lot.code}: {len(members)} harvests, {format_number(total)} kg of "
        f"{crop.name} grade {lot.grade}",
        {
            "code": lot.code,
            "crop_id": crop.id,
            "grade": lot.grade,
            "members": [
                {"harvest_id": m.harvest_id, "quantity_kg": m.quantity_kg} for m in lot.members
            ],
        },
    )
    for member in lot.members:
        await notify(
            db,
            [member.farmer_id],
            "consent",
            "Consent to join pooled sale",
            f"{actor.full_name} added {format_number(member.quantity_kg)} kg of your "
            f"{crop.name.lower()} to lot {lot.code}. Review the lot and give your consent.",
            link=farmer_link(lot.id),
        )
    return await reload_lot(db, lot)


async def join_lot(db: AsyncSession, lot: Lot, req: schemas.JoinLotRequest, farmer: User) -> Lot:
    """``POST /lots/{id}/join``: a farmer adds an own harvest (consent ``accepted``)."""
    lot = await lock_lot(db, lot)
    if lot.status not in JOINABLE_LOT_STATUSES:
        raise conflict("This lot is no longer accepting farmers", "lot_not_joinable")
    harvest = next(iter(await lock_harvests(db, [req.harvest_id])), None)
    if harvest is None or harvest.farmer_id != farmer.id:
        raise not_found("Harvest")
    quantity = kg(req.quantity_kg)
    existing = next((m for m in lot.members if m.harvest_id == harvest.id), None)
    if existing is not None and existing.consent_status != "declined":
        raise conflict("This harvest is already part of the lot", "already_member")
    available = (await available_kg_map(db, [harvest.id])).get(harvest.id, Decimal(0))
    _validate_member(
        harvest, crop_id=lot.crop_id, grade=lot.grade, quantity_kg=quantity, available_kg=available
    )
    now = utcnow()
    distance = _distance_to_collection(harvest, lot.collection_latitude, lot.collection_longitude)
    if existing is not None:
        existing.quantity_kg = quantity
        existing.distance_km = distance
        existing.consent_status = "accepted"
        existing.consented_at = now
        existing.consent_note = None
        existing.consent_recorded_by_id = None
    else:
        db.add(
            LotMember(
                lot_id=lot.id,
                harvest_id=harvest.id,
                farmer_id=farmer.id,
                quantity_kg=quantity,
                distance_km=distance,
                consent_status="accepted",
                consented_at=now,
            )
        )
    lot = await reload_lot(db, lot)
    await audit(
        db,
        farmer,
        "lot.join",
        "lot",
        lot.id,
        f"{farmer.full_name} joined lot {lot.code} with {format_number(quantity)} kg",
        {"harvest_id": harvest.id, "quantity_kg": quantity},
    )
    await notify_lot_coordinators(
        db,
        lot,
        f"A farmer joined lot {lot.code}",
        f"{farmer.full_name} added {format_number(quantity)} kg.",
    )
    await refresh_lot_status(db, lot)
    return await reload_lot(db, lot)


async def record_member_consent(
    db: AsyncSession,
    lot: Lot,
    member_id: uuid.UUID,
    req: schemas.ConsentRequest,
    actor: User,
) -> Lot:
    """``POST /lots/{id}/members/{member_id}/consent``: the farmer, or a coordinator (assisted)."""
    member = next((m for m in lot.members if m.id == member_id), None)
    if member is None:
        raise not_found("Lot member")
    assisted = is_privileged(actor)
    if not assisted and not (actor.role == "farmer" and member.farmer_id == actor.id):
        raise forbidden("Only the farmer or a coordinator can record this consent")
    lot = await lock_lot(db, lot)
    member = next(m for m in lot.members if m.id == member_id)
    if lot.status not in JOINABLE_LOT_STATUSES:
        raise conflict("Consent can no longer be changed for this lot", "lot_not_awaiting_consent")
    if req.decision == "accepted" and member.consent_status == "declined":
        # A declined member no longer holds its kilograms (they may have been pooled or sold
        # elsewhere, or the listing cancelled): re-validate exactly like joining again.
        harvest = (await lock_harvests(db, [member.harvest_id]))[0]
        available = (await available_kg_map(db, [harvest.id])).get(harvest.id, Decimal(0))
        _validate_member(
            harvest,
            crop_id=lot.crop_id,
            grade=lot.grade,
            quantity_kg=member.quantity_kg,
            available_kg=available,
        )

    member.consent_status = req.decision
    member.consented_at = utcnow()
    member.consent_note = req.note
    member.consent_recorded_by_id = actor.id if assisted else None
    farmer_name = member.farmer.full_name
    verb = "accepted" if req.decision == "accepted" else "declined"
    if assisted:
        await audit(
            db,
            actor,
            "lot.assisted_consent",
            "lot",
            lot.id,
            f"Assisted consent: {actor.full_name} recorded that {farmer_name} {verb} "
            f"pooling into lot {lot.code}",
            {"member_id": member.id, "decision": req.decision, "note": req.note},
        )
        await notify(
            db,
            [member.farmer_id],
            "consent",
            f"Consent recorded for lot {lot.code}",
            f"{actor.full_name} recorded that you {verb} joining lot {lot.code}.",
            link=farmer_link(lot.id),
        )
    else:
        await audit(
            db,
            actor,
            "lot.consent",
            "lot",
            lot.id,
            f"{farmer_name} {verb} pooling into lot {lot.code}",
            {"member_id": member.id, "decision": req.decision, "note": req.note},
        )
    await db.flush()
    await refresh_lot_status(db, lot)
    return await reload_lot(db, lot)


async def open_lot(db: AsyncSession, lot: Lot, actor: User) -> Lot:
    """``POST /lots/{id}/open``: pending members are declined, the lot opens for offers."""
    lot = await lock_lot(db, lot)
    if lot.status not in JOINABLE_LOT_STATUSES:
        raise conflict("Only forming or awaiting-consent lots can be opened", "lot_not_openable")
    if not any(member.consent_status == "accepted" for member in lot.members):
        raise conflict(
            "At least one farmer must have consented before the lot can open",
            "no_accepted_members",
        )
    now = utcnow()
    dropped: list[LotMember] = []
    for member in lot.members:
        if member.consent_status == "pending":
            member.consent_status = "declined"
            member.consent_note = DID_NOT_RESPOND
            member.consented_at = now
            member.consent_recorded_by_id = actor.id
            dropped.append(member)
    await mark_lot_opened(
        db,
        lot,
        actor,
        f"{actor.full_name} opened lot {lot.code} for offers"
        + (f"; {len(dropped)} farmers did not respond" if dropped else ""),
    )
    await db.flush()
    await _sync_members(db, lot)
    accepted_ids = [m.farmer_id for m in lot.members if m.consent_status == "accepted"]
    await notify(
        db,
        accepted_ids,
        "lot",
        f"Lot {lot.code} is open for offers",
        f"Buyers can now make offers on {format_number(lot_total_kg(lot))} kg.",
        link=farmer_link(lot.id),
    )
    if dropped:
        await notify(
            db,
            [m.farmer_id for m in dropped],
            "lot",
            f"Not included in lot {lot.code}",
            "The lot opened without your harvest because no consent was received.",
            link=farmer_link(lot.id),
        )
    return await reload_lot(db, lot)


async def cancel_lot(db: AsyncSession, lot: Lot, actor: User) -> Lot:
    """``POST /lots/{id}/cancel``: open offers are rejected and the harvests freed."""
    lot = await lock_lot(db, lot)
    if lot.status not in CANCELLABLE_LOT_STATUSES:
        raise conflict(
            f"A lot that is {lot.status.replace('_', ' ')} cannot be cancelled",
            "lot_not_cancellable",
        )
    message = f"Lot {lot.code} was cancelled"
    open_offers = (
        await db.scalars(
            select(Offer).where(Offer.lot_id == lot.id, Offer.status.in_(OPEN_OFFER_STATUSES))
        )
    ).all()
    await reject_offers(db, open_offers, message)

    accepted_offer = lot.accepted_offer
    if accepted_offer is not None:
        db.add(
            NegotiationEntry(
                offer_id=accepted_offer.id,
                author_id=None,
                author_role="system",
                action="note",
                message=f"{message} after the deal was agreed",
            )
        )
        if accepted_offer.demand_id is not None:
            demand = await db.get(Demand, accepted_offer.demand_id)
            if demand is not None and demand.status == "matched":
                demand.status = "open"
        await notify(
            db,
            [accepted_offer.buyer_id],
            "offer",
            message,
            f"The deal {accepted_offer.code} will not go ahead.",
            link=f"/app/buyer/offers/{accepted_offer.id}",
        )

    requests = (
        await db.scalars(
            select(TransportRequest).where(
                TransportRequest.lot_id == lot.id,
                TransportRequest.status.in_(("open", "quoted")),
            )
        )
    ).all()
    for request in requests:
        request.status = "cancelled"

    lot.status = "cancelled"
    lot.cancelled_reason = f"Cancelled by {actor.full_name}"
    await db.flush()
    await _sync_members(db, lot)
    await audit(
        db,
        actor,
        "lot.cancel",
        "lot",
        lot.id,
        f"{actor.full_name} cancelled lot {lot.code}",
        {"code": lot.code, "rejected_offers": [offer.code for offer in open_offers]},
    )
    await notify(
        db,
        [member.farmer_id for member in active_members(lot)],
        "lot",
        message,
        "Your harvest is free to sell again.",
        link=farmer_link(lot.id),
    )
    return await reload_lot(db, lot)
