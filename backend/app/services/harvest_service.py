"""Harvest listings: availability, visibility, presentation, lifecycle and photos.

Rules (DOMAIN_RULES §1–2):

* ``available_kg = quantity_kg − Σ member.quantity_kg`` over members in lots that are not
  ``cancelled`` and whose consent is not ``declined`` (never below zero).
* Visibility: the owner farmer, coordinators and admins always; buyers while the harvest is
  ``listed`` or ``pooled``; nobody else (404).
* The farmer's name is masked and ``min_price_per_kg`` hidden for everyone except the owner,
  coordinators and admins.
* ``listed`` harvests whose ``sell_by`` has passed become ``expired`` lazily (on list / get).
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from typing import Any

from fastapi import UploadFile
from fastapi import status as http_status
from fastapi.exceptions import RequestValidationError
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import ValidationError
from sqlalchemy import func, inspect, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app import schemas
from app.core.config import settings
from app.core.errors import DomainError, conflict, forbidden, not_found
from app.core.time import today_ist, utcnow
from app.models import (
    Crop,
    Harvest,
    HarvestPhoto,
    Lot,
    LotMember,
    NegotiationEntry,
    Offer,
    OfferConsent,
    User,
)
from app.services import photo_analysis
from app.services.audit import audit
from app.services.notify import coordinator_ids_for, notify
from app.services.presenters import FULL_NAME_ROLES, farmer_display_name
from app.services.pricing import format_number, round_money

ZERO = Decimal("0")

BUYER_VISIBLE_STATUSES = frozenset({"listed", "pooled"})
"""Buyers may open a harvest only while it is on the market."""
EDITABLE_STATUSES = frozenset({"draft", "listed"})
"""Harvests that may still be edited."""
CANCELLABLE_STATUSES = frozenset({"draft", "listed", "pooled"})
"""Pooled harvests only while none of their lots has an accepted offer (DOMAIN_RULES §2)."""
POOLING_LOT_STATUSES = frozenset({"forming", "awaiting_consent", "open_for_offers"})
INSPECTABLE_STATUSES = frozenset({"draft", "listed", "pooled", "committed", "picked_up"})
PHOTO_LOCKED_STATUSES = frozenset({"committed", "picked_up", "delivered", "settled"})
"""Once a deal is agreed photos are kept as evidence and cannot be deleted."""
CLOSED_STATUSES = frozenset({"cancelled", "expired"})

OPEN_DIRECT_OFFER_STATUSES = ("pending", "countered")
OPEN_LOT_OFFER_STATUSES = ("pending", "countered", "proposed")

POOLED_CANCEL_MESSAGE = "This harvest is part of a pooled lot — decline or leave the lot first"

MAX_PHOTOS = 6
MAX_IMAGE_SIDE = 1600
MAX_IMAGE_PIXELS = 50_000_000
"""Decoded images larger than this are refused before any pixel data is loaded."""
ALLOWED_IMAGE_FORMATS = frozenset({"JPEG", "PNG", "WEBP"})
WEBP_QUALITY = 82
READ_CHUNK_BYTES = 1024 * 1024

_RELATIONSHIPS = ("farmer", "crop", "verified_by", "photos")


# ─────────────────────────────── Helpers ───────────────────────────────


def field_error(field_name: str, message: str, error_type: str = "value_error") -> Exception:
    """A 422 shaped like FastAPI's own validation errors, pointing at one body field."""
    return RequestValidationError(
        [{"loc": ("body", field_name), "msg": message, "type": error_type}]
    )


def _decimal(value: float | Decimal | None) -> Decimal | None:
    return None if value is None else round_money(value)


def _float(value: Decimal | None) -> float | None:
    return None if value is None else float(round_money(value))


def can_see_private(harvest: Harvest, viewer: User) -> bool:
    """Owner, coordinators and admins see the full name and the private minimum price."""
    return viewer.id == harvest.farmer_id or viewer.role in FULL_NAME_ROLES


def can_view_harvest(harvest: Harvest, viewer: User) -> bool:
    if can_see_private(harvest, viewer):
        return True
    return viewer.role == "buyer" and harvest.status in BUYER_VISIBLE_STATUSES


def ensure_can_manage(harvest: Harvest, actor: User) -> None:
    """Only the owner farmer, coordinators and admins may change a harvest (403 otherwise)."""
    if not can_see_private(harvest, actor):
        raise forbidden("Only the farmer or a coordinator can change this harvest")


