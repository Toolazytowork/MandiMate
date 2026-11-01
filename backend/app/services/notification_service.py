"""Reading in-app notifications and the lazily created sell-by reminders (DOMAIN_RULES §8)."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import TYPE_CHECKING

from sqlalchemy import func, select, update

from app.core.errors import not_found
from app.core.time import today_ist, utcnow
from app.models import Harvest, Notification
from app.services.notify import notify
from app.services.pricing import format_number

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models import User

DEADLINE_WINDOW_DAYS = 2
"""Remind a farmer when a listed/pooled harvest must be sold within this many days."""

DEADLINE_HARVEST_STATUSES = ("listed", "pooled")


def _when(days_left: int) -> str:
    if days_left <= 0:
        return "today"
    if days_left == 1:
        return "tomorrow"
    return f"in {days_left} days"


async def ensure_deadline_reminders(db: AsyncSession, user: User) -> list[Notification]:
    """Create today's ``harvest_deadline`` reminders for a farmer (at most one per harvest per
    day, deduplicated by ``deadline:<harvest_id>:<today>``). Other roles get none."""
    if user.role != "farmer":
        return []
    today = today_ist()
    harvests = (
        await db.scalars(
            select(Harvest)
            .where(
                Harvest.farmer_id == user.id,
                Harvest.status.in_(DEADLINE_HARVEST_STATUSES),
                Harvest.sell_by >= today,
                Harvest.sell_by <= today + timedelta(days=DEADLINE_WINDOW_DAYS),
            )
            .order_by(Harvest.sell_by, Harvest.created_at)
        )
    ).all()
    created: list[Notification] = []
    for harvest in harvests:
        days_left = (harvest.sell_by - today).days
        crop = harvest.crop.name if harvest.crop is not None else "produce"
        pooled = harvest.status == "pooled"
        body = (
            f"Your {format_number(harvest.quantity_kg)} kg of {crop} (grade {harvest.grade}) "
            f"must be sold by {harvest.sell_by:%d %b} ({_when(days_left)}). "
            + (
                "It is in a pooled lot that is still waiting for a deal; "
                "check the lot's offers with your coordinator."
                if pooled
                else "Review your offers or ask your coordinator to add it to a lot."
            )
        )
        created += await notify(
            db,
            [user.id],
            "harvest_deadline",
            f"{crop} must be sold {_when(days_left)}",
            body,
            link=f"/app/farmer/harvests/{harvest.id}",
            dedupe_key=f"deadline:{harvest.id}:{today.isoformat()}",
        )
    return created


async def list_notifications(
    db: AsyncSession, user: User, *, unread_only: bool = False, limit: int = 100
) -> list[Notification]:
    """The user's notifications, newest first."""
    await ensure_deadline_reminders(db, user)
    query = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        query = query.where(Notification.read_at.is_(None))
    query = query.order_by(Notification.created_at.desc(), Notification.id).limit(limit)
    return list((await db.scalars(query)).all())


async def unread_count(db: AsyncSession, user: User) -> int:
    await ensure_deadline_reminders(db, user)
    count = await db.scalar(
        select(func.count(Notification.id)).where(
            Notification.user_id == user.id, Notification.read_at.is_(None)
        )
    )
    return int(count or 0)


async def mark_read(db: AsyncSession, user: User, notification_id: uuid.UUID) -> Notification:
    """Mark one of the user's notifications read (404 for anyone else's)."""
    notification = await db.get(Notification, notification_id)
    if notification is None or notification.user_id != user.id:
        raise not_found("Notification")
    if notification.read_at is None:
        notification.read_at = utcnow()
        await db.flush()
    return notification


async def mark_all_read(db: AsyncSession, user: User) -> int:
    """Mark every unread notification of the user read; returns how many changed."""
    result = await db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        .values(read_at=utcnow())
    )
    return result.rowcount or 0
