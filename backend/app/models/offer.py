"""Buyer offers, the negotiation thread and per-farmer consent on lot deals."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import (
    ADDRESS_LENGTH,
    PERCENT,
    Base,
    CreatedAt,
    Timestamps,
    UUIDPrimaryKey,
    str_enum,
)
from app.models.enums import (
    AWAITING_SIDES,
    CONSENT_DECISIONS,
    GRADES,
    NEGOTIATION_ACTIONS,
    NEGOTIATION_AUTHOR_ROLES,
    OFFER_STATUSES,
    OFFER_TARGET_TYPES,
    OPEN_OFFER_STATUSES,
    PICKUP_TERMS,
    Awaiting,
    ConsentDecision,
    Grade,
    NegotiationAction,
    NegotiationAuthorRole,
    OfferStatus,
    OfferTargetType,
    PickupTerms,
)

if TYPE_CHECKING:
    from app.models.crop import Crop
    from app.models.harvest import Harvest
    from app.models.lot import Lot, LotMember
    from app.models.user import User

_OPEN_STATUSES_SQL = ", ".join(f"'{status}'" for status in OPEN_OFFER_STATUSES)


class Offer(UUIDPrimaryKey, Timestamps, Base):
    """A buyer's offer on a lot (``open_for_offers``) or directly on a listed harvest.

    When a direct harvest offer is accepted a solo lot is created and ``lot_id`` points to it.
    """

    __tablename__ = "offers"
    __table_args__ = (
        CheckConstraint(
            "(target_type = 'lot' AND lot_id IS NOT NULL)"
            " OR (target_type = 'harvest' AND harvest_id IS NOT NULL)",
            name="target",
        ),
        Index(
            "uq_offers_open_per_buyer_lot",
            "buyer_id",
            "lot_id",
            unique=True,
            postgresql_where=text(f"target_type = 'lot' AND status IN ({_OPEN_STATUSES_SQL})"),
        ),
        Index(
            "uq_offers_open_per_buyer_harvest",
            "buyer_id",
            "harvest_id",
            unique=True,
            postgresql_where=text(f"target_type = 'harvest' AND status IN ({_OPEN_STATUSES_SQL})"),
        ),
    )

    code: Mapped[str] = mapped_column(String(32), unique=True)
    buyer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    target_type: Mapped[OfferTargetType] = mapped_column(
        str_enum(OFFER_TARGET_TYPES, "offer_target_type")
    )
    lot_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("lots.id"), index=True)
    harvest_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("harvests.id"), index=True)
    demand_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("demands.id", ondelete="SET NULL"), index=True
    )
    crop_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("crops.id"), index=True)
    grade: Mapped[Grade] = mapped_column(str_enum(GRADES, "grade"))
    price_per_kg: Mapped[Decimal]
    quantity_kg: Mapped[Decimal]
    pickup_terms: Mapped[PickupTerms] = mapped_column(str_enum(PICKUP_TERMS, "pickup_terms"))
    delivery_location: Mapped[str] = mapped_column(String(ADDRESS_LENGTH))
    delivery_latitude: Mapped[float | None]
    delivery_longitude: Mapped[float | None]
    payment_terms_days: Mapped[int]
    max_rejection_pct: Mapped[Decimal] = mapped_column(PERCENT)
    quality_spec: Mapped[str | None] = mapped_column(Text)
    handling_charge_per_kg: Mapped[Decimal] = mapped_column(default=0, server_default=text("0"))
    commission_pct: Mapped[Decimal] = mapped_column(PERCENT, default=0, server_default=text("0"))
    valid_until: Mapped[datetime] = mapped_column(index=True)
    status: Mapped[OfferStatus] = mapped_column(
        str_enum(OFFER_STATUSES, "offer_status"),
        default="pending",
        server_default="pending",
        index=True,
    )
    awaiting: Mapped[Awaiting | None] = mapped_column(str_enum(AWAITING_SIDES, "awaiting"))
    notes: Mapped[str | None] = mapped_column(Text)
    accepted_at: Mapped[datetime | None]

    buyer: Mapped[User] = relationship(lazy="selectin")
    crop: Mapped[Crop] = relationship(lazy="selectin")
    lot: Mapped[Lot | None] = relationship(foreign_keys=[lot_id], lazy="selectin")
    harvest: Mapped[Harvest | None] = relationship(lazy="selectin")
    negotiation: Mapped[list[NegotiationEntry]] = relationship(
        back_populates="offer",
        cascade="all, delete-orphan",
        order_by=lambda: [NegotiationEntry.created_at, NegotiationEntry.id],
        lazy="selectin",
    )
    consents: Mapped[list[OfferConsent]] = relationship(
        back_populates="offer",
        cascade="all, delete-orphan",
        order_by=lambda: [OfferConsent.created_at, OfferConsent.id],
        lazy="selectin",
    )


class NegotiationEntry(UUIDPrimaryKey, CreatedAt, Base):
    """One step of the negotiation thread. System entries have no author."""

    __tablename__ = "negotiation_entries"

    offer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("offers.id", ondelete="CASCADE"), index=True
    )
    author_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    author_role: Mapped[NegotiationAuthorRole] = mapped_column(
        str_enum(NEGOTIATION_AUTHOR_ROLES, "negotiation_author_role")
    )
    action: Mapped[NegotiationAction] = mapped_column(
        str_enum(NEGOTIATION_ACTIONS, "negotiation_action")
    )
    price_per_kg: Mapped[Decimal | None]
    quantity_kg: Mapped[Decimal | None]
    payment_terms_days: Mapped[int | None]
    message: Mapped[str | None] = mapped_column(Text)

    offer: Mapped[Offer] = relationship(back_populates="negotiation")
    author: Mapped[User | None] = relationship(lazy="selectin")


class OfferConsent(UUIDPrimaryKey, Timestamps, Base):
    """A lot member's decision on a ``proposed`` lot offer."""

    __tablename__ = "offer_consents"
    __table_args__ = (UniqueConstraint("offer_id", "member_id"),)

    offer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("offers.id", ondelete="CASCADE"), index=True
    )
    member_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("lot_members.id", ondelete="CASCADE"), index=True
    )
    farmer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    quantity_kg: Mapped[Decimal]
    decision: Mapped[ConsentDecision] = mapped_column(
        str_enum(CONSENT_DECISIONS, "consent_decision"),
        default="pending",
        server_default="pending",
    )
    decided_at: Mapped[datetime | None]
    note: Mapped[str | None] = mapped_column(Text)
    recorded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    """Set when a coordinator records the decision on the farmer's behalf."""

    offer: Mapped[Offer] = relationship(back_populates="consents")
    member: Mapped[LotMember] = relationship(lazy="selectin")
    farmer: Mapped[User] = relationship(foreign_keys=[farmer_id], lazy="selectin")