async def _ensure_loaded(db: AsyncSession, harvests: Iterable[Harvest]) -> None:
    """Load relationships that a caller's query or a flush left unloaded (no lazy IO later)."""
    for harvest in harvests:
        state = inspect(harvest)
        if state.pending:
            await db.flush()
        missing = [name for name in _RELATIONSHIPS if name in state.unloaded]
        if missing:
            await db.refresh(harvest, attribute_names=missing)


# ───────────────────────────── Availability ─────────────────────────────


@dataclass
class _Memberships:
    committed: dict[uuid.UUID, Decimal] = field(default_factory=dict)
    lot_ids: dict[uuid.UUID, list[uuid.UUID]] = field(default_factory=dict)


async def _active_memberships(db: AsyncSession, harvest_ids: Sequence[uuid.UUID]) -> _Memberships:
    """Committed kg and lot ids per harvest over lots not cancelled, consent not declined."""
    result = _Memberships()
    if not harvest_ids:
        return result
    rows = (
        await db.execute(
            select(LotMember.harvest_id, LotMember.lot_id, LotMember.quantity_kg)
            .join(Lot, Lot.id == LotMember.lot_id)
            .where(
                LotMember.harvest_id.in_(harvest_ids),
                Lot.status != "cancelled",
                LotMember.consent_status != "declined",
            )
            .order_by(Lot.created_at, Lot.id)
        )
    ).all()
    committed: dict[uuid.UUID, Decimal] = defaultdict(lambda: ZERO)
    lot_ids: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for harvest_id, lot_id, quantity in rows:
        committed[harvest_id] += quantity
        if lot_id not in lot_ids[harvest_id]:
            lot_ids[harvest_id].append(lot_id)
    result.committed = dict(committed)
    result.lot_ids = dict(lot_ids)
    return result


async def committed_kg_map(
    db: AsyncSession, harvest_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, Decimal]:
    """kg of each harvest committed to active lots (harvests with none are omitted)."""
    ids = list(dict.fromkeys(harvest_ids))
    return (await _active_memberships(db, ids)).committed


async def available_kg_map(
    db: AsyncSession, harvest_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, Decimal]:
    """``available_kg`` for many harvests in two queries; unknown ids are omitted."""
    ids = list(dict.fromkeys(harvest_ids))
    if not ids:
        return {}
    quantities = (
        await db.execute(select(Harvest.id, Harvest.quantity_kg).where(Harvest.id.in_(ids)))
    ).all()
    committed = (await _active_memberships(db, ids)).committed
    return {
        harvest_id: max(quantity - committed.get(harvest_id, ZERO), ZERO)
        for harvest_id, quantity in quantities
    }


async def get_available_kg(db: AsyncSession, harvest_id: uuid.UUID) -> Decimal:
    """Harvest quantity minus kg committed to non-cancelled lots (consent not declined).

    Never negative; ``0`` for an unknown harvest.
    """
    return (await available_kg_map(db, [harvest_id])).get(harvest_id, ZERO)


# ───────────────────────────── Presentation ─────────────────────────────


async def _open_offer_prices(
    db: AsyncSession, harvest_ids: Sequence[uuid.UUID], lot_ids: Mapping[uuid.UUID, list[uuid.UUID]]
) -> dict[uuid.UUID, list[Decimal]]:
    """Prices of open offers per harvest: direct offers plus offers on its active lots.

    Offers whose ``valid_until`` has passed while ``pending``/``countered`` count as expired.
    """
    now = utcnow()
    prices: dict[uuid.UUID, list[Decimal]] = defaultdict(list)
    direct = (
        await db.execute(
            select(Offer.harvest_id, Offer.price_per_kg).where(
                Offer.target_type == "harvest",
                Offer.harvest_id.in_(harvest_ids),
                Offer.status.in_(OPEN_DIRECT_OFFER_STATUSES),
                Offer.valid_until > now,
            )
        )
    ).all()
    for harvest_id, price in direct:
        prices[harvest_id].append(price)

    all_lot_ids = {lot_id for ids in lot_ids.values() for lot_id in ids}
    if all_lot_ids:
        on_lots = (
            await db.execute(
                select(Offer.lot_id, Offer.price_per_kg).where(
                    Offer.target_type == "lot",
                    Offer.lot_id.in_(all_lot_ids),
                    Offer.status.in_(OPEN_LOT_OFFER_STATUSES),
                    or_(Offer.status == "proposed", Offer.valid_until > now),
                )
            )
        ).all()
        by_lot: dict[uuid.UUID, list[Decimal]] = defaultdict(list)
        for lot_id, price in on_lots:
            by_lot[lot_id].append(price)
        for harvest_id, ids in lot_ids.items():
            for lot_id in ids:
                prices[harvest_id].extend(by_lot.get(lot_id, []))
    return prices


