"""End to end operations: accepted lot → transport → delivery → settlement → payouts → metrics.

Two farmers pool 400 kg + 600 kg of grade-A tomato, sold at ₹16/kg with ₹0.50/kg buyer handling
and 2 % commission, paid in 7 days. Every rupee below is asserted to the paisa (DOMAIN_RULES §6):

* Transport: ₹4,200 booked quote shared by dispatched kg (395 + 610 = 1,005 kg):
  4200 × 395/1005 = 1650.746… → ₹1,650.75 and 4200 × 610/1005 = 2549.253… → ₹2,549.25.
* Farmer 1 (dispatched 395, delivered 390, accepted 370): gross 16 × 370 = 5,920.00; handling
  0.50 × 370 + 0.25 × 395 = 283.75; commission 2 % = 118.40; net 3,867.10 → ₹9.79/kg. Mandi baseline
  for 395 kg at ₹14 modal: ₹9.07/kg → uplift ₹0.72/kg.
* Farmer 2 (dispatched 610, delivered 605, accepted 600): gross 9,600.00; handling 300 + 152.50 =
  452.50; commission 192.00; net 6,406.25 → ₹10.50/kg vs ₹10.01 baseline → uplift ₹0.49/kg.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import IST, today_ist, utcnow
from app.models import AuditLog, Demand, Harvest, Lot, Settlement
from tests import factories
from tests.api.test_transport import make_deal, notifications_for


async def test_full_operations_flow(db: AsyncSession, auth_client: Any) -> None:
    listed_at = utcnow() - timedelta(hours=30)
    deal = await make_deal(
        db,
        handling="0.5",
        commission="2",
        with_demand=True,
        harvest_created_at=listed_at,
        accepted_at=listed_at + timedelta(hours=30),
    )
    first, second = deal.members
    coordinator = auth_client(deal.coordinator)
    buyer = auth_client(deal.buyer)

    # 1. Plan and request transport.
    plan = (await coordinator.post(f"/api/v1/lots/{deal.lot.id}/transport-plan")).json()
    assert plan["suggested_vehicle_type"] == "pickup" and len(plan["stops"]) == 2
    request = await coordinator.post(
        "/api/v1/transport-requests", json={"lot_id": str(deal.lot.id)}
    )
    assert request.status_code == 201, request.text
    request_id = request.json()["id"]
    assert request.json()["estimated_cost"] == plan["estimated_cost"]

    # 2. Two transporters quote; the coordinator books the cheaper one.
    expensive, cheap = [await factories.create_user(db, "transporter") for _ in range(2)]
    pricey = await auth_client(expensive).post(
        f"/api/v1/transport-requests/{request_id}/quotes",
        json={
            "vehicle_type": "light_truck",
            "capacity_kg": 3500,
            "price_total": 4500,
            "eta_hours": 7,
        },
    )
    vehicle = (
        await auth_client(cheap).post(
            "/api/v1/vehicles",
            json={
                "vehicle_type": "pickup",
                "registration_number": "AP39 TB 4521",
                "capacity_kg": 1500,
                "base_charge": 900,
                "per_km_rate": 24,
            },
        )
    ).json()
    winning = await auth_client(cheap).post(
        f"/api/v1/transport-requests/{request_id}/quotes",
        json={
            "vehicle_id": vehicle["id"],
            "vehicle_type": "pickup",
            "capacity_kg": 1500,
            "price_total": 4200,
            "eta_hours": 6,
        },
    )
    assert pricey.status_code == winning.status_code == 201
    assert winning.json()["price_per_kg"] == 4.2
    booked = await coordinator.post(f"/api/v1/transport-quotes/{winning.json()['id']}/accept")
    assert booked.status_code == 200 and booked.json()["status"] == "booked"
    assert {q["id"]: q["status"] for q in booked.json()["quotes"]} == {
        pricey.json()["id"]: "rejected",
        winning.json()["id"]: "accepted",
    }

    # 3. Pickups (the first starts the trip) and completion.
    driver = auth_client(cheap)
    stops = {stop["member_id"]: stop["id"] for stop in booked.json()["stops"]}
    for member, picked in ((first, 395), (second, 610)):
        response = await driver.post(
            f"/api/v1/transport-requests/{request_id}/stops/{stops[str(member.id)]}/pickup",
            json={"picked_kg": picked},
        )
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "in_progress"
    assert (await driver.post(f"/api/v1/transport-requests/{request_id}/complete", json={})).json()[
        "status"
    ] == "completed"
    lot = await db.get(Lot, deal.lot.id, populate_existing=True)
    assert lot is not None and lot.status == "in_transit"

    # 4. Delivery & quality check by the buyer: rejections and a 5 kg transit shortage each.
    delivery = await buyer.post(
        f"/api/v1/lots/{deal.lot.id}/delivery",
        json={
            "items": [
                {
                    "member_id": str(first.id),
                    "delivered_kg": 390,
                    "accepted_kg": 370,
                    "rejection_reason": "Soft fruit",
                },
                {"member_id": str(second.id), "delivered_kg": 605, "accepted_kg": 600},
            ],
            "inspector_name": "FreshBasket QC",
        },
    )
    assert delivery.status_code == 201, delivery.text
    record = delivery.json()
    assert (record["total_dispatched_kg"], record["total_delivered_kg"]) == (1005.0, 995.0)
    assert (
        record["total_accepted_kg"],
        record["total_rejected_kg"],
        record["total_shortage_kg"],
    ) == (
        970.0,
        25.0,
        10.0,
    )
    item = next(i for i in record["items"] if i["member_id"] == str(first.id))
    assert item["rejection_reason"] == "Soft fruit" and item["shortage_kg"] == 5

    # 5. Settlement maths to the paisa.
    url = f"/api/v1/settlements/{record['settlement_id']}"
    s = (await coordinator.get(url)).json()
    assert s == s | {
        "code": "ST-00001",
        "price_per_kg": 16.0,
        "total_accepted_kg": 970.0,
        "gross_amount": 15520.0,
        "transport_cost": 4200.0,
        "handling_cost": 736.25,
        "commission_amount": 310.4,
        "net_to_farmers": 10273.35,
        "amount_paid": 0.0,
        "payment_status": "pending",
        "due_date": (today_ist() + timedelta(days=7)).isoformat(),
    }
    payouts = {p["farmer_id"]: p for p in s["payouts"]}
    one, two = payouts[str(first.farmer_id)], payouts[str(second.farmer_id)]
    assert one == one | {
        "accepted_kg": 370.0,
        "rejected_kg": 20.0,
        "gross_amount": 5920.0,
        "transport_share": 1650.75,
        "handling_share": 283.75,
        "commission_share": 118.4,
        "net_amount": 3867.1,
        "net_per_kg": 9.79,
        "baseline_net_per_kg": 9.07,
        "uplift_per_kg": 0.72,
        "status": "pending",
    }
    assert two == two | {
        "accepted_kg": 600.0,
        "rejected_kg": 5.0,
        "gross_amount": 9600.0,
        "transport_share": 2549.25,
        "handling_share": 452.5,
        "commission_share": 192.0,
        "net_amount": 6406.25,
        "net_per_kg": 10.5,
        "baseline_net_per_kg": 10.01,
        "uplift_per_kg": 0.49,
    }
    farmer_view = (await auth_client(deal.farmers[0]).get(url)).json()
    assert [p["farmer_id"] for p in farmer_view["payouts"]] == [str(deal.farmers[0].id)]

    # 6. Partial then full payment by the buyer.
    partial = await buyer.post(f"{url}/payments", json={"amount": 5000, "reference": "UTR-1"})
    assert partial.json()["payment_status"] == "partially_paid"
    assert (await buyer.post(f"{url}/payments", json={"amount": 10520.02})).status_code == 422
    full = await buyer.post(f"{url}/payments", json={"amount": 10520, "reference": "UTR-2"})
    assert full.json()["payment_status"] == "paid" and full.json()["amount_paid"] == 15520.0
    assert [p["amount"] for p in full.json()["payments"]] == [5000.0, 10520.0]

    # 7. Payouts → lot settled, harvests settled, demand fulfilled.
    for payout in (one, two):
        response = await coordinator.post(
            f"{url}/payouts/{payout['id']}/mark-paid", json={"reference": "NEFT"}
        )
        assert response.status_code == 200, response.text
    lot = await db.get(Lot, deal.lot.id, populate_existing=True)
    assert lot is not None and lot.status == "settled" and lot.settled_at is not None
    for harvest in deal.harvests:
        refreshed = await db.get(Harvest, harvest.id, populate_existing=True)
        assert refreshed is not None and refreshed.status == "settled"
    assert deal.demand is not None
    demand = await db.get(Demand, deal.demand.id, populate_existing=True)
    assert demand is not None and demand.status == "fulfilled"
    assert any(
        n.title == "Payment sent: ₹3,867.10" for n in await notifications_for(db, deal.farmers[0])
    )

    # 8. The farmer's earnings.
    earnings = (await auth_client(deal.farmers[0]).get("/api/v1/earnings")).json()
    assert earnings["totals"] == {
        "gross_amount": 5920.0,
        "total_deductions": 2052.9,
        "net_amount": 3867.1,
        "kg_sold": 370.0,
        "avg_net_per_kg": 9.79,
        "avg_uplift_per_kg": 0.72,
        "sales_count": 1,
        "pending_amount": 0.0,
    }
    assert earnings["by_month"][-1] == {
        "month": utcnow().astimezone(IST).strftime("%Y-%m"),
        "gross_amount": 5920.0,
        "net_amount": 3867.1,
        "baseline_net_amount": 3582.65,  # 9.07 × 395
        "kg_sold": 370.0,
    }
    sale = earnings["sales"][0]
    assert (
        sale["status"] == "paid"
        and sale["settled_at"] is not None
        and sale["lot_code"] == deal.lot.code
    )

    # 9. Pilot metrics.
    metrics = (await coordinator.get("/api/v1/dashboard/coordinator")).json()["pilot_metrics"]
    assert metrics == {
        "net_uplift_per_kg": 0.58,  # (0.72 × 395 + 0.49 × 610) / 1005
        "completion_rate_pct": 97.0,  # 970 kg settled of 1000 kg listed
        "avg_hours_listing_to_buyer": 30.0,
        "transport_cost_per_kg": 4.18,  # 4200 / 1005
        "avg_payment_delay_days": 0.0,
        "rejection_rate_pct": 2.51,  # 25 / 995
        "failed_transactions": 0,
        "repeat_farmers_pct": 0.0,
        "repeat_buyers_pct": 0.0,
    }
    audited = set(await db.scalars(select(AuditLog.action)))
    assert {
        "transport_request.create",
        "transport_quote.create",
        "transport_quote.accept",
        "transport.pickup",
        "transport.complete",
        "delivery.record",
        "settlement.create",
        "settlement.payment",
        "payout.paid",
        "lot.settle",
    } <= audited


async def test_metrics_failures_and_repeats(db: AsyncSession, auth_client: Any) -> None:
    """Cancelled-after-acceptance lots and overdue settlements count as failures; repeats."""
    first = await make_deal(
        db, quantities=(300,), pickup_terms="buyer_pickup", payment_terms_days=0
    )
    farmer, buyer = first.farmers[0], first.buyer
    kwargs = {"crop": first.crop, "coordinator": first.coordinator, "buyer": buyer}
    second = await make_deal(
        db, quantities=(200,), farmers=[farmer], pickup_terms="buyer_pickup", **kwargs
    )
    cancelled = await make_deal(db, quantities=(100,), **kwargs)
    cancelled.lot.status = "cancelled"
    await db.commit()

    for deal in (first, second):
        response = await auth_client(buyer).post(
            f"/api/v1/lots/{deal.lot.id}/delivery",
            json={
                "items": [
                    {"member_id": str(deal.members[0].id), "delivered_kg": 200, "accepted_kg": 190}
                ]
            },
        )
        assert response.status_code == 201, response.text
    # The first settlement was due on delivery: make it overdue.
    overdue = await db.scalar(select(Settlement).where(Settlement.lot_id == first.lot.id))
    assert overdue is not None
    overdue.due_date = today_ist() - timedelta(days=1)
    await db.commit()

    metrics = (await auth_client(first.coordinator).get("/api/v1/dashboard/coordinator")).json()[
        "pilot_metrics"
    ]
    assert metrics["failed_transactions"] == 2
    assert metrics["repeat_farmers_pct"] == 100.0 and metrics["repeat_buyers_pct"] == 100.0
    assert metrics["rejection_rate_pct"] == 5.0
    assert metrics["net_uplift_per_kg"] is None  # nothing paid out yet
    assert metrics["completion_rate_pct"] == 0.0
    assert metrics["avg_payment_delay_days"] is None
    assert metrics["transport_cost_per_kg"] is None
