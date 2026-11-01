"""Vehicles, transport plans, transport requests, quotes, pickups and trips.

Also home of ``make_deal`` / ``book_transport``: the operations scenario builders reused by the
delivery, settlement, dispute, dashboard and flow tests (state is built with the factories, so
these tests never depend on the deals endpoints).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.models import (
    AuditLog,
    Crop,
    Demand,
    Harvest,
    Lot,
    LotMember,
    Notification,
    Offer,
    TransportQuote,
    TransportRequest,
    User,
)
from app.services import pricing
from tests import factories

# ──────────────────────────── Scenario builders ────────────────────────────

PRE_OFFER_STATUSES = ("forming", "awaiting_consent")


@dataclass
class Deal:
    coordinator: User
    buyer: User
    farmers: list[User]
    crop: Crop
    harvests: list[Harvest]
    lot: Lot
    offer: Offer  # None for lots still forming / awaiting consent (typed loosely for tests)
    demand: Demand | None = None
    transporters: list[User] = field(default_factory=list)

    @property
    def members(self) -> list[LotMember]:
        """The lot's members in the order of ``harvests`` (one member per harvest)."""
        by_harvest = {member.harvest_id: member for member in self.lot.members}
        return [by_harvest[harvest.id] for harvest in self.harvests]


async def make_deal(
    db: AsyncSession,
    *,
    quantities: tuple[int, ...] = (400, 600),
    pickup_terms: str = "mandimate_delivery",
    lot_status: str = "offer_accepted",
    consent_status: str = "accepted",
    price: str = "16",
    handling: str = "0",
    commission: str = "0",
    payment_terms_days: int = 7,
    with_demand: bool = False,
    with_market_price: bool = True,
    crop: Crop | None = None,
    coordinator: User | None = None,
    buyer: User | None = None,
    farmers: list[User] | None = None,
    harvest_created_at: datetime | None = None,
    accepted_at: datetime | None = None,
) -> Deal:
    """A lot of ``len(quantities)`` farmers whose offer from ``buyer`` was accepted.

    For ``open_for_offers`` the buyer's offer is still pending; lots still forming or awaiting
    consent have no offer (``deal.offer`` is ``None``).
    """
    coordinator = coordinator or await factories.create_user(db, "coordinator")
    buyer = buyer or await factories.create_user(db, "buyer")
    if crop is None:
        crop = await factories.create_crop(db)
        if with_market_price:
            await factories.create_market_price(db, crop)
    farmers = farmers or [await factories.create_user(db, "farmer") for _ in quantities]
    extra: dict[str, Any] = {}
    if harvest_created_at is not None:
        extra["created_at"] = harvest_created_at
    harvests = [
        await factories.create_harvest(db, farmer, crop, quantity_kg=Decimal(quantity), **extra)
        for farmer, quantity in zip(farmers, quantities, strict=True)
    ]
    demand = await factories.create_demand(db, buyer, crop) if with_demand else None
    lot = await factories.create_lot(
        db,
        crop,
        harvests,
        coordinator=coordinator,
        consent_status=consent_status,
        status=lot_status,
        demand_id=demand.id if demand else None,
    )
    if lot_status in PRE_OFFER_STATUSES:
        return Deal(coordinator, buyer, farmers, crop, harvests, lot, None, demand)  # type: ignore[arg-type]
    accepted = lot_status != "open_for_offers"
    offer = await factories.create_offer(
        db,
        buyer,
        lot=lot,
        status="accepted" if accepted else "pending",
        awaiting=None if accepted else "seller",
        accepted_at=(accepted_at or utcnow()) if accepted else None,
        pickup_terms=pickup_terms,
        price_per_kg=Decimal(price),
        handling_charge_per_kg=Decimal(handling),
        commission_pct=Decimal(commission),
        payment_terms_days=payment_terms_days,
        demand_id=demand.id if demand else None,
    )
    if accepted:
        lot.accepted_offer_id = offer.id
        lot.pickup_terms = pickup_terms  # type: ignore[assignment]
        if demand is not None:
            demand.status = "matched"
        await db.commit()
        await db.refresh(lot)
    return Deal(coordinator, buyer, farmers, crop, harvests, lot, offer, demand)


