"""Telemetry for every AI assistant call (live model or rules fallback)."""

from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, UUIDPrimaryKey, str_enum
from app.models.enums import AI_SOURCES, AiSource


class AiInteraction(UUIDPrimaryKey, CreatedAt, Base):
    """One AI feature invocation. Stores sizes and timing, never the prompt text."""

    __tablename__ = "ai_interactions"

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    feature: Mapped[str] = mapped_column(String(64), index=True)
    source: Mapped[AiSource] = mapped_column(str_enum(AI_SOURCES, "ai_source"))
    model: Mapped[str | None] = mapped_column(String(64))
    latency_ms: Mapped[int]
    input_chars: Mapped[int]
    output_chars: Mapped[int]
    success: Mapped[bool]
    error: Mapped[str | None] = mapped_column(Text)
