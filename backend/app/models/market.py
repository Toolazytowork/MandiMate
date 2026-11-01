"""Mandi (wholesale market) prices used for the baseline alternative."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Index, String, UniqueConstraint, false
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import NAME_LENGTH, Base, CreatedAt, UUIDPrimaryKey

if TYPE_CHECKING:
    from app.models.crop import Crop


class MarketPrice(UUIDPrimaryKey, CreatedAt, Base):
    """Daily min / modal / max price per kg for a crop at one market."""

    __tablename__ = "market_prices"
    __table_args__ = (
        UniqueConstraint("crop_id", "market_name", "price_date"),
        Index("ix_market_prices_crop_id_price_date", "crop_id", "price_date"),
    )

    crop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("crops.id", ondelete="CASCADE"))
    market_name: Mapped[str] = mapped_column(String(NAME_LENGTH))
    district: Mapped[str] = mapped_column(String(NAME_LENGTH), index=True)
    state: Mapped[str] = mapped_column(String(NAME_LENGTH))
    price_date: Mapped[date]
    min_price_per_kg: Mapped[Decimal]
    modal_price_per_kg: Mapped[Decimal]
    max_price_per_kg: Mapped[Decimal]
    source: Mapped[str] = mapped_column(String(NAME_LENGTH))
    is_illustrative: Mapped[bool] = mapped_column(default=False, server_default=false())

    crop: Mapped[Crop] = relationship(lazy="selectin")
