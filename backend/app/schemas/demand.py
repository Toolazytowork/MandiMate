"""Buyer demand (requirement) schemas."""

import uuid
from datetime import date, datetime
from typing import Annotated

from pydantic import AfterValidator, ValidationInfo
from pydantic_core import PydanticCustomError

from app.schemas.common import (
    AddressText,
    ApiModel,
    DemandStatus,
    Grade,
    Latitude,
    Longitude,
    OptionalLongText,
    OptionalShortText,
    PatchModel,
    PaymentTermsDays,
    Percent,
    Price,
    Quantity,
    RequestModel,
)


class Demand(ApiModel):
    id: uuid.UUID
    buyer_id: uuid.UUID
    buyer_name: str
    buyer_verified: bool
    crop_id: uuid.UUID
    crop_name: str
    grade_required: Grade
    quantity_kg: float
    min_quantity_kg: float
    target_price_per_kg: float | None
    delivery_location: str
    delivery_district: str | None
    delivery_state: str | None
    delivery_latitude: float | None
    delivery_longitude: float | None
    needed_by: date
    payment_terms_days: int
    max_rejection_pct: float
    quality_spec: str | None
    notes: str | None
    status: DemandStatus
    lot_ids: list[uuid.UUID]
    created_at: datetime


def _min_quantity_within_quantity(min_quantity_kg: float, info: ValidationInfo) -> float:
    """Checks against quantity_kg sent in the same body; services re-check merged PATCH values."""
    quantity_kg = info.data.get("quantity_kg")
    if quantity_kg is not None and min_quantity_kg > quantity_kg:
        raise PydanticCustomError(
            "min_quantity_above_quantity",
            "Minimum quantity cannot be more than the total quantity",
        )
    return min_quantity_kg


MinQuantity = Annotated[Quantity, AfterValidator(_min_quantity_within_quantity)]


class DemandCreateRequest(RequestModel):
    coordinate_pairs = (("delivery_latitude", "delivery_longitude"),)

    crop_id: uuid.UUID
    grade_required: Grade
    quantity_kg: Quantity
    min_quantity_kg: MinQuantity | None = None
    """Defaults to quantity_kg (applied by the service) when omitted."""
    target_price_per_kg: Price | None = None
    delivery_location: AddressText
    delivery_district: OptionalShortText = None
    delivery_state: OptionalShortText = None
    delivery_latitude: Latitude | None = None
    delivery_longitude: Longitude | None = None
    needed_by: date
    payment_terms_days: PaymentTermsDays
    max_rejection_pct: Percent | None = None
    """Defaults to the crop's default rejection % (applied by the service) when omitted."""
    quality_spec: OptionalLongText = None
    notes: OptionalLongText = None


class DemandUpdateRequest(PatchModel):
    coordinate_pairs = (("delivery_latitude", "delivery_longitude"),)
    non_nullable_fields = frozenset(
        {
            "crop_id",
            "grade_required",
            "quantity_kg",
            "min_quantity_kg",
            "delivery_location",
            "needed_by",
            "payment_terms_days",
            "max_rejection_pct",
        }
    )

    crop_id: uuid.UUID | None = None
    grade_required: Grade | None = None
    quantity_kg: Quantity | None = None
    min_quantity_kg: MinQuantity | None = None
    target_price_per_kg: Price | None = None
    delivery_location: AddressText | None = None
    delivery_district: OptionalShortText = None
    delivery_state: OptionalShortText = None
    delivery_latitude: Latitude | None = None
    delivery_longitude: Longitude | None = None
    needed_by: date | None = None
    payment_terms_days: PaymentTermsDays | None = None
    max_rejection_pct: Percent | None = None
    quality_spec: OptionalLongText = None
    notes: OptionalLongText = None
