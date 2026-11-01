"""Shared building blocks for the API schemas.

Every string union exported by ``frontend/src/types/api.ts`` is mirrored here as a
``typing.Literal`` alias with the same name. This module also holds the base model
configuration, the API error shapes and the constrained field types that request
bodies use for validation.
"""

import re
from datetime import UTC, datetime
from typing import Annotated, ClassVar, Literal, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    ValidationInfo,
    field_validator,
    model_validator,
)
from pydantic_core import PydanticCustomError

# ─────────────────────────────── Enums ───────────────────────────────

Role = Literal["farmer", "buyer", "transporter", "coordinator", "admin"]
SignupRole = Literal["farmer", "buyer", "transporter", "coordinator"]
Language = Literal["en", "hi", "te", "kn", "ur"]
VerificationStatus = Literal["unverified", "pending", "verified", "rejected"]
Grade = Literal["A", "B", "C", "ungraded"]
CropCategory = Literal["vegetable", "fruit", "grain", "pulse", "spice", "oilseed"]
Certainty = Literal["confirmed", "estimated", "unresolved"]

HarvestStatus = Literal[
    "draft",
    "listed",
    "pooled",
    "committed",
    "picked_up",
    "delivered",
    "settled",
    "cancelled",
    "expired",
]
QualityStatus = Literal["self_reported", "pending_inspection", "inspected"]
ListingSource = Literal["manual", "voice", "assisted"]

DemandStatus = Literal["open", "matched", "fulfilled", "cancelled", "expired"]

LotStatus = Literal[
    "forming",
    "awaiting_consent",
    "open_for_offers",
    "offer_accepted",
    "transport_booked",
    "in_transit",
    "delivered",
    "settled",
    "cancelled",
]
ConsentDecision = Literal["pending", "accepted", "declined"]

OfferStatus = Literal[
    "pending",
    "countered",
    "proposed",
    "accepted",
    "rejected",
    "withdrawn",
    "expired",
]
OfferTargetType = Literal["lot", "harvest"]
Awaiting = Literal["buyer", "seller", "farmers"]
PickupTerms = Literal["buyer_pickup", "mandimate_delivery"]
NegotiationAction = Literal[
    "offer", "counter", "accept", "reject", "withdraw", "propose", "consent", "note"
]

VehicleType = Literal["mini_truck", "pickup", "light_truck", "medium_truck", "reefer_truck"]
TransportRequestStatus = Literal[
    "open", "quoted", "booked", "in_progress", "completed", "cancelled"
]
QuoteStatus = Literal["submitted", "accepted", "rejected", "withdrawn"]
StopStatus = Literal["pending", "picked_up", "skipped"]

PaymentStatus = Literal["pending", "partially_paid", "paid", "overdue", "disputed"]
PayoutStatus = Literal["pending", "paid"]

DisputeCategory = Literal["quantity", "quality", "payment", "transport", "other"]
DisputeStatus = Literal["open", "under_review", "resolved", "rejected"]

NotificationType = Literal[
    "offer",
    "consent",
    "lot",
    "pickup",
    "delivery",
    "payment",
    "harvest_deadline",
    "dispute",
    "verification",
    "system",
]

JourneyKey = Literal[
    "listed",
    "grouped",
    "offers",
    "compared",
    "consent",
    "transport",
    "delivered",
    "settled",
]
JourneyStepStatus = Literal["complete", "current", "upcoming", "skipped"]

AiSource = Literal["ai", "rules"]

BreakdownKey = Literal[
    "gross",
    "transport",
    "handling",
    "commission",
    "rejection",
    "payment_wait",
    "platform_fee",
]
SellingOptionSource = Literal["direct_offer", "pooled_offer", "baseline"]

ActionKind = Literal[
    "consent",
    "offer",
    "pickup",
    "payment",
    "deadline",
    "verification",
    "quote",
    "delivery",
    "dispute",
    "lot",
]

# ──────────────────────────── Base models ────────────────────────────


class ApiModel(BaseModel):
    """Base for every API schema; reads ORM objects and dataclasses directly.

    Attribute docstrings become field descriptions in the OpenAPI document.
    """

    model_config = ConfigDict(
        from_attributes=True, populate_by_name=True, use_attribute_docstrings=True
    )


class RequestModel(ApiModel):
    """Base for request bodies.

    ``coordinate_pairs`` lists (latitude, longitude) field pairs that must be sent
    together: both numbers, both null, or both omitted.
    """

    coordinate_pairs: ClassVar[tuple[tuple[str, str], ...]] = ()

    @model_validator(mode="after")
    def _coordinates_sent_together(self) -> Self:
        for latitude_field, longitude_field in self.coordinate_pairs:
            latitude_missing = getattr(self, latitude_field) is None
            longitude_missing = getattr(self, longitude_field) is None
            latitude_sent = latitude_field in self.model_fields_set
            longitude_sent = longitude_field in self.model_fields_set
            if latitude_missing != longitude_missing or latitude_sent != longitude_sent:
                raise PydanticCustomError(
                    "coordinates_incomplete",
                    "Provide both latitude and longitude, or neither",
                )
        return self


class PatchModel(RequestModel):
    """Base for PATCH bodies.

    Omitted fields stay unchanged, so services must apply
    ``model_dump(exclude_unset=True)``. Fields named in ``non_nullable_fields`` may be
    omitted but never sent as ``null`` (they back NOT NULL columns).
    """

    non_nullable_fields: ClassVar[frozenset[str]] = frozenset()

    @field_validator("*", mode="before")
    @classmethod
    def _reject_null_for_required_values(cls, value: object, info: ValidationInfo) -> object:
        if value is None and info.field_name in cls.non_nullable_fields:
            raise PydanticCustomError("null_not_allowed", "This field cannot be empty")
        return value


