"""Vehicle, transport plan, request & quote schemas."""

import re
import uuid
from datetime import date, datetime
from typing import Annotated

from pydantic import AfterValidator, Field, StringConstraints
from pydantic_core import PydanticCustomError

from app.schemas.common import (
    Amount,
    ApiModel,
    MeasuredQuantity,
    NonNegativeAmount,
    OptionalLongText,
    PatchModel,
    Quantity,
    QuoteStatus,
    Rate,
    RequestModel,
    StopStatus,
    TransportRequestStatus,
    VehicleType,
)

MAX_ETA_HOURS = 720

_REGISTRATION_SEPARATORS = re.compile(r"[\s\-.]")
_REGISTRATION_PATTERN = re.compile(r"[A-Z0-9]{4,15}")


def _canonical_registration(value: str) -> str:
    """Upper-cases and removes separators so "ap 03-ta 1234" and "AP03TA1234" are one vehicle."""
    canonical = _REGISTRATION_SEPARATORS.sub("", value).upper()
    if not _REGISTRATION_PATTERN.fullmatch(canonical):
        raise PydanticCustomError(
            "registration_invalid",
            "Enter a valid vehicle registration number, for example AP 03 TA 1234",
        )
    return canonical


RegistrationNumber = Annotated[
    str, StringConstraints(max_length=24), AfterValidator(_canonical_registration)
]

EtaHours = Annotated[float, Field(gt=0, le=MAX_ETA_HOURS)]


class Vehicle(ApiModel):
    id: uuid.UUID
    transporter_id: uuid.UUID
    vehicle_type: VehicleType
    registration_number: str
    capacity_kg: float
    has_refrigeration: bool
    base_charge: float
    per_km_rate: float
    is_active: bool
    created_at: datetime


class VehicleCreateRequest(RequestModel):
    vehicle_type: VehicleType
    registration_number: RegistrationNumber
    capacity_kg: Quantity
    has_refrigeration: bool = False
    base_charge: NonNegativeAmount
    per_km_rate: Rate


class VehicleUpdateRequest(PatchModel):
    non_nullable_fields = frozenset(
        {
            "vehicle_type",
            "registration_number",
            "capacity_kg",
            "has_refrigeration",
            "base_charge",
            "per_km_rate",
            "is_active",
        }
    )

    vehicle_type: VehicleType | None = None
    registration_number: RegistrationNumber | None = None
    capacity_kg: Quantity | None = None
    has_refrigeration: bool | None = None
    base_charge: NonNegativeAmount | None = None
    per_km_rate: Rate | None = None
    is_active: bool | None = None


class PickupStop(ApiModel):
    id: uuid.UUID
    sequence: int
    member_id: uuid.UUID
    farmer_name: str
    village: str | None
    latitude: float
    longitude: float
    quantity_kg: float
    status: StopStatus
    picked_kg: float | None
    picked_up_at: datetime | None


class TransportPlan(ApiModel):
    """A preview that is not persisted. Stop ids are member ids in a plan preview."""

    lot_id: uuid.UUID
    stops: list[PickupStop]
    destination_name: str
    destination_latitude: float
    destination_longitude: float
    total_distance_km: float
    suggested_vehicle_type: VehicleType
    vehicle_capacity_kg: float
    trips_needed: int
    utilization_pct: float
    estimated_cost: float
    cost_per_kg: float
    route: list[tuple[float, float]]
    """Ordered [lat, lng] points: collection stops then destination."""


class TransportQuote(ApiModel):
    id: uuid.UUID
    request_id: uuid.UUID
    transporter_id: uuid.UUID
    transporter_name: str
    transporter_verified: bool
    vehicle_id: uuid.UUID | None
    vehicle_type: VehicleType
    capacity_kg: float
    price_total: float
    price_per_kg: float
    eta_hours: float
    notes: str | None
    status: QuoteStatus
    created_at: datetime


class TransportRequest(ApiModel):
    id: uuid.UUID
    lot_id: uuid.UUID
    lot_code: str
    crop_name: str
    total_quantity_kg: float
    pickup_date: date
    requires_refrigeration: bool
    stops: list[PickupStop]
    destination_name: str
    destination_latitude: float
    destination_longitude: float
    estimated_distance_km: float
    suggested_vehicle_type: VehicleType
    estimated_cost: float
    status: TransportRequestStatus
    quotes: list[TransportQuote]
    booked_quote_id: uuid.UUID | None
    transporter_name: str | None
    notes: str | None
    created_at: datetime


class TransportRequestCreateRequest(RequestModel):
    lot_id: uuid.UUID
    notes: OptionalLongText = None


class QuoteCreateRequest(RequestModel):
    vehicle_id: uuid.UUID | None = None
    vehicle_type: VehicleType
    capacity_kg: Quantity
    price_total: Amount
    eta_hours: EtaHours
    notes: OptionalLongText = None


class PickupConfirmRequest(RequestModel):
    picked_kg: MeasuredQuantity
    """Weighed at the farm gate; 0 records that nothing was collected from this stop."""
    note: OptionalLongText = None


class TripCompleteRequest(RequestModel):
    note: OptionalLongText = None