def photo_out(photo: HarvestPhoto) -> schemas.HarvestPhoto:
    analysis: schemas.PhotoAnalysis | None = None
    if photo.analysis:
        try:
            analysis = schemas.PhotoAnalysis.model_validate(photo.analysis)
        except ValidationError:
            analysis = None
    return schemas.HarvestPhoto(
        id=photo.id, url=photo.url, analysis=analysis, created_at=photo.created_at
    )


def _present(
    harvest: Harvest,
    viewer: User,
    *,
    available: Decimal,
    lot_ids: list[uuid.UUID],
    offer_prices: list[Decimal],
) -> schemas.Harvest:
    private = can_see_private(harvest, viewer)
    return schemas.Harvest(
        id=harvest.id,
        farmer_id=harvest.farmer_id,
        farmer_name=farmer_display_name(harvest.farmer, viewer),
        crop_id=harvest.crop_id,
        crop_name=harvest.crop.name,
        variety=harvest.variety,
        quantity_kg=float(harvest.quantity_kg),
        available_kg=float(round_money(available)),
        grade=harvest.grade,
        quality_notes=harvest.quality_notes,
        quality_status=harvest.quality_status,
        harvest_date=harvest.harvest_date,
        available_from=harvest.available_from,
        sell_by=harvest.sell_by,
        village=harvest.village,
        district=harvest.district,
        state=harvest.state,
        latitude=harvest.latitude,
        longitude=harvest.longitude,
        min_price_per_kg=_float(harvest.min_price_per_kg) if private else None,
        status=harvest.status,
        source=harvest.source,
        photos=[photo_out(photo) for photo in harvest.photos],
        lot_ids=lot_ids,
        open_offers_count=len(offer_prices),
        best_offer_price_per_kg=_float(max(offer_prices)) if offer_prices else None,
        created_by_id=harvest.created_by_id,
        verified_by_name=harvest.verified_by.full_name if harvest.verified_by else None,
        verified_at=harvest.verified_at,
        created_at=harvest.created_at,
        updated_at=harvest.updated_at,
    )


async def harvests_out(
    db: AsyncSession, harvests: Sequence[Harvest], viewer: User
) -> list[schemas.Harvest]:
    """Batch version of ``harvest_out`` for list endpoints (a fixed number of queries)."""
    harvests = list(harvests)
    if not harvests:
        return []
    await _ensure_loaded(db, harvests)
    ids = list(dict.fromkeys(harvest.id for harvest in harvests))
    memberships = await _active_memberships(db, ids)
    offer_prices = await _open_offer_prices(db, ids, memberships.lot_ids)
    return [
        _present(
            harvest,
            viewer,
            available=max(harvest.quantity_kg - memberships.committed.get(harvest.id, ZERO), ZERO),
            lot_ids=memberships.lot_ids.get(harvest.id, []),
            offer_prices=offer_prices.get(harvest.id, []),
        )
        for harvest in harvests
    ]


async def harvest_out(db: AsyncSession, harvest: Harvest, viewer: User) -> schemas.Harvest:
    """The API ``Harvest`` as ``viewer`` may see it (masked name, private minimum price)."""
    return (await harvests_out(db, [harvest], viewer))[0]


# ───────────────────────────── Visibility & expiry ─────────────────────────────


async def expire_overdue_harvests(db: AsyncSession) -> int:
    """``listed`` harvests whose sell-by date has passed become ``expired``; returns the count."""
    result = await db.execute(
        update(Harvest)
        .where(Harvest.status == "listed", Harvest.sell_by < today_ist())
        .values(status="expired", updated_at=utcnow())
        .execution_options(synchronize_session="fetch")
    )
    return int(getattr(result, "rowcount", 0) or 0)


async def get_harvest_for_viewer(db: AsyncSession, harvest_id: uuid.UUID, viewer: User) -> Harvest:
    """Load a harvest the viewer may see, raising 404 when it is missing or not visible.

    An overdue ``listed`` harvest is expired first, so buyers never see stale listings.
    """
    harvest = await db.get(Harvest, harvest_id)
    if harvest is None:
        raise not_found("Harvest")
    if harvest.status == "listed" and harvest.sell_by < today_ist():
        harvest.status = "expired"
        harvest.updated_at = utcnow()
        await db.flush()
    if not can_view_harvest(harvest, viewer):
        raise not_found("Harvest")
    return harvest


