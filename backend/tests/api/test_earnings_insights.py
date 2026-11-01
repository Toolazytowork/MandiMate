"""Farmer earnings history and coordinator supply/demand insights."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import timedelta
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app import schemas
from app.ai import service as ai_service
from app.core.time import IST, today_ist, utcnow
from app.services.earnings_service import last_months
from tests import factories
from tests.api.test_delivery_settlement import deliver
from tests.api.test_transport import make_deal

# ───────────────────────────────── Earnings ─────────────────────────────────


async def test_earnings_requires_farmer(db: AsyncSession, auth_client: Any) -> None:
    for role in ("buyer", "transporter", "coordinator", "admin"):
        user = await factories.create_user(db, role)
        assert (await auth_client(user).get("/api/v1/earnings")).status_code == 403


async def test_earnings_without_sales(db: AsyncSession, auth_client: Any) -> None:
    farmer = await factories.create_user(db, "farmer")
    earnings = (await auth_client(farmer).get("/api/v1/earnings")).json()
    assert earnings["sales"] == []
    assert earnings["totals"] == {
        "gross_amount": 0.0,
        "total_deductions": 0.0,
        "net_amount": 0.0,
        "kg_sold": 0.0,
        "avg_net_per_kg": None,
        "avg_uplift_per_kg": None,
        "sales_count": 0,
        "pending_amount": 0.0,
    }
    months = [m["month"] for m in earnings["by_month"]]
    assert months == last_months(today_ist()) and len(months) == 12
    assert months[-1] == utcnow().astimezone(IST).strftime("%Y-%m")
    assert all(m["net_amount"] == 0 for m in earnings["by_month"])


async def test_earnings_totals_months_and_sales(db: AsyncSession, auth_client: Any) -> None:
    first = await make_deal(db, quantities=(400,), pickup_terms="buyer_pickup")
    farmer = first.farmers[0]
    await deliver(auth_client, first, (400, 380))
    second = await make_deal(
        db,
        quantities=(500,),
        farmers=[farmer],
        crop=first.crop,
        coordinator=first.coordinator,
        pickup_terms="buyer_pickup",
        price="18",
        handling="0.5",
        commission="1",
    )
    record = await deliver(auth_client, second, (500, 500))
    url = f"/api/v1/settlements/{record['settlement_id']}"
    paid = await auth_client(second.buyer).post(f"{url}/payments", json={"amount": 9000})
    await auth_client(second.coordinator).post(
        f"{url}/payouts/{paid.json()['payouts'][0]['id']}/mark-paid"
    )

    earnings = (await auth_client(farmer).get("/api/v1/earnings")).json()
    # Sale 1: 16 × 380 = 6080 gross, 0.25 × 400 = 100 loading → 5980 net (14.95/kg vs 9.10 mandi).
    # Sale 2: 18 × 500 = 9000 gross, 0.75 × 500 = 375 handling, 1 % = 90 commission → 8535 net.
    first_sale, second_sale = earnings["sales"][1], earnings["sales"][0]
    assert second_sale["lot_id"] == str(second.lot.id) and second_sale["status"] == "paid"
    assert second_sale["settled_at"] is not None and second_sale["price_per_kg"] == 18
    assert (
        second_sale["handling_share"],
        second_sale["commission_share"],
        second_sale["net_amount"],
    ) == (
        375.0,
        90.0,
        8535.0,
    )
    assert first_sale["status"] == "pending" and first_sale["settled_at"] is None
    assert (
        first_sale["net_amount"],
        first_sale["net_per_kg"],
        first_sale["baseline_net_per_kg"],
    ) == (
        5980.0,
        14.95,
        9.1,
    )
    assert (
        first_sale["buyer_name"] == "FreshBasket Retail Pvt Ltd" and first_sale["rejected_kg"] == 20
    )

    totals = earnings["totals"]
    assert totals == {
        "gross_amount": 15080.0,
        "total_deductions": 565.0,
        "net_amount": 14515.0,
        "kg_sold": 880.0,
        "avg_net_per_kg": 16.13,  # 14515 / 900 dispatched kg
        "avg_uplift_per_kg": totals["avg_uplift_per_kg"],
        "sales_count": 2,
        "pending_amount": 5980.0,
    }
    uplifts = [(s["uplift_per_kg"], 400 if s is first_sale else 500) for s in earnings["sales"]]
    weighted = sum(Decimal(str(u)) * kg for u, kg in uplifts) / 900
    assert totals["avg_uplift_per_kg"] == float(weighted.quantize(Decimal("0.01")))

    this_month = earnings["by_month"][-1]
    baseline = (
        Decimal(str(first_sale["baseline_net_per_kg"])) * 400
        + Decimal(str(second_sale["baseline_net_per_kg"])) * 500
    )
    assert this_month == {
        "month": utcnow().astimezone(IST).strftime("%Y-%m"),
        "gross_amount": 15080.0,
        "net_amount": 14515.0,
        "baseline_net_amount": float(baseline.quantize(Decimal("0.01"))),
        "kg_sold": 880.0,
    }
    other_farmer = await factories.create_user(db, "farmer")
    assert (await auth_client(other_farmer).get("/api/v1/earnings")).json()["sales"] == []


def test_last_months_wraps_years() -> None:
    from datetime import date

    assert last_months(date(2026, 2, 10), 4) == ["2025-11", "2025-12", "2026-01", "2026-02"]


# ───────────────────────────────── Insights ─────────────────────────────────


async def test_insights_require_coordinator(db: AsyncSession, auth_client: Any) -> None:
    for role in ("farmer", "buyer", "transporter"):
        user = await factories.create_user(db, role)
        assert (await auth_client(user).get("/api/v1/insights/supply-demand")).status_code == 403


async def test_supply_demand_insights(
    db: AsyncSession, auth_client: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    today = today_ist()
    coordinator = await factories.create_user(db, "coordinator")
    buyer = await factories.create_user(db, "buyer")
    tomato = await factories.create_crop(db)
    await factories.create_market_price(db, tomato)
    onion = await factories.create_crop(db, code="ONI", name="Onion", name_hi="प्याज", name_te="ఉల్లి")
    chilli = await factories.create_crop(
        db, code="CHL", name="Chilli", name_hi="मिर्च", name_te="మిర్చి"
    )
    farmer = await factories.create_user(db, "farmer")

    t1 = await factories.create_harvest(db, farmer, tomato, quantity_kg=Decimal(400))
    t2 = await factories.create_harvest(
        db, farmer, tomato, quantity_kg=Decimal(600), available_from=today + timedelta(days=3)
    )
    await factories.create_harvest(
        db,
        farmer,
        onion,
        quantity_kg=Decimal(500),
        available_from=today - timedelta(days=2),
        sell_by=today + timedelta(days=3),
    )
    await factories.create_harvest(
        db,
        farmer,
        chilli,
        quantity_kg=Decimal(100),
        available_from=today + timedelta(days=20),
        sell_by=today + timedelta(days=25),
    )
    # Committed elsewhere: does not count as listed supply.
    pooled = await factories.create_harvest(db, farmer, tomato, quantity_kg=Decimal(300))
    await factories.create_lot(
        db, tomato, [pooled], coordinator=coordinator, status="awaiting_consent"
    )
    await factories.create_demand(db, buyer, tomato, quantity_kg=Decimal(1000))
    await factories.create_demand(db, buyer, tomato, quantity_kg=Decimal(800))
    await factories.create_demand(db, buyer, chilli, quantity_kg=Decimal(105))
    await factories.create_demand(db, buyer, onion, quantity_kg=Decimal(900), status="cancelled")
    await factories.create_offer(db, buyer, harvest=t1, price_per_kg=Decimal("16"))
    other_buyer = await factories.create_user(db, "buyer")
    await factories.create_offer(db, other_buyer, harvest=t2, price_per_kg=Decimal("18"))

    seen: list[Sequence[schemas.CropBalance]] = []

    async def fake_summary(db: Any, insights: Any, user: Any) -> schemas.AiText:
        seen.append(insights)
        return schemas.AiText(
            text="Tomato is short.",
            source="rules",
            model=None,
            generated_at=utcnow(),
            disclaimer="Rules.",
        )

    monkeypatch.setattr(ai_service, "summarize_insights", fake_summary)
    response = await auth_client(coordinator).get("/api/v1/insights/supply-demand")
    assert response.status_code == 200, response.text
    insights = response.json()
    by_crop = {row["crop_name"]: row for row in insights["by_crop"]}
    assert list(by_crop) == ["Chilli", "Onion", "Tomato"]
    assert by_crop["Tomato"] == {
        "crop_id": str(tomato.id),
        "crop_name": "Tomato",
        "listed_kg": 1000.0,
        "demanded_kg": 1800.0,
        "gap_kg": 800.0,
        "avg_offer_price_per_kg": 17.2,  # (16 × 400 + 18 × 600) / 1000
        "market_modal_price_per_kg": 14.0,
        "signal": "shortage",
    }
    assert by_crop["Onion"]["signal"] == "surplus" and by_crop["Onion"]["demanded_kg"] == 0
    assert by_crop["Onion"]["market_modal_price_per_kg"] is None
    assert by_crop["Chilli"]["signal"] == "balanced" and by_crop["Chilli"]["gap_kg"] == 5
    assert insights["upcoming_supply"] == [
        {"date": today.isoformat(), "crop_name": "Onion", "quantity_kg": 500.0},
        {
            "date": (today + timedelta(days=1)).isoformat(),
            "crop_name": "Tomato",
            "quantity_kg": 400.0,
        },
        {
            "date": (today + timedelta(days=3)).isoformat(),
            "crop_name": "Tomato",
            "quantity_kg": 600.0,
        },
    ]
    assert insights["summary"]["text"] == "Tomato is short."
    schemas.PilotMetrics.model_validate(insights["pilot_metrics"])
    assert [row.crop_name for row in seen[0]] == ["Chilli", "Onion", "Tomato"]


async def test_insights_summary_from_ai_service(db: AsyncSession, auth_client: Any) -> None:
    """The real (mock-mode) AI service words the summary; no network is used."""
    coordinator = await factories.create_user(db, "coordinator")
    crop = await factories.create_crop(db)
    farmer = await factories.create_user(db, "farmer")
    await factories.create_harvest(db, farmer, crop)
    response = await auth_client(coordinator).get("/api/v1/insights/supply-demand")
    assert response.status_code == 200, response.text
    summary = response.json()["summary"]
    assert summary["source"] == "rules" and summary["text"]
