"""End to end: the brief's example deal.

Three farmers with 200, 350 and 500 kg of grade-A tomato are matched into a 1,000 kg lot for a
Bengaluru buyer's demand, consent (one through the coordinator), receive two offers, the
coordinator counters the better one, the buyer accepts the counter, one farmer declines the deal
and it is agreed for the remaining farmers.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import today_ist
from app.models import AuditLog, Demand, Harvest, Notification, Offer
from app.services import pricing
from tests import factories
from tests.api.test_lots import API, COLLECTION, offer_body


async def test_brief_example_deal(db: AsyncSession, auth_client: Any) -> None:
    fpo = await factories.create_fpo(db)
    crop = await factories.create_crop(db)
    await factories.create_market_price(db, crop)
    coordinator_user = await factories.create_user(db, "coordinator", fpo_id=fpo.id)
    farmers = [await factories.create_user(db, "farmer", fpo_id=fpo.id) for _ in range(3)]
    harvests = [
        await factories.create_harvest(db, farmer, crop, quantity_kg=Decimal(quantity))
        for farmer, quantity in zip(farmers, (200, 350, 500), strict=True)
    ]
    fresh_basket = await factories.create_user(db, "buyer")
    metro = await factories.create_user(
        db, "buyer", full_name="Imran Khan", organization_name="Metro Fresh Foods"
    )
    demand = await factories.create_demand(db, fresh_basket, crop)  # 1,000 kg, min 800 kg

    coordinator = auth_client(coordinator_user)
    farmer_clients = [auth_client(farmer) for farmer in farmers]
    buyer_a, buyer_b = auth_client(fresh_basket), auth_client(metro)
    pickup_date = (today_ist() + timedelta(days=2)).isoformat()

    # 1 · Matching: all three harvests are needed to reach the 1,000 kg target.
    proposal = (
        await coordinator.post(
            f"{API}/lots/match-preview",
            json={
                "crop_id": str(crop.id),
                "grade": "A",
                "target_quantity_kg": 1000,
                "collection_latitude": COLLECTION["collection_latitude"],
                "collection_longitude": COLLECTION["collection_longitude"],
                "pickup_date": pickup_date,
                "radius_km": 60,
                "demand_id": str(demand.id),
            },
        )
    ).json()
    assert proposal["selected_total_kg"] == 1000
    assert proposal["feasible"] is True
    selected = [c for c in proposal["candidates"] if c["proposed_kg"] > 0]
    assert {c["harvest_id"] for c in selected} == {str(h.id) for h in harvests}

    # 2 · The coordinator pools them; every farmer is asked to consent.
    created = await coordinator.post(
        f"{API}/lots",
        json={
            "crop_id": str(crop.id),
            "grade": "A",
            "demand_id": str(demand.id),
            "target_quantity_kg": 1000,
            **COLLECTION,
            "district": factories.DISTRICT,
            "state": factories.STATE,
            "pickup_date": pickup_date,
            "members": [
                {"harvest_id": c["harvest_id"], "quantity_kg": c["proposed_kg"]} for c in selected
            ],
            "match_explanation": proposal["explanation"],
        },
    )
    assert created.status_code == 201, created.text
    lot = created.json()
    assert (lot["status"], lot["total_quantity_kg"]) == ("awaiting_consent", 1000)
    member_of = {m["farmer_id"]: m for m in lot["members"]}
    quantity_of = {farmer.id: member_of[str(farmer.id)]["quantity_kg"] for farmer in farmers}

    # 3 · Two farmers consent in the app; the third by phone through the coordinator.
    for farmer, client in zip(farmers[:2], farmer_clients[:2], strict=True):
        response = await client.post(
            f"{API}/lots/{lot['id']}/members/{member_of[str(farmer.id)]['id']}/consent",
            json={"decision": "accepted"},
        )
        assert response.json()["status"] == "awaiting_consent"
    opened = await coordinator.post(
        f"{API}/lots/{lot['id']}/members/{member_of[str(farmers[2].id)]['id']}/consent",
        json={"decision": "accepted", "note": "Consent taken by phone"},
    )
    assert opened.json()["status"] == "open_for_offers"
    for harvest in harvests:
        await db.refresh(harvest)
        assert harvest.status == "pooled"

    # 4 · Two buyers make offers.
    offer_a = (
        await buyer_a.post(
            f"{API}/offers",
            json=offer_body(
                lot_id=lot["id"], quantity=1000, price_per_kg=15.5, demand_id=str(demand.id)
            ),
        )
    ).json()
    offer_b = (
        await buyer_b.post(
            f"{API}/offers", json=offer_body(lot_id=lot["id"], quantity=1000, price_per_kg=15)
        )
    ).json()
    assert offer_a["status"] == offer_b["status"] == "pending"

    # 5 · A farmer compares by net earnings: FreshBasket's offer is best, both beat the mandi.
    options = (await farmer_clients[0].get(f"{API}/harvests/{harvests[0].id}/options")).json()
    assert options["best_option_id"] == offer_a["id"]
    assert [o["source"] for o in options["options"]].count("pooled_offer") == 2
    assert options["uplift_vs_baseline_per_kg"] is not None

    # 6 · The coordinator counters at ₹16.50; the buyer accepts → the farmers must consent.
    countered = await coordinator.post(
        f"{API}/offers/{offer_a['id']}/counter",
        json={"price_per_kg": 16.5, "message": "Grade A, inspected on pickup"},
    )
    assert (countered.json()["status"], countered.json()["awaiting"]) == ("countered", "buyer")
    proposed = (await buyer_a.post(f"{API}/offers/{offer_a['id']}/accept", json={})).json()
    assert (proposed["status"], proposed["awaiting"]) == ("proposed", "farmers")
    assert sorted(c["quantity_kg"] for c in proposed["consents"]) == sorted(quantity_of.values())
    breakdown = (await farmer_clients[1].get(f"{API}/offers/{offer_a['id']}/breakdown")).json()
    assert breakdown["quantity_kg"] == quantity_of[farmers[1].id]
    assert breakdown["gross_price_per_kg"] == 16.5
    assert pricing.UNRESOLVED_FARMER_CONSENT in breakdown["unresolved"]

    # 7 · Farmer 1 declines; farmers 2 and 3 accept → the deal is agreed without farmer 1.
    declined = await farmer_clients[0].post(
        f"{API}/offers/{offer_a['id']}/consent",
        json={"decision": "declined", "note": "Selling to a local trader"},
    )
    assert declined.json()["status"] == "proposed"
    await farmer_clients[1].post(
        f"{API}/offers/{offer_a['id']}/consent", json={"decision": "accepted"}
    )
    final = (
        await farmer_clients[2].post(
            f"{API}/offers/{offer_a['id']}/consent", json={"decision": "accepted"}
        )
    ).json()
    remaining = quantity_of[farmers[1].id] + quantity_of[farmers[2].id]
    assert final["status"] == "accepted"
    assert final["awaiting"] is None
    assert final["price_per_kg"] == 16.5
    assert final["quantity_kg"] == remaining
    assert [e["action"] for e in final["negotiation"]] == [
        "offer",
        "counter",
        "accept",
        "propose",
        "consent",
        "consent",
        "consent",
    ]

    lot_view = (await coordinator.get(f"{API}/lots/{lot['id']}")).json()
    assert lot_view["status"] == "offer_accepted"
    assert lot_view["accepted_offer_id"] == offer_a["id"]
    assert lot_view["buyer_name"] == "FreshBasket Retail Pvt Ltd"
    assert lot_view["price_per_kg"] == 16.5
    assert lot_view["pickup_terms"] == "mandimate_delivery"
    assert lot_view["total_quantity_kg"] == remaining
    assert lot_view["member_count"] == 2
    assert lot_view["journey_step"] == 6
    statuses = {m["farmer_id"]: m["consent_status"] for m in lot_view["members"]}
    assert statuses[str(farmers[0].id)] == "declined"

    # Side effects: the rival offer closes, the demand is matched, harvests follow the lot.
    rival = await db.get(Offer, offer_b["id"])
    await db.refresh(rival)
    assert rival.status == "rejected"
    await db.refresh(demand)
    assert demand.status == "matched"
    expected = {harvests[0].id: "listed", harvests[1].id: "committed", harvests[2].id: "committed"}
    for harvest_id, status in expected.items():
        harvest = await db.get(Harvest, harvest_id)
        await db.refresh(harvest)
        assert harvest.status == status
    assert (await db.scalar(select(Demand.status).where(Demand.id == demand.id))) == "matched"

    deal_notes = (
        await db.scalars(select(Notification).where(Notification.title.like("Deal agreed%")))
    ).all()
    assert {n.user_id for n in deal_notes} == {fresh_basket.id, farmers[1].id, farmers[2].id}
    rejection = (
        await db.scalars(select(Notification).where(Notification.user_id == metro.id))
    ).all()
    assert any("closed" in n.title for n in rejection)
    actions = set((await db.scalars(select(AuditLog.action))).all())
    assert {
        "lot.create",
        "lot.consent",
        "lot.assisted_consent",
        "lot.opened",
        "offer.create",
        "offer.counter",
        "offer.propose",
        "offer.consent",
        "offer.accepted",
    } <= actions

    # The agreed deal is now the farmer's best option, priced at the agreed ₹16.50/kg.
    options = (await farmer_clients[2].get(f"{API}/harvests/{harvests[2].id}/options")).json()
    best = next(o for o in options["options"] if o["is_best"])
    assert best["option_id"] == offer_a["id"]
    assert best["offer_status"] == "accepted"
    assert best["gross_price_per_kg"] == 16.5
    assert best["quantity_kg"] == quantity_of[farmers[2].id]

    timeline = (await farmer_clients[2].get(f"{API}/lots/{lot['id']}/timeline")).json()
    assert [s["status"] for s in timeline][:6] == ["complete"] * 5 + ["current"]
    assert timeline[2]["detail"] == "2 offers · best ₹16.50/kg"
    assert timeline[4]["detail"] == "Accepted FreshBasket Retail Pvt Ltd at ₹16.50/kg"
