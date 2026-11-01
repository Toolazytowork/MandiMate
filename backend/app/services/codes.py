"""Human-readable codes backed by PostgreSQL sequences (DOMAIN_RULES §9)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from sqlalchemy import Sequence, select

from app.models import dispute_code_seq, lot_code_seq, offer_code_seq, settlement_code_seq

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

CodeKind = Literal["lot", "offer", "settlement", "dispute"]

_CODE_FORMATS: dict[CodeKind, tuple[Sequence, str]] = {
    "lot": (lot_code_seq, "MM-{crop}-{number:04d}"),
    "offer": (offer_code_seq, "OF-{number:05d}"),
    "settlement": (settlement_code_seq, "ST-{number:05d}"),
    "dispute": (dispute_code_seq, "DP-{number:04d}"),
}


async def next_code(db: AsyncSession, kind: CodeKind, crop_code: str | None = None) -> str:
    """Next code of ``kind``: ``MM-TOM-0001``, ``OF-00001``, ``ST-00001`` or ``DP-0001``.

    Lot codes embed the crop code, so ``crop_code`` is required for ``kind="lot"``.
    """
    sequence, template = _CODE_FORMATS[kind]
    crop = (crop_code or "").strip().upper()
    if kind == "lot" and not crop:
        raise ValueError("crop_code is required for lot codes")
    number = await db.scalar(select(sequence.next_value()))
    return template.format(crop=crop, number=number)
