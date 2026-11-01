"""Pooled lots and their member harvests."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint, false
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import NAME_LENGTH, Base, Timestamps, UUIDPrimaryKey, str_enum
from app.models.enums import (
    CONSENT_DECISIONS,
    GRADES,
    LOT_STATUSES,
    PICKUP_TERMS,
    ConsentDecision,
    Grade,
    LotStatus,
    PickupTerms,
)

if TYPE_CHECKING:
    from app.models.crop import Crop
    from app.models.harvest import Harvest
    from app.models.offer import Offer
    from app.models.user import User


class Lot(UUIDPrimaryKey, Timestamps, Base):
    """A buyer-ready consignment pooled from one or more harvests of the same crop and grade.

    Solo lots (``is_solo``) wrap a single harvest whose direct offer was accepted.
    ``total_quantity_kg`` is derived from members whose consent is not ``declined``.
    """

    __tablename__ = "lots"

    code: Mapped[str] = mapped_column(String(32), unique=True)
    crop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("crops.id"), index=True)
    grade: Mapped[Grade] = mapped_column(str_enum(GRADES, "grade"))
    demand_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("demands.id", ondelete="SET NULL"), index=True
    )
    target_quantity_kg: Mapped[Decimal]
    collection_point_name: Mapped[str] = mapped_column(String(NAME_LENGTH))
    collection_latitude: Mapped[float]
    collection_longitude: Mapped[float]
    district: Mapped[str | None] = mapped_column(String(NAME_LENGTH))
    state: Mapped[str | None] = mapped_column(String(NAME_LENGTH))
    pickup_date: Mapped[date]
    status: Mapped[LotStatus] = mapped_column(
        str_enum(LOT_STATUSES, "lot_status"),
        default="forming",
        server_default="forming",
        index=True,
    )
    is_solo: Mapped[bool] = mapped_column(default=False, server_default=false())
    coordinator_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    accepted_offer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("offers.id", use_alter=True, ondelete="SET NULL")
    )
    pickup_terms: Mapped[PickupTerms | None] = mapped_column(str_enum(PICKUP_TERMS, "pickup_terms"))
    """Copied from the accepted offer."""
    match_explanation: Mapped[str | None] = mapped_column(Text)
    cancelled_reason: Mapped[str | None] = mapped_column(Text)
    delivered_at: Mapped[datetime | None]
    settled_at: Mapped[datetime | None]

    crop: Mapped[Crop] = relationship(lazy="selectin")
    coordinator: Mapped[User | None] = relationship(foreign_keys=[coordinator_id], lazy="selectin")
    members: Mapped[list[LotMember]] = relationship(
        back_populates="lot",
        cascade="all, delete-orphan",
        order_by=lambda: [LotMember.created_at, LotMember.id],
        lazy="selectin",
    )
    accepted_offer: Mapped[Offer | None] = relationship(
        foreign_keys=[accepted_offer_id], post_update=True, lazy="selectin"
    )


class LotMember(UUIDPrimaryKey, Timestamps, Base):
    """One harvest's share of a lot, the farmer's consent, and the delivery outcome."""

    __tablename__ = "lot_members"
    __table_args__ = (UniqueConstraint("lot_id", "harvest_id"),)

    lot_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lots.id", ondelete="CASCADE"), index=True)
    harvest_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("harvests.id"), index=True)
    farmer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    """Denormalised from the harvest so "lots containing my harvests" is a single filter."""
    quantity_kg: Mapped[Decimal]
    distance_km: Mapped[Decimal | None]
    """Road distance from the farm to the lot's collection point."""
    consent_status: Mapped[ConsentDecision] = mapped_column(
        str_enum(CONSENT_DECISIONS, "consent_decision"),
        default="pending",
        server_default="pending",
        index=True,
    )
    consented_at: Mapped[datetime | None]
    consent_note: Mapped[str | None] = mapped_column(Text)
    consent_recorded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    """Set when a coordinator records consent on the farmer's behalf (assisted consent)."""
    dispatched_kg: Mapped[Decimal | None]
    delivered_kg: Mapped[Decimal | None]
    accepted_kg: Mapped[Decimal | None]
    rejected_kg: Mapped[Decimal | None]
    rejection_reason: Mapped[str | None] = mapped_column(Text)

    lot: Mapped[Lot] = relationship(back_populates="members")
    harvest: Mapped[Harvest] = relationship(lazy="selectin")
    farmer: Mapped[User] = relationship(foreign_keys=[farmer_id], lazy="selectin")
