"""Delivery & quality check schemas."""

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, Field, ValidationInfo
from pydantic_core import PydanticCustomError

from app.schemas.common import (
    ApiModel,
    MeasuredQuantity,
    OptionalLongText,
    OptionalShortText,
    RequestModel,
)


def _accepted_within_delivered(accepted_kg: float, info: ValidationInfo) -> float:
    delivered_kg = info.data.get("delivered_kg")
    if delivered_kg is not None and accepted_kg > delivered_kg:
        raise PydanticCustomError(
            "accepted_above_delivered",
            "Accepted quantity cannot be more than the delivered quantity",
        )
    return accepted_kg


class DeliveryItemInput(RequestModel):
    member_id: uuid.UUID
    delivered_kg: MeasuredQuantity
    """Validated against the dispatched quantity (≤ dispatched × 1.02) by the service."""
    accepted_kg: Annotated[MeasuredQuantity, AfterValidator(_accepted_within_delivered)]
    rejection_reason: OptionalLongText = None


def _one_item_per_member(items: list[DeliveryItemInput]) -> list[DeliveryItemInput]:
    member_ids = [item.member_id for item in items]
    if len(member_ids) != len(set(member_ids)):
        raise PydanticCustomError("duplicate_member", "Record each farmer's delivery only once")
    return items


class DeliveryRecordRequest(RequestModel):
    items: Annotated[
        list[DeliveryItemInput], Field(min_length=1), AfterValidator(_one_item_per_member)
    ]
    inspector_name: OptionalShortText = None
    notes: OptionalLongText = None


class DeliveryItem(ApiModel):
    member_id: uuid.UUID
    farmer_name: str
    dispatched_kg: float
    delivered_kg: float
    accepted_kg: float
    rejected_kg: float
    shortage_kg: float
    rejection_reason: str | None


class DeliveryRecord(ApiModel):
    lot_id: uuid.UUID
    lot_code: str
    recorded_by_name: str
    inspector_name: str | None
    recorded_at: datetime
    notes: str | None
    items: list[DeliveryItem]
    total_dispatched_kg: float
    total_delivered_kg: float
    total_accepted_kg: float
    total_rejected_kg: float
    total_shortage_kg: float
    settlement_id: uuid.UUID | None
