"""Declarative base, shared column types and mixins for every ORM model."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Double, Enum, MetaData, Numeric, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncAttrs
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.core.time import utcnow

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

MONEY = Numeric(12, 2)
"""Rupees and kilograms (``Decimal`` in Python, rounded to 2 dp)."""

PERCENT = Numeric(5, 2)
"""Percentages 0.00–100.00."""

JSON_DOCUMENT = JSONB(none_as_null=True)

NAME_LENGTH = 120
ADDRESS_LENGTH = 200


class Base(AsyncAttrs, DeclarativeBase):
    """Base class for all models.

    ``AsyncAttrs`` adds ``await obj.awaitable_attrs.<relationship>`` for relationships that
    are not eagerly loaded (lazy loading is not possible on an ``AsyncSession``).
    """

    metadata = MetaData(naming_convention=NAMING_CONVENTION)
    type_annotation_map = {  # noqa: RUF012 - SQLAlchemy reads this class attribute
        datetime: DateTime(timezone=True),
        Decimal: MONEY,
        float: Double(),
        str: String(255),
    }


def str_enum(values: tuple[str, ...], name: str) -> Enum:
    """A string enum stored as VARCHAR (``native_enum=False``) with the exact API literals."""
    return Enum(
        *values,
        name=name,
        native_enum=False,
        create_constraint=False,
        validate_strings=True,
        length=32,
    )


class UUIDPrimaryKey:
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4, sort_order=-100)


class CreatedAt:
    created_at: Mapped[datetime] = mapped_column(
        default=utcnow, server_default=func.now(), index=True, sort_order=100
    )


class Timestamps(CreatedAt):
    updated_at: Mapped[datetime] = mapped_column(
        default=utcnow, server_default=func.now(), onupdate=utcnow, sort_order=101
    )