async def list_harvests(
    db: AsyncSession,
    viewer: User,
    *,
    status: str | None = None,
    crop_id: uuid.UUID | None = None,
    farmer_id: uuid.UUID | None = None,
    limit: int = 100,
) -> list[Harvest]:
    """Harvests newest first: a farmer's own only; every harvest for coordinators/admins."""
    await expire_overdue_harvests(db)
    statement = select(Harvest).order_by(Harvest.created_at.desc(), Harvest.id.desc()).limit(limit)
    if viewer.role == "farmer":
        statement = statement.where(Harvest.farmer_id == viewer.id)
    if farmer_id is not None:
        statement = statement.where(Harvest.farmer_id == farmer_id)
    if status is not None:
        statement = statement.where(Harvest.status == status)
    if crop_id is not None:
        statement = statement.where(Harvest.crop_id == crop_id)
    return list((await db.scalars(statement)).all())


# ───────────────────────────── Lifecycle ─────────────────────────────


async def _get_crop(db: AsyncSession, crop_id: uuid.UUID) -> Crop:
    crop = await db.get(Crop, crop_id)
    if crop is None:
        raise field_error("crop_id", "Choose a crop from the catalogue")
    return crop


def _check_grade(crop: Crop, grade: str, *, allow_ungraded: bool = True) -> None:
    allowed = [*crop.grades, "ungraded"] if allow_ungraded else list(crop.grades)
    if grade not in allowed:
        raise field_error("grade", f"{crop.name} is traded in grades {', '.join(crop.grades)}")


def _check_dates(harvest_date: Any, available_from: Any, sell_by: Any) -> None:
    if sell_by < available_from:
        raise field_error("sell_by", "Sell-by date cannot be earlier than the available-from date")
    if sell_by < harvest_date:
        raise field_error("sell_by", "Sell-by date cannot be earlier than the harvest date")


async def _resolve_owner(
    db: AsyncSession, req: schemas.HarvestCreateRequest, actor: User
) -> tuple[User, str]:
    """The farmer the harvest belongs to and the listing source."""
    if actor.role == "farmer":
        if req.farmer_id is not None and req.farmer_id != actor.id:
            raise forbidden("Farmers can only list their own harvests")
        return actor, ("manual" if req.source == "assisted" else req.source)
    if req.farmer_id is None:
        raise field_error(
            "farmer_id", "Choose the farmer this harvest belongs to", error_type="missing"
        )
    farmer = await db.get(User, req.farmer_id)
    if farmer is None or farmer.role != "farmer" or not farmer.is_active:
        raise field_error("farmer_id", "Choose a registered farmer")
    return farmer, "assisted"


async def create_harvest(
    db: AsyncSession, req: schemas.HarvestCreateRequest, actor: User
) -> Harvest:
    """List a harvest: a farmer for themself, or a coordinator/admin for a farmer (assisted).

    Location fields left out default to the farmer's profile location.
    """
    farmer, source = await _resolve_owner(db, req, actor)
    crop = await _get_crop(db, req.crop_id)
    _check_grade(crop, req.grade)
    _check_dates(req.harvest_date, req.available_from, req.sell_by)
    if req.sell_by < today_ist():
        raise field_error("sell_by", "Sell-by date cannot be in the past")

    if req.latitude is not None and req.longitude is not None:
        latitude, longitude = req.latitude, req.longitude
    else:
        latitude, longitude = farmer.latitude, farmer.longitude

    harvest = Harvest(
        farmer=farmer,
        crop=crop,
        variety=req.variety,
        quantity_kg=round_money(req.quantity_kg),
        grade=req.grade,
        quality_notes=req.quality_notes,
        quality_status="self_reported",
        harvest_date=req.harvest_date,
        available_from=req.available_from,
        sell_by=req.sell_by,
        village=req.village if req.village is not None else farmer.village,
        district=req.district if req.district is not None else farmer.district,
        state=req.state if req.state is not None else farmer.state,
        latitude=latitude,
        longitude=longitude,
        min_price_per_kg=_decimal(req.min_price_per_kg),
        status=req.status,
        source=source,
        created_by_id=actor.id,
        verified_by=None,
        photos=[],
    )
    db.add(harvest)
    await db.flush()

    assisted = farmer.id != actor.id
    summary = (
        f"{actor.full_name} listed {format_number(harvest.quantity_kg)} kg of {crop.name} "
        f"for {farmer.full_name}"
        if assisted
        else f"{farmer.full_name} listed {format_number(harvest.quantity_kg)} kg of {crop.name}"
    )
    await audit(
        db,
        actor,
        "harvest.create",
        "harvest",
        harvest.id,
        summary,
        {
            "farmer_id": farmer.id,
            "crop_id": crop.id,
            "quantity_kg": harvest.quantity_kg,
            "grade": harvest.grade,
            "status": harvest.status,
            "source": source,
        },
    )
    return harvest


