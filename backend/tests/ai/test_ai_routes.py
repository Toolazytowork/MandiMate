"""AI endpoints: roles, visibility (404), validation (422), state (409) and happy paths."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import timedelta
from decimal import Decimal
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import today_ist
from app.models import AiInteraction, Crop, User
from tests import factories
from tests.ai.test_ai_service_mock import proposal

API = "/api/v1/ai"
AuthClient = Callable[[User], AsyncClient]


@pytest.fixture
async def tomato(db: AsyncSession) -> Crop:
    crop = await factories.create_crop(db)
    await factories.create_market_price(db, crop)
    return crop


async def user(db: AsyncSession, role: str, **overrides: Any) -> User:
    return await factories.create_user(db, role, **overrides)  # type: ignore[arg-type]


async def interaction_count(db: AsyncSession) -> int:
    return int(await db.scalar(select(func.count()).select_from(AiInteraction)) or 0)


# ─────────────────────────────── Status ───────────────────────────────


async def test_status_requires_sign_in(client: AsyncClient) -> None:
    response = await client.get(f"{API}/status")
    assert response.status_code == 401


@pytest.mark.parametrize("role", ["farmer", "buyer", "transporter", "coordinator", "admin"])
async def test_status_for_any_role(db: AsyncSession, auth_client: AuthClient, role: str) -> None:
    response = await auth_client(await user(db, role)).get(f"{API}/status")
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "mock"
    assert body["provider"] == "deepseek"
    assert body["model"] == "rules"
    assert "deal_advice" in body["features"]


# ─────────────────────────────── Voice listing ───────────────────────────────


@pytest.mark.parametrize("role", ["farmer", "coordinator", "admin"])
async def test_voice_listing_happy_path(
    db: AsyncSession, auth_client: AuthClient, tomato: Crop, role: str
) -> None:
    response = await auth_client(await user(db, role)).post(
        f"{API}/voice-listing",
        json={
            "transcript": "I have 400 kilos of tomatoes ready for pickup tomorrow morning",
            "language": "en",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["source"] == "rules"
    assert body["language"] == "en"
    assert body["draft"]["crop_id"] == str(tomato.id)
    assert body["draft"]["crop_name"] == "Tomato"
    assert body["draft"]["quantity_kg"] == 400.0
    assert body["draft"]["available_from"] == (today_ist() + timedelta(days=1)).isoformat()
    assert body["missing_fields"] == ["sell_by", "grade", "harvest_date"]
    assert body["follow_up_question"] == "By which day must it be sold?"
    assert body["confidence"] == 0.5
    assert await interaction_count(db) == 1


async def test_voice_listing_telugu(
    db: AsyncSession, auth_client: AuthClient, tomato: Crop
) -> None:
    response = await auth_client(await user(db, "farmer")).post(
        f"{API}/voice-listing",
        json={
            "transcript": "నా దగ్గర 5 క్వింటాళ్ల టమాటాలు రేపు సిద్ధంగా ఉన్నాయి",
            "language": "te",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["draft"]["quantity_kg"] == 500.0
    assert body["follow_up_question"] == "ఏ రోజు లోపు అమ్మాలి?"


@pytest.mark.parametrize("role", ["buyer", "transporter"])
async def test_voice_listing_wrong_role(
    db: AsyncSession, auth_client: AuthClient, tomato: Crop, role: str
) -> None:
    response = await auth_client(await user(db, role)).post(
        f"{API}/voice-listing", json={"transcript": "400 kg tomatoes", "language": "en"}
    )
    assert response.status_code == 403


async def test_voice_listing_requires_sign_in(client: AsyncClient) -> None:
    response = await client.post(
        f"{API}/voice-listing", json={"transcript": "400 kg tomatoes", "language": "en"}
    )
    assert response.status_code == 401


@pytest.mark.parametrize(
    "body",
    [
        {"transcript": "   ", "language": "en"},
        {"transcript": "400 kg tomatoes", "language": "fr"},
        {"transcript": "x" * 2001, "language": "en"},
        {"language": "en"},
    ],
)
async def test_voice_listing_validation(
    db: AsyncSession, auth_client: AuthClient, body: dict[str, Any]
) -> None:
    response = await auth_client(await user(db, "farmer")).post(f"{API}/voice-listing", json=body)
    assert response.status_code == 422


# ─────────────────────────────── Deal advice ───────────────────────────────


async def test_deal_advice_for_own_harvest(
    db: AsyncSession, auth_client: AuthClient, tomato: Crop
) -> None:
    farmer = await user(db, "farmer", preferred_language="te")
    harvest = await factories.create_harvest(db, farmer, tomato, min_price_per_kg=Decimal("12"))
    buyer = await user(db, "buyer")
    offer = await factories.create_offer(
        db, buyer, harvest=harvest, price_per_kg=Decimal("13"), pickup_terms="buyer_pickup"
    )

    response = await auth_client(farmer).post(
        f"{API}/deal-advice", json={"harvest_id": str(harvest.id)}
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["harvest_id"] == str(harvest.id)
    assert body["recommended_option_id"] == str(offer.id)
    assert [o["source"] for o in body["options"]] == ["direct_offer", "baseline"]
    assert body["explanation"]["source"] == "rules"
    assert body["explanation"]["model"] is None
    assert body["explanation"]["text"].endswith("తుది నిర్ణయం మీదే.")
    assert body["explanation"]["disclaimer"]
    assert body["counteroffer"]["offer_id"] == str(offer.id)
    assert body["counteroffer"]["market_reference_per_kg"] == 14.0


async def test_deal_advice_for_coordinator(
    db: AsyncSession, auth_client: AuthClient, tomato: Crop
) -> None:
    farmer = await user(db, "farmer")
    harvest = await factories.create_harvest(db, farmer, tomato)
    response = await auth_client(await user(db, "coordinator")).post(
        f"{API}/deal-advice", json={"harvest_id": str(harvest.id)}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["recommended_option_id"] is None
    assert [o["option_id"] for o in body["options"]] == ["baseline"]
    assert body["counteroffer"] is None
    assert body["explanation"]["text"].startswith("There are no buyer offers for your tomato yet.")


async def test_deal_advice_other_farmers_harvest_is_not_found(
    db: AsyncSession, auth_client: AuthClient, tomato: Crop
) -> None:
    owner = await user(db, "farmer")
    harvest = await factories.create_harvest(db, owner, tomato)
    response = await auth_client(await user(db, "farmer")).post(
        f"{API}/deal-advice", json={"harvest_id": str(harvest.id)}
    )
    assert response.status_code == 404


async def test_deal_advice_unknown_harvest(db: AsyncSession, auth_client: AuthClient) -> None:
    response = await auth_client(await user(db, "coordinator")).post(
        f"{API}/deal-advice", json={"harvest_id": str(uuid.uuid4())}
    )
    assert response.status_code == 404


@pytest.mark.parametrize("role", ["buyer", "transporter"])
async def test_deal_advice_wrong_role(
    db: AsyncSession, auth_client: AuthClient, tomato: Crop, role: str
) -> None:
    farmer = await user(db, "farmer")
    harvest = await factories.create_harvest(db, farmer, tomato)
    response = await auth_client(await user(db, role)).post(
        f"{API}/deal-advice", json={"harvest_id": str(harvest.id)}
    )
    assert response.status_code == 403


async def test_deal_advice_validation(db: AsyncSession, auth_client: AuthClient) -> None:
    client = auth_client(await user(db, "farmer"))
    assert (await client.post(f"{API}/deal-advice", json={"harvest_id": "x"})).status_code == 422
    assert (await client.post(f"{API}/deal-advice", json={})).status_code == 422


# ─────────────────────────────── Counter suggestion ───────────────────────────────


async def test_counter_suggestion_for_harvest_owner(
    db: AsyncSession, auth_client: AuthClient, tomato: Crop
) -> None:
    farmer = await user(db, "farmer")
    harvest = await factories.create_harvest(db, farmer, tomato, min_price_per_kg=Decimal("12"))
    offer = await factories.create_offer(
        db,
        await user(db, "buyer"),
        harvest=harvest,
        price_per_kg=Decimal("10"),
        pickup_terms="buyer_pickup",
    )

    response = await auth_client(farmer).post(f"{API}/offers/{offer.id}/counter-suggestion")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["offer_id"] == str(offer.id)
    assert body["current_price_per_kg"] == 10.0
    assert body["suggested_price_per_kg"] == 13.0
    assert body["market_reference_per_kg"] == 14.0
    assert body["floor_price_per_kg"] is not None
    assert body["source"] == "rules"
    # Factory farmers prefer Telugu: the rationale follows the viewer's language.
    assert body["rationale"].startswith("కొనుగోలుదారు కిలోకు ₹10.00 ఇస్తున్నారు.")


async def test_counter_suggestion_not_visible_to_other_farmer(
    db: AsyncSession, auth_client: AuthClient, tomato: Crop
) -> None:
    harvest = await factories.create_harvest(db, await user(db, "farmer"), tomato)
    offer = await factories.create_offer(db, await user(db, "buyer"), harvest=harvest)
    response = await auth_client(await user(db, "farmer")).post(
        f"{API}/offers/{offer.id}/counter-suggestion"
    )
    assert response.status_code == 404


@pytest.mark.parametrize("role", ["buyer", "transporter"])
async def test_counter_suggestion_wrong_role(
    db: AsyncSession, auth_client: AuthClient, tomato: Crop, role: str
) -> None:
    harvest = await factories.create_harvest(db, await user(db, "farmer"), tomato)
    buyer = await user(db, "buyer")
    offer = await factories.create_offer(db, buyer, harvest=harvest)
    actor = buyer if role == "buyer" else await user(db, role)
    response = await auth_client(actor).post(f"{API}/offers/{offer.id}/counter-suggestion")
    assert response.status_code == 403


async def test_counter_suggestion_for_lot_offers(
    db: AsyncSession, auth_client: AuthClient, tomato: Crop
) -> None:
    coordinator = await user(db, "coordinator")
    farmer_a, farmer_b, outsider = (
        await user(db, "farmer"),
        await user(db, "farmer"),
        await user(db, "farmer"),
    )
    harvest_a = await factories.create_harvest(db, farmer_a, tomato, min_price_per_kg=Decimal("15"))
    harvest_b = await factories.create_harvest(db, farmer_b, tomato)
    lot = await factories.create_lot(db, tomato, [harvest_a, harvest_b], coordinator=coordinator)
    offer = await factories.create_offer(
        db,
        await user(db, "buyer"),
        lot=lot,
        price_per_kg=Decimal("12"),
        pickup_terms="buyer_pickup",
    )
    url = f"{API}/offers/{offer.id}/counter-suggestion"

    whole = await auth_client(coordinator).post(url)
    member = await auth_client(coordinator).post(url, params={"harvest_id": str(harvest_b.id)})
    own = await auth_client(farmer_a).post(url)
    own_explicit = await auth_client(farmer_a).post(url, params={"harvest_id": str(harvest_a.id)})
    someone_elses = await auth_client(farmer_a).post(url, params={"harvest_id": str(harvest_b.id)})
    not_member = await auth_client(outsider).post(url)
    unknown_member = await auth_client(coordinator).post(
        url, params={"harvest_id": str(uuid.uuid4())}
    )

    assert whole.status_code == 200 and whole.json()["floor_price_per_kg"] is not None
    assert member.status_code == 200 and member.json()["floor_price_per_kg"] is None
    assert own.status_code == 200
    assert own.json() == own_explicit.json()
    assert own.json()["floor_price_per_kg"] == whole.json()["floor_price_per_kg"]
    assert someone_elses.status_code == 404
    assert not_member.status_code == 404
    assert unknown_member.status_code == 404


async def test_counter_suggestion_on_closed_offer_is_a_conflict(
    db: AsyncSession, auth_client: AuthClient, tomato: Crop
) -> None:
    farmer = await user(db, "farmer")
    harvest = await factories.create_harvest(db, farmer, tomato)
    offer = await factories.create_offer(
        db, await user(db, "buyer"), harvest=harvest, status="rejected", awaiting=None
    )
    response = await auth_client(farmer).post(f"{API}/offers/{offer.id}/counter-suggestion")
    assert response.status_code == 409


async def test_counter_suggestion_unknown_offer(db: AsyncSession, auth_client: AuthClient) -> None:
    client = auth_client(await user(db, "coordinator"))
    missing = await client.post(f"{API}/offers/{uuid.uuid4()}/counter-suggestion")
    malformed = await client.post(f"{API}/offers/not-a-uuid/counter-suggestion")
    assert missing.status_code == 404
    assert malformed.status_code == 422


# ─────────────────────────────── Match explanation ───────────────────────────────


async def test_match_explanation_for_coordinator(
    db: AsyncSession, auth_client: AuthClient, tomato: Crop
) -> None:
    body = {"proposal": proposal(tomato).model_dump(mode="json")}
    response = await auth_client(await user(db, "coordinator")).post(
        f"{API}/match-explanation", json=body
    )
    assert response.status_code == 200, response.text
    text = response.json()
    assert text["source"] == "rules"
    assert text["model"] is None
    assert text["text"].startswith("2 compatible harvests can supply 700 kg of grade A tomato")
    assert text["disclaimer"]
    assert text["generated_at"]


@pytest.mark.parametrize("role", ["farmer", "buyer", "transporter"])
async def test_match_explanation_wrong_role(
    db: AsyncSession, auth_client: AuthClient, tomato: Crop, role: str
) -> None:
    body = {"proposal": proposal(tomato).model_dump(mode="json")}
    response = await auth_client(await user(db, role)).post(f"{API}/match-explanation", json=body)
    assert response.status_code == 403


async def test_match_explanation_validation(db: AsyncSession, auth_client: AuthClient) -> None:
    client = auth_client(await user(db, "coordinator"))
    response = await client.post(f"{API}/match-explanation", json={"proposal": {"crop_id": "x"}})
    assert response.status_code == 422
