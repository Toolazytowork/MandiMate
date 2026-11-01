"""In-app notifications."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, UUIDPrimaryKey, str_enum
from app.models.enums import NOTIFICATION_TYPES, NotificationType


class Notification(UUIDPrimaryKey, CreatedAt, Base):
    """A message for one user. ``dedupe_key`` (per user) prevents repeated reminders."""

    __tablename__ = "notifications"
    __table_args__ = (
        Index("ix_notifications_user_id_created_at", "user_id", "created_at"),
        Index("ix_notifications_user_id_read_at", "user_id", "read_at"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    type: Mapped[NotificationType] = mapped_column(
        str_enum(NOTIFICATION_TYPES, "notification_type")
    )
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(String(500))
    """In-app path, e.g. ``/app/farmer/offers``."""
    read_at: Mapped[datetime | None]
    dedupe_key: Mapped[str | None] = mapped_column(String(255), unique=True)
