"""Aggregated supply for buyers: pooled lots open for offers and individually listed harvests.

A harvest that is a member of a lot open for offers is represented by that lot only. Farmer
names never appear (``SupplyItem`` carries none). Quantities are what a buyer can actually make
an offer for: a lot's pooled total, or a harvest's ``available_kg``.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import date
from decimal import Decimal

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import schemas
from app.core.time import today_ist, utcnow
from app.models import Harvest, Lot, LotMember, Offer, User
from app.services.harvest_service import committed_kg_map, expire_overdue_harvests
from app.services.pricing import road_km, round_money

ZERO = Decimal("0")

OPEN_DIRECT_OFFER_STATUSES = ("pending", "countered")
OPEN_LOT_OFFER_STATUSES = ("pending", "countered", "proposed")
EXPIRING_STATUSES = frozenset(OPEN_DIRECT_OFFER_STATUSES)

QUALITY_RANK: dict[str, int] = {"self_reported": 0, "pending_inspection": 1, "inspected": 2}
"""A lot is only as well-checked as its least-checked member."""


def _distance(viewer: User, latitude: float | None, longitude: float | None) -> float | None:
    if None in (viewer.latitude, viewer.longitude, latitude, longitude):
        return None
    return float(road_km(viewer.latitude, viewer.longitude, latitude, longitude))  # type: ignore[arg-type]


async def _open_offer_counts(
    db: AsyncSession, lot_ids: Sequence[uuid.UUID], harvest_ids: Sequence[uuid.UUID]
) -> tuple[dict[uuid.UUID, int], dict[uuid.UUID, int]]:
    """Open (not yet lapsed) offers per lot and per harvest (direct offers)."""
    now = utcnow()
    per_lot: dict[uuid.UUID, int] = {}
    per_harvest: dict[uuid.UUID, int] = {}
    if lot_ids:
        rows = await db.execute(
            select(Offer.lot_id, func.count())
            .where(
                Offer.target_type == "lot",
                Offer.lot_id.in_(lot_ids),
                Offer.status.in_(OPEN_LOT_OFFER_STATUSES),
                or_(Offer.status == "proposed", Offer.valid_until > now),
            )
            .group_by(Offer.lot_id)
        )
        per_lot = {row[0]: row[1] for row in rows.all()}
    if harvest_ids:
        rows = await db.execute(
            select(Offer.harvest_id, func.count())
            .where(
                Offer.target_type == "harvest",
                Offer.harvest_id.in_(harvest_ids),
                Offer.status.in_(OPEN_DIRECT_OFFER_STATUSES),
                Offer.valid_until > now,
            )
            .group_by(Offer.harvest_id)
        )
        per_harvest = {row[0]: row[1] for row in rows.all()}
    return per_lot, per_harvest


async def _my_offer_statuses(
    db: AsyncSession,
    viewer: User,
    lot_ids: Sequence[uuid.UUID],
    harvest_ids: Sequence[uuid.UUID],
) -> tuple[dict[uuid.UUID, str], dict[uuid.UUID, str]]:
    """Status of the viewer's most recent offer on each lot / harvest."""
    targets = []
    if lot_ids:
        targets.append(and_(Offer.target_type == "lot", Offer.lot_id.in_(lot_ids)))
    if harvest_ids:
        targets.append(and_(Offer.target_type == "harvest", Offer.harvest_id.in_(harvest_ids)))
    if not targets:
        return {}, {}
    rows = await db.execute(
        select(Offer.target_type, Offer.lot_id, Offer.harvest_id, Offer.status, Offer.valid_until)
        .where(Offer.buyer_id == viewer.id, or_(*targets))
        .order_by(Offer.created_at.desc(), Offer.id.desc())
    )
    now = utcnow()
    on_lots: dict[uuid.UUID, str] = {}
    on_harvests: dict[uuid.UUID, str] = {}
    for target_type, lot_id, harvest_id, status, valid_until in rows.all():
        effective = "expired" if status in EXPIRING_STATUSES and valid_until <= now else status
        if target_type == "lot":
            on_lots.setdefault(lot_id, effective)
        else:
            on_harvests.setdefault(harvest_id, effective)
    return on_lots, on_harvests


def _lot_item(
    lot: Lot, viewer: User, *, offers_count: int, my_offer_status: str | None
) -> schemas.SupplyItem | None:
    members = [member for member in lot.members if member.consent_status != "declined"]
    quantity = sum((member.quantity_kg for member in members), ZERO)
    if not members or quantity <= 0:
        return None
    harvests = [member.harvest for member in members]
    quality = min(
        (harvest.quality_status for harvest in harvests), key=lambda value: QUALITY_RANK[value]
    )
    available_from: date = max(harvest.available_from for harvest in harvests)
    sell_by: date = min(harvest.sell_by for harvest in harvests)
    return schemas.SupplyItem(
        kind="lot",
        id=lot.id,
        code=lot.code,
        crop_id=lot.crop_id,
        crop_name=lot.crop.name,
        grade=lot.grade,
        quantity_kg=float(round_money(quantity)),
        member_count=len({member.harvest_id for member in members}),
        village=lot.collection_point_name,
        district=lot.district,
        quality_status=quality,
        available_from=available_from,
        sell_by=sell_by,
        pickup_date=lot.pickup_date,
        distance_km=_distance(viewer, lot.collection_latitude, lot.collection_longitude),
        offers_count=offers_count,
        my_offer_status=my_offer_status,  # type: ignore[arg-type]
    )


