"""Selling options (GET /harvests/{id}/options) and offer breakdowns, checked against the engine."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import today_ist
from app.models import TransportQuote, TransportRequest
from app.services import pricing, routing
from tests import factories
from tests.api.test_lots import API, Cluster, make_cluster, offer_body, open_lot_with_all

BENGALURU = (
    factories.BENGALURU_BUYER["delivery_latitude"],
    factories.BENGALURU_BUYER["delivery_longitude"],
)


def pooled_transport(cluster: Cluster, shares: list[tuple[int, Decimal]]) -> Decimal:
    """Estimated lot transport for ``(harvest index, kg)`` farms delivered to Bengaluru."""
    stops = [
        routing.RouteStop(
            id=index,
            latitude=cluster.harvests[index].latitude,
            longitude=cluster.harvests[index].longitude,
            quantity_kg=quantity,
            label="",
        )
        for index, quantity in shares
    ]
    plan = routing.plan_route(stops, BENGALURU)
    total = sum((quantity for _, quantity in shares), Decimal(0))
    return pricing.estimate_transport_cost(total, plan.total_distance_km).cost_total


def expected_net(**overrides: Any) -> Any:
    fields: dict[str, Any] = {
        "label": "expected",
        "transport_certainty": "estimated",
        "rejection_pct": Decimal(5),
        "rejection_certainty": "unresolved",
        "handling_per_kg": pricing.LOADING_PER_KG,
        "commission_pct": 0,
        "commission_certainty": "confirmed",
        "payment_terms_days": 7,
    }
    return pricing.compute_net_proceeds(**(fields | overrides))


def amounts(net: dict) -> dict[str, float]:
    return {line["key"]: line["amount"] for line in net["lines"]}


async def test_selling_options_compare_direct_pooled_and_baseline(
    db: AsyncSession, auth_client: Any
) -> None:
    cluster = await make_cluster(db, (400, 300), min_price_per_kg=Decimal("12"))
    market = await factories.create_market_price(db, cluster.crop)
    h0 = cluster.harvests[0]
    buyer = auth_client(cluster.buyer)
    # A direct buyer-pickup offer made while the harvest was listed …
    direct = (
        await buyer.post(
            f"{API}/offers",
            json=offer_body(
                harvest_id=h0.id, quantity=150, price_per_kg=17, pickup_terms="buyer_pickup"
            ),
        )
    ).json()
    # … then 200 kg of it pooled with 300 kg from a neighbour, and a ₹16 offer on the lot.
    lot = await open_lot_with_all(auth_client, cluster, [(h0, 200.0), (cluster.harvests[1], 300.0)])
    pooled = (
        await buyer.post(f"{API}/offers", json=offer_body(lot_id=lot["id"], quantity=500))
    ).json()

    response = await auth_client(cluster.farmers[0]).get(f"{API}/harvests/{h0.id}/options")
    assert response.status_code == 200, response.text
    options = response.json()
    by_id = {option["option_id"]: option for option in options["options"]}
    assert set(by_id) == {direct["id"], pooled["id"], "baseline"}
    assert options["quantity_kg"] == 400
    assert options["min_price_per_kg"] == 12

    direct_expected = expected_net(
        quantity_kg=150,
        price_per_kg=17,
        transport_cost=0,
        transport_certainty="confirmed",
    )
    direct_option = by_id[direct["id"]]
    assert direct_option["source"] == "direct_offer"
    assert direct_option["quantity_kg"] == 150
    assert direct_option["net_amount"] == direct_expected.net_amount
    assert amounts(direct_option)["transport"] == 0
    assert direct_option["unresolved"] == [pricing.UNRESOLVED_QUALITY]
    assert direct_option["confidence"] == "unresolved"
    assert direct_option["buyer_verified"] is True

    lot_transport = pooled_transport(cluster, [(0, Decimal(200)), (1, Decimal(300))])
    pooled_expected = expected_net(
        quantity_kg=200,
        price_per_kg=16,
        transport_cost=lot_transport * 200 / 500,
    )
    pooled_option = by_id[pooled["id"]]
    assert pooled_option["source"] == "pooled_offer"
    assert pooled_option["lot_id"] == lot["id"]
    assert pooled_option["quantity_kg"] == 200
    assert pooled_option["net_amount"] == pooled_expected.net_amount
    assert amounts(pooled_option) == amounts(pooled_expected.model_dump())
    transport_line = next(line for line in pooled_option["lines"] if line["key"] == "transport")
    assert transport_line["certainty"] == "estimated"
    assert "Shared by weight across 2 farmers" in transport_line["note"]
    assert pooled_option["unresolved"] == [
        pricing.UNRESOLVED_TRANSPORT_QUOTE,
        pricing.UNRESOLVED_QUALITY,
    ]

    baseline_expected = pricing.baseline_net_proceeds(
        quantity_kg=Decimal(400),
        market_price_per_kg=market.modal_price_per_kg,
        default_rejection_pct=cluster.crop.default_rejection_pct,
        is_illustrative=True,
        market_name=market.market_name,
    )
    assert baseline_expected is not None
    baseline = by_id["baseline"]
    assert baseline["net_amount"] == baseline_expected.net_amount
    assert baseline["title"] == pricing.BASELINE_LABEL
    assert baseline["is_best"] is False

    nets = [option["net_amount"] for option in options["options"]]
    assert nets == sorted(nets, reverse=True)
    best = max((by_id[direct["id"]], by_id[pooled["id"]]), key=lambda o: o["net_amount"])
    assert options["best_option_id"] == best["option_id"]
    assert [o["option_id"] for o in options["options"] if o["is_best"]] == [best["option_id"]]
    assert options["uplift_vs_baseline_per_kg"] == round(
        best["net_per_kg"] - baseline["net_per_kg"], 2
    )
    for option in options["options"]:
        assert option["meets_min_price"] == (option["net_per_kg"] >= 12)

    # Coordinator may compare too; buyers and other farmers may not.
    assert (
        await auth_client(cluster.coordinator).get(f"{API}/harvests/{h0.id}/options")
    ).status_code == 200
    assert (await buyer.get(f"{API}/harvests/{h0.id}/options")).status_code == 403
    outsider = await factories.create_user(db, "farmer")
    assert (await auth_client(outsider).get(f"{API}/harvests/{h0.id}/options")).status_code == 404


async def test_inspected_grade_a_unverified_buyer_and_counter(
    db: AsyncSession, auth_client: Any
) -> None:
    cluster = await make_cluster(db, (400,), quality_status="inspected")
    unverified = await factories.create_user(
        db, "buyer", verification_status="unverified", organization_name="New Mart"
    )
    harvest = cluster.harvests[0]
    offer = (
        await auth_client(unverified).post(
            f"{API}/offers", json=offer_body(harvest_id=harvest.id, quantity=400)
        )
    ).json()
    await auth_client(cluster.farmers[0]).post(
        f"{API}/offers/{offer['id']}/counter", json={"price_per_kg": 18}
    )

    options = (
        await auth_client(cluster.farmers[0]).get(f"{API}/harvests/{harvest.id}/options")
    ).json()
    assert options["uplift_vs_baseline_per_kg"] is None  # no market price → no baseline
    (option,) = options["options"]
    rejection = next(line for line in option["lines"] if line["key"] == "rejection")
    assert rejection["certainty"] == "estimated"
    assert option["expected_accepted_kg"] == 400 * (1 - 0.025)  # 5% × 0.5 for inspected grade A
    assert option["gross_price_per_kg"] == 18
    assert option["offer_status"] == "countered"
    assert option["awaiting"] == "buyer"
    assert option["buyer_verified"] is False
    assert option["unresolved"] == [
        pricing.UNRESOLVED_TRANSPORT_QUOTE,
        pricing.UNRESOLVED_BUYER_UNVERIFIED,
        pricing.UNRESOLVED_BUYER_RESPONSE,
    ]
    assert option["meets_min_price"] is None


async def test_breakdown_permissions_and_booked_quote(db: AsyncSession, auth_client: Any) -> None:
    cluster = await make_cluster(db, (200, 300), quality_status="inspected")
    lot = await open_lot_with_all(auth_client, cluster)
    offer = (
        await auth_client(cluster.buyer).post(
            f"{API}/offers", json=offer_body(lot_id=lot["id"], quantity=500)
        )
    ).json()
    url = f"{API}/offers/{offer['id']}/breakdown"
    lot_transport = pooled_transport(cluster, [(0, Decimal(200)), (1, Decimal(300))])

    mine = (await auth_client(cluster.farmers[1]).get(url)).json()
    assert mine["quantity_kg"] == 300
    assert mine["net_amount"] == (
        expected_net(
            quantity_kg=300,
            price_per_kg=16,
            transport_cost=lot_transport * 300 / 500,
            rejection_pct=Decimal("2.5"),
            rejection_certainty="estimated",
        ).net_amount
    )
    coordinator = auth_client(cluster.coordinator)
    whole = (await coordinator.get(url)).json()
    assert whole["quantity_kg"] == 500
    assert amounts(whole)["transport"] == -float(lot_transport)
    member = (await coordinator.get(url, params={"harvest_id": str(cluster.harvests[0].id)})).json()
    assert member["quantity_kg"] == 200

    assert (await auth_client(cluster.buyer).get(url)).status_code == 403
    assert (
        await coordinator.get(url, params={"harvest_id": str(cluster.crop.id)})
    ).status_code == 404
    assert (
        await auth_client(cluster.farmers[0]).get(
            url, params={"harvest_id": str(cluster.harvests[1].id)}
        )
    ).status_code == 404
    outsider = await factories.create_user(db, "farmer")
    assert (await auth_client(outsider).get(url)).status_code == 404

    # Once the deal is agreed and a transport quote booked, transport is confirmed.
    await coordinator.post(f"{API}/offers/{offer['id']}/accept", json={})
    for farmer in cluster.farmers:
        await auth_client(farmer).post(
            f"{API}/offers/{offer['id']}/consent", json={"decision": "accepted"}
        )
    transporter = await factories.create_user(db, "transporter")
    request = TransportRequest(
        lot_id=lot["id"],
        total_quantity_kg=Decimal(500),
        pickup_date=today_ist() + timedelta(days=2),
        destination_name="Bengaluru",
        destination_latitude=BENGALURU[0],
        destination_longitude=BENGALURU[1],
        estimated_distance_km=Decimal(150),
        suggested_vehicle_type="mini_truck",
        estimated_cost=Decimal(3300),
        status="booked",
    )
    db.add(request)
    await db.flush()
    quote = TransportQuote(
        request_id=request.id,
        transporter_id=transporter.id,
        vehicle_type="mini_truck",
        capacity_kg=Decimal(750),
        price_total=Decimal(3000),
        price_per_kg=Decimal(6),
        eta_hours=Decimal(5),
        status="accepted",
    )
    db.add(quote)
    await db.flush()
    request.booked_quote_id = quote.id
    await db.commit()

    booked = (await auth_client(cluster.farmers[0]).get(url)).json()
    transport = next(line for line in booked["lines"] if line["key"] == "transport")
    assert transport["certainty"] == "confirmed"
    assert transport["amount"] == -1200.0  # ₹3,000 × 200/500
    assert pricing.UNRESOLVED_TRANSPORT_QUOTE not in booked["unresolved"]
    assert booked["confidence"] == "estimated"

    # The booked transporter sees full farmer names on the lot.
    lot_view = (await auth_client(transporter).get(f"{API}/lots/{lot['id']}")).json()
    names = {m["farmer_name"] for m in lot_view["members"]}
    assert names == {farmer.full_name for farmer in cluster.farmers}
    assert lot_view["transport_request_id"] == str(request.id)


async def test_direct_option_counts_pooled_kg_without_accepted_deal(
    db: AsyncSession, auth_client: Any
) -> None:
    """Direct quantity = min(offer qty, harvest qty − kg in pools with an accepted offer)."""
    cluster = await make_cluster(db, (400, 300))
    h0, h1 = cluster.harvests
    buyer = auth_client(cluster.buyer)
    direct = (
        await buyer.post(f"{API}/offers", json=offer_body(harvest_id=h0.id, quantity=350))
    ).json()
    farmer = auth_client(cluster.farmers[0])

    async def direct_kg() -> float:
        response = await farmer.get(f"{API}/harvests/{h0.id}/options")
        assert response.status_code == 200, response.text
        by_id = {option["option_id"]: option for option in response.json()["options"]}
        return by_id[direct["id"]]["quantity_kg"]

    # 300 kg pooled without a deal still count: compared at the full 350 kg.
    lot = await open_lot_with_all(auth_client, cluster, [(h0, 300.0), (h1, 300.0)])
    assert await direct_kg() == 350
    # Once the pool's deal is accepted, only 400 − 300 = 100 kg remain for a direct sale.
    deal = await buyer.post(f"{API}/offers", json=offer_body(lot_id=lot["id"], quantity=600))
    deal_id = deal.json()["id"]
    coordinator = auth_client(cluster.coordinator)
    assert (await coordinator.post(f"{API}/offers/{deal_id}/accept", json={})).status_code == 200
    for farmer_user in cluster.farmers:
        consent = await auth_client(farmer_user).post(
            f"{API}/offers/{deal_id}/consent", json={"decision": "accepted"}
        )
        assert consent.status_code == 200, consent.text
    assert await direct_kg() == 100
