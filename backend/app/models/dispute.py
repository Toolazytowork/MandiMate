"""Disputes raised by lot participants."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, Timestamps, UUIDPrimaryKey, str_enum
from app.models.enums import (
    DISPUTE_CATEGORIES,
    DISPUTE_STATUSES,
    ROLES,
    DisputeCategory,
    DisputeStatus,
    Role,
)

if TYPE_CHECKING:
    from app.models.lot import Lot
    from app.models.user import User


class Dispute(UUIDPrimaryKey, Timestamps, Base):
    """A quantity, quality, payment or transport complaint about a lot."""

    __tablename__ = "disputes"

    code: Mapped[str] = mapped_column(String(32), unique=True)
    lot_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lots.id"), index=True)
    settlement_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("settlements.id", ondelete="SET NULL"), index=True
    )
    raised_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    raised_by_role: Mapped[Role] = mapped_column(str_enum(ROLES, "role"))
    """The raiser's role when the dispute was created."""
    category: Mapped[DisputeCategory] = mapped_column(
        str_enum(DISPUTE_CATEGORIES, "dispute_category")
    )
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[DisputeStatus] = mapped_column(
        str_enum(DISPUTE_STATUSES, "dispute_status"),
        default="open",
        server_default="open",
        index=True,
    )
    resolution: Mapped[str | None] = mapped_column(Text)
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    resolved_at: Mapped[datetime | None]

    lot: Mapped[Lot] = relationship(lazy="selectin")
    raised_by: Mapped[User] = relationship(foreign_keys=[raised_by_id], lazy="selectin")
    resolved_by: Mapped[User | None] = relationship(foreign_keys=[resolved_by_id], lazy="selectin")
