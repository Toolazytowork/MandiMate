"""Buyer requirements (demands)."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import (
    ADDRESS_LENGTH,
    NAME_LENGTH,
    PERCENT,
    Base,
    Timestamps,
    UUIDPrimaryKey,
    str_enum,
)
from app.models.enums import DEMAND_STATUSES, GRADES, DemandStatus, Grade

if TYPE_CHECKING:
    from app.models.crop import Crop
    from app.models.user import User


class Demand(UUIDPrimaryKey, Timestamps, Base):
    """What a buyer needs: crop, grade, quantity, delivery point, date and payment terms."""

    __tablename__ = "demands"

    buyer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    crop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("crops.id"), index=True)
    grade_required: Mapped[Grade] = mapped_column(str_enum(GRADES, "grade"))
    quantity_kg: Mapped[Decimal]
    min_quantity_kg: Mapped[Decimal]
    target_price_per_kg: Mapped[Decimal | None]
    delivery_location: Mapped[str] = mapped_column(String(ADDRESS_LENGTH))
    delivery_district: Mapped[str | None] = mapped_column(String(NAME_LENGTH))
    delivery_state: Mapped[str | None] = mapped_column(String(NAME_LENGTH))
    delivery_latitude: Mapped[float | None]
    delivery_longitude: Mapped[float | None]
    needed_by: Mapped[date]
    payment_terms_days: Mapped[int]
    max_rejection_pct: Mapped[Decimal] = mapped_column(PERCENT)
    quality_spec: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[DemandStatus] = mapped_column(
        str_enum(DEMAND_STATUSES, "demand_status"),
        default="open",
        server_default="open",
        index=True,
    )

    buyer: Mapped[User] = relationship(lazy="selectin")
    crop: Mapped[Crop] = relationship(lazy="selectin")
