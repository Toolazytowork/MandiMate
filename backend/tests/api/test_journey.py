"""The 8-step journey: lot and harvest timelines across statuses (DOMAIN_RULES §7)."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import today_ist, utcnow
from app.models import Delivery, Lot, Settlement, TransportRequest, TransportStop
from tests import factories
from tests.api.test_lots import API, create_lot_via_api, make_cluster, offer_body, open_lot_with_all

KEYS = ["listed", "grouped", "offers", "compared", "consent", "transport", "delivered", "settled"]


def statuses(steps: list[dict]) -> list[str]:
    return [step["status"] for step in steps]


async def timeline(client: Any, lot_id: str) -> list[dict]:
    response = await client.get(f"{API}/lots/{lot_id}/timeline")
    assert response.status_code == 200, response.text
    steps = response.json()
    assert [step["key"] for step in steps] == KEYS
    assert [step["step"] for step in steps] == list(range(1, 9))
    return steps


async def test_lot_journey_through_negotiation(db: AsyncSession, auth_client: Any) -> None:
    cluster = await make_cluster(db, (200, 300))
    coordinator = auth_client(cluster.coordinator)
    buyer = auth_client(cluster.buyer)

    forming = await create_lot_via_api(coordinator, cluster, [], target_quantity_kg=500)
    steps = await timeline(coordinator, forming["id"])
    assert statuses(steps) == ["complete", "current"] + ["upcoming"] * 6
    assert steps[0]["at"] is not None
    assert steps[1]["detail"] == "Waiting for farmers to join"

    lot = await open_lot_with_all(auth_client, cluster)
    steps = await timeline(coordinator, lot["id"])
    assert statuses(steps)[:3] == ["complete", "complete", "current"]
    assert steps[1]["detail"] == "2 farmers · 500 kg"
    assert steps[1]["at"] is not None

    offer = (
        await buyer.post(f"{API}/offers", json=offer_body(lot_id=lot["id"], quantity=500))
    ).json()
    await buyer.post(
        f"{API}/offers",
        json=offer_body(lot_id=lot["id"], quantity=400, price_per_kg=15.5) | {"notes": "second"},
    )  # duplicate per buyer → rejected with 409, journey unchanged
    steps = await timeline(coordinator, lot["id"])
    assert statuses(steps)[:4] == ["complete", "complete", "complete", "current"]
    assert steps[2]["detail"] == "1 offer · best ₹16.00/kg"

    await coordinator.post(f"{API}/offers/{offer['id']}/counter", json={"price_per_kg": 16.5})
    steps = await timeline(coordinator, lot["id"])
    assert steps[3]["status"] == "complete"
    assert steps[3]["detail"] == "Countered at ₹16.50/kg"
    assert steps[4]["status"] == "current"

    await buyer.post(f"{API}/offers/{offer['id']}/accept", json={})
    steps = await timeline(coordinator, lot["id"])
    assert steps[4]["status"] == "current"
    assert steps[4]["detail"] == "0 of 2 farmers consented"

    for farmer in cluster.farmers:
        await auth_client(farmer).post(
            f"{API}/offers/{offer['id']}/consent", json={"decision": "accepted"}
        )
    steps = await timeline(auth_client(cluster.farmers[0]), lot["id"])
    assert statuses(steps)[:6] == ["complete"] * 5 + ["current"]
    assert steps[4]["detail"] == "Accepted FreshBasket Retail Pvt Ltd at ₹16.50/kg"
    assert steps[4]["at"] is not None
    pickup = today_ist() + timedelta(days=2)
    assert steps[5]["detail"] == f"Pickup {pickup.day} {pickup.strftime('%b')}"
    lot_view = (await coordinator.get(f"{API}/lots/{lot['id']}")).json()
    assert lot_view["journey_step"] == 6

    # Buyers who did not take part cannot see the lot's timeline.
    outsider = await factories.create_user(db, "buyer")
    assert (await auth_client(outsider).get(f"{API}/lots/{lot['id']}/timeline")).status_code == 404


async def test_buyer_pickup_skips_transport_and_delivery_settlement_complete(
    db: AsyncSession, auth_client: Any
) -> None:
    cluster = await make_cluster(db, (300,))
    harvest = cluster.harvests[0]
    offer = (
        await auth_client(cluster.buyer).post(
            f"{API}/offers",
            json=offer_body(harvest_id=harvest.id, quantity=300, pickup_terms="buyer_pickup"),
        )
    ).json()
    accepted = (
        await auth_client(cluster.farmers[0]).post(f"{API}/offers/{offer['id']}/accept", json={})
    ).json()
    lot_id = accepted["lot_id"]
    coordinator = auth_client(cluster.coordinator)

    steps = await timeline(coordinator, lot_id)
    assert statuses(steps) == ["complete"] * 5 + ["skipped", "current", "upcoming"]
    assert steps[1]["detail"] == "Direct sale · 300 kg"
    assert (await coordinator.get(f"{API}/lots/{lot_id}")).json()["journey_step"] == 7

    lot = await db.get(Lot, lot_id)
    await db.refresh(lot)
    db.add(Delivery(lot_id=lot.id, recorded_by_id=cluster.coordinator.id, recorded_at=utcnow()))
    lot.status = "delivered"
    lot.delivered_at = utcnow()
    await db.commit()
    steps = await timeline(coordinator, lot_id)
    assert statuses(steps)[6:] == ["complete", "current"]

    db.add(
        Settlement(
            code="ST-00001",
            lot_id=lot.id,
            offer_id=offer["id"],
            buyer_id=cluster.buyer.id,
            price_per_kg=Decimal(16),
            total_accepted_kg=Decimal(300),
            gross_amount=Decimal(4800),
            transport_cost=Decimal(0),
            handling_cost=Decimal(75),
            commission_amount=Decimal(0),
            net_to_farmers=Decimal(4725),
            amount_paid=Decimal(4800),
            payment_status="paid",
            due_date=today_ist() + timedelta(days=7),
            paid_at=utcnow(),
        )
    )
    lot.status = "settled"
    lot.settled_at = utcnow()
    await db.commit()
    steps = await timeline(coordinator, lot_id)
    assert statuses(steps) == ["complete"] * 5 + ["skipped", "complete", "complete"]
    assert steps[7]["detail"] == "₹4,800.00 settled"
    lot_view = (await coordinator.get(f"{API}/lots/{lot_id}")).json()
    assert lot_view["journey_step"] == 8
    assert lot_view["settlement_id"] is not None


async def test_first_pickup_completes_transport(db: AsyncSession, auth_client: Any) -> None:
    cluster = await make_cluster(db, (300,))
    lot = await factories.create_lot(
        db, cluster.crop, cluster.harvests, coordinator=cluster.coordinator, status="in_transit"
    )
    offer = await factories.create_offer(
        db, cluster.buyer, lot=lot, status="accepted", accepted_at=utcnow(), awaiting=None
    )
    lot.accepted_offer_id = offer.id
    lot.pickup_terms = "mandimate_delivery"
    request = TransportRequest(
        lot_id=lot.id,
        total_quantity_kg=Decimal(300),
        pickup_date=lot.pickup_date,
        destination_name="Bengaluru",
        destination_latitude=12.95,
        destination_longitude=77.57,
        estimated_distance_km=Decimal(150),
        suggested_vehicle_type="mini_truck",
        estimated_cost=Decimal(3300),
        status="in_progress",
    )
    db.add(request)
    await db.flush()
    picked_at = utcnow()
    db.add(
        TransportStop(
            request_id=request.id,
            member_id=lot.members[0].id,
            sequence=1,
            latitude=13.6,
            longitude=78.5,
            quantity_kg=Decimal(300),
            status="picked_up",
            picked_kg=Decimal(298),
            picked_up_at=picked_at,
        )
    )
    await db.commit()

    steps = await timeline(auth_client(cluster.coordinator), str(lot.id))
    assert statuses(steps)[5:] == ["complete", "current", "upcoming"]
    assert steps[5]["detail"] == f"Picked up {picked_at.day} {picked_at.strftime('%b')}"
    assert steps[5]["at"] is not None


async def test_harvest_timeline(db: AsyncSession, auth_client: Any) -> None:
    cluster = await make_cluster(db, (400, 300))
    harvest = cluster.harvests[0]
    farmer = auth_client(cluster.farmers[0])

    response = await farmer.get(f"{API}/harvests/{harvest.id}/timeline")
    assert response.status_code == 200
    steps = response.json()
    assert statuses(steps) == ["complete", "current"] + ["upcoming"] * 6
    assert steps[0]["detail"] == "400 kg tomato listed"

    lot = await open_lot_with_all(auth_client, cluster)
    steps = (await farmer.get(f"{API}/harvests/{harvest.id}/timeline")).json()
    assert statuses(steps)[:3] == ["complete", "complete", "current"]
    assert steps[0]["detail"] == "400 kg tomato listed"
    assert steps[1]["detail"] == "2 farmers · 700 kg"
    assert lot["journey_step"] == 3

    assert (
        await auth_client(cluster.coordinator).get(f"{API}/harvests/{harvest.id}/timeline")
    ).status_code == 200
    assert (
        await auth_client(cluster.buyer).get(f"{API}/harvests/{harvest.id}/timeline")
    ).status_code == 403
    assert (
        await auth_client(cluster.farmers[1]).get(f"{API}/harvests/{harvest.id}/timeline")
    ).status_code == 404
