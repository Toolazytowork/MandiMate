"""Offer & negotiation schemas."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field, ValidationInfo, field_validator
from pydantic_core import PydanticCustomError

from app.schemas.common import (
    AddressText,
    ApiModel,
    Awaiting,
    ConsentDecision,
    Grade,
    Latitude,
    Longitude,
    NegotiationAction,
    OfferStatus,
    OfferTargetType,
    OptionalLongText,
    PaymentTermsDays,
    Percent,
    PickupTerms,
    Price,
    Quantity,
    Rate,
    RequestModel,
    Role,
    UtcDateTime,
)


class NegotiationEntry(ApiModel):
    id: uuid.UUID
    author_id: uuid.UUID | None
    author_name: str
    author_role: Role | Literal["system"]
    action: NegotiationAction
    price_per_kg: float | None
    quantity_kg: float | None
    payment_terms_days: int | None
    message: str | None
    created_at: datetime


class OfferConsent(ApiModel):
    member_id: uuid.UUID
    farmer_id: uuid.UUID
    farmer_name: str
    quantity_kg: float
    decision: ConsentDecision
    decided_at: datetime | None
    is_mine: bool


class Offer(ApiModel):
    id: uuid.UUID
    code: str
    buyer_id: uuid.UUID
    buyer_name: str
    buyer_verified: bool
    buyer_reliability_pct: float | None
    """0..100 from settlement history; null when there is no history yet."""
    target_type: OfferTargetType
    lot_id: uuid.UUID | None
    lot_code: str | None
    harvest_id: uuid.UUID | None
    demand_id: uuid.UUID | None
    crop_id: uuid.UUID
    crop_name: str
    grade: Grade
    price_per_kg: float
    quantity_kg: float
    pickup_terms: PickupTerms
    delivery_location: str
    delivery_latitude: float | None
    delivery_longitude: float | None
    payment_terms_days: int
    max_rejection_pct: float
    quality_spec: str | None
    handling_charge_per_kg: float
    commission_pct: float
    valid_until: datetime
    status: OfferStatus
    awaiting: Awaiting | None
    notes: str | None
    negotiation: list[NegotiationEntry]
    consents: list[OfferConsent]
    created_at: datetime
    updated_at: datetime


_TARGET_FIELD: dict[OfferTargetType, str] = {"lot": "lot_id", "harvest": "harvest_id"}


class OfferCreateRequest(RequestModel):
    coordinate_pairs = (("delivery_latitude", "delivery_longitude"),)

    target_type: OfferTargetType
    lot_id: uuid.UUID | None = Field(default=None, validate_default=True)
    """Required when target_type is 'lot'."""
    harvest_id: uuid.UUID | None = Field(default=None, validate_default=True)
    """Required when target_type is 'harvest'."""
    demand_id: uuid.UUID | None = None
    price_per_kg: Price
    quantity_kg: Quantity
    pickup_terms: PickupTerms
    delivery_location: AddressText
    delivery_latitude: Latitude | None = None
    delivery_longitude: Longitude | None = None
    payment_terms_days: PaymentTermsDays
    max_rejection_pct: Percent
    quality_spec: OptionalLongText = None
    handling_charge_per_kg: Rate = 0.0
    valid_until: UtcDateTime
    notes: OptionalLongText = None

    @field_validator("lot_id", "harvest_id")
    @classmethod
    def _matches_target_type(
        cls, value: uuid.UUID | None, info: ValidationInfo
    ) -> uuid.UUID | None:
        target_type: OfferTargetType | None = info.data.get("target_type")
        if target_type is None:
            return value
        is_target_field = info.field_name == _TARGET_FIELD[target_type]
        if is_target_field and value is None:
            raise PydanticCustomError(
                "offer_target_required",
                "Select the {target_type} this offer is for",
                {"target_type": target_type},
            )
        if not is_target_field and value is not None:
            raise PydanticCustomError(
                "offer_target_conflict",
                "An offer is made on either a lot or a harvest, not both",
            )
        return value


class CounterRequest(RequestModel):
    price_per_kg: Price
    quantity_kg: Quantity | None = None
    payment_terms_days: PaymentTermsDays | None = None
    message: OptionalLongText = None


class OfferActionRequest(RequestModel):
    message: OptionalLongText = None
