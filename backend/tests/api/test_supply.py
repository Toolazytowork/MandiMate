"""/supply: lots open for offers plus individually listed harvests, never the same kg twice."""

from datetime import timedelta
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import today_ist, utcnow
from app.models import Crop, User
from app.services.pricing import road_km
from tests import factories
from tests.conftest import AuthClientFactory, MakeUser

SUPPLY = "/api/v1/supply"


@pytest.fixture
async def crop(db: AsyncSession) -> Crop:
    return await factories.create_crop(db)


@pytest.fixture
async def buyer(make_user: MakeUser) -> User:
    user, _ = await make_user("buyer")
    return user


async def test_supply_lists_open_lots_and_unpooled_listed_harvests(
    auth_client: AuthClientFactory, make_user: MakeUser, buyer: User, crop: Crop, db: AsyncSession
) -> None:
    ravi, _ = await make_user("farmer", full_name="Ravi Kumar")
    lakshmi, _ = await make_user("farmer", full_name="Lakshmi Devi")
    venkatesh, _ = await make_user("farmer", full_name="Venkatesh Naidu")
    pooled_a = await factories.create_harvest(db, ravi, crop, quality_status="inspected")
    pooled_b = await factories.create_harvest(
        db, lakshmi, crop, quality_status="pending_inspection"
    )
    declined = await factories.create_harvest(db, venkatesh, crop)
    lot = await factories.create_lot(db, crop, [pooled_a, (pooled_b, 250), declined])
    next(m for m in lot.members if m.harvest_id == declined.id).consent_status = "declined"
    declined.status = "listed"
    await db.commit()
    solo = await factories.create_harvest(db, venkatesh, crop, quantity_kg=Decimal("300"))
    await factories.create_harvest(db, venkatesh, crop, status="draft")
    forming = await factories.create_harvest(db, lakshmi, crop)
    await factories.create_lot(db, crop, [forming], status="forming")
    fully_committed = await factories.create_harvest(db, ravi, crop, quantity_kg=Decimal("100"))
    await factories.create_lot(
        db, crop, [fully_committed], status="awaiting_consent", consent_status="pending"
    )
    fully_committed.status = "listed"
    await db.commit()

    response = await auth_client(buyer).get(SUPPLY)

    assert response.status_code == 200
    items = response.json()
    by_id = {item["id"]: item for item in items}
    assert set(by_id) == {str(lot.id), str(solo.id), str(declined.id)}
    assert items[0]["kind"] == "lot"
    lot_item = by_id[str(lot.id)]
    assert lot_item["code"] == lot.code
    assert lot_item["quantity_kg"] == 650
    assert lot_item["member_count"] == 2
    assert lot_item["quality_status"] == "pending_inspection"
    assert lot_item["village"] == lot.collection_point_name
    assert lot_item["pickup_date"] == lot.pickup_date.isoformat()
    assert lot_item["sell_by"] == pooled_a.sell_by.isoformat()
    expected = float(
        road_km(buyer.latitude, buyer.longitude, lot.collection_latitude, lot.collection_longitude)
    )
    assert lot_item["distance_km"] == expected
    harvest_item = by_id[str(solo.id)]
    assert harvest_item["kind"] == "harvest"
    assert harvest_item["code"] is None
    assert harvest_item["quantity_kg"] == 300
    assert harvest_item["member_count"] == 1
    assert harvest_item["pickup_date"] is None
    assert harvest_item["village"] == solo.village
    text = response.text
    for name in ("Ravi", "Lakshmi", "Venkatesh"):
        assert name not in text


