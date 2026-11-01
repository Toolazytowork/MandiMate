"""Disputes: raising, review, effects on settlement status and payouts, visibility."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog
from tests import factories
from tests.api.test_delivery_settlement import deliver
from tests.api.test_transport import book_transport, make_deal, notifications_for


async def test_dispute_freezes_settlement_until_resolved(
    db: AsyncSession, auth_client: Any
) -> None:
    deal = await make_deal(db, pickup_terms="buyer_pickup")
    record = await deliver(auth_client, deal, (400, 400), (600, 560))
    settlement_url = f"/api/v1/settlements/{record['settlement_id']}"
    coordinator = auth_client(deal.coordinator)
    paid = await auth_client(deal.buyer).post(f"{settlement_url}/payments", json={"amount": 15360})
    assert paid.json()["payment_status"] == "paid"
    payout_ids = [p["id"] for p in paid.json()["payouts"]]

    farmer = auth_client(deal.farmers[1])
    raised = await farmer.post(
        "/api/v1/disputes",
        json={
            "lot_id": str(deal.lot.id),
            "category": "quality",
            "description": "40 kg rejected as soft but the crates were firm at loading.",
        },
    )
    assert raised.status_code == 201, raised.text
    dispute = raised.json()
    assert dispute["code"] == "DP-0001" and dispute["status"] == "open"
    assert dispute["settlement_id"] == record["settlement_id"]
    assert (
        dispute["raised_by_role"] == "farmer"
        and dispute["raised_by_name"] == deal.farmers[1].full_name
    )
    assert dispute["resolution"] is None and dispute["resolved_at"] is None
    assert any(n.type == "dispute" for n in await notifications_for(db, deal.coordinator))

    frozen = (await coordinator.get(settlement_url)).json()
    assert frozen["payment_status"] == "disputed"
    blocked = await coordinator.post(f"{settlement_url}/payouts/{payout_ids[0]}/mark-paid", json={})
    assert blocked.status_code == 409

    review = await coordinator.patch(
        f"/api/v1/disputes/{dispute['id']}", json={"status": "under_review"}
    )
    assert review.status_code == 200 and review.json()["status"] == "under_review"
    assert (await coordinator.get(settlement_url)).json()["payment_status"] == "disputed"

    resolved = await coordinator.patch(
        f"/api/v1/disputes/{dispute['id']}",
        json={"status": "resolved", "resolution": "Buyer re-inspected; rejection stands."},
    )
    assert resolved.status_code == 200
    body = resolved.json()
    assert body["status"] == "resolved" and body["resolved_by_name"] == deal.coordinator.full_name
    assert body["resolution"] == "Buyer re-inspected; rejection stands." and body["resolved_at"]
    assert (await coordinator.get(settlement_url)).json()["payment_status"] == "paid"
    raiser_notes = [n for n in await notifications_for(db, deal.farmers[1]) if n.type == "dispute"]
    assert len(raiser_notes) == 2 and raiser_notes[-1].link == "/app/disputes"
    assert (
        await coordinator.post(f"{settlement_url}/payouts/{payout_ids[0]}/mark-paid", json={})
    ).status_code == 200
    actions = list(
        await db.scalars(select(AuditLog.action).where(AuditLog.action.like("dispute.%")))
    )
    assert sorted(actions) == ["dispute.create", "dispute.update", "dispute.update"]


async def test_dispute_rules_and_permissions(db: AsyncSession, auth_client: Any) -> None:
    deal = await make_deal(db)
    other = await make_deal(
        db, crop=deal.crop, coordinator=deal.coordinator, pickup_terms="buyer_pickup"
    )
    other_record = await deliver(auth_client, other, (400, 400), (600, 600))
    body = {"lot_id": str(deal.lot.id), "category": "transport", "description": "Truck came late."}

    outsider = await factories.create_user(db, "farmer")
    assert (await auth_client(outsider).post("/api/v1/disputes", json=body)).status_code == 404
    bystander = await factories.create_user(db, "buyer")
    await factories.create_offer(db, bystander, lot=deal.lot, status="rejected", awaiting=None)
    assert (await auth_client(bystander).post("/api/v1/disputes", json=body)).status_code == 403
    mismatch = await auth_client(deal.buyer).post(
        "/api/v1/disputes", json=body | {"settlement_id": other_record["settlement_id"]}
    )
    assert mismatch.status_code == 422
    assert (
        await auth_client(deal.buyer).post("/api/v1/disputes", json=body | {"description": " "})
    ).status_code == 422
    assert (
        await auth_client(deal.buyer).post("/api/v1/disputes", json=body | {"category": "price"})
    ).status_code == 422

    # Before delivery there is no settlement to link; the booked transporter is a participant.
    booked = await book_transport(db, auth_client, deal)
    assert booked["status"] == "booked"
    by_transporter = await auth_client(deal.transporters[0]).post("/api/v1/disputes", json=body)
    assert by_transporter.status_code == 201
    dispute = by_transporter.json()
    assert dispute["settlement_id"] is None and dispute["raised_by_role"] == "transporter"

    url = f"/api/v1/disputes/{dispute['id']}"
    assert (
        await auth_client(deal.farmers[0]).patch(url, json={"status": "resolved"})
    ).status_code == 403
    coordinator = auth_client(deal.coordinator)
    assert (
        await coordinator.patch(f"/api/v1/disputes/{uuid.uuid4()}", json={"status": "resolved"})
    ).status_code == 404
    assert (await coordinator.patch(url, json={"status": "open"})).status_code == 422
    rejected = await coordinator.patch(
        url, json={"status": "rejected", "resolution": "Delay was weather."}
    )
    assert rejected.status_code == 200 and rejected.json()["status"] == "rejected"
    assert (await coordinator.patch(url, json={"status": "under_review"})).status_code == 409
    assert (await coordinator.patch(url, json={"status": "rejected"})).status_code == 409


async def test_dispute_listing_scopes(db: AsyncSession, auth_client: Any) -> None:
    deal = await make_deal(db, pickup_terms="buyer_pickup")
    other = await make_deal(
        db, crop=deal.crop, coordinator=deal.coordinator, pickup_terms="buyer_pickup"
    )
    by_farmer = await auth_client(deal.farmers[0]).post(
        "/api/v1/disputes",
        json={
            "lot_id": str(deal.lot.id),
            "category": "payment",
            "description": "Advance not received.",
        },
    )
    by_buyer = await auth_client(other.buyer).post(
        "/api/v1/disputes",
        json={
            "lot_id": str(other.lot.id),
            "category": "quantity",
            "description": "Short by 20 kg.",
        },
    )
    assert by_farmer.status_code == 201 and by_buyer.status_code == 201

    def ids(response: Any) -> list[str]:
        assert response.status_code == 200, response.text
        return [item["id"] for item in response.json()]

    assert ids(await auth_client(deal.coordinator).get("/api/v1/disputes")) == [
        by_buyer.json()["id"],
        by_farmer.json()["id"],
    ]
    assert ids(await auth_client(deal.farmers[0]).get("/api/v1/disputes")) == [
        by_farmer.json()["id"]
    ]
    # Another member of the same lot sees it too; the raiser's name is masked for them.
    fellow = await auth_client(deal.farmers[1]).get("/api/v1/disputes")
    assert ids(fellow) == [by_farmer.json()["id"]]
    assert fellow.json()[0]["raised_by_name"].endswith(".")
    assert ids(await auth_client(deal.buyer).get("/api/v1/disputes")) == [by_farmer.json()["id"]]
    assert ids(await auth_client(other.farmers[0]).get("/api/v1/disputes")) == [
        by_buyer.json()["id"]
    ]
    stranger = await factories.create_user(db, "transporter")
    assert ids(await auth_client(stranger).get("/api/v1/disputes")) == []
    assert ids(await auth_client(deal.coordinator).get("/api/v1/disputes?status=resolved")) == []
    assert (
        await auth_client(deal.coordinator).get("/api/v1/disputes?status=closed")
    ).status_code == 422