async def book_transport(
    db: AsyncSession,
    auth_client: Any,
    deal: Deal,
    *,
    price_total: float = 4200,
    other_price: float | None = None,
) -> dict[str, Any]:
    """Request transport, collect quotes and book the cheapest; returns the booked request."""
    coordinator = auth_client(deal.coordinator)
    response = await coordinator.post(
        "/api/v1/transport-requests", json={"lot_id": str(deal.lot.id)}
    )
    assert response.status_code == 201, response.text
    request_id = response.json()["id"]
    transporter = await factories.create_user(db, "transporter")
    deal.transporters.append(transporter)
    quote = await auth_client(transporter).post(
        f"/api/v1/transport-requests/{request_id}/quotes",
        json={
            "vehicle_type": "light_truck",
            "capacity_kg": 3500,
            "price_total": price_total,
            "eta_hours": 6,
        },
    )
    assert quote.status_code == 201, quote.text
    if other_price is not None:
        rival = await factories.create_user(db, "transporter")
        deal.transporters.append(rival)
        response = await auth_client(rival).post(
            f"/api/v1/transport-requests/{request_id}/quotes",
            json={
                "vehicle_type": "light_truck",
                "capacity_kg": 3500,
                "price_total": other_price,
                "eta_hours": 8,
            },
        )
        assert response.status_code == 201, response.text
    booked = await coordinator.post(f"/api/v1/transport-quotes/{quote.json()['id']}/accept")
    assert booked.status_code == 200, booked.text
    return booked.json()


QUOTE = {"vehicle_type": "light_truck", "capacity_kg": 3500, "price_total": 4200, "eta_hours": 6}


async def notifications_for(db: AsyncSession, user: User) -> list[Notification]:
    return list(
        await db.scalars(
            select(Notification)
            .where(Notification.user_id == user.id)
            .order_by(Notification.created_at)
        )
    )


# ───────────────────────────────── Vehicles ─────────────────────────────────


VEHICLE = {
    "vehicle_type": "light_truck",
    "registration_number": "ap 03-ta 1234",
    "capacity_kg": 3500,
    "base_charge": 1500,
    "per_km_rate": 32,
}


async def test_vehicle_crud(db: AsyncSession, auth_client: Any) -> None:
    transporter = await factories.create_user(db, "transporter")
    client = auth_client(transporter)

    created = await client.post("/api/v1/vehicles", json=VEHICLE)
    assert created.status_code == 201, created.text
    vehicle = created.json()
    assert vehicle["registration_number"] == "AP03TA1234"
    assert vehicle["transporter_id"] == str(transporter.id)
    assert vehicle["is_active"] is True and vehicle["has_refrigeration"] is False

    listed = await client.get("/api/v1/vehicles")
    assert [v["id"] for v in listed.json()] == [vehicle["id"]]

    patched = await client.patch(
        f"/api/v1/vehicles/{vehicle['id']}", json={"capacity_kg": 3000, "is_active": False}
    )
    assert patched.status_code == 200
    assert patched.json()["capacity_kg"] == 3000 and patched.json()["is_active"] is False

    deleted = await client.delete(f"/api/v1/vehicles/{vehicle['id']}")
    assert deleted.status_code == 204
    assert (await client.get("/api/v1/vehicles")).json() == []
    actions = set(await db.scalars(select(AuditLog.action)))
    assert {"vehicle.create", "vehicle.update", "vehicle.delete"} <= actions


