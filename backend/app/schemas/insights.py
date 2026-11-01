"""Supply & demand insight schemas (coordinators)."""

import datetime as dt
import uuid
from typing import Literal

from app.schemas.ai import AiText
from app.schemas.common import ApiModel
from app.schemas.dashboard import PilotMetrics


class CropBalance(ApiModel):
    crop_id: uuid.UUID
    crop_name: str
    listed_kg: float
    demanded_kg: float
    gap_kg: float
    """demanded_kg − listed_kg"""
    avg_offer_price_per_kg: float | None
    market_modal_price_per_kg: float | None
    signal: Literal["surplus", "balanced", "shortage"]


class SupplyForecastPoint(ApiModel):
    date: dt.date
    crop_name: str
    quantity_kg: float


class SupplyDemandInsights(ApiModel):
    by_crop: list[CropBalance]
    upcoming_supply: list[SupplyForecastPoint]
    pilot_metrics: PilotMetrics
    summary: AiText
