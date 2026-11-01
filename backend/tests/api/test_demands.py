"""/demands: buyer requirements — create defaults, visibility per role, edit, cancel, expiry."""

from datetime import timedelta
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import today_ist
from app.models import AuditLog, Crop, Demand, Notification, User
from tests import factories
from tests.conftest import AuthClientFactory, MakeUser

DEMANDS = "/api/v1/demands"


def demand_url(demand: Demand | str) -> str:
    return f"{DEMANDS}/{demand if isinstance(demand, str) else demand.id}"


def create_body(crop: Crop, **overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "crop_id": str(crop.id),
        "grade_required": "A",
        "quantity_kg": 1000,
        "target_price_per_kg": 16,
        "delivery_location": "Kalasipalya Wholesale Market, Bengaluru",
        "delivery_district": "Bengaluru Urban",
        "delivery_state": "Karnataka",
        "delivery_latitude": 12.9592,
        "delivery_longitude": 77.576,
        "needed_by": (today_ist() + timedelta(days=4)).isoformat(),
        "payment_terms_days": 7,
        "quality_spec": "Firm, uniformly red",
    }
    return body | overrides


@pytest.fixture
async def crop(db: AsyncSession) -> Crop:
    return await factories.create_crop(db, default_rejection_pct=Decimal("7.5"))


@pytest.fixture
async def buyer(make_user: MakeUser) -> User:
    user, _ = await make_user("buyer")
    return user


# ─────────────────────────────── Create ────────────────────────────────


async def test_buyer_posts_a_requirement_with_defaults(
    auth_client: AuthClientFactory, buyer: User, crop: Crop, db: AsyncSession
) -> None:
    response = await auth_client(buyer).post(DEMANDS, json=create_body(crop))

    assert response.status_code == 201
    body = response.json()
    assert body["buyer_id"] == str(buyer.id)
    assert body["buyer_name"] == "FreshBasket Retail Pvt Ltd"
    assert body["buyer_verified"] is True
    assert body["crop_name"] == "Tomato"
    assert body["quantity_kg"] == 1000
    assert body["min_quantity_kg"] == 1000
    assert body["max_rejection_pct"] == 7.5
    assert body["status"] == "open"
    assert body["lot_ids"] == []
    entry = await db.scalar(select(AuditLog).where(AuditLog.action == "demand.create"))
    assert entry is not None and entry.actor_id == buyer.id


async def test_explicit_minimum_and_rejection_are_kept(
    auth_client: AuthClientFactory, make_user: MakeUser, crop: Crop
) -> None:
    unverified, _ = await make_user("buyer", verification_status="unverified")

    response = await auth_client(unverified).post(
        DEMANDS, json=create_body(crop, min_quantity_kg=800, max_rejection_pct=3)
    )

    body = response.json()
    assert body["min_quantity_kg"] == 800
    assert body["max_rejection_pct"] == 3
    assert body["buyer_verified"] is False


async def test_create_permissions_and_validation(
    auth_client: AuthClientFactory, make_user: MakeUser, buyer: User, crop: Crop
) -> None:
    farmer, _ = await make_user("farmer")
    coordinator, _ = await make_user("coordinator")
    client = auth_client(buyer)

    assert (await auth_client(farmer).post(DEMANDS, json=create_body(crop))).status_code == 403
    assert (await auth_client(coordinator).post(DEMANDS, json=create_body(crop))).status_code == 403
    assert (
        await client.post(DEMANDS, json=create_body(crop, min_quantity_kg=1200))
    ).status_code == 422
    past = create_body(crop, needed_by=(today_ist() - timedelta(days=1)).isoformat())
    response = await client.post(DEMANDS, json=past)
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "needed_by"]
    unknown = create_body(crop, crop_id="00000000-0000-0000-0000-000000000001")
    assert (await client.post(DEMANDS, json=unknown)).status_code == 422
    assert (
        await client.post(DEMANDS, json=create_body(crop, grade_required="D"))
    ).status_code == 422
    assert (
        await client.post(DEMANDS, json=create_body(crop, delivery_location=" "))
    ).status_code == 422


# ─────────────────────────── Visibility ───────────────────────────


async def test_list_scopes_per_role(
    auth_client: AuthClientFactory, make_user: MakeUser, buyer: User, crop: Crop, db: AsyncSession
) -> None:
    other_buyer, _ = await make_user("buyer", full_name="Kiran Rao", organization_name=None)
    farmer, _ = await make_user("farmer")
    coordinator, _ = await make_user("coordinator")
    transporter, _ = await make_user("transporter")
    mine_open = await factories.create_demand(db, buyer, crop)
    mine_cancelled = await factories.create_demand(db, buyer, crop, status="cancelled")
    theirs = await factories.create_demand(db, other_buyer, crop)

    own = (await auth_client(buyer).get(DEMANDS)).json()
    own_cancelled = (await auth_client(buyer).get(DEMANDS, params={"status": "cancelled"})).json()
    as_farmer = (await auth_client(farmer).get(DEMANDS)).json()
    farmer_cancelled = (
        await auth_client(farmer).get(DEMANDS, params={"status": "cancelled"})
    ).json()
    everything = (await auth_client(coordinator).get(DEMANDS)).json()

    assert [item["id"] for item in own] == [str(mine_cancelled.id), str(mine_open.id)]
    assert [item["id"] for item in own_cancelled] == [str(mine_cancelled.id)]
    assert {item["id"] for item in as_farmer} == {str(mine_open.id), str(theirs.id)}
    assert next(item for item in as_farmer if item["id"] == str(theirs.id))["buyer_name"] == (
        "Kiran Rao"
    )
    assert farmer_cancelled == []
    assert len(everything) == 3
    assert (await auth_client(transporter).get(DEMANDS)).status_code == 403
    filtered = (
        await auth_client(coordinator).get(DEMANDS, params={"crop_id": str(crop.id), "limit": 1})
    ).json()
    assert [item["id"] for item in filtered] == [str(theirs.id)]


