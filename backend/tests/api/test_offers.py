"""Offers API: creation rules, every negotiation transition, consent, acceptance side effects."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import today_ist, utcnow
from app.models import (
    AuditLog,
    Demand,
    Harvest,
    Lot,
    LotMember,
    NegotiationEntry,
    Notification,
    Offer,
    OfferConsent,
)
from app.services.lot_service import buyer_name
from tests import factories
from tests.api.test_lots import API, make_cluster, offer_body, open_lot_with_all

# ─────────────────────────────── Create ───────────────────────────────


async def test_create_lot_offer_notifies_seller_side(db: AsyncSession, auth_client: Any) -> None:
    cluster = await make_cluster(db, (200, 300))
    lot = await open_lot_with_all(auth_client, cluster)
    demand = await factories.create_demand(db, cluster.buyer, cluster.crop)
    response = await auth_client(cluster.buyer).post(
        f"{API}/offers",
        json=offer_body(lot_id=lot["id"], quantity=500, demand_id=str(demand.id), notes="Firm"),
    )
    assert response.status_code == 201, response.text
    offer = response.json()
    assert offer["code"] == "OF-00001"
    assert offer["status"] == "pending"
    assert offer["awaiting"] == "seller"
    assert offer["lot_code"] == lot["code"]
    assert offer["crop_name"] == "Tomato"
    assert offer["grade"] == "A"
    assert offer["commission_pct"] == 0
    assert offer["buyer_name"] == "FreshBasket Retail Pvt Ltd"
    assert offer["buyer_verified"] is True
    assert offer["buyer_reliability_pct"] is None
    assert [e["action"] for e in offer["negotiation"]] == ["offer"]
    assert offer["negotiation"][0]["message"] == "Firm"

    recipients = set(
        (await db.scalars(select(Notification.user_id).where(Notification.type == "offer"))).all()
    )
    assert recipients == {cluster.farmers[0].id, cluster.farmers[1].id, cluster.coordinator.id}
    assert await db.scalar(select(AuditLog).where(AuditLog.action == "offer.create"))

    lot_after = (await auth_client(cluster.coordinator).get(f"{API}/lots/{lot['id']}")).json()
    assert lot_after["offers_count"] == 1
    assert lot_after["journey_step"] == 4


async def test_create_offer_rules(db: AsyncSession, auth_client: Any) -> None:
    cluster = await make_cluster(db, (200, 300))
    buyer = auth_client(cluster.buyer)
    coordinator = auth_client(cluster.coordinator)
    lot = await open_lot_with_all(auth_client, cluster, [(cluster.harvests[0], 200.0)])

    too_much = await buyer.post(f"{API}/offers", json=offer_body(lot_id=lot["id"], quantity=201))
    assert too_much.status_code == 409
    assert too_much.json()["code"] == "quantity_exceeds_supply"
    past = await buyer.post(
        f"{API}/offers",
        json=offer_body(
            lot_id=lot["id"], quantity=100, valid_until=(utcnow() - timedelta(hours=1)).isoformat()
        ),
    )
    assert past.status_code == 422
    both = await buyer.post(
        f"{API}/offers",
        json=offer_body(lot_id=lot["id"], quantity=100)
        | {"harvest_id": str(cluster.harvests[1].id)},
    )
    assert both.status_code == 422
    farmer = await auth_client(cluster.farmers[0]).post(
        f"{API}/offers", json=offer_body(lot_id=lot["id"], quantity=100)
    )
    assert farmer.status_code == 403

    first = await buyer.post(f"{API}/offers", json=offer_body(lot_id=lot["id"], quantity=200))
    assert first.status_code == 201
    duplicate = await buyer.post(f"{API}/offers", json=offer_body(lot_id=lot["id"], quantity=100))
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "duplicate_offer"

    other_buyer = await factories.create_user(db, "buyer", organization_name="Metro Fresh")
    foreign_demand = await factories.create_demand(db, cluster.buyer, cluster.crop)
    stolen = await auth_client(other_buyer).post(
        f"{API}/offers",
        json=offer_body(lot_id=lot["id"], quantity=100, demand_id=str(foreign_demand.id)),
    )
    assert stolen.status_code == 404

    # A lot that is not open: invisible to buyers (404); pooled harvest: 409; unknown: 404.
    pending_lot = (
        await coordinator.post(
            f"{API}/lots",
            json={
                "crop_id": str(cluster.crop.id),
                "grade": "A",
                "target_quantity_kg": 300,
                "collection_point_name": "Madanapalle APMC",
                "collection_latitude": 13.55,
                "collection_longitude": 78.5,
                "pickup_date": (today_ist() + timedelta(days=2)).isoformat(),
                "members": [{"harvest_id": str(cluster.harvests[1].id), "quantity_kg": 100}],
            },
        )
    ).json()
    hidden = await buyer.post(f"{API}/offers", json=offer_body(lot_id=pending_lot["id"]))
    assert hidden.status_code == 404
    pooled = await buyer.post(
        f"{API}/offers", json=offer_body(harvest_id=cluster.harvests[1].id, quantity=100)
    )
    assert pooled.status_code == 409
    assert pooled.json()["code"] == "harvest_not_open"
    missing = await buyer.post(f"{API}/offers", json=offer_body(harvest_id=cluster.crop.id))
    assert missing.status_code == 404


# ─────────────────────────────── Negotiation transitions ───────────────────────────────


async def test_harvest_offer_counter_accept_creates_solo_lot(
    db: AsyncSession, auth_client: Any
) -> None:
    cluster = await make_cluster(db, (400,))
    harvest, farmer_user = cluster.harvests[0], cluster.farmers[0]
    buyer = auth_client(cluster.buyer)
    farmer = auth_client(farmer_user)
    rival_buyer = await factories.create_user(db, "buyer", organization_name="Metro Fresh")
    rival = await auth_client(rival_buyer).post(
        f"{API}/offers", json=offer_body(harvest_id=harvest.id, quantity=300, price_per_kg=15)
    )
    created = await buyer.post(
        f"{API}/offers", json=offer_body(harvest_id=harvest.id, quantity=450)
    )
    assert created.status_code == 409  # more than available
    created = await buyer.post(
        f"{API}/offers", json=offer_body(harvest_id=harvest.id, quantity=400)
    )
    offer_id = created.json()["id"]

    # Buyer cannot act while the seller is awaited; coordinators are not the seller of a
    # direct offer.
    assert (await buyer.post(f"{API}/offers/{offer_id}/accept", json={})).status_code == 403
    assert (
        await buyer.post(f"{API}/offers/{offer_id}/counter", json={"price_per_kg": 15})
    ).status_code == 403
    coordinator_try = await auth_client(cluster.coordinator).post(
        f"{API}/offers/{offer_id}/accept", json={}
    )
    assert coordinator_try.status_code == 403

    countered = await farmer.post(
        f"{API}/offers/{offer_id}/counter",
        json={"price_per_kg": 17.5, "quantity_kg": 350, "message": "Better quality"},
    )
    assert countered.status_code == 200, countered.text
    body = countered.json()
    assert (body["status"], body["awaiting"]) == ("countered", "buyer")
    assert (body["price_per_kg"], body["quantity_kg"]) == (17.5, 350)
    assert body["negotiation"][-1]["action"] == "counter"
    assert body["negotiation"][-1]["author_name"] == farmer_user.full_name  # own name

    buyer_view = (await buyer.get(f"{API}/offers/{offer_id}")).json()
    assert buyer_view["negotiation"][-1]["author_name"].endswith(".")  # masked for buyers
    assert (await farmer.post(f"{API}/offers/{offer_id}/accept", json={})).status_code == 403

    back = await buyer.post(f"{API}/offers/{offer_id}/counter", json={"price_per_kg": 17})
    assert (back.json()["status"], back.json()["awaiting"]) == ("pending", "seller")

    accepted = await farmer.post(f"{API}/offers/{offer_id}/accept", json={"message": "Deal"})
    assert accepted.status_code == 200, accepted.text
    offer = accepted.json()
    assert offer["status"] == "accepted"
    assert offer["awaiting"] is None
    assert offer["quantity_kg"] == 350
    assert offer["lot_id"] is not None
    assert offer["lot_code"] == "MM-TOM-0001"

    lot = await db.get(Lot, offer["lot_id"])
    await db.refresh(lot)
    assert lot.is_solo is True
    assert lot.status == "offer_accepted"
    assert lot.accepted_offer_id is not None
    assert lot.pickup_terms == "mandimate_delivery"
    assert lot.pickup_date == max(today_ist(), harvest.available_from)
    assert lot.collection_latitude == harvest.latitude
    members = (await db.scalars(select(LotMember).where(LotMember.lot_id == lot.id))).all()
    assert [(m.harvest_id, m.quantity_kg, m.consent_status) for m in members] == [
        (harvest.id, Decimal("350.00"), "accepted")
    ]
    await db.refresh(harvest)
    assert harvest.status == "committed"

    rival_offer = await db.get(Offer, rival.json()["id"])
    await db.refresh(rival_offer)
    assert rival_offer.status == "rejected"
    system = await db.scalar(
        select(NegotiationEntry).where(
            NegotiationEntry.offer_id == rival_offer.id, NegotiationEntry.author_role == "system"
        )
    )
    assert system is not None

    lot_view = (await farmer.get(f"{API}/lots/{lot.id}")).json()
    assert lot_view["buyer_name"] == "FreshBasket Retail Pvt Ltd"
    assert lot_view["price_per_kg"] == 17
    assert lot_view["journey_step"] == 6
    buyer_lot = await buyer.get(f"{API}/lots/{lot.id}")
    assert buyer_lot.status_code == 200

    # Terminal: no more negotiation.
    for action in ("accept", "reject", "withdraw"):
        response = await buyer.post(f"{API}/offers/{offer_id}/{action}", json={})
        assert response.status_code in (403, 409)
    assert (await farmer.post(f"{API}/offers/{offer_id}/reject", json={})).status_code == 409


async def test_reject_and_withdraw(db: AsyncSession, auth_client: Any) -> None:
    cluster = await make_cluster(db, (400,))
    harvest = cluster.harvests[0]
    buyer = auth_client(cluster.buyer)
    farmer = auth_client(cluster.farmers[0])

    first = (
        await buyer.post(f"{API}/offers", json=offer_body(harvest_id=harvest.id, quantity=100))
    ).json()
    rejected = await farmer.post(f"{API}/offers/{first['id']}/reject", json={"message": "Too low"})
    assert rejected.json()["status"] == "rejected"
    assert rejected.json()["negotiation"][-1]["message"] == "Too low"
    assert (await buyer.post(f"{API}/offers/{first['id']}/withdraw", json={})).status_code == 409

    second = (
        await buyer.post(f"{API}/offers", json=offer_body(harvest_id=harvest.id, quantity=100))
    ).json()
    assert (await farmer.post(f"{API}/offers/{second['id']}/withdraw", json={})).status_code == 403
    countered = await farmer.post(f"{API}/offers/{second['id']}/counter", json={"price_per_kg": 18})
    assert countered.json()["awaiting"] == "buyer"
    assert (await farmer.post(f"{API}/offers/{second['id']}/reject", json={})).status_code == 403
    buyer_reject = await buyer.post(f"{API}/offers/{second['id']}/reject", json={})
    assert buyer_reject.json()["status"] == "rejected"

    third = (
        await buyer.post(f"{API}/offers", json=offer_body(harvest_id=harvest.id, quantity=100))
    ).json()
    withdrawn = await buyer.post(f"{API}/offers/{third['id']}/withdraw", json={"message": "Sorry"})
    assert withdrawn.json()["status"] == "withdrawn"
    assert withdrawn.json()["negotiation"][-1]["action"] == "withdraw"
    await db.refresh(harvest)
    assert harvest.status == "listed"


async def test_lazy_expiry(db: AsyncSession, auth_client: Any) -> None:
    cluster = await make_cluster(db, (400,))
    offer = await factories.create_offer(
        db, cluster.buyer, harvest=cluster.harvests[0], valid_until=utcnow() - timedelta(minutes=1)
    )
    farmer = auth_client(cluster.farmers[0])
    accept = await farmer.post(f"{API}/offers/{offer.id}/accept", json={})
    assert accept.status_code == 409
    assert accept.json()["code"] == "offer_expired"
    listed = (await farmer.get(f"{API}/offers")).json()
    assert [(o["id"], o["status"]) for o in listed] == [(str(offer.id), "expired")]
    assert listed[0]["negotiation"][-1]["author_role"] == "system"
    again = await farmer.post(f"{API}/offers/{offer.id}/accept", json={})
    assert again.status_code == 409


# ─────────────────────────────── Lot deals & consent ───────────────────────────────


async def test_lot_offer_proposal_scales_pro_rata(db: AsyncSession, auth_client: Any) -> None:
    cluster = await make_cluster(db, (200, 300, 500))
    lot = await open_lot_with_all(auth_client, cluster)
    buyer = auth_client(cluster.buyer)
    coordinator = auth_client(cluster.coordinator)
    other_buyer = await factories.create_user(db, "buyer", organization_name="Metro Fresh")
    other = (
        await auth_client(other_buyer).post(
            f"{API}/offers", json=offer_body(lot_id=lot["id"], quantity=900, price_per_kg=15)
        )
    ).json()
    offer = (
        await buyer.post(f"{API}/offers", json=offer_body(lot_id=lot["id"], quantity=600))
    ).json()

    # Member farmers can see the lot offer but are not the seller side.
    farmer = auth_client(cluster.farmers[0])
    assert (await farmer.get(f"{API}/offers/{offer['id']}")).status_code == 200
    assert (await farmer.post(f"{API}/offers/{offer['id']}/accept", json={})).status_code == 403
    outsider = await factories.create_user(db, "farmer")
    assert (await auth_client(outsider).get(f"{API}/offers/{offer['id']}")).status_code == 404

    proposed = await coordinator.post(f"{API}/offers/{offer['id']}/accept", json={})
    assert proposed.status_code == 200, proposed.text
    body = proposed.json()
    assert (body["status"], body["awaiting"]) == ("proposed", "farmers")
    assert [c["quantity_kg"] for c in body["consents"]] == [120, 180, 300]
    assert [e["action"] for e in body["negotiation"]] == ["offer", "accept", "propose"]
    consent_notes = (
        await db.scalars(
            select(Notification).where(Notification.title == "Review the deal and consent")
        )
    ).all()
    assert len(consent_notes) == 3

    blocked = await coordinator.post(f"{API}/offers/{other['id']}/accept", json={})
    assert blocked.status_code == 409
    assert blocked.json()["code"] == "another_offer_proposed"
    assert (
        await coordinator.post(f"{API}/offers/{offer['id']}/counter", json={"price_per_kg": 20})
    ).status_code == 409

    for farmer_user in cluster.farmers:
        response = await auth_client(farmer_user).post(
            f"{API}/offers/{offer['id']}/consent", json={"decision": "accepted"}
        )
        assert response.status_code == 200, response.text
    final = response.json()
    assert final["status"] == "accepted"
    assert final["quantity_kg"] == 600

    members = (
        await db.scalars(
            select(LotMember).where(LotMember.lot_id == lot["id"]).order_by(LotMember.created_at)
        )
    ).all()
    for member in members:
        await db.refresh(member)
    assert [m.quantity_kg for m in members] == [
        Decimal("120.00"),
        Decimal("180.00"),
        Decimal("300.00"),
    ]
    for harvest in cluster.harvests:
        await db.refresh(harvest)
        assert harvest.status == "committed"

    other_row = await db.get(Offer, other["id"])
    await db.refresh(other_row)
    assert other_row.status == "rejected"
    lot_view = (await coordinator.get(f"{API}/lots/{lot['id']}")).json()
    assert lot_view["status"] == "offer_accepted"
    assert lot_view["total_quantity_kg"] == 600
    assert lot_view["accepted_offer_id"] == offer["id"]


async def test_offer_consent_decline_and_assisted(db: AsyncSession, auth_client: Any) -> None:
    cluster = await make_cluster(db, (200, 300))
    lot = await open_lot_with_all(auth_client, cluster)
    demand = await factories.create_demand(
        db, cluster.buyer, cluster.crop, min_quantity_kg=Decimal(200)
    )
    buyer = auth_client(cluster.buyer)
    coordinator = auth_client(cluster.coordinator)
    offer = (
        await buyer.post(
            f"{API}/offers",
            json=offer_body(lot_id=lot["id"], quantity=500, demand_id=str(demand.id)),
        )
    ).json()

    early = await auth_client(cluster.farmers[0]).post(
        f"{API}/offers/{offer['id']}/consent", json={"decision": "accepted"}
    )
    assert early.status_code == 409  # not proposed yet
    await coordinator.post(f"{API}/offers/{offer['id']}/accept", json={})

    declined = await auth_client(cluster.farmers[0]).post(
        f"{API}/offers/{offer['id']}/consent", json={"decision": "declined", "note": "Price low"}
    )
    assert declined.status_code == 200
    assert declined.json()["status"] == "proposed"
    await db.refresh(cluster.harvests[0])
    assert cluster.harvests[0].status == "listed"
    twice = await auth_client(cluster.farmers[0]).post(
        f"{API}/offers/{offer['id']}/consent", json={"decision": "accepted"}
    )
    assert twice.status_code == 409

    no_member = await coordinator.post(
        f"{API}/offers/{offer['id']}/consent", json={"decision": "accepted"}
    )
    assert no_member.status_code == 422
    member_id = next(
        c["member_id"]
        for c in declined.json()["consents"]
        if c["farmer_id"] == str(cluster.farmers[1].id)
    )
    buyer_consent = await buyer.post(
        f"{API}/offers/{offer['id']}/consent",
        params={"member_id": member_id},
        json={"decision": "accepted"},
    )
    assert buyer_consent.status_code == 403
    assisted = await coordinator.post(
        f"{API}/offers/{offer['id']}/consent",
        params={"member_id": member_id},
        json={"decision": "accepted", "note": "Agreed on the phone"},
    )
    assert assisted.status_code == 200, assisted.text
    final = assisted.json()
    assert final["status"] == "accepted"
    assert final["quantity_kg"] == 300  # the declining farmer's 200 kg left the deal
    assert await db.scalar(select(AuditLog).where(AuditLog.action == "offer.assisted_consent"))
    await db.refresh(demand)
    assert demand.status == "matched"


async def test_every_farmer_declining_rejects_the_offer(db: AsyncSession, auth_client: Any) -> None:
    cluster = await make_cluster(db, (200,))
    lot = await open_lot_with_all(auth_client, cluster)
    offer = (
        await auth_client(cluster.buyer).post(
            f"{API}/offers", json=offer_body(lot_id=lot["id"], quantity=200)
        )
    ).json()
    await auth_client(cluster.coordinator).post(f"{API}/offers/{offer['id']}/accept", json={})
    response = await auth_client(cluster.farmers[0]).post(
        f"{API}/offers/{offer['id']}/consent", json={"decision": "declined"}
    )
    assert response.json()["status"] == "rejected"
    assert response.json()["negotiation"][-1]["author_role"] == "system"


async def test_buyer_accepts_counter_on_lot_offer(db: AsyncSession, auth_client: Any) -> None:
    cluster = await make_cluster(db, (200, 300))
    lot = await open_lot_with_all(auth_client, cluster)
    buyer = auth_client(cluster.buyer)
    coordinator = auth_client(cluster.coordinator)
    offer = (
        await buyer.post(f"{API}/offers", json=offer_body(lot_id=lot["id"], quantity=500))
    ).json()
    countered = await coordinator.post(
        f"{API}/offers/{offer['id']}/counter", json={"price_per_kg": 17, "payment_terms_days": 3}
    )
    assert countered.json()["status"] == "countered"
    assert countered.json()["payment_terms_days"] == 3
    accepted = await buyer.post(f"{API}/offers/{offer['id']}/accept", json={})
    assert accepted.json()["status"] == "proposed"
    assert accepted.json()["price_per_kg"] == 17
    withdrawn = await buyer.post(f"{API}/offers/{offer['id']}/withdraw", json={})
    assert withdrawn.json()["status"] == "withdrawn"


# ─────────────────────────────── Listing ───────────────────────────────


async def test_list_offers_scopes(db: AsyncSession, auth_client: Any) -> None:
    cluster = await make_cluster(db, (200, 300))
    lot = await open_lot_with_all(auth_client, cluster, [(cluster.harvests[0], 200.0)])
    buyer = auth_client(cluster.buyer)
    lot_offer = (
        await buyer.post(f"{API}/offers", json=offer_body(lot_id=lot["id"], quantity=200))
    ).json()
    direct = (
        await buyer.post(
            f"{API}/offers", json=offer_body(harvest_id=cluster.harvests[1].id, quantity=100)
        )
    ).json()
    other_buyer = await factories.create_user(db, "buyer")

    assert [o["id"] for o in (await buyer.get(f"{API}/offers")).json()] == [
        direct["id"],
        lot_offer["id"],
    ]
    assert (await auth_client(other_buyer).get(f"{API}/offers")).json() == []
    assert (await auth_client(other_buyer).get(f"{API}/offers/{direct['id']}")).status_code == 404
    farmer0 = [o["id"] for o in (await auth_client(cluster.farmers[0]).get(f"{API}/offers")).json()]
    farmer1 = [o["id"] for o in (await auth_client(cluster.farmers[1]).get(f"{API}/offers")).json()]
    assert (farmer0, farmer1) == ([lot_offer["id"]], [direct["id"]])
    coordinator = auth_client(cluster.coordinator)
    by_lot = (await coordinator.get(f"{API}/offers", params={"lot_id": lot["id"]})).json()
    assert [o["id"] for o in by_lot] == [lot_offer["id"]]
    by_harvest = (
        await coordinator.get(f"{API}/offers", params={"harvest_id": str(cluster.harvests[1].id)})
    ).json()
    assert [o["id"] for o in by_harvest] == [direct["id"]]
    by_status = (await coordinator.get(f"{API}/offers", params={"status": "accepted"})).json()
    assert by_status == []
    transporter = await factories.create_user(db, "transporter")
    assert (await auth_client(transporter).get(f"{API}/offers")).status_code == 403
    assert (await coordinator.get(f"{API}/offers", params={"status": "bogus"})).status_code == 422


async def test_buyer_reliability_from_settlements(db: AsyncSession, auth_client: Any) -> None:
    from app.models import Settlement

    cluster = await make_cluster(db, (200,))
    lot = await factories.create_lot(db, cluster.crop, cluster.harvests, status="delivered")
    offer = await factories.create_offer(db, cluster.buyer, lot=lot, status="accepted")
    due = today_ist() - timedelta(days=3)
    db.add(
        Settlement(
            code="ST-00001",
            lot_id=lot.id,
            offer_id=offer.id,
            buyer_id=cluster.buyer.id,
            price_per_kg=Decimal(16),
            total_accepted_kg=Decimal(200),
            gross_amount=Decimal(3200),
            transport_cost=Decimal(0),
            handling_cost=Decimal(0),
            commission_amount=Decimal(0),
            net_to_farmers=Decimal(3200),
            amount_paid=Decimal(3200),
            payment_status="paid",
            due_date=due,
            paid_at=utcnow() - timedelta(days=5),
        )
    )
    await db.commit()
    view = (await auth_client(cluster.buyer).get(f"{API}/offers/{offer.id}")).json()
    assert view["buyer_reliability_pct"] == 100.0
    assert await db.scalar(select(Demand.id)) is None


async def test_direct_accept_withdraws_pools_without_accepted_deal(
    db: AsyncSession, auth_client: Any
) -> None:
    """DOMAIN_RULES §3: short free kg → the farmer leaves pools with no accepted deal."""
    cluster = await make_cluster(db, (400, 300, 200))
    h0, h1, h2 = cluster.harvests
    buyer = auth_client(cluster.buyer)
    coordinator = auth_client(cluster.coordinator)
    direct = (
        await buyer.post(
            f"{API}/offers", json=offer_body(harvest_id=h0.id, quantity=350, price_per_kg=18)
        )
    ).json()
    # Pool B (no accepted deal yet): 200 kg of h0 + h2; pool A (deal accepted): 100 kg of h0 + h1.
    lot_b = await open_lot_with_all(auth_client, cluster, [(h0, 200.0), (h2, 200.0)])
    lot_a = await open_lot_with_all(auth_client, cluster, [(h0, 100.0), (h1, 300.0)])
    rival = auth_client(await factories.create_user(db, "buyer", organization_name="Metro Fresh"))
    deal_a = (
        await rival.post(f"{API}/offers", json=offer_body(lot_id=lot_a["id"], quantity=400))
    ).json()
    deal_b = (
        await rival.post(f"{API}/offers", json=offer_body(lot_id=lot_b["id"], quantity=400))
    ).json()
    for deal, farmers in ((deal_a, (0, 1)), (deal_b, (2,))):
        assert (
            await coordinator.post(f"{API}/offers/{deal['id']}/accept", json={})
        ).status_code == 200
        for index in farmers:
            consent = await auth_client(cluster.farmers[index]).post(
                f"{API}/offers/{deal['id']}/consent", json={"decision": "accepted"}
            )
            assert consent.status_code == 200, consent.text

    # Free kg: 400 − 100 − 200 = 100; direct room: 400 − 100 (accepted pool) = 300.
    accepted = await auth_client(cluster.farmers[0]).post(
        f"{API}/offers/{direct['id']}/accept", json={}
    )
    assert accepted.status_code == 200, accepted.text
    assert (accepted.json()["status"], accepted.json()["quantity_kg"]) == ("accepted", 300)

    h0_id, coordinator_id, sold_to = h0.id, cluster.coordinator.id, buyer_name(cluster.buyer)
    db.expire_all()
    member_b = await db.scalar(
        select(LotMember).where(LotMember.lot_id == lot_b["id"], LotMember.harvest_id == h0_id)
    )
    assert member_b is not None
    assert member_b.consent_status == "declined"
    assert member_b.consent_note == f"Sold directly to {sold_to}"
    member_a = await db.scalar(
        select(LotMember).where(LotMember.lot_id == lot_a["id"], LotMember.harvest_id == h0_id)
    )
    assert member_a is not None
    assert (member_a.consent_status, member_a.quantity_kg) == ("accepted", Decimal(100))

    # h0's pending consent on pool B's deal was declined → the deal goes ahead with h2 alone.
    consent_b = await db.scalar(select(OfferConsent).where(OfferConsent.member_id == member_b.id))
    assert consent_b is not None and consent_b.decision == "declined"
    offer_b = await db.get(Offer, deal_b["id"])
    assert offer_b is not None and (offer_b.status, offer_b.quantity_kg) == (
        "accepted",
        Decimal(200),
    )
    assert (await db.get(Lot, lot_b["id"])).status == "offer_accepted"  # type: ignore[union-attr]
    assert (await db.get(Lot, lot_a["id"])).status == "offer_accepted"  # type: ignore[union-attr]
    assert await db.scalar(
        select(Notification).where(
            Notification.user_id == coordinator_id,
            Notification.title.like(f"%left lot {lot_b['code']}"),
        )
    )
    assert await db.scalar(select(AuditLog).where(AuditLog.action == "lot.member_withdrawn"))


async def test_direct_accept_empties_open_pool(db: AsyncSession, auth_client: Any) -> None:
    """An open pool left without farmers goes back to forming and its open offers close."""
    cluster = await make_cluster(db, (300,))
    h0 = cluster.harvests[0]
    buyer = auth_client(cluster.buyer)
    direct = (
        await buyer.post(f"{API}/offers", json=offer_body(harvest_id=h0.id, quantity=250))
    ).json()
    lot = await open_lot_with_all(auth_client, cluster, [(h0, 300.0)])
    rival = auth_client(await factories.create_user(db, "buyer", organization_name="Metro Fresh"))
    pooled = (
        await rival.post(f"{API}/offers", json=offer_body(lot_id=lot["id"], quantity=300))
    ).json()

    accepted = await auth_client(cluster.farmers[0]).post(
        f"{API}/offers/{direct['id']}/accept", json={}
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["quantity_kg"] == 250

    h0_id = h0.id
    db.expire_all()
    assert (await db.get(Lot, lot["id"])).status == "forming"  # type: ignore[union-attr]
    assert (await db.get(Offer, pooled["id"])).status == "rejected"  # type: ignore[union-attr]
    harvest = await db.get(Harvest, h0_id)
    assert harvest is not None and harvest.status == "committed"
