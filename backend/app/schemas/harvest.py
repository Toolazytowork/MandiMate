"""Harvest listing schemas."""

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, ValidationInfo
from pydantic_core import PydanticCustomError

from app.schemas.common import (
    ApiModel,
    Grade,
    HarvestStatus,
    Latitude,
    ListingSource,
    Longitude,
    OptionalLongText,
    OptionalShortText,
    PatchModel,
    Price,
    QualityStatus,
    Quantity,
    RequestModel,
)


class PhotoAnalysis(ApiModel):
    dominant_color_hex: str
    red_ratio: float
    green_ratio: float
    brightness: float
    uniformity: float
    observations: list[str]
    disclaimer: str


class HarvestPhoto(ApiModel):
    id: uuid.UUID
    url: str
    analysis: PhotoAnalysis | None
    created_at: datetime


class Harvest(ApiModel):
    id: uuid.UUID
    farmer_id: uuid.UUID
    farmer_name: str
    """Masked (e.g. "Ravi K.") for viewers who are not the owner, a coordinator or an admin."""
    crop_id: uuid.UUID
    crop_name: str
    variety: str | None
    quantity_kg: float
    available_kg: float
    """quantity_kg minus quantity committed to lots that are not cancelled."""
    grade: Grade
    quality_notes: str | None
    quality_status: QualityStatus
    harvest_date: date
    available_from: date
    sell_by: date
    village: str | None
    district: str | None
    state: str | None
    latitude: float | None
    longitude: float | None
    min_price_per_kg: float | None
    """Private: only the owner farmer, coordinators and admins see it; null for everyone else."""
    status: HarvestStatus
    source: ListingSource
    photos: list[HarvestPhoto]
    lot_ids: list[uuid.UUID]
    open_offers_count: int
    best_offer_price_per_kg: float | None
    created_by_id: uuid.UUID
    verified_by_name: str | None
    verified_at: datetime | None
    created_at: datetime
    updated_at: datetime


def _sell_by_after_other_dates(sell_by: date, info: ValidationInfo) -> date:
    """Checks sell_by against harvest_date / available_from sent in the same body.

    PATCH bodies may carry only some of the dates, so services re-check the merged values.
    """
    available_from = info.data.get("available_from")
    if available_from is not None and sell_by < available_from:
        raise PydanticCustomError(
            "sell_by_before_available_from",
            "Sell-by date cannot be earlier than the available-from date",
        )
    harvest_date = info.data.get("harvest_date")
    if harvest_date is not None and sell_by < harvest_date:
        raise PydanticCustomError(
            "sell_by_before_harvest_date", "Sell-by date cannot be earlier than the harvest date"
        )
    return sell_by


SellByDate = Annotated[date, AfterValidator(_sell_by_after_other_dates)]


class HarvestCreateRequest(RequestModel):
    coordinate_pairs = (("latitude", "longitude"),)

    crop_id: uuid.UUID
    variety: OptionalShortText = None
    quantity_kg: Quantity
    grade: Grade = "ungraded"
    quality_notes: OptionalLongText = None
    harvest_date: date
    available_from: date
    sell_by: SellByDate
    village: OptionalShortText = None
    """Location fields default to the farmer's profile location when omitted."""
    district: OptionalShortText = None
    state: OptionalShortText = None
    latitude: Latitude | None = None
    longitude: Longitude | None = None
    min_price_per_kg: Price | None = None
    source: ListingSource = "manual"
    status: Literal["draft", "listed"] = "listed"
    farmer_id: uuid.UUID | None = None
    """Coordinator-assisted listing on behalf of a farmer; required for coordinators/admins."""


class HarvestUpdateRequest(PatchModel):
    coordinate_pairs = (("latitude", "longitude"),)
    non_nullable_fields = frozenset(
        {
            "crop_id",
            "quantity_kg",
            "grade",
            "harvest_date",
            "available_from",
            "sell_by",
            "status",
        }
    )

    crop_id: uuid.UUID | None = None
    variety: OptionalShortText = None
    quantity_kg: Quantity | None = None
    grade: Grade | None = None
    quality_notes: OptionalLongText = None
    harvest_date: date | None = None
    available_from: date | None = None
    sell_by: SellByDate | None = None
    village: OptionalShortText = None
    district: OptionalShortText = None
    state: OptionalShortText = None
    latitude: Latitude | None = None
    longitude: Longitude | None = None
    min_price_per_kg: Price | None = None
    status: Literal["draft", "listed"] | None = None


class HarvestVerifyRequest(RequestModel):
    grade: Grade
    quality_notes: OptionalLongText = None
