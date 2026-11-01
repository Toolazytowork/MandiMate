"""Settlements: what the buyer owes, payments received and payouts to each farmer."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import NAME_LENGTH, Base, CreatedAt, Timestamps, UUIDPrimaryKey, str_enum
from app.models.enums import PAYMENT_STATUSES, PAYOUT_STATUSES, PaymentStatus, PayoutStatus

if TYPE_CHECKING:
    from app.models.lot import Lot, LotMember
    from app.models.offer import Offer
    from app.models.user import User


class Settlement(UUIDPrimaryKey, Timestamps, Base):
    """Financial outcome of a delivered lot (one per lot)."""

    __tablename__ = "settlements"

    code: Mapped[str] = mapped_column(String(32), unique=True)
    lot_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lots.id"), unique=True)
    offer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("offers.id"), index=True)
    buyer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    price_per_kg: Mapped[Decimal]
    total_accepted_kg: Mapped[Decimal]
    gross_amount: Mapped[Decimal]
    """What the buyer owes: price × accepted kg."""
    transport_cost: Mapped[Decimal]
    handling_cost: Mapped[Decimal]
    commission_amount: Mapped[Decimal]
    net_to_farmers: Mapped[Decimal]
    amount_paid: Mapped[Decimal] = mapped_column(default=0, server_default=text("0"))
    payment_status: Mapped[PaymentStatus] = mapped_column(
        str_enum(PAYMENT_STATUSES, "payment_status"),
        default="pending",
        server_default="pending",
        index=True,
    )
    due_date: Mapped[date] = mapped_column(index=True)
    paid_at: Mapped[datetime | None]

    lot: Mapped[Lot] = relationship(lazy="selectin")
    offer: Mapped[Offer] = relationship(lazy="selectin")
    buyer: Mapped[User] = relationship(lazy="selectin")
    payouts: Mapped[list[FarmerPayout]] = relationship(
        back_populates="settlement",
        cascade="all, delete-orphan",
        order_by=lambda: [FarmerPayout.created_at, FarmerPayout.id],
        lazy="selectin",
    )
    payments: Mapped[list[Payment]] = relationship(
        back_populates="settlement",
        cascade="all, delete-orphan",
        order_by=lambda: [Payment.paid_at, Payment.id],
        lazy="selectin",
    )


class Payment(UUIDPrimaryKey, CreatedAt, Base):
    """A payment received from the buyer against a settlement."""

    __tablename__ = "payments"

    settlement_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("settlements.id", ondelete="CASCADE"), index=True
    )
    amount: Mapped[Decimal]
    reference: Mapped[str | None] = mapped_column(String(NAME_LENGTH))
    paid_at: Mapped[datetime]
    recorded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    settlement: Mapped[Settlement] = relationship(back_populates="payments")
    recorded_by: Mapped[User | None] = relationship(lazy="selectin")


class FarmerPayout(UUIDPrimaryKey, Timestamps, Base):
    """One farmer's net proceeds from a settlement, with the baseline comparison."""

    __tablename__ = "farmer_payouts"
    __table_args__ = (UniqueConstraint("settlement_id", "member_id"),)

    settlement_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("settlements.id", ondelete="CASCADE"), index=True
    )
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lot_members.id"), index=True)
    farmer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    dispatched_kg: Mapped[Decimal]
    accepted_kg: Mapped[Decimal]
    rejected_kg: Mapped[Decimal]
    gross_amount: Mapped[Decimal]
    transport_share: Mapped[Decimal]
    handling_share: Mapped[Decimal]
    commission_share: Mapped[Decimal]
    net_amount: Mapped[Decimal]
    net_per_kg: Mapped[Decimal]
    baseline_net_per_kg: Mapped[Decimal | None]
    uplift_per_kg: Mapped[Decimal | None]
    status: Mapped[PayoutStatus] = mapped_column(
        str_enum(PAYOUT_STATUSES, "payout_status"),
        default="pending",
        server_default="pending",
        index=True,
    )
    reference: Mapped[str | None] = mapped_column(String(NAME_LENGTH))
    paid_at: Mapped[datetime | None]
    marked_paid_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    settlement: Mapped[Settlement] = relationship(back_populates="payouts")
    member: Mapped[LotMember] = relationship(lazy="selectin")
    farmer: Mapped[User] = relationship(foreign_keys=[farmer_id], lazy="selectin")