async def test_vehicle_validation_and_ownership(db: AsyncSession, auth_client: Any) -> None:
    owner = await factories.create_user(db, "transporter")
    other = await factories.create_user(db, "transporter")
    farmer = await factories.create_user(db, "farmer")
    created = await auth_client(owner).post("/api/v1/vehicles", json=VEHICLE)
    vehicle_id = created.json()["id"]

    duplicate = await auth_client(other).post(
        "/api/v1/vehicles", json=VEHICLE | {"registration_number": "AP03TA1234"}
    )
    assert duplicate.status_code == 409

    too_small = await auth_client(owner).post(
        "/api/v1/vehicles", json=VEHICLE | {"registration_number": "AP03TB0001", "capacity_kg": 50}
    )
    assert too_small.status_code == 422
    too_big = await auth_client(owner).patch(
        f"/api/v1/vehicles/{vehicle_id}", json={"capacity_kg": 45000}
    )
    assert too_big.status_code == 422
    null_capacity = await auth_client(owner).patch(
        f"/api/v1/vehicles/{vehicle_id}", json={"capacity_kg": None}
    )
    assert null_capacity.status_code == 422

    assert (
        await auth_client(other).patch(f"/api/v1/vehicles/{vehicle_id}", json={"is_active": False})
    ).status_code == 404
    assert (await auth_client(other).delete(f"/api/v1/vehicles/{vehicle_id}")).status_code == 404
    assert (await auth_client(farmer).get("/api/v1/vehicles")).status_code == 403
    assert (await auth_client(farmer).post("/api/v1/vehicles", json=VEHICLE)).status_code == 403


# ────────────────────────────── Transport plan ──────────────────────────────


async def test_transport_plan_routes_to_offer_destination(
    db: AsyncSession, auth_client: Any
) -> None:
    deal = await make_deal(db)
    response = await auth_client(deal.coordinator).post(
        f"/api/v1/lots/{deal.lot.id}/transport-plan"
    )
    assert response.status_code == 200, response.text
    plan = response.json()
    assert plan["lot_id"] == str(deal.lot.id)
    assert plan["destination_name"] == factories.BENGALURU_BUYER["delivery_location"]
    assert {stop["member_id"] for stop in plan["stops"]} == {str(m.id) for m in deal.members}
    assert all(stop["id"] == stop["member_id"] for stop in plan["stops"])
    assert [stop["sequence"] for stop in plan["stops"]] == [1, 2]
    assert len(plan["route"]) == 3 and plan["route"][-1] == [12.9592, 77.576]
    estimate = pricing.estimate_transport_cost(
        Decimal(1000), Decimal(str(plan["total_distance_km"]))
    )
    assert plan["suggested_vehicle_type"] == estimate.vehicle_type == "pickup"
    assert plan["estimated_cost"] == float(estimate.cost_total)
    assert plan["cost_per_kg"] == float(estimate.cost_per_kg)
    assert plan["trips_needed"] == 1 and plan["vehicle_capacity_kg"] == 1500
    assert {stop["farmer_name"] for stop in plan["stops"]} == {f.full_name for f in deal.farmers}


async def test_transport_plan_visibility_and_masking(db: AsyncSession, auth_client: Any) -> None:
    deal = await make_deal(db)
    url = f"/api/v1/lots/{deal.lot.id}/transport-plan"
    member = await auth_client(deal.farmers[0]).post(url)
    assert member.status_code == 200
    names = {stop["farmer_name"] for stop in member.json()["stops"]}
    assert deal.farmers[0].full_name in names  # own name in full
    buyer = await auth_client(deal.buyer).post(url)
    assert buyer.status_code == 200
    assert all(name.endswith(".") for name in (s["farmer_name"] for s in buyer.json()["stops"]))
    stranger = await factories.create_user(db, "buyer")
    assert (await auth_client(stranger).post(url)).status_code == 404
    transporter = await factories.create_user(db, "transporter")
    assert (await auth_client(transporter).post(url)).status_code == 404


