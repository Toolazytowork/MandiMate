"""Lots API: creation, visibility, joining, member consent, opening and cancelling.

Also hosts the small helpers the other deal tests (offers, selling options, journey, matching,
end-to-end flow) share.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import today_ist, utcnow
from app.models import AuditLog, Crop, Harvest, Lot, Notification, Offer, User
from tests import factories

API = "/api/v1"
COLLECTION = {
    "collection_point_name": "Madanapalle APMC",
    "collection_latitude": 13.5503,
    "collection_longitude": 78.5029,
}


@dataclass
class Cluster:
    crop: Crop
    coordinator: User
    farmers: list[User]
    harvests: list[Harvest]
    buyer: User


async def make_cluster(
    db: AsyncSession, quantities: tuple[int, ...] = (200, 350, 500), **harvest_overrides: Any
) -> Cluster:
    """A tomato cluster: one coordinator, one buyer and a farmer with a listed harvest per qty."""
    crop = await factories.create_crop(db)
    coordinator = await factories.create_user(db, "coordinator")
    buyer = await factories.create_user(db, "buyer")
    farmers: list[User] = []
    harvests: list[Harvest] = []
    for quantity in quantities:
        farmer = await factories.create_user(db, "farmer")
        farmers.append(farmer)
        harvests.append(
            await factories.create_harvest(
                db, farmer, crop, quantity_kg=Decimal(quantity), **harvest_overrides
            )
        )
    return Cluster(crop, coordinator, farmers, harvests, buyer)


def lot_body(cluster: Cluster, members: list[tuple[Harvest, float]], **overrides: Any) -> dict:
    body: dict[str, Any] = {
        "crop_id": str(cluster.crop.id),
        "grade": "A",
        "target_quantity_kg": sum(quantity for _, quantity in members) or 1000,
        **COLLECTION,
        "district": factories.DISTRICT,
        "state": factories.STATE,
        "pickup_date": (today_ist() + timedelta(days=2)).isoformat(),
        "members": [
            {"harvest_id": str(harvest.id), "quantity_kg": quantity}
            for harvest, quantity in members
        ],
    }
    return body | overrides


def offer_body(
    *, lot_id: Any = None, harvest_id: Any = None, quantity: float = 1000, **overrides: Any
) -> dict:
    target = (
        {"target_type": "lot", "lot_id": str(lot_id)}
        if lot_id is not None
        else {"target_type": "harvest", "harvest_id": str(harvest_id)}
    )
    body: dict[str, Any] = {
        **target,
        "price_per_kg": 16,
        "quantity_kg": quantity,
        "pickup_terms": "mandimate_delivery",
        "delivery_location": factories.BENGALURU_BUYER["delivery_location"],
        "delivery_latitude": factories.BENGALURU_BUYER["delivery_latitude"],
        "delivery_longitude": factories.BENGALURU_BUYER["delivery_longitude"],
        "payment_terms_days": 7,
        "max_rejection_pct": 5,
        "valid_until": (utcnow() + timedelta(days=3)).isoformat(),
    }
    return body | overrides


async def create_lot_via_api(
    client: AsyncClient, cluster: Cluster, members: list[tuple[Harvest, float]], **overrides: Any
) -> dict:
    response = await client.post(f"{API}/lots", json=lot_body(cluster, members, **overrides))
    assert response.status_code == 201, response.text
    return response.json()


async def open_lot_with_all(
    client_for: Any, cluster: Cluster, members: list[tuple[Harvest, float]] | None = None
) -> dict:
    """Create a lot of every cluster harvest (whole quantities), all consenting → open."""
    coordinator = client_for(cluster.coordinator)
    members = members or [(h, float(h.quantity_kg)) for h in cluster.harvests]
    lot = await create_lot_via_api(coordinator, cluster, members)
    by_harvest = {m["harvest_id"]: m["id"] for m in lot["members"]}
    for harvest, _ in members:
        farmer = next(f for f in cluster.farmers if f.id == harvest.farmer_id)
        response = await client_for(farmer).post(
            f"{API}/lots/{lot['id']}/members/{by_harvest[str(harvest.id)]}/consent",
            json={"decision": "accepted"},
        )
        assert response.status_code == 200, response.text
        lot = response.json()
    assert lot["status"] == "open_for_offers"
    return lot


# ─────────────────────────────── Create ───────────────────────────────


async def test_create_lot_awaits_consent_and_notifies(db: AsyncSession, auth_client: Any) -> None:
    cluster = await make_cluster(db)
    coordinator = auth_client(cluster.coordinator)
    members = [(cluster.harvests[0], 200.0), (cluster.harvests[1], 300.0)]

    lot = await create_lot_via_api(coordinator, cluster, members, match_explanation="Nearby")

    assert lot["code"] == "MM-TOM-0001"
    assert lot["status"] == "awaiting_consent"
    assert lot["total_quantity_kg"] == 500
    assert lot["member_count"] == 2
    assert lot["coordinator_id"] == str(cluster.coordinator.id)
    assert lot["coordinator_name"] == cluster.coordinator.full_name
    assert lot["journey_step"] == 2
    assert lot["offers_count"] == 0
    assert lot["match_explanation"] == "Nearby"
    assert [m["consent_status"] for m in lot["members"]] == ["pending", "pending"]
    assert lot["members"][0]["farmer_name"] == cluster.farmers[0].full_name  # coordinator
    assert lot["members"][0]["distance_km"] is not None

    for harvest in cluster.harvests[:2]:
        await db.refresh(harvest)
        assert harvest.status == "pooled"
    notes = (await db.scalars(select(Notification).where(Notification.type == "consent"))).all()
    assert {n.user_id for n in notes} == {cluster.farmers[0].id, cluster.farmers[1].id}
    assert all(n.title == "Consent to join pooled sale" for n in notes)
    audit = await db.scalar(select(AuditLog).where(AuditLog.action == "lot.create"))
    assert audit is not None


async def test_create_lot_without_members_is_forming(db: AsyncSession, auth_client: Any) -> None:
    cluster = await make_cluster(db, (100,))
    lot = await create_lot_via_api(
        auth_client(cluster.coordinator), cluster, [], target_quantity_kg=800
    )
    assert lot["status"] == "forming"
    assert lot["members"] == []
    assert lot["total_quantity_kg"] == 0


async def test_create_lot_validation(db: AsyncSession, auth_client: Any) -> None:
    cluster = await make_cluster(db, (200, 300))
    other_crop = await factories.create_crop(
        db, code="ONI", name="Onion", name_hi="प्याज", name_te="ఉల్లి"
    )
    onion = await factories.create_harvest(db, cluster.farmers[0], other_crop)
    grade_b = await factories.create_harvest(db, cluster.farmers[1], cluster.crop, grade="B")
    coordinator = auth_client(cluster.coordinator)
    h0, h1 = cluster.harvests

    cases = [
        ([(h0, 250.0)], 409, "insufficient_quantity"),
        ([(onion, 100.0)], 409, "crop_mismatch"),
        ([(grade_b, 100.0)], 409, "grade_mismatch"),
    ]
    for members, status, code in cases:
        response = await coordinator.post(f"{API}/lots", json=lot_body(cluster, members))
        assert response.status_code == status, response.text
        assert response.json()["code"] == code

    duplicate = await coordinator.post(
        f"{API}/lots", json=lot_body(cluster, [(h0, 100.0), (h0, 50.0)])
    )
    assert duplicate.status_code == 422
    negative = await coordinator.post(f"{API}/lots", json=lot_body(cluster, [(h1, -5.0)]))
    assert negative.status_code == 422
    past = await coordinator.post(
        f"{API}/lots",
        json=lot_body(
            cluster, [(h1, 50.0)], pickup_date=(today_ist() - timedelta(days=1)).isoformat()
        ),
    )
    assert past.status_code == 422
    missing = await coordinator.post(
        f"{API}/lots",
        json=lot_body(cluster, [(h1, 50.0)])
        | {"members": [{"harvest_id": str(cluster.crop.id), "quantity_kg": 5}]},
    )
    assert missing.status_code == 404


async def test_ungraded_harvest_is_flagged_for_inspection(
    db: AsyncSession, auth_client: Any
) -> None:
    cluster = await make_cluster(db, (300,), grade="ungraded")
    lot = await create_lot_via_api(
        auth_client(cluster.coordinator), cluster, [(cluster.harvests[0], 300.0)]
    )
    assert lot["members"][0]["harvest_quality_status"] == "pending_inspection"


async def test_only_coordinators_create_or_preview(db: AsyncSession, auth_client: Any) -> None:
    cluster = await make_cluster(db, (200,))
    body = lot_body(cluster, [(cluster.harvests[0], 100.0)])
    for user in (cluster.farmers[0], cluster.buyer):
        response = await auth_client(user).post(f"{API}/lots", json=body)
        assert response.status_code == 403
    admin = await factories.create_user(db, "admin")
    response = await auth_client(admin).post(f"{API}/lots", json=body)
    assert response.status_code == 201


async def test_unauthenticated_is_401(client: AsyncClient) -> None:
    assert (await client.get(f"{API}/lots")).status_code == 401


# ─────────────────────────────── Consent & open ───────────────────────────────


async def test_all_consents_open_the_lot_and_masks_names(
    db: AsyncSession, auth_client: Any
) -> None:
    cluster = await make_cluster(db, (200, 350))
    lot = await open_lot_with_all(auth_client, cluster)
    assert lot["status"] == "open_for_offers"
    assert lot["journey_step"] == 3

    farmer_view = (await auth_client(cluster.farmers[0]).get(f"{API}/lots/{lot['id']}")).json()
    names = {m["farmer_id"]: (m["farmer_name"], m["is_mine"]) for m in farmer_view["members"]}
    assert names[str(cluster.farmers[0].id)] == (cluster.farmers[0].full_name, True)
    other = cluster.farmers[1]
    first, *_, last = other.full_name.split()
    assert names[str(other.id)] == (f"{first} {last[0]}.", False)

    buyer_view = await auth_client(cluster.buyer).get(f"{API}/lots/{lot['id']}")
    assert buyer_view.status_code == 200
    assert all(m["farmer_name"].endswith(".") for m in buyer_view.json()["members"])

    opened = await db.scalar(select(AuditLog).where(AuditLog.action == "lot.opened"))
    assert opened is not None


async def test_decline_frees_harvest_and_open_declines_non_responders(
    db: AsyncSession, auth_client: Any
) -> None:
    cluster = await make_cluster(db, (200, 350, 500))
    coordinator = auth_client(cluster.coordinator)
    members = [(h, float(h.quantity_kg)) for h in cluster.harvests]
    lot = await create_lot_via_api(coordinator, cluster, members)
    ids = [m["id"] for m in lot["members"]]

    accepted = await auth_client(cluster.farmers[0]).post(
        f"{API}/lots/{lot['id']}/members/{ids[0]}/consent", json={"decision": "accepted"}
    )
    assert accepted.json()["status"] == "awaiting_consent"
    declined = await auth_client(cluster.farmers[1]).post(
        f"{API}/lots/{lot['id']}/members/{ids[1]}/consent",
        json={"decision": "declined", "note": "Selling locally"},
    )
    assert declined.status_code == 200
    assert declined.json()["total_quantity_kg"] == 700
    await db.refresh(cluster.harvests[1])
    assert cluster.harvests[1].status == "listed"

    # Someone else's member → 403; a buyer cannot see the lot yet → 404.
    wrong = await auth_client(cluster.farmers[0]).post(
        f"{API}/lots/{lot['id']}/members/{ids[2]}/consent", json={"decision": "accepted"}
    )
    assert wrong.status_code == 403
    hidden = await auth_client(cluster.buyer).get(f"{API}/lots/{lot['id']}")
    assert hidden.status_code == 404

    opened = await coordinator.post(f"{API}/lots/{lot['id']}/open")
    assert opened.status_code == 200
    body = opened.json()
    assert body["status"] == "open_for_offers"
    assert [m["consent_status"] for m in body["members"]] == ["accepted", "declined", "declined"]
    assert body["total_quantity_kg"] == 200
    await db.refresh(cluster.harvests[2])
    assert cluster.harvests[2].status == "listed"

    again = await coordinator.post(f"{API}/lots/{lot['id']}/open")
    assert again.status_code == 409
    late = await auth_client(cluster.farmers[2]).post(
        f"{API}/lots/{lot['id']}/members/{ids[2]}/consent", json={"decision": "accepted"}
    )
    assert late.status_code == 409


async def test_open_requires_an_accepted_member(db: AsyncSession, auth_client: Any) -> None:
    cluster = await make_cluster(db, (200,))
    coordinator = auth_client(cluster.coordinator)
    lot = await create_lot_via_api(coordinator, cluster, [(cluster.harvests[0], 200.0)])
    response = await coordinator.post(f"{API}/lots/{lot['id']}/open")
    assert response.status_code == 409
    assert response.json()["code"] == "no_accepted_members"
    farmer_open = await auth_client(cluster.farmers[0]).post(f"{API}/lots/{lot['id']}/open")
    assert farmer_open.status_code == 403


async def test_assisted_consent_is_audited(db: AsyncSession, auth_client: Any) -> None:
    cluster = await make_cluster(db, (200,))
    coordinator = auth_client(cluster.coordinator)
    lot = await create_lot_via_api(coordinator, cluster, [(cluster.harvests[0], 200.0)])
    member_id = lot["members"][0]["id"]
    response = await coordinator.post(
        f"{API}/lots/{lot['id']}/members/{member_id}/consent",
        json={"decision": "accepted", "note": "Confirmed by phone"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "open_for_offers"
    entry = await db.scalar(select(AuditLog).where(AuditLog.action == "lot.assisted_consent"))
    assert entry is not None
    assert entry.summary.startswith("Assisted consent")


# ─────────────────────────────── Join ───────────────────────────────


async def test_farmer_joins_forming_lot(db: AsyncSession, auth_client: Any) -> None:
    cluster = await make_cluster(db, (200, 300))
    coordinator = auth_client(cluster.coordinator)
    lot = await create_lot_via_api(coordinator, cluster, [], target_quantity_kg=1000)
    farmer = auth_client(cluster.farmers[0])

    listed = (await farmer.get(f"{API}/lots")).json()
    assert [item["id"] for item in listed] == [lot["id"]]  # joinable: same crop listed
    assert (await farmer.get(f"{API}/lots", params={"mine": "true"})).json() == []

    joined = await farmer.post(
        f"{API}/lots/{lot['id']}/join",
        json={"harvest_id": str(cluster.harvests[0].id), "quantity_kg": 150},
    )
    assert joined.status_code == 200, joined.text
    body = joined.json()
    assert body["members"][0]["consent_status"] == "accepted"
    assert body["members"][0]["is_mine"] is True
    assert body["status"] == "open_for_offers"  # nobody pending, one accepted

    again = await farmer.post(
        f"{API}/lots/{lot['id']}/join",
        json={"harvest_id": str(cluster.harvests[0].id), "quantity_kg": 10},
    )
    assert again.status_code == 409  # lot no longer forming

    other_lot = await create_lot_via_api(coordinator, cluster, [], target_quantity_kg=500)
    not_mine = await farmer.post(
        f"{API}/lots/{other_lot['id']}/join",
        json={"harvest_id": str(cluster.harvests[1].id), "quantity_kg": 10},
    )
    assert not_mine.status_code == 404
    too_much = await farmer.post(
        f"{API}/lots/{other_lot['id']}/join",
        json={"harvest_id": str(cluster.harvests[0].id), "quantity_kg": 100},
    )
    assert too_much.status_code == 409
    assert too_much.json()["code"] == "insufficient_quantity"
    buyer_join = await auth_client(cluster.buyer).post(
        f"{API}/lots/{other_lot['id']}/join",
        json={"harvest_id": str(cluster.harvests[0].id), "quantity_kg": 10},
    )
    assert buyer_join.status_code == 403


# ─────────────────────────────── Listing & visibility ───────────────────────────────


async def test_list_scopes_per_role(db: AsyncSession, auth_client: Any) -> None:
    cluster = await make_cluster(db, (200, 300))
    coordinator = auth_client(cluster.coordinator)
    open_lot = await open_lot_with_all(auth_client, cluster, [(cluster.harvests[0], 200.0)])
    pending_lot = await create_lot_via_api(coordinator, cluster, [(cluster.harvests[1], 300.0)])

    all_lots = (await coordinator.get(f"{API}/lots")).json()
    assert [lot["id"] for lot in all_lots] == [pending_lot["id"], open_lot["id"]]  # newest first
    filtered = (await coordinator.get(f"{API}/lots", params={"status": "open_for_offers"})).json()
    assert [lot["id"] for lot in filtered] == [open_lot["id"]]
    mine = (await coordinator.get(f"{API}/lots", params={"mine": "true"})).json()
    assert len(mine) == 2

    buyer_lots = (await auth_client(cluster.buyer).get(f"{API}/lots")).json()
    assert [lot["id"] for lot in buyer_lots] == [open_lot["id"]]
    assert (
        await auth_client(cluster.buyer).get(f"{API}/lots", params={"mine": "true"})
    ).json() == []

    farmer_lots = (await auth_client(cluster.farmers[1]).get(f"{API}/lots")).json()
    assert [lot["id"] for lot in farmer_lots] == [pending_lot["id"]]

    transporter = await factories.create_user(db, "transporter")
    assert (await auth_client(transporter).get(f"{API}/lots")).json() == []
    hidden = await auth_client(transporter).get(f"{API}/lots/{open_lot['id']}")
    assert hidden.status_code == 404
    unknown = await coordinator.get(f"{API}/lots/{cluster.crop.id}")
    assert unknown.status_code == 404


# ─────────────────────────────── Cancel ───────────────────────────────


async def test_cancel_rejects_open_offers_and_frees_harvests(
    db: AsyncSession, auth_client: Any
) -> None:
    cluster = await make_cluster(db, (200, 300))
    lot = await open_lot_with_all(auth_client, cluster)
    buyer = auth_client(cluster.buyer)
    offer = await buyer.post(f"{API}/offers", json=offer_body(lot_id=lot["id"], quantity=500))
    assert offer.status_code == 201

    forbidden = await auth_client(cluster.farmers[0]).post(f"{API}/lots/{lot['id']}/cancel")
    assert forbidden.status_code == 403
    response = await auth_client(cluster.coordinator).post(f"{API}/lots/{lot['id']}/cancel")
    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"

    stored = await db.scalar(select(Offer).where(Offer.id == offer.json()["id"]))
    await db.refresh(stored)
    assert stored.status == "rejected"
    for harvest in cluster.harvests:
        await db.refresh(harvest)
        assert harvest.status == "listed"
    again = await auth_client(cluster.coordinator).post(f"{API}/lots/{lot['id']}/cancel")
    assert again.status_code == 409
    lot_row = await db.get(Lot, lot["id"])
    await db.refresh(lot_row)
    assert lot_row.cancelled_reason
