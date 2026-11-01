"""POST /lots/match-preview: candidate loading, exclusions, allocation and permissions."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import today_ist
from tests import factories
from tests.api.test_lots import API, COLLECTION, create_lot_via_api, make_cluster


def preview_body(crop_id: Any, **overrides: Any) -> dict:
    body: dict[str, Any] = {
        "crop_id": str(crop_id),
        "grade": "A",
        "target_quantity_kg": 1000,
        "collection_latitude": COLLECTION["collection_latitude"],
        "collection_longitude": COLLECTION["collection_longitude"],
        "pickup_date": (today_ist() + timedelta(days=2)).isoformat(),
        "radius_km": 60,  # every factory village is within 60 km of Madanapalle by road
    }
    return body | overrides


async def test_match_preview_selects_and_excludes(db: AsyncSession, auth_client: Any) -> None:
    cluster = await make_cluster(db, (200, 350, 500))
    crop, farmer = cluster.crop, cluster.farmers[0]
    today = today_ist()
    grade_b = await factories.create_harvest(db, farmer, crop, grade="B")
    ungraded = await factories.create_harvest(db, farmer, crop, grade="ungraded")
    far_away = await factories.create_harvest(db, farmer, crop, latitude=17.385, longitude=78.4867)
    stale = await factories.create_harvest(db, farmer, crop, sell_by=today + timedelta(days=1))
    draft = await factories.create_harvest(db, farmer, crop, status="draft")
    onion = await factories.create_crop(db, code="ONI", name="Onion", name_hi="प्याज", name_te="ఉల్లి")
    await factories.create_harvest(db, farmer, onion)

    response = await auth_client(cluster.coordinator).post(
        f"{API}/lots/match-preview", json=preview_body(crop.id)
    )
    assert response.status_code == 200, response.text
    proposal = response.json()

    assert proposal["crop_name"] == "Tomato"
    assert proposal["target_quantity_kg"] == 1000
    assert proposal["selected_total_kg"] == 1000
    assert proposal["shortfall_kg"] == 0
    assert proposal["feasible"] is True
    assert len(proposal["rules_applied"]) == 6
    assert proposal["explanation"].startswith("Selected 3 harvests of tomato")
    candidates = {c["harvest_id"]: c for c in proposal["candidates"]}
    assert set(candidates) == {str(h.id) for h in cluster.harvests}
    assert sum(c["proposed_kg"] for c in candidates.values()) == 1000
    for harvest in cluster.harvests:
        candidate = candidates[str(harvest.id)]
        assert candidate["proposed_kg"] <= candidate["available_kg"] == float(harvest.quantity_kg)
    scores = [c["score"] for c in proposal["candidates"]]
    assert scores == sorted(scores, reverse=True)
    names = {c["farmer_name"] for c in proposal["candidates"]}
    assert names == {f.full_name for f in cluster.farmers}  # full names for coordinators

    excluded = {e["harvest_id"]: e["reason"] for e in proposal["excluded"]}
    assert set(excluded) == {str(h.id) for h in (grade_b, ungraded, far_away, stale)}
    assert excluded[str(grade_b.id)] == "Grade B does not match requested grade A"
    assert excluded[str(stale.id)] == "Sell-by date passes before pickup"
    assert excluded[str(far_away.id)].startswith("Outside 60 km radius")
    assert str(draft.id) not in excluded  # only listed/pooled harvests are loaded

    with_ungraded = (
        await auth_client(cluster.coordinator).post(
            f"{API}/lots/match-preview", json=preview_body(crop.id, include_ungraded=True)
        )
    ).json()
    flagged = next(c for c in with_ungraded["candidates"] if c["harvest_id"] == str(ungraded.id))
    assert "Ungraded — inspection required before pickup" in flagged["reasons"]


async def test_match_preview_uses_available_kg_and_demand_minimum(
    db: AsyncSession, auth_client: Any
) -> None:
    cluster = await make_cluster(db, (400, 300))
    coordinator = auth_client(cluster.coordinator)
    await create_lot_via_api(coordinator, cluster, [(cluster.harvests[0], 250.0)])
    demand = await factories.create_demand(
        db, cluster.buyer, cluster.crop, min_quantity_kg=Decimal(450)
    )

    proposal = (
        await coordinator.post(
            f"{API}/lots/match-preview",
            json=preview_body(cluster.crop.id, demand_id=str(demand.id)),
        )
    ).json()
    available = {c["harvest_id"]: c["available_kg"] for c in proposal["candidates"]}
    assert available == {str(cluster.harvests[0].id): 150, str(cluster.harvests[1].id): 300}
    assert proposal["selected_total_kg"] == 450
    assert proposal["shortfall_kg"] == 550
    assert proposal["feasible"] is True  # meets the demand's 450 kg minimum
    assert proposal["demand_id"] == str(demand.id)

    without_demand = (
        await coordinator.post(f"{API}/lots/match-preview", json=preview_body(cluster.crop.id))
    ).json()
    assert without_demand["feasible"] is False  # 90% of the target is needed


async def test_match_preview_permissions_and_validation(db: AsyncSession, auth_client: Any) -> None:
    cluster = await make_cluster(db, (200,))
    body = preview_body(cluster.crop.id)
    for user in (cluster.farmers[0], cluster.buyer):
        response = await auth_client(user).post(f"{API}/lots/match-preview", json=body)
        assert response.status_code == 403
    coordinator = auth_client(cluster.coordinator)
    assert (
        await coordinator.post(f"{API}/lots/match-preview", json=preview_body(cluster.buyer.id))
    ).status_code == 404
    assert (
        await coordinator.post(
            f"{API}/lots/match-preview", json=preview_body(cluster.crop.id, radius_km=0)
        )
    ).status_code == 422
    assert (
        await coordinator.post(
            f"{API}/lots/match-preview",
            json=preview_body(cluster.crop.id, demand_id=str(cluster.crop.id)),
        )
    ).status_code == 404
