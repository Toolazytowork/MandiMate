"""Users of every role and their refresh-token sessions."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, String, Text, true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import NAME_LENGTH, Base, CreatedAt, Timestamps, UUIDPrimaryKey, str_enum
from app.models.enums import (
    LANGUAGES,
    ROLES,
    VERIFICATION_STATUSES,
    Language,
    Role,
    VerificationStatus,
)

if TYPE_CHECKING:
    from app.models.fpo import Fpo


class User(UUIDPrimaryKey, Timestamps, Base):
    """A person using MandiMate. ``email`` is stored lower-cased, ``phone`` as E.164 (+91…)."""

    __tablename__ = "users"
    __table_args__ = (CheckConstraint("email IS NOT NULL OR phone IS NOT NULL", name="contact"),)

    email: Mapped[str | None] = mapped_column(String(320), unique=True)
    phone: Mapped[str | None] = mapped_column(String(20), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(NAME_LENGTH))
    role: Mapped[Role] = mapped_column(str_enum(ROLES, "role"), index=True)
    preferred_language: Mapped[Language] = mapped_column(
        str_enum(LANGUAGES, "language"), default="en", server_default="en"
    )
    organization_name: Mapped[str | None] = mapped_column(String(NAME_LENGTH))
    village: Mapped[str | None] = mapped_column(String(NAME_LENGTH))
    district: Mapped[str | None] = mapped_column(String(NAME_LENGTH))
    state: Mapped[str | None] = mapped_column(String(NAME_LENGTH))
    latitude: Mapped[float | None]
    longitude: Mapped[float | None]
    verification_status: Mapped[VerificationStatus] = mapped_column(
        str_enum(VERIFICATION_STATUSES, "verification_status"),
        default="unverified",
        server_default="unverified",
        index=True,
    )
    verification_note: Mapped[str | None] = mapped_column(Text)
    verification_documents_note: Mapped[str | None] = mapped_column(Text)
    fpo_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("fpos.id", ondelete="SET NULL"), index=True
    )
    is_active: Mapped[bool] = mapped_column(default=True, server_default=true())
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    last_login_at: Mapped[datetime | None]

    fpo: Mapped[Fpo | None] = relationship(lazy="selectin")


class RefreshToken(UUIDPrimaryKey, CreatedAt, Base):
    """One issued refresh token (by ``jti``), enabling rotation, logout and reuse detection."""

    __tablename__ = "refresh_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    jti: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime]
    revoked_at: Mapped[datetime | None]
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(255))
