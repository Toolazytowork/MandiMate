"""Auth & user profile schemas."""

import uuid
from datetime import datetime
from typing import Annotated, Self

from pydantic import AfterValidator, StringConstraints, ValidationInfo, model_validator
from pydantic_core import PydanticCustomError

from app.schemas.common import (
    ApiModel,
    Language,
    Latitude,
    Longitude,
    LongText,
    NewPassword,
    OptionalEmail,
    OptionalPhone,
    OptionalShortText,
    Password,
    PatchModel,
    RequestModel,
    Role,
    ShortText,
    SignupRole,
    VerificationStatus,
)

ORGANIZATION_ROLES: frozenset[SignupRole] = frozenset({"buyer", "transporter", "coordinator"})
"""Signup roles that must provide ``organization_name`` (business or FPO name)."""


class User(ApiModel):
    id: uuid.UUID
    email: str | None
    phone: str | None
    full_name: str
    role: Role
    preferred_language: Language
    organization_name: str | None
    village: str | None
    district: str | None
    state: str | None
    latitude: float | None
    longitude: float | None
    verification_status: VerificationStatus
    verification_note: str | None
    fpo_id: uuid.UUID | None
    fpo_name: str | None
    created_at: datetime


class SignupRequest(RequestModel):
    coordinate_pairs = (("latitude", "longitude"),)

    full_name: ShortText
    email: OptionalEmail = None
    phone: OptionalPhone = None
    password: NewPassword
    role: SignupRole
    preferred_language: Language = "en"
    organization_name: OptionalShortText = None
    village: OptionalShortText = None
    district: OptionalShortText = None
    state: OptionalShortText = None
    latitude: Latitude | None = None
    longitude: Longitude | None = None

    @model_validator(mode="after")
    def _contact_and_organization_present(self) -> Self:
        if self.email is None and self.phone is None:
            raise PydanticCustomError(
                "contact_required", "Provide an email address or a phone number"
            )
        if self.role in ORGANIZATION_ROLES and self.organization_name is None:
            raise PydanticCustomError(
                "organization_required",
                "Organization name is required for buyers, transporters and coordinators",
            )
        return self


class LoginRequest(RequestModel):
    identifier: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=254)
    ]
    """Email address or phone number; services normalise it before lookup."""
    password: Password


class AuthResponse(ApiModel):
    user: User


class UpdateProfileRequest(PatchModel):
    coordinate_pairs = (("latitude", "longitude"),)
    non_nullable_fields = frozenset({"full_name", "preferred_language"})

    full_name: ShortText | None = None
    phone: OptionalPhone = None
    email: OptionalEmail = None
    preferred_language: Language | None = None
    organization_name: OptionalShortText = None
    village: OptionalShortText = None
    district: OptionalShortText = None
    state: OptionalShortText = None
    latitude: Latitude | None = None
    longitude: Longitude | None = None


def _differs_from_current_password(new_password: str, info: ValidationInfo) -> str:
    if new_password == info.data.get("current_password"):
        raise PydanticCustomError(
            "password_unchanged", "Choose a new password that is different from the current one"
        )
    return new_password


class ChangePasswordRequest(RequestModel):
    current_password: Password
    new_password: Annotated[NewPassword, AfterValidator(_differs_from_current_password)]


class VerificationRequest(RequestModel):
    documents_note: LongText
    """Free-text description of documents provided (GSTIN, FSSAI, RC book, etc.)."""
