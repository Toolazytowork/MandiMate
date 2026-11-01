"""Messages sent through the public contact form."""

from __future__ import annotations

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import NAME_LENGTH, Base, CreatedAt, UUIDPrimaryKey


class ContactMessage(UUIDPrimaryKey, CreatedAt, Base):
    """A public enquiry (farmer, buyer, transporter, FPO, partner)."""

    __tablename__ = "contact_messages"

    name: Mapped[str] = mapped_column(String(NAME_LENGTH))
    email: Mapped[str] = mapped_column(String(320))
    organization: Mapped[str | None] = mapped_column(String(NAME_LENGTH))
    role: Mapped[str | None] = mapped_column(String(64))
    message: Mapped[str] = mapped_column(Text)
    ip: Mapped[str | None] = mapped_column(String(64))
