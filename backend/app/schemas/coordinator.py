"""Coordinator (FPO field worker) schemas."""

from datetime import datetime

from app.schemas.auth import User
from app.schemas.common import (
    ApiModel,
    Language,
    Latitude,
    Longitude,
    OptionalEmail,
    Phone,
    RequestModel,
    ShortText,
)


class RegisterFarmerRequest(RequestModel):
    coordinate_pairs = (("latitude", "longitude"),)

    full_name: ShortText
    phone: Phone
    email: OptionalEmail = None
    village: ShortText
    district: ShortText
    state: ShortText
    preferred_language: Language
    latitude: Latitude | None = None
    longitude: Longitude | None = None


class RegisteredFarmer(ApiModel):
    user: User
    temporary_password: str
    """Shown once to the coordinator so they can hand it to the farmer."""


class FarmerSummary(ApiModel):
    user: User
    active_harvests: int
    listed_kg: float
    lifetime_net: float
    last_activity_at: datetime | None