# ─────────────────────────────── Errors ──────────────────────────────


class ValidationIssue(ApiModel):
    loc: list[str | int]
    msg: str
    type: str


class ApiErrorBody(ApiModel):
    """Every non-2xx response body. ``detail`` is a string for domain errors, a list for 422s."""

    detail: str | list[ValidationIssue]
    code: str | None = None


# ──────────────────────── Request field types ────────────────────────

NAME_MAX_LENGTH = 120
ADDRESS_MAX_LENGTH = 200
TEXT_MAX_LENGTH = 2000
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128
MAX_QUANTITY_KG = 1_000_000
MAX_PRICE_PER_KG = 100_000
MAX_AMOUNT = 1_000_000_000
MAX_DISTANCE_KM = 5_000
MAX_PAYMENT_TERMS_DAYS = 180


def blank_to_none(value: object) -> object:
    """Strip optional text; an empty or whitespace-only string means "not provided"."""
    if isinstance(value, str):
        return value.strip() or None
    return value


def _strip(value: object) -> object:
    return value.strip() if isinstance(value, str) else value


ShortText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=NAME_MAX_LENGTH)
]
"""Names, places, references: 1..120 characters after trimming."""

OptionalShortText = Annotated[
    Annotated[str, StringConstraints(max_length=NAME_MAX_LENGTH)] | None,
    BeforeValidator(blank_to_none),
]

AddressText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=ADDRESS_MAX_LENGTH)
]
"""Free-form delivery addresses: 1..200 characters after trimming."""

LongText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=TEXT_MAX_LENGTH)
]
"""Descriptions, notes and messages: 1..2000 characters after trimming."""

OptionalLongText = Annotated[
    Annotated[str, StringConstraints(max_length=TEXT_MAX_LENGTH)] | None,
    BeforeValidator(blank_to_none),
]

_PHONE_SEPARATORS = re.compile(r"[\s\-().]")
_PHONE_PATTERN = re.compile(r"\+?\d{10,15}")


def _compact_phone(value: str) -> str:
    compact = _PHONE_SEPARATORS.sub("", value)
    if not _PHONE_PATTERN.fullmatch(compact):
        raise PydanticCustomError(
            "phone_invalid",
            "Enter a valid phone number, for example 98765 43210 or +91 98765 43210",
        )
    return compact


Phone = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=24), AfterValidator(_compact_phone)
]
"""Phone number with separators removed (digits with an optional leading ``+``).
Services normalise Indian numbers to ``+91XXXXXXXXXX``."""

OptionalPhone = Annotated[Phone | None, BeforeValidator(blank_to_none)]

Email = Annotated[EmailStr, BeforeValidator(_strip)]
OptionalEmail = Annotated[EmailStr | None, BeforeValidator(blank_to_none)]


def _check_password_policy(value: str) -> str:
    if len(value) < PASSWORD_MIN_LENGTH:
        raise PydanticCustomError(
            "password_too_short",
            "Password must be at least {min_length} characters long",
            {"min_length": PASSWORD_MIN_LENGTH},
        )
    if len(value) > PASSWORD_MAX_LENGTH:
        raise PydanticCustomError(
            "password_too_long",
            "Password must be at most {max_length} characters long",
            {"max_length": PASSWORD_MAX_LENGTH},
        )
    if not (any(char.isalpha() for char in value) and any(char.isdigit() for char in value)):
        raise PydanticCustomError(
            "password_too_weak", "Password must contain at least one letter and one digit"
        )
    return value


NewPassword = Annotated[str, AfterValidator(_check_password_policy)]
"""A password being set: 8..128 characters with at least one letter and one digit."""

Password = Annotated[str, StringConstraints(min_length=1, max_length=PASSWORD_MAX_LENGTH)]
"""An existing password being presented (login, password change)."""

Quantity = Annotated[float, Field(gt=0, le=MAX_QUANTITY_KG)]
"""Kilograms offered, listed or requested: > 0 and ≤ 1,000,000."""

MeasuredQuantity = Annotated[float, Field(ge=0, le=MAX_QUANTITY_KG)]
"""Kilograms weighed at pickup or delivery; 0 is a valid measurement."""

Price = Annotated[float, Field(gt=0, le=MAX_PRICE_PER_KG)]
"""₹ per kg: > 0 and ≤ 100,000."""

Rate = Annotated[float, Field(ge=0, le=MAX_PRICE_PER_KG)]
"""Non-negative ₹ per unit charge (handling per kg, transport per km)."""

Amount = Annotated[float, Field(gt=0, le=MAX_AMOUNT)]
"""Positive ₹ total (payments, quotes)."""

NonNegativeAmount = Annotated[float, Field(ge=0, le=MAX_AMOUNT)]

Percent = Annotated[float, Field(ge=0, le=100)]

PaymentTermsDays = Annotated[int, Field(ge=0, le=MAX_PAYMENT_TERMS_DAYS)]

DistanceKm = Annotated[float, Field(ge=0, le=MAX_DISTANCE_KM)]

Latitude = Annotated[float, Field(ge=-90, le=90)]
Longitude = Annotated[float, Field(ge=-180, le=180)]


def _as_utc(value: datetime) -> datetime:
    """Interpret naive timestamps as UTC and convert aware ones to UTC."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


UtcDateTime = Annotated[datetime, AfterValidator(_as_utc)]
