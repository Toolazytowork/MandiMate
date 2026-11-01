"""Farmer Producer Organisations (FPOs) that coordinators work for."""

from __future__ import annotations

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import NAME_LENGTH, Base, Timestamps, UUIDPrimaryKey


class Fpo(UUIDPrimaryKey, Timestamps, Base):
    """An FPO / cooperative. Created by coordinator signup with the organisation name."""

    __tablename__ = "fpos"

    name: Mapped[str] = mapped_column(String(NAME_LENGTH), index=True)
    district: Mapped[str | None] = mapped_column(String(NAME_LENGTH))
    state: Mapped[str | None] = mapped_column(String(NAME_LENGTH))
