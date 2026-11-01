"""Vehicles, transport requests, pickup stops and transporter quotes."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Index, Numeric, String, Text, UniqueConstraint, false, text, true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import NAME_LENGTH, Base, Timestamps, UUIDPrimaryKey, str_enum
from app.models.enums import (
    QUOTE_STATUSES,
    STOP_STATUSES,
    TRANSPORT_REQUEST_STATUSES,
    VEHICLE_TYPES,
    QuoteStatus,
    StopStatus,
    TransportRequestStatus,
    VehicleType,
)

if TYPE_CHECKING:
    from app.models.lot import Lot, LotMember
    from app.models.user import User


class Vehicle(UUIDPrimaryKey, Timestamps, Base):
    """A transporter's vehicle with its tariff."""

    __tablename__ = "vehicles"

    transporter_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    vehicle_type: Mapped[VehicleType] = mapped_column(str_enum(VEHICLE_TYPES, "vehicle_type"))
    registration_number: Mapped[str] = mapped_column(String(32), unique=True)
    capacity_kg: Mapped[Decimal]
    has_refrigeration: Mapped[bool] = mapped_column(default=False, server_default=false())
    base_charge: Mapped[Decimal]
    per_km_rate: Mapped[Decimal]
    is_active: Mapped[bool] = mapped_column(default=True, server_default=true())


class TransportRequest(UUIDPrimaryKey, Timestamps, Base):
    """A pickup job for a ``mandimate_delivery`` lot: ordered stops to the buyer's destination."""

    __tablename__ = "transport_requests"

    lot_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lots.id"), index=True)
    requested_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    total_quantity_kg: Mapped[Decimal]
    pickup_date: Mapped[date]
    requires_refrigeration: Mapped[bool] = mapped_column(default=False, server_default=false())
    destination_name: Mapped[str] = mapped_column(String(NAME_LENGTH))
    destination_latitude: Mapped[float]
    destination_longitude: Mapped[float]
    estimated_distance_km: Mapped[Decimal]
    suggested_vehicle_type: Mapped[VehicleType] = mapped_column(
        str_enum(VEHICLE_TYPES, "vehicle_type")
    )
    estimated_cost: Mapped[Decimal]
    status: Mapped[TransportRequestStatus] = mapped_column(
        str_enum(TRANSPORT_REQUEST_STATUSES, "transport_request_status"),
        default="open",
        server_default="open",
        index=True,
    )
    booked_quote_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("transport_quotes.id", use_alter=True, ondelete="SET NULL")
    )
    notes: Mapped[str | None] = mapped_column(Text)
    completion_note: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None]
    completed_at: Mapped[datetime | None]

    lot: Mapped[Lot] = relationship(lazy="selectin")
    stops: Mapped[list[TransportStop]] = relationship(
        back_populates="request",
        cascade="all, delete-orphan",
        order_by=lambda: TransportStop.sequence,
        lazy="selectin",
    )
    quotes: Mapped[list[TransportQuote]] = relationship(
        back_populates="request",
        cascade="all, delete-orphan",
        foreign_keys=lambda: [TransportQuote.request_id],
        order_by=lambda: [TransportQuote.created_at, TransportQuote.id],
        lazy="selectin",
    )
    booked_quote: Mapped[TransportQuote | None] = relationship(
        foreign_keys=[booked_quote_id], post_update=True, lazy="selectin"
    )


class TransportStop(UUIDPrimaryKey, Timestamps, Base):
    """One farm pickup on a transport request (sequence 1..n)."""

    __tablename__ = "transport_stops"
    __table_args__ = (
        UniqueConstraint("request_id", "sequence"),
        UniqueConstraint("request_id", "member_id"),
    )

    request_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("transport_requests.id", ondelete="CASCADE"), index=True
    )
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lot_members.id"), index=True)
    sequence: Mapped[int]
    village: Mapped[str | None] = mapped_column(String(NAME_LENGTH))
    latitude: Mapped[float]
    longitude: Mapped[float]
    quantity_kg: Mapped[Decimal]
    status: Mapped[StopStatus] = mapped_column(
        str_enum(STOP_STATUSES, "stop_status"), default="pending", server_default="pending"
    )
    picked_kg: Mapped[Decimal | None]
    picked_up_at: Mapped[datetime | None]
    note: Mapped[str | None] = mapped_column(Text)

    request: Mapped[TransportRequest] = relationship(back_populates="stops")
    member: Mapped[LotMember] = relationship(lazy="selectin")


class TransportQuote(UUIDPrimaryKey, Timestamps, Base):
    """A transporter's price for a request. One ``submitted`` quote per transporter."""

    __tablename__ = "transport_quotes"
    __table_args__ = (
        Index(
            "uq_transport_quotes_active_per_transporter",
            "request_id",
            "transporter_id",
            unique=True,
            postgresql_where=text("status = 'submitted'"),
        ),
    )

    request_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("transport_requests.id", ondelete="CASCADE"), index=True
    )
    transporter_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    vehicle_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("vehicles.id", ondelete="SET NULL")
    )
    vehicle_type: Mapped[VehicleType] = mapped_column(str_enum(VEHICLE_TYPES, "vehicle_type"))
    capacity_kg: Mapped[Decimal]
    price_total: Mapped[Decimal]
    price_per_kg: Mapped[Decimal]
    eta_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[QuoteStatus] = mapped_column(
        str_enum(QUOTE_STATUSES, "quote_status"),
        default="submitted",
        server_default="submitted",
        index=True,
    )

    request: Mapped[TransportRequest] = relationship(
        back_populates="quotes", foreign_keys=[request_id]
    )
    transporter: Mapped[User] = relationship(lazy="selectin")
