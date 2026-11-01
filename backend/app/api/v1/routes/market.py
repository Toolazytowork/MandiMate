"""Mandi market prices."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Query

from app import schemas
from app.core.deps import CurrentUser, DbSession
from app.services import market_service

router = APIRouter(prefix="/market-prices", tags=["market"])


@router.get("", response_model=list[schemas.MarketPrice], summary="List market prices")
async def list_market_prices(
    db: DbSession,
    user: CurrentUser,
    crop_id: uuid.UUID | None = None,
    district: Annotated[str | None, Query(max_length=120)] = None,
    limit: Annotated[int, Query(ge=1, le=market_service.MAX_LIMIT)] = market_service.DEFAULT_LIMIT,
) -> list[schemas.MarketPrice]:
    """Mandi prices, latest first; filter by crop and/or district (case-insensitive)."""
    prices = await market_service.list_market_prices(
        db, crop_id=crop_id, district=district, limit=limit
    )
    return [market_service.market_price_out(price) for price in prices]
