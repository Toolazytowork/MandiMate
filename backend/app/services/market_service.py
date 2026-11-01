"""Mandi market price lookups (the baseline "sell alone at the local mandi" alternative)."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import schemas
from app.models import MarketPrice

MAX_LIMIT = 500
DEFAULT_LIMIT = 100

_LATEST_FIRST = (
    MarketPrice.price_date.desc(),
    MarketPrice.created_at.desc(),
    MarketPrice.id.desc(),
)


def _same_district(district: str) -> ColumnElement[bool]:
    return func.lower(MarketPrice.district) == district.strip().lower()


async def latest_market_price(
    db: AsyncSession, crop_id: uuid.UUID, district: str | None = None
) -> MarketPrice | None:
    """Most recent market price for the crop, preferring ``district`` when given.

    Falls back to the latest price from any district; ``None`` when the crop has no price.
    District names are compared case-insensitively.
    """
    if district is not None and district.strip():
        local = await db.scalar(
            select(MarketPrice)
            .where(MarketPrice.crop_id == crop_id, _same_district(district))
            .order_by(*_LATEST_FIRST)
            .limit(1)
        )
        if local is not None:
            return local
    return await db.scalar(
        select(MarketPrice).where(MarketPrice.crop_id == crop_id).order_by(*_LATEST_FIRST).limit(1)
    )


async def list_market_prices(
    db: AsyncSession,
    *,
    crop_id: uuid.UUID | None = None,
    district: str | None = None,
    limit: int = DEFAULT_LIMIT,
) -> Sequence[MarketPrice]:
    """Market prices, latest first, optionally for one crop and/or district."""
    statement = select(MarketPrice).order_by(*_LATEST_FIRST).limit(min(limit, MAX_LIMIT))
    if crop_id is not None:
        statement = statement.where(MarketPrice.crop_id == crop_id)
    if district is not None and district.strip():
        statement = statement.where(_same_district(district))
    return (await db.scalars(statement)).all()


def market_price_out(price: MarketPrice) -> schemas.MarketPrice:
    """The API ``MarketPrice`` (``crop`` is eagerly loaded with the price)."""
    return schemas.MarketPrice(
        id=price.id,
        crop_id=price.crop_id,
        crop_name=price.crop.name,
        market_name=price.market_name,
        district=price.district,
        state=price.state,
        price_date=price.price_date,
        min_price_per_kg=float(price.min_price_per_kg),
        modal_price_per_kg=float(price.modal_price_per_kg),
        max_price_per_kg=float(price.max_price_per_kg),
        source=price.source,
        is_illustrative=price.is_illustrative,
    )