async def update_harvest(
    db: AsyncSession, harvest: Harvest, req: schemas.HarvestUpdateRequest, actor: User
) -> Harvest:
    """Edit a ``draft``/``listed`` harvest (409 otherwise).

    The quantity cannot drop below the kg already committed to lots (409). A farmer who changes
    the grade of an inspected harvest sends it back to ``self_reported``.
    """
    ensure_can_manage(harvest, actor)
    changes = req.model_dump(exclude_unset=True)
    if changes:
        await _lock(db, harvest)
    if harvest.status not in EDITABLE_STATUSES:
        raise conflict("Only draft or listed harvests can be edited")
    if not changes:
        return harvest

    committed = (await committed_kg_map(db, [harvest.id])).get(harvest.id, ZERO)
    crop = harvest.crop
    if "crop_id" in changes and changes["crop_id"] != harvest.crop_id:
        if committed > 0:
            raise conflict("The crop cannot be changed while the harvest is part of a lot")
        open_offer = await db.scalar(
            select(Offer.code)
            .where(
                Offer.target_type == "harvest",
                Offer.harvest_id == harvest.id,
                Offer.status.in_(OPEN_DIRECT_OFFER_STATUSES),
                Offer.valid_until > utcnow(),
            )
            .limit(1)
        )
        if open_offer is not None:
            raise conflict(
                f"The crop cannot be changed while buyers have open offers ({open_offer}) "
                "on this harvest"
            )
        crop = await _get_crop(db, changes["crop_id"])
    grade = changes.get("grade", harvest.grade)
    if "grade" in changes or crop is not harvest.crop:
        _check_grade(crop, grade)

    harvest_date = changes.get("harvest_date", harvest.harvest_date)
    available_from = changes.get("available_from", harvest.available_from)
    sell_by = changes.get("sell_by", harvest.sell_by)
    _check_dates(harvest_date, available_from, sell_by)
    becomes_listed = changes.get("status") == "listed" and harvest.status != "listed"
    if ("sell_by" in changes or becomes_listed) and sell_by < today_ist():
        raise field_error("sell_by", "Sell-by date cannot be in the past")
    becomes_draft = changes.get("status") == "draft" and harvest.status == "listed"
    if becomes_draft and committed > 0:
        raise conflict(POOLED_CANCEL_MESSAGE)

    if "quantity_kg" in changes:
        quantity = round_money(changes["quantity_kg"])
        if quantity < committed:
            raise conflict(
                f"Quantity cannot be less than the {format_number(committed)} kg already "
                "committed to lots"
            )
        changes["quantity_kg"] = quantity
    if "min_price_per_kg" in changes:
        changes["min_price_per_kg"] = _decimal(changes["min_price_per_kg"])

    grade_changed = "grade" in changes and changes["grade"] != harvest.grade
    for name, value in changes.items():
        if name == "crop_id":
            continue
        setattr(harvest, name, value)
    if crop is not harvest.crop:
        harvest.crop = crop
    if (
        grade_changed
        and actor.role not in FULL_NAME_ROLES
        and harvest.quality_status != "self_reported"
    ):
        harvest.quality_status = "self_reported"
        harvest.verified_by = None
        harvest.verified_at = None
    harvest.updated_at = utcnow()
    closed = (
        await _close_direct_offers(db, harvest, "The farmer took the listing off the market")
        if becomes_draft
        else []
    )
    await db.flush()

    await audit(
        db,
        actor,
        "harvest.update",
        "harvest",
        harvest.id,
        f"{actor.full_name} updated the {crop.name} harvest of {harvest.farmer.full_name}",
        {"fields": sorted(changes), "rejected_offer_ids": [offer.id for offer in closed]},
    )
    await _notify_closed_offers(db, closed, crop.name)
    return harvest


