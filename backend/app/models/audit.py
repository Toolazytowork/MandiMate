"""Append-only audit trail of security- and money-relevant actions."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import JSON_DOCUMENT, Base, CreatedAt, UUIDPrimaryKey

if TYPE_CHECKING:
    from app.models.user import User


class AuditLog(UUIDPrimaryKey, CreatedAt, Base):
    """Who did what to which entity, with a human summary and structured payload."""

    __tablename__ = "audit_log"
    __table_args__ = (Index("ix_audit_log_entity", "entity_type", "entity_id"),)

    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    action: Mapped[str] = mapped_column(String(64), index=True)
    entity_type: Mapped[str] = mapped_column(String(64))
    entity_id: Mapped[str | None] = mapped_column(String(64))
    summary: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON_DOCUMENT)
    ip: Mapped[str | None] = mapped_column(String(64))

    actor: Mapped[User | None] = relationship(lazy="selectin")