async def test_transport_plan_falls_back_to_collection_point(
    db: AsyncSession, auth_client: Any
) -> None:
    deal = await make_deal(db)
    deal.offer.delivery_latitude = None
    deal.offer.delivery_longitude = None
    await db.commit()
    plan = (
        await auth_client(deal.coordinator).post(f"/api/v1/lots/{deal.lot.id}/transport-plan")
    ).json()
    assert plan["destination_name"] == factories.MADANAPALLE_MARKET[0]
    assert plan["total_distance_km"] >= float(pricing.BASELINE_DISTANCE_KM)


# ─────────────────────────── Transport requests ────────────────────────────


async def test_create_request_persists_stops_and_notifies_transporters(
    db: AsyncSession, auth_client: Any
) -> None:
    deal = await make_deal(db)
    transporter = await factories.create_user(db, "transporter")
    response = await auth_client(deal.coordinator).post(
        "/api/v1/transport-requests", json={"lot_id": str(deal.lot.id), "notes": "Crates ready"}
    )
    assert response.status_code == 201, response.text
    req = response.json()
    assert req["status"] == "open" and req["quotes"] == [] and req["booked_quote_id"] is None
    assert req["lot_code"] == deal.lot.code and req["crop_name"] == "Tomato"
    assert req["total_quantity_kg"] == 1000 and req["notes"] == "Crates ready"
    assert len(req["stops"]) == 2 and all(stop["status"] == "pending" for stop in req["stops"])
    assert {stop["member_id"] for stop in req["stops"]} == {str(m.id) for m in deal.members}
    assert req["stops"][0]["id"] != req["stops"][0]["member_id"]

    notes = await notifications_for(db, transporter)
    assert [n.type for n in notes] == ["pickup"]
    assert notes[0].link == f"/app/transporter/requests/{req['id']}"
    assert await db.scalar(
        select(AuditLog.action).where(AuditLog.action == "transport_request.create")
    )


async def test_create_request_state_and_role_errors(db: AsyncSession, auth_client: Any) -> None:
    open_deal = await make_deal(db, lot_status="open_for_offers")
    coordinator = auth_client(open_deal.coordinator)
    not_accepted = await coordinator.post(
        "/api/v1/transport-requests", json={"lot_id": str(open_deal.lot.id)}
    )
    assert not_accepted.status_code == 409

    pickup_deal = await make_deal(
        db, pickup_terms="buyer_pickup", crop=open_deal.crop, coordinator=open_deal.coordinator
    )
    buyer_pickup = await coordinator.post(
        "/api/v1/transport-requests", json={"lot_id": str(pickup_deal.lot.id)}
    )
    assert buyer_pickup.status_code == 409

    deal = await make_deal(db, crop=open_deal.crop, coordinator=open_deal.coordinator)
    assert (
        await auth_client(deal.farmers[0]).post(
            "/api/v1/transport-requests", json={"lot_id": str(deal.lot.id)}
        )
    ).status_code == 403
    first = await coordinator.post("/api/v1/transport-requests", json={"lot_id": str(deal.lot.id)})
    assert first.status_code == 201
    second = await coordinator.post("/api/v1/transport-requests", json={"lot_id": str(deal.lot.id)})
    assert second.status_code == 409
    missing = await coordinator.post(
        "/api/v1/transport-requests", json={"lot_id": "00000000-0000-0000-0000-000000000000"}
    )
    assert missing.status_code == 404
    assert (await coordinator.post("/api/v1/transport-requests", json={})).status_code == 422


