"""Crop catalog & market price schemas."""

import uuid
from datetime import date

from app.schemas.common import ApiModel, CropCategory, Grade


class Crop(ApiModel):
    id: uuid.UUID
    code: str
    name: str
    name_hi: str
    name_te: str
    name_kn: str
    name_ur: str
    category: CropCategory
    perishability_days: int
    grades: list[Grade]
    default_rejection_pct: float
    requires_refrigeration: bool


class MarketPrice(ApiModel):
    id: uuid.UUID
    crop_id: uuid.UUID
    crop_name: str
    market_name: str
    district: str
    state: str
    price_date: date
    min_price_per_kg: float
    modal_price_per_kg: float
    max_price_per_kg: float
    source: str
    is_illustrative: bool
    """Seeded / demo data that must be labelled as illustrative in the UI."""
