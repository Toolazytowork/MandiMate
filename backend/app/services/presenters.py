"""Shared ORM → API presentation helpers, including farmer-name masking (DOMAIN_RULES §1)."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app import schemas
    from app.models import User

FULL_NAME_ROLES = frozenset({"coordinator", "admin"})
"""Roles that always see farmers' full names (and private minimum prices)."""


def user_out(user: User) -> schemas.User:
    """The API ``User`` for an ORM user (``fpo`` is eagerly loaded with the user)."""
    from app import schemas

    return schemas.User(
        id=user.id,
        email=user.email,
        phone=user.phone,
        full_name=user.full_name,
        role=user.role,
        preferred_language=user.preferred_language,
        organization_name=user.organization_name,
        village=user.village,
        district=user.district,
        state=user.state,
        latitude=user.latitude,
        longitude=user.longitude,
        verification_status=user.verification_status,
        verification_note=user.verification_note,
        fpo_id=user.fpo_id,
        fpo_name=user.fpo.name if user.fpo is not None else None,
        created_at=user.created_at,
    )


def mask_name(full_name: str) -> str:
    """``"Ravi Kumar"`` → ``"Ravi K."``; a single-word name is returned unchanged."""
    parts = full_name.split()
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0]
    return f"{parts[0]} {parts[-1][0].upper()}."


def farmer_display_name(farmer: User, viewer: User | None, *, reveal: bool = False) -> str:
    """The farmer's name as ``viewer`` may see it.

    Full name for the farmer themself, coordinators and admins, or when ``reveal`` is set
    (the caller passes it for the booked transporter of the farmer's lot); masked otherwise.
    """
    if reveal or (
        viewer is not None and (viewer.id == farmer.id or viewer.role in FULL_NAME_ROLES)
    ):
        return farmer.full_name
    return mask_name(farmer.full_name)
