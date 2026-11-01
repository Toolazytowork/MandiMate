"""Lot matching schemas."""

import uuid
from datetime import date
from typing import Annotated

from pydantic import Field

from app.schemas.common import (
    ApiModel,
    Grade,
    Latitude,
    Longitude,
    QualityStatus,
    Quantity,
    RequestModel,
)

DEFAULT_RADIUS_KM = 40.0
MAX_RADIUS_KM = 500.0


class MatchPreviewRequest(RequestModel):
    crop_id: uuid.UUID
    grade: Grade
    target_quantity_kg: Quantity
    collection_latitude: Latitude
    collection_longitude: Longitude
    pickup_date: date
    radius_km: Annotated[float, Field(gt=0, le=MAX_RADIUS_KM)] = DEFAULT_RADIUS_KM
    demand_id: uuid.UUID | None = None
    include_ungraded: bool = False
    """Also consider 'ungraded' listings (flagged: inspection required before pickup)."""


class MatchCandidate(ApiModel):
    harvest_id: uuid.UUID
    farmer_id: uuid.UUID
    farmer_name: str
    village: str | None
    grade: Grade
    quality_status: QualityStatus
    available_kg: float
    proposed_kg: float
    """0 when the candidate is compatible but not needed to reach the target."""
    distance_km: float
    sell_by: date
    score: float
    reasons: list[str]


class MatchExclusion(ApiModel):
    harvest_id: uuid.UUID
    farmer_name: str
    reason: str


class MatchProposal(ApiModel):
    crop_id: uuid.UUID
    crop_name: str
    grade: Grade
    target_quantity_kg: float
    selected_total_kg: float
    shortfall_kg: float
    feasible: bool
    candidates: list[MatchCandidate]
    excluded: list[MatchExclusion]
    rules_applied: list[str]
    explanation: str
    collection_latitude: float
    collection_longitude: float
    pickup_date: date
    demand_id: uuid.UUID | None
