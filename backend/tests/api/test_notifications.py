"""/notifications: listing, unread counts, read flags and sell-by deadline reminders."""

import uuid
from datetime import timedelta

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import today_ist
from app.models import Notification, User
from app.services.notify import notify
from tests import factories
from tests.conftest import AuthClientFactory, MakeUser

NOTIFICATIONS = "/api/v1/notifications"
UNREAD = "/api/v1/notifications/unread-count"
READ_ALL = "/api/v1/notifications/read-all"


async def _notify(db: AsyncSession, user: User, title: str) -> Notification:
    [created] = await notify(
        db, [user.id], "offer", title, f"{title} body", link="/app/farmer/offers"
    )
    await db.commit()
    return created


# ─────────────────────────────── Listing ────────────────────────────────


async def test_list_is_own_newest_first_with_filters(
    auth_client: AuthClientFactory, make_user: MakeUser, db: AsyncSession
) -> None:
    buyer, _ = await make_user("buyer")
    other, _ = await make_user("buyer")
    first = await _notify(db, buyer, "First")
    second = await _notify(db, buyer, "Second")
    await _notify(db, other, "Not yours")
    client = auth_client(buyer)
    await client.post(f"{NOTIFICATIONS}/{first.id}/read")

    everything = await client.get(NOTIFICATIONS)
    unread = await client.get(NOTIFICATIONS, params={"unread_only": "true"})
    limited = await client.get(NOTIFICATIONS, params={"limit": 1})

    assert everything.status_code == 200
    assert [item["title"] for item in everything.json()] == ["Second", "First"]
    item = everything.json()[0]
    assert item == {
        "id": str(second.id),
        "type": "offer",
        "title": "Second",
        "body": "Second body",
        "link": "/app/farmer/offers",
        "read_at": None,
        "created_at": item["created_at"],
    }
    assert everything.json()[1]["read_at"] is not None
    assert [item["title"] for item in unread.json()] == ["Second"]
    assert len(limited.json()) == 1


async def test_list_validation_and_authentication(
    auth_client: AuthClientFactory, make_user: MakeUser, client: AsyncClient
) -> None:
    buyer, _ = await make_user("buyer")

    assert (await auth_client(buyer).get(NOTIFICATIONS, params={"limit": 0})).status_code == 422
    assert (await client.get(NOTIFICATIONS)).status_code == 401
    assert (await client.get(UNREAD)).status_code == 401
    assert (await client.post(READ_ALL)).status_code == 401


# ───────────────────────────── Read flags ───────────────────────────────


async def test_unread_count_mark_read_and_read_all(
    auth_client: AuthClientFactory, make_user: MakeUser, db: AsyncSession
) -> None:
    transporter, _ = await make_user("transporter")
    other, _ = await make_user("transporter")
    notifications = [await _notify(db, transporter, f"Trip {n}") for n in range(3)]
    others = await _notify(db, other, "Other trip")
    client = auth_client(transporter)

    assert (await client.get(UNREAD)).json() == {"count": 3}

    read = await client.post(f"{NOTIFICATIONS}/{notifications[0].id}/read")
    assert read.status_code == 200
    first_read_at = read.json()["read_at"]
    assert first_read_at is not None
    again = await client.post(f"{NOTIFICATIONS}/{notifications[0].id}/read")
    assert again.json()["read_at"] == first_read_at
    assert (await client.get(UNREAD)).json() == {"count": 2}

    assert (await client.post(f"{NOTIFICATIONS}/{others.id}/read")).status_code == 404
    assert (await client.post(f"{NOTIFICATIONS}/{uuid.uuid4()}/read")).status_code == 404
    assert (await client.post(f"{NOTIFICATIONS}/not-a-uuid/read")).status_code == 422

    read_all = await client.post(READ_ALL)
    assert read_all.status_code == 204
    assert (await client.get(UNREAD)).json() == {"count": 0}
    still_unread = await db.scalar(
        select(func.count(Notification.id)).where(
            Notification.user_id == other.id, Notification.read_at.is_(None)
        )
    )
    assert still_unread == 1


# ────────────────────────── Deadline reminders ──────────────────────────


async def test_deadline_reminders_for_harvests_selling_within_two_days(
    auth_client: AuthClientFactory, make_user: MakeUser, db: AsyncSession
) -> None:
    farmer, _ = await make_user("farmer")
    crop = await factories.create_crop(db)
    today = today_ist()
    due_today = await factories.create_harvest(db, farmer, crop, sell_by=today)
    due_in_two = await factories.create_harvest(
        db, farmer, crop, sell_by=today + timedelta(days=2), status="pooled"
    )
    # Not reminded: too far out, already committed, draft, or past its sell-by date.
    await factories.create_harvest(db, farmer, crop, sell_by=today + timedelta(days=3))
    await factories.create_harvest(
        db, farmer, crop, sell_by=today + timedelta(days=1), status="committed"
    )
    await factories.create_harvest(
        db, farmer, crop, sell_by=today + timedelta(days=1), status="draft"
    )
    await factories.create_harvest(
        db,
        farmer,
        crop,
        harvest_date=today - timedelta(days=5),
        available_from=today - timedelta(days=4),
        sell_by=today - timedelta(days=1),
    )
    client = auth_client(farmer)

    count = await client.get(UNREAD)
    listed = await client.get(NOTIFICATIONS)
    # Reading again the same day never duplicates the reminders.
    again = await client.get(NOTIFICATIONS)

    assert count.json() == {"count": 2}
    reminders = listed.json()
    assert len(reminders) == 2 == len(again.json())
    assert {item["type"] for item in reminders} == {"harvest_deadline"}
    assert {item["link"] for item in reminders} == {
        f"/app/farmer/harvests/{due_today.id}",
        f"/app/farmer/harvests/{due_in_two.id}",
    }
    by_link = {item["link"]: item for item in reminders}
    today_item = by_link[f"/app/farmer/harvests/{due_today.id}"]
    assert today_item["title"] == "Tomato must be sold today"
    assert "400 kg of Tomato" in today_item["body"]
    assert by_link[f"/app/farmer/harvests/{due_in_two.id}"]["title"] == (
        "Tomato must be sold in 2 days"
    )
    keys = set((await db.scalars(select(Notification.dedupe_key))).all())
    assert f"deadline:{due_today.id}:{today.isoformat()}:{farmer.id}" in keys


async def test_deadline_reminder_is_not_recreated_after_reading(
    auth_client: AuthClientFactory, make_user: MakeUser, db: AsyncSession
) -> None:
    farmer, _ = await make_user("farmer")
    crop = await factories.create_crop(db)
    await factories.create_harvest(db, farmer, crop, sell_by=today_ist() + timedelta(days=1))
    client = auth_client(farmer)

    assert (await client.get(UNREAD)).json() == {"count": 1}
    assert (await client.post(READ_ALL)).status_code == 204

    assert (await client.get(UNREAD)).json() == {"count": 0}
    assert len((await client.get(NOTIFICATIONS)).json()) == 1


async def test_deadline_reminders_only_for_the_owner_farmer(
    auth_client: AuthClientFactory, make_user: MakeUser, db: AsyncSession
) -> None:
    farmer, _ = await make_user("farmer")
    neighbour, _ = await make_user("farmer")
    coordinator, _ = await make_user("coordinator")
    crop = await factories.create_crop(db)
    await factories.create_harvest(db, farmer, crop, sell_by=today_ist())

    assert (await auth_client(neighbour).get(UNREAD)).json() == {"count": 0}
    assert (await auth_client(coordinator).get(NOTIFICATIONS)).json() == []
