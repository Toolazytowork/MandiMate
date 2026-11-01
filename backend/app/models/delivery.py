"""Delivery and quality-check records (per-member weights live on ``LotMember``)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import NAME_LENGTH, Base, Timestamps, UUIDPrimaryKey

if TYPE_CHECKING:
    from app.models.lot import Lot
    from app.models.user import User


class Delivery(UUIDPrimaryKey, Timestamps, Base):
    """The delivery of a lot at the buyer, recorded once by the buyer or a coordinator."""

    __tablename__ = "deliveries"

    lot_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lots.id"), unique=True)
    recorded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    inspector_name: Mapped[str | None] = mapped_column(String(NAME_LENGTH))
    notes: Mapped[str | None] = mapped_column(Text)
    recorded_at: Mapped[datetime]

    lot: Mapped[Lot] = relationship(lazy="selectin")
    recorded_by: Mapped[User | None] = relationship(lazy="selectin")
