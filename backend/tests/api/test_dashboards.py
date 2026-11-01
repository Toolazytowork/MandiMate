"""Role dashboards: shapes, stats, action items and role checks."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app import schemas
from app.core.time import today_ist
from app.models.enums import ROLES
from tests import factories
from tests.api.test_delivery_settlement import deliver
from tests.api.test_transport import book_transport, make_deal


def kinds(dashboard: dict[str, Any]) -> set[str]:
    return {item["kind"] for item in dashboard["action_items"]}


async def test_dashboards_are_role_scoped(db: AsyncSession, client: Any, auth_client: Any) -> None:
    users = {role: await factories.create_user(db, role) for role in ROLES}
    assert (await client.get("/api/v1/dashboard/farmer")).status_code == 401
    for path, allowed in (
        ("farmer", {"farmer"}),
        ("buyer", {"buyer"}),
        ("transporter", {"transporter"}),
        ("coordinator", {"coordinator", "admin"}),
        ("admin", {"admin"}),
    ):
        for role, user in users.items():
            response = await auth_client(user).get(f"/api/v1/dashboard/{path}")
            expected = 200 if role in allowed else 403
            assert response.status_code == expected, (path, role, response.text)


async def test_empty_dashboards_have_contract_shapes(db: AsyncSession, auth_client: Any) -> None:
    for role, model in (
        ("farmer", schemas.FarmerDashboard),
        ("buyer", schemas.BuyerDashboard),
        ("transporter", schemas.TransporterDashboard),
        ("coordinator", schemas.CoordinatorDashboard),
        ("admin", schemas.AdminOverview),
    ):
        user = await factories.create_user(db, role)
        response = await auth_client(user).get(f"/api/v1/dashboard/{role}")
        assert response.status_code == 200, response.text
        model.model_validate(response.json())
    farmer = (
        await auth_client(await factories.create_user(db, "farmer")).get("/api/v1/dashboard/farmer")
    ).json()
    assert farmer["current_harvest"] is None and farmer["selling_options"] is None
    assert farmer["stats"]["avg_uplift_per_kg"] is None and farmer["action_items"] == []


async def test_farmer_dashboard(db: AsyncSession, auth_client: Any) -> None:
    today = today_ist()
    deal = await make_deal(db)  # farmers[0] has a booked pickup below
    await book_transport(db, auth_client, deal)
    farmer = deal.farmers[0]
    soon = await factories.create_harvest(
        db, farmer, deal.crop, quantity_kg=Decimal(300), sell_by=today + timedelta(days=1)
    )
    direct_buyer = await factories.create_user(db, "buyer")
    await factories.create_offer(db, direct_buyer, harvest=soon, price_per_kg=Decimal("17"))
    pooled = await factories.create_harvest(db, farmer, deal.crop, quantity_kg=Decimal(250))
    await factories.create_lot(
        db,
        deal.crop,
        [pooled],
        coordinator=deal.coordinator,
        status="awaiting_consent",
        consent_status="pending",
    )
    sold = await make_deal(
        db,
        quantities=(200,),
        farmers=[farmer],
        crop=deal.crop,
        coordinator=deal.coordinator,
        pickup_terms="buyer_pickup",
    )
    await deliver(auth_client, sold, (200, 200))

    response = await auth_client(farmer).get("/api/v1/dashboard/farmer")
    assert response.status_code == 200, response.text
    dashboard = response.json()
    stats = dashboard["stats"]
    # 16 × 200 − 0.25 × 200 loading = 3150 net, still waiting for the buyer.
    assert stats == stats | {
        "active_harvests": 4,
        "listed_kg": 300.0,
        "open_offers": 1,
        "pending_consents": 1,
        "upcoming_pickups": 1,
        "season_net_earnings": 3150.0,
        "pending_payments": 3150.0,
    }
    assert stats["avg_uplift_per_kg"] is not None
    assert dashboard["current_harvest"]["id"] == str(soon.id)
    assert dashboard["selling_options"]["harvest_id"] == str(soon.id)
    assert kinds(dashboard) == {"consent", "offer", "pickup", "deadline", "payment"}
    links = {item["kind"]: item["link"] for item in dashboard["action_items"]}
    assert links["deadline"] == f"/app/farmer/harvests/{soon.id}"
    assert links["payment"] == "/app/farmer/earnings"
    assert links["pickup"] == f"/app/farmer/lots/{deal.lot.id}"
    assert dashboard["action_items"][0]["priority"] == "high"
    assert dashboard["recent_activity"] and dashboard["recent_activity"][0]["kind"] in {
        "delivery",
        "pickup",
    }


async def test_buyer_dashboard(db: AsyncSession, auth_client: Any) -> None:
    buyer = await factories.create_user(db, "buyer", verification_status="unverified")
    delivered = await make_deal(db, buyer=buyer, pickup_terms="buyer_pickup", with_demand=True)
    await deliver(auth_client, delivered, (400, 400), (600, 500))
    waiting = await make_deal(
        db,
        buyer=buyer,
        crop=delivered.crop,
        coordinator=delivered.coordinator,
        pickup_terms="buyer_pickup",
    )
    await factories.create_demand(db, buyer, delivered.crop)
    open_lot = await make_deal(
        db, crop=delivered.crop, coordinator=delivered.coordinator, lot_status="open_for_offers"
    )
    farmer = await factories.create_user(db, "farmer")
    listed = await factories.create_harvest(db, farmer, delivered.crop, quantity_kg=Decimal(350))
    countered = await factories.create_offer(
        db, buyer, harvest=listed, status="countered", awaiting="buyer", price_per_kg=Decimal("18")
    )

    response = await auth_client(buyer).get("/api/v1/dashboard/buyer")
    assert response.status_code == 200, response.text
    dashboard = response.json()
    assert dashboard["verification_status"] == "unverified"
    stats = dashboard["stats"]
    assert stats == stats | {
        "open_demands": 1,
        "active_offers": 1,
        "orders_in_progress": 1,
        "kg_sourced": 900.0,
        "amount_due": 14400.0,
        "avg_price_per_kg": 16.0,
        "on_time_delivery_pct": 100.0,
    }
    supply = {item["id"]: item for item in dashboard["recommended_supply"]}
    assert str(open_lot.lot.id) in supply and str(listed.id) in supply
    lot_item = supply[str(open_lot.lot.id)]
    assert (
        lot_item["kind"] == "lot"
        and lot_item["member_count"] == 2
        and lot_item["quantity_kg"] == 1000
    )
    assert lot_item["offers_count"] == 1 and lot_item["my_offer_status"] is None
    harvest_item = supply[str(listed.id)]
    assert (
        harvest_item["my_offer_status"] == "countered" and harvest_item["distance_km"] is not None
    )
    assert dashboard["recommended_supply"][0]["kind"] == "lot"
    assert kinds(dashboard) == {"offer", "delivery", "payment", "verification"}
    links = {item["id"]: item["link"] for item in dashboard["action_items"]}
    assert links[f"offer-{countered.id}"] == f"/app/buyer/offers/{countered.id}"
    assert links[f"delivery-{waiting.lot.id}"] == f"/app/buyer/orders/{waiting.lot.id}"
    assert "/app/verification" in links.values()


async def test_transporter_dashboard(db: AsyncSession, auth_client: Any) -> None:
    deal = await make_deal(db)
    booked = await book_transport(db, auth_client, deal)
    other = await make_deal(db, crop=deal.crop, coordinator=deal.coordinator)
    open_req = (
        await auth_client(deal.coordinator).post(
            "/api/v1/transport-requests", json={"lot_id": str(other.lot.id)}
        )
    ).json()
    transporter = deal.transporters[0]
    transporter.verification_status = "pending"
    await db.commit()
    driver = auth_client(transporter)
    first = booked["stops"][0]
    await driver.post(
        f"/api/v1/transport-requests/{booked['id']}/stops/{first['id']}/pickup",
        json={"picked_kg": first["quantity_kg"]},
    )

    dashboard = (await driver.get("/api/v1/dashboard/transporter")).json()
    assert dashboard["verification_status"] == "pending"
    stats = dashboard["stats"]
    assert stats == stats | {
        "open_requests": 1,
        "quotes_submitted": 0,
        "active_trips": 1,
        "completed_trips": 0,
        "kg_moved": first["quantity_kg"],
        "earnings_total": 0.0,
        "avg_utilization_pct": None,
    }
    assert [r["id"] for r in dashboard["open_requests"]] == [open_req["id"]]
    assert [r["id"] for r in dashboard["active_trips"]] == [booked["id"]]
    assert kinds(dashboard) == {"pickup", "quote", "verification"}

    second = booked["stops"][1]
    await driver.post(
        f"/api/v1/transport-requests/{booked['id']}/stops/{second['id']}/pickup",
        json={"picked_kg": second["quantity_kg"]},
    )
    await driver.post(f"/api/v1/transport-requests/{booked['id']}/complete", json={})
    done = (await driver.get("/api/v1/dashboard/transporter")).json()["stats"]
    # 1000 kg moved in a 3,500 kg light truck: 28.57 % utilisation, ₹4,200 earned.
    assert done == done | {
        "active_trips": 0,
        "completed_trips": 1,
        "kg_moved": 1000.0,
        "earnings_total": 4200.0,
        "avg_utilization_pct": 28.57,
    }


async def test_coordinator_dashboard(db: AsyncSession, auth_client: Any) -> None:
    coordinator = await factories.create_user(db, "coordinator")
    crop = await factories.create_crop(db)
    await factories.create_market_price(db, crop)
    kwargs = {"crop": crop, "coordinator": coordinator}
    awaiting = await make_deal(
        db, lot_status="awaiting_consent", consent_status="pending", **kwargs
    )
    open_lot = await make_deal(db, lot_status="open_for_offers", **kwargs)
    needs_transport = await make_deal(db, **kwargs)
    quoted = await make_deal(db, **kwargs)
    paid = await make_deal(db, pickup_terms="buyer_pickup", **kwargs)
    request = (
        await auth_client(coordinator).post(
            "/api/v1/transport-requests", json={"lot_id": str(quoted.lot.id)}
        )
    ).json()
    transporter = await factories.create_user(db, "transporter")
    await auth_client(transporter).post(
        f"/api/v1/transport-requests/{request['id']}/quotes",
        json={"vehicle_type": "pickup", "capacity_kg": 1500, "price_total": 3800, "eta_hours": 5},
    )
    record = await deliver(auth_client, paid, (400, 400), (600, 600))
    await auth_client(paid.buyer).post(
        f"/api/v1/settlements/{record['settlement_id']}/payments", json={"amount": 16000}
    )
    # A dispute on another lot (one on ``paid`` would freeze its payouts).
    await auth_client(needs_transport.farmers[0]).post(
        "/api/v1/disputes",
        json={"lot_id": str(needs_transport.lot.id), "category": "other", "description": "Crates?"},
    )
    await factories.create_user(db, "buyer", verification_status="pending")

    response = await auth_client(coordinator).get("/api/v1/dashboard/coordinator")
    assert response.status_code == 200, response.text
    dashboard = response.json()
    stats = dashboard["stats"]
    assert stats == stats | {
        "farmers": 10,
        "lots_forming": 1,
        "lots_active": 4,
        "offers_pending": 1,
        "deliveries_pending": 0,
        "settlements_pending_amount": 0.0,
        "open_disputes": 1,
    }
    pipeline = dashboard["pipeline"]
    assert [(c["step"], c["key"]) for c in pipeline] == [
        (1, "listed"),
        (2, "grouped"),
        (3, "offers"),
        (4, "compared"),
        (5, "consent"),
        (6, "transport"),
        (7, "delivered"),
        (8, "settled"),
    ]
    placed = {lot["id"]: column["step"] for column in pipeline for lot in column["lots"]}
    assert set(placed) == {
        str(d.lot.id) for d in (awaiting, open_lot, needs_transport, quoted, paid)
    }
    # Accepted, waiting for transport → step 6; buyer pickup delivered, not yet settled → step 8.
    assert placed[str(needs_transport.lot.id)] == 6 and placed[str(paid.lot.id)] == 8
    assert schemas.PilotMetrics.model_validate(dashboard["pilot_metrics"])
    assert kinds(dashboard) == {
        "consent",
        "offer",
        "lot",
        "quote",
        "payment",
        "dispute",
        "verification",
    }
    links = {item["id"]: item["link"] for item in dashboard["action_items"]}
    assert links[f"lot-consent-{awaiting.lot.id}"] == f"/app/coordinator/lots/{awaiting.lot.id}"
    assert links[f"offer-{open_lot.offer.id}"] == f"/app/coordinator/offers/{open_lot.offer.id}"
    assert links[f"transport-{needs_transport.lot.id}"] == "/app/coordinator/transport"
    assert links[f"quotes-{request['id']}"] == "/app/coordinator/transport"
    assert (
        links[f"payouts-{record['settlement_id']}"]
        == "/app/coordinator/settlements/" + record["settlement_id"]
    )


async def test_admin_overview(db: AsyncSession, auth_client: Any) -> None:
    admin = await factories.create_user(db, "admin")
    deal = await make_deal(db, pickup_terms="buyer_pickup")
    await deliver(auth_client, deal, (400, 400), (600, 550))
    await factories.create_user(db, "transporter", verification_status="pending")

    overview = (await auth_client(admin).get("/api/v1/dashboard/admin")).json()
    assert overview["users_by_role"] == {
        "farmer": 2,
        "buyer": 1,
        "transporter": 1,
        "coordinator": 1,
        "admin": 1,
    }
    assert overview["pending_verifications"] == 1
    assert overview["total_kg_traded"] == 950.0 and overview["total_gmv"] == 15200.0
    assert overview["lots_by_status"] == {"delivered": 1}
    assert overview["pilot_metrics"]["rejection_rate_pct"] == 5.0
    # Admins can also open the coordinator dashboard.
    assert (await auth_client(admin).get("/api/v1/dashboard/coordinator")).status_code == 200