async def _close_direct_offers(db: AsyncSession, harvest: Harvest, reason: str) -> list[Offer]:
    """Reject open direct offers on a harvest that left the market (system negotiation entry)."""
    offers = (
        await db.scalars(
            select(Offer).where(
                Offer.target_type == "harvest",
                Offer.harvest_id == harvest.id,
                Offer.status.in_(OPEN_DIRECT_OFFER_STATUSES),
            )
        )
    ).all()
    for offer in offers:
        offer.status = "rejected"
        offer.awaiting = None
        offer.negotiation.append(
            NegotiationEntry(author_id=None, author_role="system", action="reject", message=reason)
        )
    return list(offers)


async def _notify_closed_offers(db: AsyncSession, offers: Sequence[Offer], crop_name: str) -> None:
    for offer in offers:
        await notify(
            db,
            [offer.buyer_id],
            "offer",
            "Offer closed: listing withdrawn",
            f"The {crop_name} listing your offer {offer.code} was for has been withdrawn.",
            link=f"/app/buyer/offers/{offer.id}",
        )


async def _lock(db: AsyncSession, harvest: Harvest) -> None:
    """Re-read the harvest's status and quantity under ``FOR UPDATE``.

    The row lock conflicts with the ``FOR KEY SHARE`` lock that inserting a lot member takes,
    so a concurrent join / lot creation cannot slip in between our checks and our write.
    """
    await db.refresh(harvest, attribute_names=["status", "quantity_kg"], with_for_update=True)


async def _withdraw_from_lots(db: AsyncSession, harvest: Harvest, actor: User) -> list[Lot]:
    """Decline the harvest's active lot memberships so it can be cancelled (DOMAIN_RULES §2).

    Allowed only while every active lot is still pooling (no accepted offer) and no deal
    including this harvest is awaiting the farmers' consent (409 otherwise).
    """
    from app.services import lot_service  # lot_service imports this module

    lot_ids = (
        await db.scalars(
            select(LotMember.lot_id)
            .join(Lot, Lot.id == LotMember.lot_id)
            .where(
                LotMember.harvest_id == harvest.id,
                LotMember.consent_status != "declined",
                Lot.status != "cancelled",
            )
        )
    ).all()
    if not lot_ids:
        return []
    lots = list((await db.scalars(select(Lot).where(Lot.id.in_(lot_ids)))).all())
    if any(
        lot.status not in POOLING_LOT_STATUSES or lot.accepted_offer_id is not None for lot in lots
    ):
        raise conflict("This harvest is committed to a deal and can no longer be cancelled")
    members = [
        member
        for lot in lots
        for member in lot.members
        if member.harvest_id == harvest.id and member.consent_status != "declined"
    ]
    proposed = await db.scalar(
        select(Offer.code)
        .join(OfferConsent, OfferConsent.offer_id == Offer.id)
        .where(
            Offer.status == "proposed",
            OfferConsent.member_id.in_([member.id for member in members]),
        )
        .limit(1)
    )
    if proposed is not None:
        raise conflict(
            f"Deal {proposed} including this harvest is awaiting the farmers' consent — "
            "decline the deal to withdraw the harvest"
        )

    now = utcnow()
    assisted = actor.id != harvest.farmer_id
    for member in members:
        member.consent_status = "declined"
        member.consented_at = now
        member.consent_note = "Harvest listing cancelled"
        member.consent_recorded_by_id = actor.id if assisted else None
    await db.flush()
    for lot in lots:
        await lot_service.refresh_lot_status(db, lot)
        recipients = [lot.coordinator_id] if lot.coordinator_id else None
        if recipients is None:
            recipients = await coordinator_ids_for(db, [harvest.farmer_id])
        await notify(
            db,
            [user_id for user_id in recipients if user_id != actor.id],
            "lot",
            f"A harvest left lot {lot.code}",
            f"{harvest.farmer.full_name} withdrew {format_number(harvest.quantity_kg)} kg of "
            f"{harvest.crop.name}; the listing was cancelled.",
            link=f"/app/coordinator/lots/{lot.id}",
        )
    return lots


