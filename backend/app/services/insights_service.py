"""Supply & demand insights for coordinators (``GET /insights/supply-demand``).

* ``by_crop`` — per crop with listed supply or open demand: ``listed_kg`` (available kg of
  listed/pooled harvests), ``demanded_kg`` (open demands), ``gap_kg = demanded − listed``, the
  kg-weighted average offer price of the last 30 days and the latest mandi modal price.
  ``signal``: ``shortage`` when the gap exceeds 10% of ``max(listed, demanded)``, ``surplus`` when
  it is below −10%, else ``balanced``.
* ``upcoming_supply`` — available kg by date and crop over the next 14 days (harvests already
  available count from today).
* ``summary`` — narrative from ``ai.service.summarize_insights`` over the computed balances.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import func, select

from app import schemas
from app.ai import service as ai_service
from app.core.time import today_ist, utcnow
from app.models import Crop, Demand, Offer
from app.services import market_service, metrics
from app.services.pricing import round_money
from app.services.transport_service import money

if TYPE_CHECKING:
    import uuid

    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models import User

OFFER_WINDOW_DAYS = 30
FORECAST_DAYS = 14
SIGNAL_THRESHOLD = Decimal("0.10")
_ZERO = Decimal(0)


def balance_signal(listed: Decimal, demanded: Decimal) -> str:
    gap = demanded - listed
    threshold = max(listed, demanded) * SIGNAL_THRESHOLD
    if gap > threshold:
        return "shortage"
    if gap < -threshold:
        return "surplus"
    return "balanced"


async def crop_balances(db: AsyncSession) -> list[schemas.CropBalance]:
    supply = await metrics.supply_rows(db)
    listed: dict[uuid.UUID, Decimal] = defaultdict(lambda: _ZERO)
    for row in supply:
        listed[row.crop_id] += row.available_kg
    demanded = dict(
        (
            await db.execute(
                select(Demand.crop_id, func.sum(Demand.quantity_kg))
                .where(Demand.status == "open")
                .group_by(Demand.crop_id)
            )
        ).all()
    )
    since = utcnow() - timedelta(days=OFFER_WINDOW_DAYS)
    offer_prices = {
        crop_id: (total, quantity)
        for crop_id, total, quantity in (
            await db.execute(
                select(
                    Offer.crop_id,
                    func.sum(Offer.price_per_kg * Offer.quantity_kg),
                    func.sum(Offer.quantity_kg),
                )
                .where(Offer.created_at >= since)
                .group_by(Offer.crop_id)
            )
        ).all()
    }
    crop_ids = {crop_id for crop_id, kg in listed.items() if kg > 0} | {
        crop_id for crop_id, kg in demanded.items() if kg and kg > 0
    }
    if not crop_ids:
        return []
    crops = list(await db.scalars(select(Crop).where(Crop.id.in_(crop_ids)).order_by(Crop.name)))

    balances = []
    for crop in crops:
        listed_kg = round_money(listed.get(crop.id, _ZERO))
        demanded_kg = round_money(demanded.get(crop.id) or _ZERO)
        total, quantity = offer_prices.get(crop.id, (None, None))
        market = await market_service.latest_market_price(db, crop.id)
        balances.append(
            schemas.CropBalance(
                crop_id=crop.id,
                crop_name=crop.name,
                listed_kg=money(listed_kg),
                demanded_kg=money(demanded_kg),
                gap_kg=money(demanded_kg - listed_kg),
                avg_offer_price_per_kg=metrics.ratio(total, quantity),
                market_modal_price_per_kg=(
                    money(market.modal_price_per_kg) if market is not None else None
                ),
                signal=balance_signal(listed_kg, demanded_kg),
            )
        )
    return balances


async def upcoming_supply(db: AsyncSession) -> list[schemas.SupplyForecastPoint]:
    today = today_ist()
    horizon = today + timedelta(days=FORECAST_DAYS)
    totals: dict[tuple[date, uuid.UUID], Decimal] = defaultdict(lambda: _ZERO)
    for row in await metrics.supply_rows(db):
        if row.available_kg <= 0 or row.sell_by < today:
            continue
        day = max(row.available_from, today)
        if day <= horizon:
            totals[(day, row.crop_id)] += row.available_kg
    if not totals:
        return []
    names = dict(
        (
            await db.execute(
                select(Crop.id, Crop.name).where(Crop.id.in_({crop for _, crop in totals}))
            )
        ).all()
    )
    points = [
        schemas.SupplyForecastPoint(date=day, crop_name=names[crop_id], quantity_kg=money(kg))
        for (day, crop_id), kg in totals.items()
    ]
    return sorted(points, key=lambda point: (point.date, point.crop_name))


async def supply_demand_insights(db: AsyncSession, user: User) -> schemas.SupplyDemandInsights:
    by_crop = await crop_balances(db)
    summary = await ai_service.summarize_insights(db, by_crop, user)
    return schemas.SupplyDemandInsights(
        by_crop=by_crop,
        upcoming_supply=await upcoming_supply(db),
        pilot_metrics=await metrics.pilot_metrics(db),
        summary=summary,
    )