async def test_quotes_lifecycle_and_visibility(db: AsyncSession, auth_client: Any) -> None:
    deal = await make_deal(db)
    request_id = (
        await auth_client(deal.coordinator).post(
            "/api/v1/transport-requests", json={"lot_id": str(deal.lot.id)}
        )
    ).json()["id"]
    first = await factories.create_user(db, "transporter")
    second = await factories.create_user(db, "transporter")
    vehicle = (await auth_client(first).post("/api/v1/vehicles", json=VEHICLE)).json()

    quote = await auth_client(first).post(
        f"/api/v1/transport-requests/{request_id}/quotes",
        json=QUOTE | {"vehicle_id": vehicle["id"]},
    )
    assert quote.status_code == 201, quote.text
    assert quote.json()["price_per_kg"] == 4.2 and quote.json()["status"] == "submitted"
    assert quote.json()["transporter_verified"] is True
    again = await auth_client(first).post(
        f"/api/v1/transport-requests/{request_id}/quotes", json=QUOTE
    )
    assert again.status_code == 409
    foreign_vehicle = await auth_client(second).post(
        f"/api/v1/transport-requests/{request_id}/quotes",
        json=QUOTE | {"vehicle_id": vehicle["id"]},
    )
    assert foreign_vehicle.status_code == 404
    rival = await auth_client(second).post(
        f"/api/v1/transport-requests/{request_id}/quotes", json=QUOTE | {"price_total": 3900}
    )
    assert rival.status_code == 201
    coordinator_notes = await notifications_for(db, deal.coordinator)
    assert sum(n.title.startswith("New transport quote") for n in coordinator_notes) == 2

    as_coordinator = (
        await auth_client(deal.coordinator).get(f"/api/v1/transport-requests/{request_id}")
    ).json()
    assert as_coordinator["status"] == "quoted" and len(as_coordinator["quotes"]) == 2
    as_first = (await auth_client(first).get(f"/api/v1/transport-requests/{request_id}")).json()
    assert [q["id"] for q in as_first["quotes"]] == [quote.json()["id"]]
    as_farmer = (
        await auth_client(deal.farmers[0]).get(f"/api/v1/transport-requests/{request_id}")
    ).json()
    assert as_farmer["quotes"] == []
    assert (
        await auth_client(deal.farmers[0]).post(
            f"/api/v1/transport-requests/{request_id}/quotes", json=QUOTE
        )
    ).status_code == 403

    # Withdrawing: only the quoting transporter; the request reopens when no quote is left.
    assert (
        await auth_client(second).post(f"/api/v1/transport-quotes/{quote.json()['id']}/withdraw")
    ).status_code == 404
    withdrawn = await auth_client(first).post(
        f"/api/v1/transport-quotes/{quote.json()['id']}/withdraw"
    )
    assert withdrawn.status_code == 200 and withdrawn.json()["status"] == "withdrawn"
    assert (
        await auth_client(first).post(f"/api/v1/transport-quotes/{quote.json()['id']}/withdraw")
    ).status_code == 409
    await auth_client(second).post(f"/api/v1/transport-quotes/{rival.json()['id']}/withdraw")
    reopened = (
        await auth_client(deal.coordinator).get(f"/api/v1/transport-requests/{request_id}")
    ).json()
    assert reopened["status"] == "open"
    # A withdrawn quote frees the transporter to quote again.
    requote = await auth_client(first).post(
        f"/api/v1/transport-requests/{request_id}/quotes", json=QUOTE
    )
    assert requote.status_code == 201


async def test_refrigerated_load_needs_reefer(db: AsyncSession, auth_client: Any) -> None:
    crop = await factories.create_crop(
        db, code="MNG", name="Mango", name_hi="आम", name_te="మామిడి", requires_refrigeration=True
    )
    deal = await make_deal(db, crop=crop)
    req = (
        await auth_client(deal.coordinator).post(
            "/api/v1/transport-requests", json={"lot_id": str(deal.lot.id)}
        )
    ).json()
    assert req["requires_refrigeration"] is True and req["suggested_vehicle_type"] == "reefer_truck"
    transporter = await factories.create_user(db, "transporter")
    url = f"/api/v1/transport-requests/{req['id']}/quotes"
    assert (await auth_client(transporter).post(url, json=QUOTE)).status_code == 422
    reefer = await auth_client(transporter).post(url, json=QUOTE | {"vehicle_type": "reefer_truck"})
    assert reefer.status_code == 201