async def cancel_harvest(db: AsyncSession, harvest: Harvest, actor: User) -> Harvest:
    """Withdraw a ``draft``/``listed`` harvest, or a ``pooled`` one whose lots have no accepted
    offer (its memberships are declined). Committed or later harvests cannot be cancelled."""
    ensure_can_manage(harvest, actor)
    await _lock(db, harvest)
    if harvest.status == "cancelled":
        raise conflict("This harvest is already cancelled")
    if harvest.status == "expired":
        raise conflict("This listing has already expired")
    if harvest.status not in CANCELLABLE_STATUSES:
        raise conflict("This harvest is committed to a deal and can no longer be cancelled")
    lots = await _withdraw_from_lots(db, harvest, actor)

    harvest.status = "cancelled"
    harvest.updated_at = utcnow()
    closed = await _close_direct_offers(db, harvest, "The farmer's listing was cancelled")
    await db.flush()

    crop_name = harvest.crop.name
    await audit(
        db,
        actor,
        "harvest.cancel",
        "harvest",
        harvest.id,
        f"{actor.full_name} cancelled the {crop_name} harvest of {harvest.farmer.full_name}",
        {
            "rejected_offer_ids": [offer.id for offer in closed],
            "withdrawn_from_lot_ids": [lot.id for lot in lots],
        },
    )
    await _notify_closed_offers(db, closed, crop_name)
    if actor.id != harvest.farmer_id:
        await notify(
            db,
            [harvest.farmer_id],
            "system",
            "Your harvest listing was cancelled",
            f"{actor.full_name} cancelled your {format_number(harvest.quantity_kg)} kg "
            f"{crop_name} listing.",
            link=f"/app/farmer/harvests/{harvest.id}",
        )
    return harvest


async def verify_harvest(
    db: AsyncSession, harvest: Harvest, req: schemas.HarvestVerifyRequest, actor: User
) -> Harvest:
    """Record a coordinator's inspection: grade, notes, ``quality_status = inspected``."""
    if harvest.status not in INSPECTABLE_STATUSES:
        raise conflict("This harvest can no longer be inspected")
    crop = harvest.crop
    _check_grade(crop, req.grade, allow_ungraded=False)
    if req.grade != harvest.grade:
        other_grade_lot = await db.scalar(
            select(Lot.code)
            .join(LotMember, LotMember.lot_id == Lot.id)
            .where(
                LotMember.harvest_id == harvest.id,
                LotMember.consent_status != "declined",
                Lot.status != "cancelled",
                Lot.grade != req.grade,
            )
            .limit(1)
        )
        if other_grade_lot is not None:
            raise conflict(
                f"This harvest is pooled in lot {other_grade_lot} of another grade — "
                "remove it from the lot before recording a different grade"
            )

    previous_grade = harvest.grade
    harvest.grade = req.grade
    if "quality_notes" in req.model_fields_set:
        harvest.quality_notes = req.quality_notes
    harvest.quality_status = "inspected"
    harvest.verified_by = actor
    harvest.verified_at = utcnow()
    harvest.updated_at = harvest.verified_at
    await db.flush()

    quantity = format_number(harvest.quantity_kg)
    await audit(
        db,
        actor,
        "harvest.verify",
        "harvest",
        harvest.id,
        f"{actor.full_name} inspected {quantity} kg of {crop.name} of "
        f"{harvest.farmer.full_name}: grade {req.grade}",
        {"grade": req.grade, "previous_grade": previous_grade, "notes": harvest.quality_notes},
    )
    await notify(
        db,
        [harvest.farmer_id],
        "verification",
        "Your harvest was inspected",
        f"{actor.full_name} recorded grade {req.grade} for your {quantity} kg of {crop.name}.",
        link=f"/app/farmer/harvests/{harvest.id}",
    )
    return harvest


# ─────────────────────────────── Photos ───────────────────────────────


def _unsupported_image() -> DomainError:
    return DomainError(
        http_status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        "Upload a JPEG, PNG or WebP photo",
        "unsupported_media_type",
    )


def _too_large(message: str | None = None) -> DomainError:
    return DomainError(
        http_status.HTTP_413_CONTENT_TOO_LARGE,
        message or f"Photos must be {settings.MAX_UPLOAD_MB} MB or smaller",
        "file_too_large",
    )


def _to_rgb(image: Image.Image) -> Image.Image:
    """RGB on a white background (transparent PNG / WebP areas become white)."""
    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.getchannel("A"))
        return background
    return image.convert("RGB")


def decode_image(data: bytes) -> Image.Image:
    """Decode an upload with Pillow (the bytes decide the type, never the name or header).

    Returns an upright RGB image at most ``MAX_IMAGE_SIDE`` pixels on its longest side.
    """
    try:
        with Image.open(BytesIO(data)) as probe:
            if probe.format not in ALLOWED_IMAGE_FORMATS:
                raise _unsupported_image()
            if probe.width * probe.height > MAX_IMAGE_PIXELS:
                raise _too_large("The photo's dimensions are too large")
            probe.verify()
        with Image.open(BytesIO(data)) as source:
            source.load()
            image = ImageOps.exif_transpose(source)
            image = _to_rgb(image)
    except DomainError:
        raise
    except (
        UnidentifiedImageError,
        Image.DecompressionBombError,
        OSError,
        SyntaxError,
        ValueError,
    ) as exc:
        raise _unsupported_image() from exc
    image.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE), Image.Resampling.LANCZOS)
    return image


