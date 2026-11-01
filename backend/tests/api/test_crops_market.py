"""/crops (public catalogue), /market-prices and ``market_service.latest_market_price``."""

import uuid
from datetime import timedelta
from decimal import Decimal

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import today_ist
from app.services import market_service
from tests import factories
from tests.conftest import AuthClientFactory, MakeUser

CROPS = "/api/v1/crops"
PRICES = "/api/v1/market-prices"


async def test_crops_are_public_and_sorted_by_name(client: AsyncClient, db: AsyncSession) -> None:
    await factories.create_crop(db)
    await factories.create_crop(
        db,
        code="ONI",
        name="Onion",
        name_hi="प्याज",
        name_te="ఉల్లిపాయ",
        name_kn="ಈರುಳ್ಳಿ",
        name_ur="پیاز",
        grades=["A", "B"],
        default_rejection_pct=Decimal("4.5"),
        requires_refrigeration=False,
    )

    response = await client.get(CROPS)

    assert response.status_code == 200
    crops = response.json()
    assert [crop["name"] for crop in crops] == ["Onion", "Tomato"]
    onion = crops[0]
    assert onion["code"] == "ONI"
    assert onion["name_te"] == "ఉల్లిపాయ"
    assert onion["name_kn"] == "ಈರುಳ್ಳಿ"
    assert onion["name_ur"] == "پیاز"
    assert onion["category"] == "vegetable"
    assert onion["grades"] == ["A", "B"]
    assert onion["default_rejection_pct"] == 4.5
    assert onion["requires_refrigeration"] is False
    assert set(onion) == {
        "id",
        "code",
        "name",
        "name_hi",
        "name_te",
        "name_kn",
        "name_ur",
        "category",
        "perishability_days",
        "grades",
        "default_rejection_pct",
        "requires_refrigeration",
    }


async def test_market_prices_need_a_session(client: AsyncClient) -> None:
    assert (await client.get(PRICES)).status_code == 401


async def test_market_prices_latest_first_with_filters(
    auth_client: AuthClientFactory, make_user: MakeUser, db: AsyncSession
) -> None:
    tomato = await factories.create_crop(db)
    onion = await factories.create_crop(db, code="ONI", name="Onion", name_hi="प्याज", name_te="ఉల్లి")
    today = today_ist()
    older = await factories.create_market_price(
        db, tomato, price_date=today - timedelta(days=2), modal_price_per_kg=Decimal("12.5")
    )
    latest = await factories.create_market_price(db, tomato)
    kolar = await factories.create_market_price(
        db,
        tomato,
        market_name="Kolar APMC",
        district="Kolar",
        state="Karnataka",
        price_date=today - timedelta(days=1),
        is_illustrative=False,
        source="Agmarknet",
    )
    onion_price = await factories.create_market_price(
        db, onion, price_date=today - timedelta(days=3)
    )
    farmer, _ = await make_user("farmer")
    client = auth_client(farmer)

    everything = (await client.get(PRICES)).json()
    tomatoes = (await client.get(PRICES, params={"crop_id": str(tomato.id)})).json()
    in_kolar = (await client.get(PRICES, params={"district": "kolar"})).json()
    top = (await client.get(PRICES, params={"limit": 1})).json()

    assert [item["id"] for item in everything] == [
        str(latest.id),
        str(kolar.id),
        str(older.id),
        str(onion_price.id),
    ]
    assert [item["id"] for item in tomatoes] == [str(latest.id), str(kolar.id), str(older.id)]
    assert [item["id"] for item in in_kolar] == [str(kolar.id)]
    assert in_kolar[0]["is_illustrative"] is False
    assert in_kolar[0]["crop_name"] == "Tomato"
    assert [item["id"] for item in top] == [str(latest.id)]
    first = everything[0]
    assert (first["min_price_per_kg"], first["modal_price_per_kg"], first["max_price_per_kg"]) == (
        10,
        14,
        18,
    )
    assert first["price_date"] == today.isoformat()
    assert (await client.get(PRICES, params={"limit": 0})).status_code == 422
    assert (await client.get(PRICES, params={"crop_id": "tomato"})).status_code == 422


async def test_latest_market_price_prefers_the_district(db: AsyncSession) -> None:
    tomato = await factories.create_crop(db)
    today = today_ist()
    local = await factories.create_market_price(db, tomato, price_date=today - timedelta(days=3))
    await factories.create_market_price(
        db, tomato, price_date=today - timedelta(days=5), market_name="Punganur"
    )
    newest_elsewhere = await factories.create_market_price(
        db, tomato, market_name="Kolar APMC", district="Kolar", state="Karnataka"
    )

    assert (await market_service.latest_market_price(db, tomato.id, "Annamayya")).id == local.id
    assert (await market_service.latest_market_price(db, tomato.id, "annamayya ")).id == local.id
    assert (
        await market_service.latest_market_price(db, tomato.id, "Chittoor")
    ).id == newest_elsewhere.id
    assert (await market_service.latest_market_price(db, tomato.id)).id == newest_elsewhere.id
    assert await market_service.latest_market_price(db, uuid.uuid4(), "Annamayya") is None