async def test_offer_counts_and_my_offer_status(
    auth_client: AuthClientFactory, make_user: MakeUser, buyer: User, crop: Crop, db: AsyncSession
) -> None:
    farmer, _ = await make_user("farmer")
    pooled = await factories.create_harvest(db, farmer, crop)
    lot = await factories.create_lot(db, crop, [pooled])
    listed = await factories.create_harvest(db, farmer, crop)
    lapsed = await factories.create_harvest(db, farmer, crop)
    rival, _ = await make_user("buyer")
    await factories.create_offer(db, buyer, lot=lot, status="withdrawn")
    await factories.create_offer(db, buyer, lot=lot)
    await factories.create_offer(db, rival, lot=lot, status="countered")
    await factories.create_offer(db, rival, harvest=listed)
    await factories.create_offer(
        db, buyer, harvest=lapsed, valid_until=utcnow() - timedelta(minutes=5)
    )

    mine = {item["id"]: item for item in (await auth_client(buyer).get(SUPPLY)).json()}
    theirs = {item["id"]: item for item in (await auth_client(rival).get(SUPPLY)).json()}

    assert mine[str(lot.id)]["offers_count"] == 2
    assert mine[str(lot.id)]["my_offer_status"] == "pending"
    assert theirs[str(lot.id)]["my_offer_status"] == "countered"
    assert mine[str(listed.id)]["offers_count"] == 1
    assert mine[str(listed.id)]["my_offer_status"] is None
    assert theirs[str(listed.id)]["my_offer_status"] == "pending"
    assert mine[str(lapsed.id)]["offers_count"] == 0
    assert mine[str(lapsed.id)]["my_offer_status"] == "expired"


async def test_filters_by_crop_grade_and_district(
    auth_client: AuthClientFactory, make_user: MakeUser, buyer: User, crop: Crop, db: AsyncSession
) -> None:
    onion = await factories.create_crop(db, code="ONI", name="Onion", name_hi="प्याज", name_te="ఉల్లి")
    farmer, _ = await make_user("farmer")
    grade_a = await factories.create_harvest(db, farmer, crop, grade="A")
    grade_b = await factories.create_harvest(db, farmer, crop, grade="B", district="Chittoor")
    onions = await factories.create_harvest(db, farmer, onion)
    client = auth_client(buyer)

    by_crop = (await client.get(SUPPLY, params={"crop_id": str(onion.id)})).json()
    by_grade = (await client.get(SUPPLY, params={"grade": "B"})).json()
    by_district = (await client.get(SUPPLY, params={"district": "  annamayya "})).json()
    limited = (await client.get(SUPPLY, params={"limit": 1})).json()

    assert [item["id"] for item in by_crop] == [str(onions.id)]
    assert [item["id"] for item in by_grade] == [str(grade_b.id)]
    assert {item["id"] for item in by_district} == {str(grade_a.id), str(onions.id)}
    assert len(limited) == 1
    assert (await client.get(SUPPLY, params={"grade": "Z"})).status_code == 422


async def test_expired_harvests_and_viewers_without_location(
    auth_client: AuthClientFactory, make_user: MakeUser, crop: Crop, db: AsyncSession
) -> None:
    farmer, _ = await make_user("farmer")
    today = today_ist()
    await factories.create_harvest(
        db,
        farmer,
        crop,
        harvest_date=today - timedelta(days=4),
        available_from=today - timedelta(days=3),
        sell_by=today - timedelta(days=1),
    )
    fresh = await factories.create_harvest(db, farmer, crop)
    coordinator, _ = await make_user("coordinator", latitude=None, longitude=None)

    items = (await auth_client(coordinator).get(SUPPLY)).json()

    assert [item["id"] for item in items] == [str(fresh.id)]
    assert items[0]["distance_km"] is None
    assert items[0]["my_offer_status"] is None


async def test_only_buyers_coordinators_and_admins(
    auth_client: AuthClientFactory, make_user: MakeUser
) -> None:
    farmer, _ = await make_user("farmer")
    transporter, _ = await make_user("transporter")
    admin, _ = await make_user("admin")

    assert (await auth_client(farmer).get(SUPPLY)).status_code == 403
    assert (await auth_client(transporter).get(SUPPLY)).status_code == 403
    assert (await auth_client(admin).get(SUPPLY)).status_code == 200