def process_photo(data: bytes, crop_name: str | None) -> tuple[bytes, schemas.PhotoAnalysis]:
    """Decode, analyse and re-encode as WebP (drops EXIF and anything hidden in the file)."""
    image = decode_image(data)
    analysis = photo_analysis.analyze(image, crop_name)
    buffer = BytesIO()
    image.save(buffer, "WEBP", quality=WEBP_QUALITY, method=4)
    return buffer.getvalue(), analysis


async def _read_upload(upload: UploadFile) -> bytes:
    limit = settings.max_upload_bytes
    if upload.size is not None and upload.size > limit:
        raise _too_large()
    chunks: list[bytes] = []
    total = 0
    while chunk := await upload.read(READ_CHUNK_BYTES):
        total += len(chunk)
        if total > limit:
            raise _too_large()
        chunks.append(chunk)
    if total == 0:
        raise _unsupported_image()
    return b"".join(chunks)


def _media_path(relative: str) -> Path | None:
    """Absolute path of a stored media file, or ``None`` if it would escape ``MEDIA_DIR``."""
    root = settings.MEDIA_DIR.resolve()
    path = (root / relative).resolve()
    return path if path.is_relative_to(root) else None


async def add_photo(
    db: AsyncSession, harvest: Harvest, upload: UploadFile, actor: User
) -> HarvestPhoto:
    """Store a re-encoded WebP photo with its visual notes (at most ``MAX_PHOTOS`` per harvest)."""
    ensure_can_manage(harvest, actor)
    if harvest.status in CLOSED_STATUSES:
        raise conflict("Photos cannot be added to a cancelled or expired listing")
    # Serialise uploads to the same harvest so the photo limit holds under concurrency.
    await db.execute(select(Harvest.id).where(Harvest.id == harvest.id).with_for_update())
    photo_count = await db.scalar(
        select(func.count()).select_from(HarvestPhoto).where(HarvestPhoto.harvest_id == harvest.id)
    )
    if (photo_count or 0) >= MAX_PHOTOS:
        raise conflict(f"A harvest can have at most {MAX_PHOTOS} photos")

    data = await _read_upload(upload)
    webp, analysis = await run_in_threadpool(process_photo, data, harvest.crop.name)

    photo_id = uuid.uuid4()
    relative = f"harvests/{harvest.id}/{photo_id}.webp"
    path = settings.MEDIA_DIR / relative
    await run_in_threadpool(path.parent.mkdir, parents=True, exist_ok=True)
    await run_in_threadpool(path.write_bytes, webp)

    photo = HarvestPhoto(
        id=photo_id,
        harvest_id=harvest.id,
        file_path=relative,
        url=f"{settings.MEDIA_URL.rstrip('/')}/{relative}",
        analysis=analysis.model_dump(),
        uploaded_by_id=actor.id,
    )
    try:
        harvest.photos.append(photo)
        await db.flush()
        await audit(
            db,
            actor,
            "harvest.photo_add",
            "harvest",
            harvest.id,
            f"{actor.full_name} added a photo to the {harvest.crop.name} harvest of "
            f"{harvest.farmer.full_name}",
            {"photo_id": photo.id},
        )
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return photo


async def delete_photo(
    db: AsyncSession, harvest: Harvest, photo_id: uuid.UUID, actor: User
) -> None:
    """Remove a photo and its file. Photos are kept as evidence once a deal is agreed."""
    ensure_can_manage(harvest, actor)
    photo = next((item for item in harvest.photos if item.id == photo_id), None)
    if photo is None:
        raise not_found("Photo")
    if harvest.status in PHOTO_LOCKED_STATUSES:
        raise conflict("Photos are kept as evidence once a deal is agreed")
    file_path = photo.file_path
    harvest.photos.remove(photo)
    await db.flush()
    await audit(
        db,
        actor,
        "harvest.photo_delete",
        "harvest",
        harvest.id,
        f"{actor.full_name} removed a photo from the {harvest.crop.name} harvest of "
        f"{harvest.farmer.full_name}",
        {"photo_id": photo_id},
    )
    path = _media_path(file_path)
    if path is not None:
        await run_in_threadpool(path.unlink, missing_ok=True)
