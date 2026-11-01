"""In-app notifications and recipient resolution (DOMAIN_RULES §8)."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.core.time import utcnow
from app.models import Notification, User

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models.enums import NotificationType


async def notify(
    db: AsyncSession,
    user_ids: Iterable[uuid.UUID],
    type: NotificationType,
    title: str,
    body: str,
    link: str | None = None,
    dedupe_key: str | None = None,
) -> list[Notification]:
    """Create one notification per distinct recipient and return the ones created.

    With ``dedupe_key`` each recipient gets the notification at most once (the key is
    stored per user as ``"<dedupe_key>:<user_id>"``); duplicates are skipped silently, even
    under concurrent requests.
    """
    recipients = list(dict.fromkeys(user_ids))
    if not recipients:
        return []

    now = utcnow()
    rows = [
        {
            "id": uuid.uuid4(),
            "user_id": user_id,
            "type": type,
            "title": title,
            "body": body,
            "link": link,
            "dedupe_key": f"{dedupe_key}:{user_id}" if dedupe_key is not None else None,
            "created_at": now,
        }
        for user_id in recipients
    ]
    statement = (
        insert(Notification)
        .values(rows)
        .on_conflict_do_nothing(index_elements=[Notification.dedupe_key])
        .returning(Notification)
    )
    created = await db.scalars(statement, execution_options={"populate_existing": True})
    return list(created)


async def coordinator_ids_for(db: AsyncSession, farmer_ids: Iterable[uuid.UUID]) -> list[uuid.UUID]:
    """Coordinators to notify about these farmers.

    For each farmer: the active coordinators of the farmer's FPO, or every active
    coordinator when the farmer has no FPO or nobody coordinates it. With no farmers,
    every active coordinator.
    """
    coordinators = (
        await db.execute(
            select(User.id, User.fpo_id)
            .where(User.role == "coordinator", User.is_active.is_(True))
            .order_by(User.created_at, User.id)
        )
    ).all()
    everyone = [coordinator_id for coordinator_id, _ in coordinators]

    farmer_id_list = list(dict.fromkeys(farmer_ids))
    if not farmer_id_list:
        return everyone

    farmer_fpo_ids = set(
        (await db.scalars(select(User.fpo_id).where(User.id.in_(farmer_id_list)))).all()
    )
    by_fpo: dict[uuid.UUID, list[uuid.UUID]] = {}
    for coordinator_id, fpo_id in coordinators:
        if fpo_id is not None:
            by_fpo.setdefault(fpo_id, []).append(coordinator_id)

    selected: set[uuid.UUID] = set()
    for fpo_id in farmer_fpo_ids:
        matched = by_fpo.get(fpo_id) if fpo_id is not None else None
        if not matched:
            return everyone
        selected.update(matched)
    return [coordinator_id for coordinator_id in everyone if coordinator_id in selected]
