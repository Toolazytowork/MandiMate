"""Crop catalogue."""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import String, false, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import JSON_DOCUMENT, PERCENT, Base, Timestamps, UUIDPrimaryKey, str_enum
from app.models.enums import CROP_CATEGORIES, CropCategory


def _default_grades() -> list[str]:
    return ["A", "B", "C"]


class Crop(UUIDPrimaryKey, Timestamps, Base):
    """A tradeable crop with its names in English, Hindi, Telugu, Kannada and Urdu."""

    __tablename__ = "crops"

    code: Mapped[str] = mapped_column(String(16), unique=True)
    name: Mapped[str] = mapped_column(String(64))
    name_hi: Mapped[str] = mapped_column(String(64))
    name_te: Mapped[str] = mapped_column(String(64))
    name_kn: Mapped[str] = mapped_column(String(64))
    name_ur: Mapped[str] = mapped_column(String(64))
    category: Mapped[CropCategory] = mapped_column(str_enum(CROP_CATEGORIES, "crop_category"))
    perishability_days: Mapped[int]
    grades: Mapped[list[str]] = mapped_column(JSON_DOCUMENT, default=_default_grades)
    default_rejection_pct: Mapped[Decimal] = mapped_column(PERCENT)
    requires_refrigeration: Mapped[bool] = mapped_column(default=False, server_default=false())
    synonyms: Mapped[list[str]] = mapped_column(
        JSON_DOCUMENT, default=list, server_default=text("'[]'::jsonb")
    )
    """Lower-case spellings in every language, used by the voice-listing parser."""
