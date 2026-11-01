"""``POST /lots/match-preview``: load candidate harvests and run the matching engine (DOMAIN_RULES §4).

The pure engine (``services/matching.py``) applies rules 2–6, scores and allocates; this module
loads the same-crop harvests that could contribute (rule 1), their available kilograms and the
demand's minimum quantity, and shapes the result as a ``MatchProposal``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import select

from app import schemas
from app.core.errors import not_found
from app.core.time import today_ist
from app.models import Crop, Demand, Harvest
from app.services import matching
from app.services.lot_service import available_kg_map, conflict
from app.services.presenters import farmer_display_name
from app.services.pricing import to_decimal

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models import User

MAX_EXCLUDED = 50
"""The proposal lists at most this many excluded harvests."""


async def match_preview(
    db: AsyncSession, req: schemas.MatchPreviewRequest, viewer: User
) -> schemas.MatchProposal:
    """Compatible harvests for a lot of ``req.crop_id`` / ``req.grade``, best first."""
    crop = await db.get(Crop, req.crop_id)
    if crop is None:
        raise not_found("Crop")
    min_quantity = None
    if req.demand_id is not None:
        demand = await db.get(Demand, req.demand_id)
        if demand is None:
            raise not_found("Demand")
        if demand.crop_id != crop.id:
            raise conflict("The demand is for a different crop", "demand_mismatch")
        min_quantity = demand.min_quantity_kg

    harvests = (
        await db.scalars(
            select(Harvest)
            .where(
                Harvest.crop_id == crop.id,
                Harvest.status.in_(tuple(matching.POOLABLE_STATUSES)),
            )
            .order_by(Harvest.created_at, Harvest.id)
        )
    ).all()
    available = await available_kg_map(db, [harvest.id for harvest in harvests])
    candidates = [
        matching.CandidateInput(
            harvest_id=harvest.id,
            farmer_id=harvest.farmer_id,
            farmer_name=farmer_display_name(harvest.farmer, viewer),
            village=harvest.village,
            grade=harvest.grade,
            quality_status=harvest.quality_status,
            status=harvest.status,
            available_kg=available.get(harvest.id, to_decimal(0)),
            available_from=harvest.available_from,
            sell_by=harvest.sell_by,
            harvest_date=harvest.harvest_date,
            latitude=harvest.latitude,
            longitude=harvest.longitude,
        )
        for harvest in harvests
    ]
    params = matching.MatchParams(
        grade=req.grade,
        target_quantity_kg=to_decimal(req.target_quantity_kg),
        collection_latitude=req.collection_latitude,
        collection_longitude=req.collection_longitude,
        pickup_date=req.pickup_date,
        perishability_days=crop.perishability_days,
        today=today_ist(),
        radius_km=to_decimal(req.radius_km),
        include_ungraded=req.include_ungraded,
        min_quantity_kg=min_quantity,
    )
    result = matching.select_candidates(candidates, params, crop_name=crop.name)

    def candidate_out(scored: matching.ScoredCandidate) -> schemas.MatchCandidate:
        c = scored.candidate
        return schemas.MatchCandidate(
            harvest_id=c.harvest_id,
            farmer_id=c.farmer_id,
            farmer_name=c.farmer_name,
            village=c.village,
            grade=c.grade,
            quality_status=c.quality_status,
            available_kg=float(c.available_kg),
            proposed_kg=float(scored.proposed_kg),
            distance_km=float(scored.distance_km),
            sell_by=c.sell_by,
            score=float(scored.score),
            reasons=scored.reasons,
        )

    return schemas.MatchProposal(
        crop_id=crop.id,
        crop_name=crop.name,
        grade=req.grade,
        target_quantity_kg=float(params.target_quantity_kg),
        selected_total_kg=float(result.selected_total_kg),
        shortfall_kg=float(result.shortfall_kg),
        feasible=result.feasible,
        candidates=[candidate_out(s) for s in [*result.selected, *result.compatible_unselected]],
        excluded=[
            schemas.MatchExclusion(
                harvest_id=candidate.harvest_id, farmer_name=candidate.farmer_name, reason=reason
            )
            for candidate, reason in result.excluded[:MAX_EXCLUDED]
        ],
        rules_applied=result.rules_applied,
        explanation=result.explanation,
        collection_latitude=req.collection_latitude,
        collection_longitude=req.collection_longitude,
        pickup_date=req.pickup_date,
        demand_id=req.demand_id,
    )
