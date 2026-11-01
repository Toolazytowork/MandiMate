"""Delivery & quality check, settlement maths, payments and payouts (DOMAIN_RULES §6)."""

from __future__ import annotations

import uuid
from datetime import timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import today_ist, utcnow
from app.models import AuditLog, Demand, Harvest, Lot, LotMember, Settlement
from tests import factories
from tests.api.test_transport import Deal, book_transport, make_deal, notifications_for


def items_for(deal: Deal, *rows: tuple[float, float]) -> list[dict[str, Any]]:
    """Delivery items in member order: ``(delivered_kg, accepted_kg)`` per member."""
    return [
        {"member_id": str(member.id), "delivered_kg": delivered, "accepted_kg": accepted}
        for member, (delivered, accepted) in zip(deal.members, rows, strict=True)
    ]


async def deliver(
    auth_client: Any, deal: Deal, *rows: tuple[float, float], user: Any = None
) -> dict[str, Any]:
    response = await auth_client(user or deal.buyer).post(
        f"/api/v1/lots/{deal.lot.id}/delivery",
        json={"items": items_for(deal, *rows), "inspector_name": "K. Prasad"},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def settlement_of(auth_client: Any, deal: Deal, user: Any = None) -> dict[str, Any]:
    response = await auth_client(user or deal.coordinator).get("/api/v1/settlements")
    assert response.status_code == 200, response.text
    matches = [s for s in response.json() if s["lot_id"] == str(deal.lot.id)]
    assert len(matches) == 1
    return matches[0]


# ───────────────────────────────── Delivery ─────────────────────────────────


async def test_buyer_pickup_delivery_creates_settlement(db: AsyncSession, auth_client: Any) -> None:
    deal = await make_deal(db, pickup_terms="buyer_pickup", with_demand=True)
    first, second = deal.members
    record = await deliver(auth_client, deal, (400, 380), (600, 600))

    assert record["lot_code"] == deal.lot.code and record["inspector_name"] == "K. Prasad"
    assert record["recorded_by_name"] == deal.buyer.full_name
    assert record["total_dispatched_kg"] == 1000 and record["total_delivered_kg"] == 1000
    assert record["total_accepted_kg"] == 980 and record["total_rejected_kg"] == 20
    assert record["total_shortage_kg"] == 0 and record["settlement_id"] is not None
    item = next(i for i in record["items"] if i["member_id"] == str(first.id))
    assert item == item | {
        "dispatched_kg": 400,
        "delivered_kg": 400,
        "accepted_kg": 380,
        "rejected_kg": 20,
    }
    assert item["farmer_name"].endswith(".")  # the buyer sees masked names

    await db.refresh(deal.lot)
    assert deal.lot.status == "delivered" and deal.lot.delivered_at is not None
    for harvest in deal.harvests:
        await db.refresh(harvest)
        assert harvest.status == "delivered"

    s = await settlement_of(auth_client, deal)
    assert s["code"] == "ST-00001" and s["payment_status"] == "pending"
    assert s["buyer_name"] == "FreshBasket Retail Pvt Ltd" and s["crop_name"] == "Tomato"
    assert s["price_per_kg"] == 16 and s["total_accepted_kg"] == 980
    assert (s["gross_amount"], s["transport_cost"], s["handling_cost"], s["commission_amount"]) == (
        15680.0,
        0.0,
        250.0,
        0.0,
    )
    assert s["net_to_farmers"] == 15430.0 and s["amount_paid"] == 0
    assert s["due_date"] == (today_ist() + timedelta(days=7)).isoformat()
    payouts = {p["farmer_id"]: p for p in s["payouts"]}
    one = payouts[str(first.farmer_id)]
    assert (one["gross_amount"], one["transport_share"], one["handling_share"]) == (
        6080.0,
        0.0,
        100.0,
    )
    assert (
        one["net_amount"],
        one["net_per_kg"],
        one["baseline_net_per_kg"],
        one["uplift_per_kg"],
    ) == (
        5980.0,
        14.95,
        9.1,
        5.85,
    )
    two = payouts[str(second.farmer_id)]
    assert (
        two["net_amount"],
        two["net_per_kg"],
        two["baseline_net_per_kg"],
        two["uplift_per_kg"],
    ) == (
        9450.0,
        15.75,
        9.98,
        5.77,
    )

    # Notifications: every member farmer, coordinators and the buyer.
    for farmer in deal.farmers:
        assert any(n.type == "delivery" for n in await notifications_for(db, farmer))
    assert any(
        n.title.startswith("Delivery recorded") for n in await notifications_for(db, deal.buyer)
    )
    assert any(
        n.title.startswith("Delivery recorded")
        for n in await notifications_for(db, deal.coordinator)
    )
    actions = set(await db.scalars(select(AuditLog.action)))
    assert {"delivery.record", "settlement.create"} <= actions

    # Participants read the record; full names for the coordinator.
    as_coordinator = await auth_client(deal.coordinator).get(f"/api/v1/lots/{deal.lot.id}/delivery")
    assert as_coordinator.status_code == 200
    assert {i["farmer_name"] for i in as_coordinator.json()["items"]} == {
        f.full_name for f in deal.farmers
    }
    assert (
        await auth_client(deal.farmers[0]).get(f"/api/v1/lots/{deal.lot.id}/delivery")
    ).status_code == 200


async def test_delivery_validation(db: AsyncSession, auth_client: Any) -> None:
    deal = await make_deal(db, pickup_terms="buyer_pickup")
    client = auth_client(deal.coordinator)
    url = f"/api/v1/lots/{deal.lot.id}/delivery"
    first, _ = deal.members

    missing = await client.post(
        url, json={"items": [{"member_id": str(first.id), "delivered_kg": 400, "accepted_kg": 400}]}
    )
    assert missing.status_code == 422
    unknown = [
        *items_for(deal, (400, 400), (600, 600)),
        {"member_id": str(uuid.uuid4()), "delivered_kg": 1, "accepted_kg": 1},
    ]
    assert (await client.post(url, json={"items": unknown})).status_code == 422
    too_much = await client.post(url, json={"items": items_for(deal, (408.01, 400), (600, 600))})
    assert too_much.status_code == 422
    accepted_above = await client.post(url, json={"items": items_for(deal, (400, 401), (600, 600))})
    assert accepted_above.status_code == 422
    duplicate = items_for(deal, (400, 400), (600, 600))
    duplicate[1]["member_id"] = duplicate[0]["member_id"]
    assert (await client.post(url, json={"items": duplicate})).status_code == 422
    assert (await client.post(url, json={"items": []})).status_code == 422

    # 2% over the dispatched weight is accepted (scale differences).
    ok = await client.post(url, json={"items": items_for(deal, (408, 400), (600, 590))})
    assert ok.status_code == 201, ok.text
    assert ok.json()["total_shortage_kg"] == 0


async def test_delivery_permissions_and_state(db: AsyncSession, auth_client: Any) -> None:
    deal = await make_deal(db, pickup_terms="buyer_pickup")
    url = f"/api/v1/lots/{deal.lot.id}/delivery"
    body = {"items": items_for(deal, (400, 400), (600, 600))}

    assert (await auth_client(deal.buyer).get(url)).status_code == 404  # not recorded yet
    assert (await auth_client(deal.farmers[0]).post(url, json=body)).status_code == 403
    stranger = await factories.create_user(db, "buyer")
    assert (await auth_client(stranger).post(url, json=body)).status_code == 404
    transporter = await factories.create_user(db, "transporter")
    assert (await auth_client(transporter).post(url, json=body)).status_code == 404
    assert (await auth_client(deal.buyer).post(url, json=body)).status_code == 201
    assert (await auth_client(deal.coordinator).post(url, json=body)).status_code == 409

    # mandimate_delivery lots need transport booked (or in transit) first.
    mandimate = await make_deal(db, crop=deal.crop, coordinator=deal.coordinator)
    response = await auth_client(mandimate.coordinator).post(
        f"/api/v1/lots/{mandimate.lot.id}/delivery",
        json={"items": items_for(mandimate, (400, 400), (600, 600))},
    )
    assert response.status_code == 409
    open_lot = await make_deal(
        db, crop=deal.crop, coordinator=deal.coordinator, lot_status="open_for_offers"
    )
    response = await auth_client(open_lot.coordinator).post(
        f"/api/v1/lots/{open_lot.lot.id}/delivery",
        json={"items": items_for(open_lot, (400, 400), (600, 600))},
    )
    assert response.status_code == 409


async def test_delivery_after_trip_uses_picked_weights(db: AsyncSession, auth_client: Any) -> None:
    deal = await make_deal(db)
    booked = await book_transport(db, auth_client, deal, price_total=3000)
    driver = auth_client(deal.transporters[0])
    stops = {stop["member_id"]: stop for stop in booked["stops"]}
    first, second = deal.members
    await driver.post(
        f"/api/v1/transport-requests/{booked['id']}/stops/{stops[str(first.id)]['id']}/pickup",
        json={"picked_kg": 390},
    )
    # The trip is in transit with one stop still pending: delivery may already be recorded.
    too_heavy = await auth_client(deal.buyer).post(
        f"/api/v1/lots/{deal.lot.id}/delivery",
        json={"items": items_for(deal, (397.81, 390), (600, 600))},
    )
    assert too_heavy.status_code == 422
    record = await deliver(auth_client, deal, (385, 380), (600, 590))
    items = {item["member_id"]: item for item in record["items"]}
    assert items[str(first.id)]["dispatched_kg"] == 390 and items[str(first.id)]["shortage_kg"] == 5
    assert items[str(second.id)]["dispatched_kg"] == 600
    # Once delivered, the trip can still be closed but no longer changes the weights.
    pending_stop = stops[str(second.id)]["id"]
    late = await driver.post(
        f"/api/v1/transport-requests/{booked['id']}/stops/{pending_stop}/pickup",
        json={"picked_kg": 10},
    )
    assert late.status_code == 409
    closed = await driver.post(f"/api/v1/transport-requests/{booked['id']}/complete")
    assert closed.status_code == 200
    statuses = {stop["member_id"]: stop["status"] for stop in closed.json()["stops"]}
    assert statuses == {str(first.id): "picked_up", str(second.id): "skipped"}
    second_member = await db.get(LotMember, second.id, populate_existing=True)
    assert second_member is not None and second_member.dispatched_kg == Decimal(600)

    s = await settlement_of(auth_client, deal)
    shares = {p["farmer_id"]: p["transport_share"] for p in s["payouts"]}
    # 3000 × 390 / 990 = 1181.818… and 3000 × 600 / 990 = 1818.181… → shares sum to the quote.
    assert shares == {str(first.farmer_id): 1181.82, str(second.farmer_id): 1818.18}
    assert s["transport_cost"] == 3000.0


# ─────────────────────────────── Settlements ───────────────────────────────


async def test_settlement_visibility(db: AsyncSession, auth_client: Any) -> None:
    deal = await make_deal(db, pickup_terms="buyer_pickup")
    record = await deliver(auth_client, deal, (400, 400), (600, 600))
    settlement_id = record["settlement_id"]
    url = f"/api/v1/settlements/{settlement_id}"

    as_farmer = await auth_client(deal.farmers[0]).get(url)
    assert as_farmer.status_code == 200
    assert [p["farmer_id"] for p in as_farmer.json()["payouts"]] == [str(deal.farmers[0].id)]
    assert as_farmer.json()["payouts"][0]["farmer_name"] == deal.farmers[0].full_name
    as_buyer = await auth_client(deal.buyer).get(url)
    assert len(as_buyer.json()["payouts"]) == 2
    assert all(p["farmer_name"].endswith(".") for p in as_buyer.json()["payouts"])

    outsider_farmer = await factories.create_user(db, "farmer")
    other_buyer = await factories.create_user(db, "buyer")
    transporter = await factories.create_user(db, "transporter")
    assert (await auth_client(outsider_farmer).get(url)).status_code == 404
    assert (await auth_client(other_buyer).get(url)).status_code == 404
    assert (await auth_client(transporter).get(url)).status_code == 403
    assert (await auth_client(transporter).get("/api/v1/settlements")).status_code == 403
    assert (await auth_client(outsider_farmer).get("/api/v1/settlements")).json() == []
    assert len((await auth_client(deal.farmers[1]).get("/api/v1/settlements")).json()) == 1
    assert (
        await auth_client(deal.coordinator).get(f"/api/v1/settlements/{uuid.uuid4()}")
    ).status_code == 404
    pending = await auth_client(deal.coordinator).get("/api/v1/settlements?payment_status=pending")
    assert [s["id"] for s in pending.json()] == [settlement_id]
    paid = await auth_client(deal.coordinator).get("/api/v1/settlements?payment_status=paid")
    assert paid.json() == []
    assert (
        await auth_client(deal.coordinator).get("/api/v1/settlements?payment_status=late")
    ).status_code == 422


async def test_payments_and_payouts(db: AsyncSession, auth_client: Any) -> None:
    deal = await make_deal(db, pickup_terms="buyer_pickup", with_demand=True)
    record = await deliver(auth_client, deal, (400, 400), (600, 600))
    settlement_id = record["settlement_id"]
    url = f"/api/v1/settlements/{settlement_id}"
    buyer = auth_client(deal.buyer)
    coordinator = auth_client(deal.coordinator)
    s = (await coordinator.get(url)).json()
    assert s["gross_amount"] == 16000.0
    payout_ids = [p["id"] for p in s["payouts"]]

    assert (
        await coordinator.post(f"{url}/payouts/{payout_ids[0]}/mark-paid", json={})
    ).status_code == 409
    assert (
        await auth_client(deal.farmers[0]).post(f"{url}/payments", json={"amount": 10})
    ).status_code == 403
    other_buyer = await factories.create_user(db, "buyer")
    assert (
        await auth_client(other_buyer).post(f"{url}/payments", json={"amount": 10})
    ).status_code == 404
    assert (await buyer.post(f"{url}/payments", json={"amount": 0})).status_code == 422
    assert (await buyer.post(f"{url}/payments", json={"amount": 16000.02})).status_code == 422
    future = (utcnow() + timedelta(days=2)).isoformat()
    assert (
        await buyer.post(f"{url}/payments", json={"amount": 10, "paid_at": future})
    ).status_code == 422

    partial = await buyer.post(f"{url}/payments", json={"amount": 6000, "reference": "UTR123"})
    assert partial.status_code == 200, partial.text
    assert (
        partial.json()["payment_status"] == "partially_paid"
        and partial.json()["amount_paid"] == 6000
    )
    assert partial.json()["payments"][0]["recorded_by_name"] == deal.buyer.full_name
    assert any(n.type == "payment" for n in await notifications_for(db, deal.coordinator))

    full = await coordinator.post(f"{url}/payments", json={"amount": 10000.01})
    assert full.status_code == 200
    assert full.json()["payment_status"] == "paid" and full.json()["paid_at"] is not None
    assert (await buyer.post(f"{url}/payments", json={"amount": 1})).status_code == 409

    assert (
        await buyer.post(f"{url}/payouts/{payout_ids[0]}/mark-paid", json={})
    ).status_code == 403
    assert (
        await coordinator.post(f"{url}/payouts/{uuid.uuid4()}/mark-paid", json={})
    ).status_code == 404
    first = await coordinator.post(
        f"{url}/payouts/{payout_ids[0]}/mark-paid", json={"reference": "NEFT-1"}
    )
    assert first.status_code == 200
    paid = next(p for p in first.json()["payouts"] if p["id"] == payout_ids[0])
    assert paid["status"] == "paid" and paid["reference"] == "NEFT-1" and paid["paid_at"]
    assert (
        await coordinator.post(f"{url}/payouts/{payout_ids[0]}/mark-paid", json={})
    ).status_code == 409
    await db.refresh(deal.lot)
    assert deal.lot.status == "delivered"

    last = await coordinator.post(f"{url}/payouts/{payout_ids[1]}/mark-paid")
    assert last.status_code == 200
    await db.refresh(deal.lot)
    assert deal.lot.status == "settled" and deal.lot.settled_at is not None
    for harvest in deal.harvests:
        harvest = await db.get(Harvest, harvest.id, populate_existing=True)
        assert harvest is not None and harvest.status == "settled"
    demand = await db.get(Demand, deal.demand.id, populate_existing=True)  # type: ignore[union-attr]
    assert demand is not None and demand.status == "fulfilled"
    farmer_notes = await notifications_for(db, deal.farmers[0])
    assert any(n.title.startswith("Payment sent") and n.type == "payment" for n in farmer_notes)
    actions = set(await db.scalars(select(AuditLog.action)))
    assert {"settlement.payment", "payout.paid", "lot.settle"} <= actions


async def test_overdue_is_applied_lazily(db: AsyncSession, auth_client: Any) -> None:
    deal = await make_deal(db, pickup_terms="buyer_pickup")
    record = await deliver(auth_client, deal, (400, 400), (600, 600))
    settlement = await db.get(Settlement, uuid.UUID(record["settlement_id"]))
    assert settlement is not None
    settlement.due_date = today_ist() - timedelta(days=3)
    await db.commit()

    coordinator = auth_client(deal.coordinator)
    overdue = await coordinator.get("/api/v1/settlements?payment_status=overdue")
    assert [s["id"] for s in overdue.json()] == [record["settlement_id"]]
    one = await coordinator.get(f"/api/v1/settlements/{record['settlement_id']}")
    assert one.json()["payment_status"] == "overdue"
    partial = await auth_client(deal.buyer).post(
        f"/api/v1/settlements/{record['settlement_id']}/payments", json={"amount": 100}
    )
    assert partial.json()["payment_status"] == "overdue"
    lot = await db.get(Lot, deal.lot.id, populate_existing=True)
    assert lot is not None and lot.status == "delivered"
