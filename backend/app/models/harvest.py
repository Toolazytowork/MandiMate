"""Harvest listings and their photos."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import (
    JSON_DOCUMENT,
    NAME_LENGTH,
    Base,
    CreatedAt,
    Timestamps,
    UUIDPrimaryKey,
    str_enum,
)
from app.models.enums import (
    GRADES,
    HARVEST_STATUSES,
    LISTING_SOURCES,
    QUALITY_STATUSES,
    Grade,
    HarvestStatus,
    ListingSource,
    QualityStatus,
)

if TYPE_CHECKING:
    from app.models.crop import Crop
    from app.models.user import User


class Harvest(UUIDPrimaryKey, Timestamps, Base):
    """A farmer's harvest offered for sale. ``available_kg`` is derived from lot memberships."""

    __tablename__ = "harvests"
    __table_args__ = (Index("ix_harvests_crop_id_status", "crop_id", "status"),)

    farmer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    crop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("crops.id"), index=True)
    variety: Mapped[str | None] = mapped_column(String(NAME_LENGTH))
    quantity_kg: Mapped[Decimal]
    grade: Mapped[Grade] = mapped_column(
        str_enum(GRADES, "grade"), default="ungraded", server_default="ungraded"
    )
    quality_notes: Mapped[str | None] = mapped_column(Text)
    quality_status: Mapped[QualityStatus] = mapped_column(
        str_enum(QUALITY_STATUSES, "quality_status"),
        default="self_reported",
        server_default="self_reported",
    )
    harvest_date: Mapped[date]
    available_from: Mapped[date]
    sell_by: Mapped[date] = mapped_column(index=True)
    village: Mapped[str | None] = mapped_column(String(NAME_LENGTH))
    district: Mapped[str | None] = mapped_column(String(NAME_LENGTH), index=True)
    state: Mapped[str | None] = mapped_column(String(NAME_LENGTH))
    latitude: Mapped[float | None]
    longitude: Mapped[float | None]
    min_price_per_kg: Mapped[Decimal | None]
    """Private net floor (₹/kg): visible only to the owner, coordinators and admins."""
    status: Mapped[HarvestStatus] = mapped_column(
        str_enum(HARVEST_STATUSES, "harvest_status"),
        default="listed",
        server_default="listed",
        index=True,
    )
    source: Mapped[ListingSource] = mapped_column(
        str_enum(LISTING_SOURCES, "listing_source"), default="manual", server_default="manual"
    )
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    verified_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    verified_at: Mapped[datetime | None]

    farmer: Mapped[User] = relationship(foreign_keys=[farmer_id], lazy="selectin")
    crop: Mapped[Crop] = relationship(lazy="selectin")
    verified_by: Mapped[User | None] = relationship(foreign_keys=[verified_by_id], lazy="selectin")
    photos: Mapped[list[HarvestPhoto]] = relationship(
        back_populates="harvest",
        cascade="all, delete-orphan",
        order_by="HarvestPhoto.created_at",
        lazy="selectin",
    )


class HarvestPhoto(UUIDPrimaryKey, CreatedAt, Base):
    """An uploaded, re-encoded WebP photo with its optional rule-based analysis."""

    __tablename__ = "harvest_photos"

    harvest_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("harvests.id", ondelete="CASCADE"), index=True
    )
    file_path: Mapped[str] = mapped_column(String(500))
    """Path relative to ``MEDIA_DIR``."""
    url: Mapped[str] = mapped_column(String(500))
    analysis: Mapped[dict[str, Any] | None] = mapped_column(JSON_DOCUMENT)
    """``PhotoAnalysis`` JSON."""
    uploaded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    harvest: Mapped[Harvest] = relationship(back_populates="photos")