async def test_accept_quote_books_trip(db: AsyncSession, auth_client: Any) -> None:
    deal = await make_deal(db)
    booked = await book_transport(db, auth_client, deal, price_total=4200, other_price=4500)
    assert booked["status"] == "booked"
    assert booked["transporter_name"] == "Sri Venkateswara Transports"
    statuses = {q["price_total"]: q["status"] for q in booked["quotes"]}
    assert statuses == {4200: "accepted", 4500: "rejected"}
    await db.refresh(deal.lot)
    assert deal.lot.status == "transport_booked"

    winner, loser = deal.transporters
    assert any(n.title.startswith("Trip booked") for n in await notifications_for(db, winner))
    assert any(n.title.startswith("Quote not selected") for n in await notifications_for(db, loser))
    for farmer in deal.farmers:
        titles = [n.title for n in await notifications_for(db, farmer)]
        assert any(title.startswith("Pickup on ") for title in titles)

    # Booked transporter sees full farmer names; the buyer sees only the booked quote.
    as_winner = (await auth_client(winner).get(f"/api/v1/transport-requests/{booked['id']}")).json()
    assert {s["farmer_name"] for s in as_winner["stops"]} == {f.full_name for f in deal.farmers}
    as_loser = (await auth_client(loser).get(f"/api/v1/transport-requests/{booked['id']}")).json()
    assert all(s["farmer_name"].endswith(".") for s in as_loser["stops"])
    as_buyer = (
        await auth_client(deal.buyer).get(f"/api/v1/transport-requests/{booked['id']}")
    ).json()
    assert [q["status"] for q in as_buyer["quotes"]] == ["accepted"]

    accepted_id = as_buyer["quotes"][0]["id"]
    again = await auth_client(deal.coordinator).post(
        f"/api/v1/transport-quotes/{accepted_id}/accept"
    )
    assert again.status_code == 409
    rejected_id = next(q["id"] for q in booked["quotes"] if q["status"] == "rejected")
    assert (
        await auth_client(deal.coordinator).post(f"/api/v1/transport-quotes/{rejected_id}/accept")
    ).status_code == 409
    assert (
        await auth_client(deal.farmers[0]).post(f"/api/v1/transport-quotes/{rejected_id}/accept")
    ).status_code == 403


async def test_request_listing_per_role(db: AsyncSession, auth_client: Any) -> None:
    deal = await make_deal(db)
    other = await make_deal(db, crop=deal.crop, coordinator=deal.coordinator)
    coordinator = auth_client(deal.coordinator)
    booked = await book_transport(db, auth_client, deal)
    open_req = (
        await coordinator.post("/api/v1/transport-requests", json={"lot_id": str(other.lot.id)})
    ).json()
    winner = deal.transporters[0]
    newcomer = await factories.create_user(db, "transporter")

    def ids(response: Any) -> list[str]:
        assert response.status_code == 200, response.text
        return [item["id"] for item in response.json()]

    assert ids(await coordinator.get("/api/v1/transport-requests")) == [
        open_req["id"],
        booked["id"],
    ]
    assert ids(await coordinator.get("/api/v1/transport-requests?status=booked")) == [booked["id"]]
    assert ids(await auth_client(winner).get("/api/v1/transport-requests")) == [
        open_req["id"],
        booked["id"],
    ]
    assert ids(await auth_client(winner).get("/api/v1/transport-requests?mine=true")) == [
        booked["id"]
    ]
    assert ids(await auth_client(newcomer).get("/api/v1/transport-requests")) == [open_req["id"]]
    assert ids(await auth_client(deal.farmers[0]).get("/api/v1/transport-requests")) == [
        booked["id"]
    ]
    assert ids(await auth_client(other.buyer).get("/api/v1/transport-requests")) == [open_req["id"]]
    assert (
        await auth_client(newcomer).get(f"/api/v1/transport-requests/{booked['id']}")
    ).status_code == 404
    assert (
        await auth_client(deal.farmers[0]).get(f"/api/v1/transport-requests/{open_req['id']}")
    ).status_code == 404
    bad = await coordinator.get("/api/v1/transport-requests?status=lost")
    assert bad.status_code == 422


