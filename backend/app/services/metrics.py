"""Pilot success metrics (``PilotMetrics``, PILOT_PLAYBOOK §3) and shared aggregate queries.

Every metric is computed from recorded transactions with a handful of aggregate queries:

* ``net_uplift_per_kg`` — kg-weighted (dispatched kg) average of ``uplift_per_kg`` over paid
  payouts that have a baseline.
* ``completion_rate_pct`` — accepted kg in settled lots ÷ kg of every harvest ever listed
  (all statuses except ``draft``).
* ``avg_hours_listing_to_buyer`` — hours from a harvest's listing to its lot's accepted offer,
  averaged over the (member harvest, accepted offer) pairs.
* ``transport_cost_per_kg`` — booked quote totals of completed trips ÷ kg picked up on them.
* ``avg_payment_delay_days`` — days paid after the due date (0 when on time), over settlements
  paid in full.
* ``rejection_rate_pct`` — rejected kg ÷ delivered kg.
* ``failed_transactions`` — lots cancelled after an offer was accepted + settlements past their due
  date and not paid in full.
* ``repeat_farmers_pct`` / ``repeat_buyers_pct`` — share of farmers (payouts) and buyers
  (settlements) with two or more settlements.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import Date, Numeric, cast, func, select

from app import schemas
from app.core.time import today_ist
from app.models import (
    FarmerPayout,
    Harvest,
    Lot,
    LotMember,
    Offer,
    Settlement,
    TransportQuote,
    TransportRequest,
    TransportStop,
)
from app.services.pricing import round_money

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

SUPPLY_STATUSES = ("listed", "pooled")
"""Harvests whose uncommitted kilograms are on offer."""
PAID_TOLERANCE = Decimal("0.01")
_HUNDRED = Decimal(100)


def ratio(numerator: Any, denominator: Any, *, scale: Decimal = Decimal(1)) -> float | None:
    """``numerator / denominator × scale`` rounded to 2 dp, or ``None`` without a denominator."""
    if denominator is None or Decimal(denominator) == 0:
        return None
    value = Decimal(numerator or 0) / Decimal(denominator) * scale
    return float(round_money(value))


# ──────────────────────────── Supply queries ────────────────────────────


def committed_kg_subquery() -> Any:
    """kg of each harvest committed to non-cancelled lots (consent not declined)."""
    return (
        select(
            LotMember.harvest_id.label("harvest_id"),
            func.sum(LotMember.quantity_kg).label("kg"),
        )
        .join(Lot, Lot.id == LotMember.lot_id)
        .where(Lot.status != "cancelled", LotMember.consent_status != "declined")
        .group_by(LotMember.harvest_id)
        .subquery()
    )


@dataclass(frozen=True)
class SupplyRow:
    harvest_id: uuid.UUID
    farmer_id: uuid.UUID
    crop_id: uuid.UUID
    available_from: date
    sell_by: date
    available_kg: Decimal


async def supply_rows(
    db: AsyncSession,
    *,
    farmer_id: uuid.UUID | None = None,
    crop_ids: Iterable[uuid.UUID] | None = None,
    statuses: tuple[str, ...] = SUPPLY_STATUSES,
) -> list[SupplyRow]:
    """Available (uncommitted) kg per harvest in ``statuses``, in one query."""
    committed = committed_kg_subquery()
    available = func.greatest(Harvest.quantity_kg - func.coalesce(committed.c.kg, 0), 0)
    query = (
        select(
            Harvest.id,
            Harvest.farmer_id,
            Harvest.crop_id,
            Harvest.available_from,
            Harvest.sell_by,
            available,
        )
        .outerjoin(committed, committed.c.harvest_id == Harvest.id)
        .where(Harvest.status.in_(statuses))
    )
    if farmer_id is not None:
        query = query.where(Harvest.farmer_id == farmer_id)
    if crop_ids is not None:
        query = query.where(Harvest.crop_id.in_(list(crop_ids)))
    rows = (await db.execute(query)).all()
    return [SupplyRow(*row[:5], available_kg=Decimal(row[5])) for row in rows]


# ───────────────────────────── Pilot metrics ────────────────────────────


async def pilot_metrics(db: AsyncSession) -> schemas.PilotMetrics:
    """Pilot KPIs: net uplift, completion, speed, transport cost, delays, rejections, repeats."""
    uplift_sum, uplift_kg = (
        await db.execute(
            select(
                func.sum(FarmerPayout.uplift_per_kg * FarmerPayout.dispatched_kg),
                func.sum(FarmerPayout.dispatched_kg),
            ).where(FarmerPayout.status == "paid", FarmerPayout.uplift_per_kg.is_not(None))
        )
    ).one()

    settled_kg = await db.scalar(
        select(func.sum(FarmerPayout.accepted_kg))
        .join(Settlement, Settlement.id == FarmerPayout.settlement_id)
        .join(Lot, Lot.id == Settlement.lot_id)
        .where(Lot.status == "settled")
    )
    listed_kg = await db.scalar(
        select(func.sum(Harvest.quantity_kg)).where(Harvest.status != "draft")
    )

    hours = func.extract("epoch", Offer.accepted_at - Harvest.created_at) / 3600
    avg_hours = await db.scalar(
        select(func.avg(cast(hours, Numeric)))
        .select_from(Lot)
        .join(Offer, Offer.id == Lot.accepted_offer_id)
        .join(LotMember, LotMember.lot_id == Lot.id)
        .join(Harvest, Harvest.id == LotMember.harvest_id)
        .where(Offer.accepted_at.is_not(None), LotMember.consent_status != "declined")
    )

    trip_cost = await db.scalar(
        select(func.sum(TransportQuote.price_total))
        .join(TransportRequest, TransportRequest.booked_quote_id == TransportQuote.id)
        .where(TransportRequest.status == "completed")
    )
    trip_kg = await db.scalar(
        select(func.sum(TransportStop.picked_kg))
        .join(TransportRequest, TransportRequest.id == TransportStop.request_id)
        .where(TransportRequest.status == "completed", TransportStop.status == "picked_up")
    )

    paid_date = cast(func.timezone("Asia/Kolkata", Settlement.paid_at), Date)
    avg_delay = await db.scalar(
        select(func.avg(func.greatest(paid_date - Settlement.due_date, 0))).where(
            Settlement.paid_at.is_not(None)
        )
    )

    rejected_kg, delivered_kg = (
        await db.execute(
            select(func.sum(LotMember.rejected_kg), func.sum(LotMember.delivered_kg)).where(
                LotMember.delivered_kg.is_not(None), LotMember.consent_status != "declined"
            )
        )
    ).one()

    failed = await failed_transactions(db)

    farmer_counts = (
        select(func.count(func.distinct(FarmerPayout.settlement_id)).label("n"))
        .group_by(FarmerPayout.farmer_id)
        .subquery()
    )
    repeat_farmers, farmers = (
        await db.execute(
            select(func.count().filter(farmer_counts.c.n >= 2), func.count()).select_from(
                farmer_counts
            )
        )
    ).one()
    buyer_counts = (
        select(func.count(Settlement.id).label("n")).group_by(Settlement.buyer_id).subquery()
    )
    repeat_buyers, buyers = (
        await db.execute(
            select(func.count().filter(buyer_counts.c.n >= 2), func.count()).select_from(
                buyer_counts
            )
        )
    ).one()

    return schemas.PilotMetrics(
        net_uplift_per_kg=ratio(uplift_sum, uplift_kg),
        completion_rate_pct=ratio(settled_kg, listed_kg, scale=_HUNDRED),
        avg_hours_listing_to_buyer=(
            float(round_money(avg_hours)) if avg_hours is not None else None
        ),
        transport_cost_per_kg=ratio(trip_cost, trip_kg),
        avg_payment_delay_days=float(round_money(avg_delay)) if avg_delay is not None else None,
        rejection_rate_pct=ratio(rejected_kg, delivered_kg, scale=_HUNDRED),
        failed_transactions=failed,
        repeat_farmers_pct=ratio(repeat_farmers, farmers, scale=_HUNDRED),
        repeat_buyers_pct=ratio(repeat_buyers, buyers, scale=_HUNDRED),
    )


async def failed_transactions(db: AsyncSession) -> int:
    """Lots cancelled after an accepted offer + unpaid settlements past their due date."""
    cancelled = await db.scalar(
        select(func.count(Lot.id)).where(
            Lot.status == "cancelled", Lot.accepted_offer_id.is_not(None)
        )
    )
    overdue = await db.scalar(
        select(func.count(Settlement.id)).where(
            Settlement.due_date < today_ist(),
            Settlement.amount_paid < Settlement.gross_amount - PAID_TOLERANCE,
        )
    )
    return int(cancelled or 0) + int(overdue or 0)
