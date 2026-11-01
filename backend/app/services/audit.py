"""Audit trail writer."""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

from fastapi.encoders import jsonable_encoder

from app.models import AuditLog

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models import User


async def audit(
    db: AsyncSession,
    actor: User | None,
    action: str,
    entity_type: str,
    entity_id: uuid.UUID | str | None,
    summary: str,
    payload: Mapping[str, Any] | None = None,
    *,
    ip: str | None = None,
) -> AuditLog:
    """Record an action in the audit log (added to the session; committed with the request).

    ``action`` is a dotted verb such as ``"lot.cancel"``; ``payload`` may contain ``Decimal``,
    ``UUID`` and dates (they are converted to JSON types).
    """
    entry = AuditLog(
        actor_id=actor.id if actor is not None else None,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        summary=summary,
        payload=jsonable_encoder(dict(payload)) if payload is not None else None,
        ip=ip,
    )
    db.add(entry)
    await db.flush()
    return entry