# ───────────────────────────── Pickups & trips ─────────────────────────────


async def test_pickups_start_trip_and_completion_skips_rest(
    db: AsyncSession, auth_client: Any
) -> None:
    deal = await make_deal(db)
    booked = await book_transport(db, auth_client, deal, other_price=5000)
    winner, loser = deal.transporters
    client = auth_client(winner)
    first, second = booked["stops"]
    url = f"/api/v1/transport-requests/{booked['id']}"

    early = await client.post(f"{url}/complete", json={})
    assert early.status_code == 409
    assert (
        await auth_client(loser).post(f"{url}/stops/{first['id']}/pickup", json={"picked_kg": 10})
    ).status_code == 403
    assert (
        await auth_client(deal.farmers[0]).post(
            f"{url}/stops/{first['id']}/pickup", json={"picked_kg": 10}
        )
    ).status_code == 403
    allowed = round(first["quantity_kg"] * 1.05, 2)
    over = await client.post(
        f"{url}/stops/{first['id']}/pickup", json={"picked_kg": allowed + 0.01}
    )
    assert over.status_code == 422
    assert (
        await client.post(f"{url}/stops/{first['id']}/pickup", json={"picked_kg": -1})
    ).status_code == 422
    assert (
        await client.post(f"{url}/stops/{booked['id']}/pickup", json={"picked_kg": 1})
    ).status_code == 404

    picked = await client.post(
        f"{url}/stops/{first['id']}/pickup", json={"picked_kg": allowed, "note": "Wet crates"}
    )
    assert picked.status_code == 200, picked.text
    trip = picked.json()
    assert trip["status"] == "in_progress"
    stop = next(s for s in trip["stops"] if s["id"] == first["id"])
    assert stop["status"] == "picked_up" and stop["picked_kg"] == allowed
    assert stop["picked_up_at"] is not None
    again = await client.post(f"{url}/stops/{first['id']}/pickup", json={"picked_kg": 1})
    assert again.status_code == 409

    await db.refresh(deal.lot)
    assert deal.lot.status == "in_transit"
    member = await db.get(LotMember, uuid.UUID(first["member_id"]), populate_existing=True)
    assert member is not None and member.dispatched_kg == Decimal(str(allowed))
    harvest = await db.get(Harvest, member.harvest_id, populate_existing=True)
    assert harvest is not None and harvest.status == "picked_up"
    farmer = next(f for f in deal.farmers if f.id == member.farmer_id)
    assert any(n.title.startswith("Picked up") for n in await notifications_for(db, farmer))

    done = await client.post(f"{url}/complete", json={"note": "Unloaded at Kalasipalya"})
    assert done.status_code == 200
    statuses = {s["id"]: s["status"] for s in done.json()["stops"]}
    assert statuses == {first["id"]: "picked_up", second["id"]: "skipped"}
    assert done.json()["status"] == "completed"
    skipped_member = await db.get(LotMember, uuid.UUID(second["member_id"]), populate_existing=True)
    assert skipped_member is not None and skipped_member.dispatched_kg == Decimal("0")
    assert (await client.post(f"{url}/complete")).status_code == 409
    late = await client.post(f"{url}/stops/{second['id']}/pickup", json={"picked_kg": 1})
    assert late.status_code == 409
    request = await db.get(TransportRequest, uuid.UUID(booked["id"]), populate_existing=True)
    assert request is not None and request.completion_note == "Unloaded at Kalasipalya"
    quote = await db.get(
        TransportQuote, uuid.UUID(booked["booked_quote_id"]), populate_existing=True
    )
    assert quote is not None and quote.status == "accepted"