def _harvest_item(
    harvest: Harvest,
    viewer: User,
    *,
    available_kg: float,
    offers_count: int,
    my_offer_status: str | None,
) -> schemas.SupplyItem:
    return schemas.SupplyItem(
        kind="harvest",
        id=harvest.id,
        code=None,
        crop_id=harvest.crop_id,
        crop_name=harvest.crop.name,
        grade=harvest.grade,
        quantity_kg=available_kg,
        member_count=1,
        village=harvest.village,
        district=harvest.district,
        quality_status=harvest.quality_status,
        available_from=harvest.available_from,
        sell_by=harvest.sell_by,
        pickup_date=None,
        distance_km=_distance(viewer, harvest.latitude, harvest.longitude),
        offers_count=offers_count,
        my_offer_status=my_offer_status,  # type: ignore[arg-type]
    )


async def list_supply(
    db: AsyncSession,
    viewer: User,
    *,
    crop_id: uuid.UUID | None = None,
    grade: str | None = None,
    district: str | None = None,
    limit: int = 100,
) -> list[schemas.SupplyItem]:
    """Lots ``open_for_offers`` (newest first), then listed harvests with ``available_kg > 0``."""
    await expire_overdue_harvests(db)
    district_key = district.strip().lower() if district and district.strip() else None

    lot_statement = (
        select(Lot)
        .where(Lot.status == "open_for_offers")
        .order_by(Lot.created_at.desc(), Lot.id.desc())
        .limit(limit)
    )
    if crop_id is not None:
        lot_statement = lot_statement.where(Lot.crop_id == crop_id)
    if grade is not None:
        lot_statement = lot_statement.where(Lot.grade == grade)
    if district_key is not None:
        lot_statement = lot_statement.where(func.lower(Lot.district) == district_key)
    lots = list((await db.scalars(lot_statement)).all())

    in_open_lots = (
        select(LotMember.harvest_id)
        .join(Lot, Lot.id == LotMember.lot_id)
        .where(Lot.status == "open_for_offers", LotMember.consent_status != "declined")
    )
    committed_kg = (
        select(func.coalesce(func.sum(LotMember.quantity_kg), 0))
        .join(Lot, Lot.id == LotMember.lot_id)
        .where(
            LotMember.harvest_id == Harvest.id,
            Lot.status != "cancelled",
            LotMember.consent_status != "declined",
        )
        .correlate(Harvest)
        .scalar_subquery()
    )
    # Filter on available kg in SQL so the query can be bounded by ``limit``.
    harvest_statement = (
        select(Harvest)
        .where(
            Harvest.status == "listed",
            Harvest.sell_by >= today_ist(),
            Harvest.id.not_in(in_open_lots),
            Harvest.quantity_kg > committed_kg,
        )
        .order_by(Harvest.created_at.desc(), Harvest.id.desc())
        .limit(limit)
    )
    if crop_id is not None:
        harvest_statement = harvest_statement.where(Harvest.crop_id == crop_id)
    if grade is not None:
        harvest_statement = harvest_statement.where(Harvest.grade == grade)
    if district_key is not None:
        harvest_statement = harvest_statement.where(func.lower(Harvest.district) == district_key)
    harvests = list((await db.scalars(harvest_statement)).all())

    committed = await committed_kg_map(db, [harvest.id for harvest in harvests])
    available: dict[uuid.UUID, float] = {}
    for harvest in harvests:
        remaining = harvest.quantity_kg - committed.get(harvest.id, ZERO)
        if remaining > 0:
            available[harvest.id] = float(round_money(remaining))
    harvests = [harvest for harvest in harvests if harvest.id in available]

    lot_ids = [lot.id for lot in lots]
    harvest_ids = [harvest.id for harvest in harvests]
    lot_offers, harvest_offers = await _open_offer_counts(db, lot_ids, harvest_ids)
    my_lot_offers, my_harvest_offers = await _my_offer_statuses(db, viewer, lot_ids, harvest_ids)

    items: list[schemas.SupplyItem] = []
    for lot in lots:
        item = _lot_item(
            lot,
            viewer,
            offers_count=lot_offers.get(lot.id, 0),
            my_offer_status=my_lot_offers.get(lot.id),
        )
        if item is not None:
            items.append(item)
    for harvest in harvests:
        if len(items) >= limit:
            break
        items.append(
            _harvest_item(
                harvest,
                viewer,
                available_kg=available[harvest.id],
                offers_count=harvest_offers.get(harvest.id, 0),
                my_offer_status=my_harvest_offers.get(harvest.id),
            )
        )
    return items[:limit]
