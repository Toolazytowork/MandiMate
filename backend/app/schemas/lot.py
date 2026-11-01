"""Pooled lot schemas."""

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BeforeValidator, Field, StringConstraints
from pydantic_core import PydanticCustomError

from app.schemas.common import (
    ApiModel,
    ConsentDecision,
    Grade,
    Latitude,
    Longitude,
    LotStatus,
    OptionalLongText,
    OptionalShortText,
    PickupTerms,
    QualityStatus,
    Quantity,
    RequestModel,
    ShortText,
    blank_to_none,
)

MAX_LOT_MEMBERS = 200
MATCH_EXPLANATION_MAX_LENGTH = 4000

OptionalExplanation = Annotated[
    Annotated[str, StringConstraints(max_length=MATCH_EXPLANATION_MAX_LENGTH)] | None,
    BeforeValidator(blank_to_none),
]


class LotMember(ApiModel):
    id: uuid.UUID
    lot_id: uuid.UUID
    harvest_id: uuid.UUID
    farmer_id: uuid.UUID
    farmer_name: str
    village: str | None
    quantity_kg: float
    distance_km: float | None
    harvest_quality_status: QualityStatus
    consent_status: ConsentDecision
    consented_at: datetime | None
    delivered_kg: float | None
    accepted_kg: float | None
    rejected_kg: float | None
    rejection_reason: str | None
    is_mine: bool
    """True when the member belongs to the requesting farmer."""


class Lot(ApiModel):
    id: uuid.UUID
    code: str
    crop_id: uuid.UUID
    crop_name: str
    grade: Grade
    demand_id: uuid.UUID | None
    target_quantity_kg: float
    total_quantity_kg: float
    """Sum of members whose consent is not 'declined'."""
    collection_point_name: str
    collection_latitude: float
    collection_longitude: float
    district: str | None
    state: str | None
    pickup_date: date
    status: LotStatus
    journey_step: int
    """1..8 — see JourneyKey order."""
    is_solo: bool
    coordinator_id: uuid.UUID | None
    coordinator_name: str | None
    members: list[LotMember]
    member_count: int
    offers_count: int
    accepted_offer_id: uuid.UUID | None
    buyer_name: str | None
    price_per_kg: float | None
    pickup_terms: PickupTerms | None
    transport_request_id: uuid.UUID | None
    settlement_id: uuid.UUID | None
    match_explanation: str | None
    created_at: datetime
    updated_at: datetime


class LotSummary(ApiModel):
    id: uuid.UUID
    code: str
    crop_name: str
    grade: Grade
    total_quantity_kg: float
    member_count: int
    status: LotStatus
    journey_step: int
    pickup_date: date
    buyer_name: str | None
    price_per_kg: float | None


class LotMemberInput(RequestModel):
    harvest_id: uuid.UUID
    quantity_kg: Quantity


JoinLotRequest = LotMemberInput


def _one_entry_per_harvest(members: list[LotMemberInput]) -> list[LotMemberInput]:
    harvest_ids = [member.harvest_id for member in members]
    if len(harvest_ids) != len(set(harvest_ids)):
        raise PydanticCustomError(
            "duplicate_harvest", "Each harvest can be added to a lot only once"
        )
    return members


class LotCreateRequest(RequestModel):
    crop_id: uuid.UUID
    grade: Grade
    demand_id: uuid.UUID | None = None
    target_quantity_kg: Quantity
    collection_point_name: ShortText
    collection_latitude: Latitude
    collection_longitude: Longitude
    district: OptionalShortText = None
    state: OptionalShortText = None
    pickup_date: date
    members: Annotated[
        list[LotMemberInput],
        Field(max_length=MAX_LOT_MEMBERS),
        AfterValidator(_one_entry_per_harvest),
    ]
    """Empty list creates a 'forming' lot; otherwise the lot awaits member consent."""
    match_explanation: OptionalExplanation = None


class ConsentRequest(RequestModel):
    decision: Literal["accepted", "declined"]
    note: OptionalLongText = None
