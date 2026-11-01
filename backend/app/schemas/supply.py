"""Supply browsing schemas (buyers)."""

import uuid
from datetime import date
from typing import Literal

from app.schemas.common import ApiModel, Grade, OfferStatus, QualityStatus


class SupplyItem(ApiModel):
    kind: Literal["lot", "harvest"]
    id: uuid.UUID
    code: str | None
    crop_id: uuid.UUID
    crop_name: str
    grade: Grade
    quantity_kg: float
    member_count: int
    village: str | None
    district: str | None
    quality_status: QualityStatus
    available_from: date
    sell_by: date
    pickup_date: date | None
    distance_km: float | None
    """Distance from the viewer's profile location, when both are known."""
    offers_count: int
    my_offer_status: OfferStatus | None