async def test_get_visibility(
    auth_client: AuthClientFactory, make_user: MakeUser, buyer: User, crop: Crop, db: AsyncSession
) -> None:
    other_buyer, _ = await make_user("buyer")
    farmer, _ = await make_user("farmer")
    admin, _ = await make_user("admin")
    open_demand = await factories.create_demand(db, buyer, crop)
    matched = await factories.create_demand(db, buyer, crop, status="matched")

    assert (await auth_client(buyer).get(demand_url(open_demand))).status_code == 200
    assert (await auth_client(farmer).get(demand_url(open_demand))).status_code == 200
    assert (await auth_client(admin).get(demand_url(matched))).status_code == 200
    assert (await auth_client(other_buyer).get(demand_url(open_demand))).status_code == 404
    assert (await auth_client(farmer).get(demand_url(matched))).status_code == 404
    missing = await auth_client(buyer).get(demand_url("00000000-0000-0000-0000-000000000001"))
    assert missing.status_code == 404


async def test_lot_ids_list_active_lots(
    auth_client: AuthClientFactory, make_user: MakeUser, buyer: User, crop: Crop, db: AsyncSession
) -> None:
    demand = await factories.create_demand(db, buyer, crop)
    farmer, _ = await make_user("farmer")
    harvest = await factories.create_harvest(db, farmer, crop)
    other = await factories.create_harvest(db, farmer, crop)
    lot = await factories.create_lot(db, crop, [harvest], demand_id=demand.id)
    await factories.create_lot(db, crop, [other], demand_id=demand.id, status="cancelled")

    body = (await auth_client(buyer).get(demand_url(demand))).json()

    assert body["lot_ids"] == [str(lot.id)]


async def test_open_demands_expire_after_needed_by(
    auth_client: AuthClientFactory, make_user: MakeUser, buyer: User, crop: Crop, db: AsyncSession
) -> None:
    overdue = await factories.create_demand(
        db, buyer, crop, needed_by=today_ist() - timedelta(days=1)
    )
    farmer, _ = await make_user("farmer")

    assert (await auth_client(farmer).get(demand_url(overdue))).status_code == 404
    listed = (await auth_client(buyer).get(DEMANDS)).json()

    assert listed[0]["status"] == "expired"


# ─────────────────────────────── Edit ────────────────────────────────


async def test_owner_edits_an_open_requirement(
    auth_client: AuthClientFactory, buyer: User, crop: Crop, db: AsyncSession
) -> None:
    demand = await factories.create_demand(db, buyer, crop)
    client = auth_client(buyer)

    response = await client.patch(
        demand_url(demand), json={"quantity_kg": 1500, "target_price_per_kg": None, "notes": "Hi"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["quantity_kg"] == 1500
    assert body["min_quantity_kg"] == 800
    assert body["target_price_per_kg"] is None
    assert body["notes"] == "Hi"
    entry = await db.scalar(select(AuditLog).where(AuditLog.action == "demand.update"))
    assert entry is not None


async def test_edit_rules(
    auth_client: AuthClientFactory, make_user: MakeUser, buyer: User, crop: Crop, db: AsyncSession
) -> None:
    demand = await factories.create_demand(db, buyer, crop)
    cancelled = await factories.create_demand(db, buyer, crop, status="cancelled")
    coordinator, _ = await make_user("coordinator")
    other_buyer, _ = await make_user("buyer")
    client = auth_client(buyer)

    below_minimum = await client.patch(demand_url(demand), json={"quantity_kg": 500})
    assert below_minimum.status_code == 422
    assert below_minimum.json()["detail"][0]["loc"] == ["body", "min_quantity_kg"]
    assert (await client.patch(demand_url(demand), json={"needed_by": None})).status_code == 422
    assert (await client.patch(demand_url(cancelled), json={"notes": "x"})).status_code == 409
    assert (
        await auth_client(coordinator).patch(demand_url(demand), json={"notes": "x"})
    ).status_code == 403
    assert (
        await auth_client(other_buyer).patch(demand_url(demand), json={"notes": "x"})
    ).status_code == 404


# ─────────────────────────────── Cancel ────────────────────────────────


async def test_owner_cancels_once(
    auth_client: AuthClientFactory, buyer: User, crop: Crop, db: AsyncSession
) -> None:
    demand = await factories.create_demand(db, buyer, crop)
    client = auth_client(buyer)

    first = await client.post(f"{demand_url(demand)}/cancel")
    second = await client.post(f"{demand_url(demand)}/cancel")

    assert first.status_code == 200
    assert first.json()["status"] == "cancelled"
    assert second.status_code == 409


async def test_coordinator_cancel_notifies_the_buyer_and_matched_cannot_be_cancelled(
    auth_client: AuthClientFactory, make_user: MakeUser, buyer: User, crop: Crop, db: AsyncSession
) -> None:
    demand = await factories.create_demand(db, buyer, crop)
    matched = await factories.create_demand(db, buyer, crop, status="matched")
    coordinator, _ = await make_user("coordinator")
    farmer, _ = await make_user("farmer")

    response = await auth_client(coordinator).post(f"{demand_url(demand)}/cancel")

    assert response.status_code == 200
    notice = await db.scalar(select(Notification).where(Notification.user_id == buyer.id))
    assert notice is not None
    assert (await auth_client(buyer).post(f"{demand_url(matched)}/cancel")).status_code == 409
    other_open = await factories.create_demand(db, buyer, crop)
    assert (await auth_client(farmer).post(f"{demand_url(other_open)}/cancel")).status_code == 403
