"""Matching engine (DOMAIN_RULES §4): which listed harvests can be pooled into one lot.

Pure functions. The caller loads harvests of the requested crop (rule 1 is enforced by its query)
and passes them in as ``CandidateInput``; this module applies rules 2–6, scores the compatible
harvests and allocates kilograms in score order without ever exceeding a farmer's available
quantity or inventing supply.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal
from typing import TYPE_CHECKING

from app.services.pricing import DEFAULT_RADIUS_KM, format_number, road_km, round_money, to_decimal

if TYPE_CHECKING:
    from app import schemas

POOLABLE_STATUSES: frozenset[str] = frozenset({"listed", "pooled"})
"""Rule 2: only these harvest statuses can contribute to a new lot."""
QUALITY_POINTS: dict[str, int] = {"inspected": 20, "pending_inspection": 10, "self_reported": 5}
DISTANCE_POINTS = Decimal(40)
URGENCY_POINTS = Decimal(30)
SIZE_POINTS = Decimal(10)
URGENCY_HORIZON_DAYS = 7
"""Harvests whose sell-by is this many days away or more get no urgency points."""
URGENT_SELL_BY_DAYS = 2
"""A sell-by this close is called out as prioritised to avoid spoilage."""
FEASIBLE_SHARE_OF_TARGET = Decimal("0.9")
"""Without a demand minimum, a match is feasible at 90% of the target."""

_CENT = Decimal("0.01")
_ZERO_KG = Decimal("0.00")


@dataclass(frozen=True)
class CandidateInput:
    harvest_id: uuid.UUID
    farmer_id: uuid.UUID
    farmer_name: str
    village: str | None
    grade: schemas.Grade
    quality_status: schemas.QualityStatus
    status: schemas.HarvestStatus
    available_kg: Decimal
    available_from: date
    sell_by: date
    harvest_date: date
    latitude: float | None
    longitude: float | None


@dataclass(frozen=True)
class MatchParams:
    grade: schemas.Grade
    target_quantity_kg: Decimal
    collection_latitude: float
    collection_longitude: float
    pickup_date: date
    perishability_days: int
    today: date
    radius_km: Decimal = DEFAULT_RADIUS_KM
    include_ungraded: bool = False
    min_quantity_kg: Decimal | None = None
    """The demand's minimum acceptable quantity; feasibility falls back to 90% of the target."""


@dataclass
class ScoredCandidate:
    candidate: CandidateInput
    distance_km: Decimal
    score: Decimal
    proposed_kg: Decimal
    """0 when the harvest is compatible but not needed to reach the target."""
    reasons: list[str]


@dataclass
class MatchResult:
    selected: list[ScoredCandidate]
    """Harvests contributing kilograms, best score first."""
    compatible_unselected: list[ScoredCandidate]
    """Compatible harvests not needed to reach the target (``proposed_kg == 0``), best first."""
    excluded: list[tuple[CandidateInput, str]]
    """Incompatible harvests with the first rule they fail, in input order."""
    selected_total_kg: Decimal
    shortfall_kg: Decimal
    feasible: bool
    rules_applied: list[str]
    explanation: str


@dataclass(frozen=True)
class _Ranked:
    candidate: CandidateInput
    available_kg: Decimal
    distance_km: Decimal
    score: Decimal
    days_to_sell_by: int


def select_candidates(
    candidates: Sequence[CandidateInput], params: MatchParams, *, crop_name: str
) -> MatchResult:
    """Apply rules 2–6, score the compatible harvests and allocate up to the target.

    Score (0–100) = distance ``40 × (1 − d/radius)`` + urgency
    ``30 × (1 − clamp(days to sell-by, 0, 7)/7)`` + quality (inspected 20, pending inspection 10,
    self-reported 5) + size ``10 × min(available/target, 1)``. Harvests are taken by score
    (ties: nearer first) and each contributes ``min(available, remaining)`` until the target is met.
    """
    target = round_money(params.target_quantity_kg)
    radius = to_decimal(params.radius_km)
    if target <= 0:
        raise ValueError("target_quantity_kg must be positive")
    if radius <= 0:
        raise ValueError("radius_km must be positive")

    ranked: list[_Ranked] = []
    excluded: list[tuple[CandidateInput, str]] = []
    for candidate in candidates:
        outcome = _assess(candidate, params, radius)
        if isinstance(outcome, str):
            excluded.append((candidate, outcome))
            continue
        available = _allocatable_kg(candidate)
        days_to_sell_by = (candidate.sell_by - params.today).days
        ranked.append(
            _Ranked(
                candidate=candidate,
                available_kg=available,
                distance_km=outcome,
                score=_score(
                    candidate, available, outcome, days_to_sell_by, target=target, radius=radius
                ),
                days_to_sell_by=days_to_sell_by,
            )
        )
    ranked.sort(
        key=lambda item: (
            -item.score,
            item.distance_km,
            item.candidate.sell_by,
            str(item.candidate.harvest_id),
        )
    )

    selected: list[ScoredCandidate] = []
    unselected: list[ScoredCandidate] = []
    remaining = target
    for item in ranked:
        proposed = min(item.available_kg, remaining)
        remaining -= proposed
        scored = ScoredCandidate(
            candidate=item.candidate,
            distance_km=item.distance_km,
            score=item.score,
            proposed_kg=proposed,
            reasons=_reasons(item, proposed, params),
        )
        (selected if proposed > 0 else unselected).append(scored)

    selected_total = round_money(sum((item.proposed_kg for item in selected), _ZERO_KG))
    shortfall = round_money(max(target - selected_total, _ZERO_KG))
    required = (
        round_money(params.min_quantity_kg)
        if params.min_quantity_kg is not None
        else round_money(target * FEASIBLE_SHARE_OF_TARGET)
    )
    feasible = selected_total >= required
    return MatchResult(
        selected=selected,
        compatible_unselected=unselected,
        excluded=excluded,
        selected_total_kg=selected_total,
        shortfall_kg=shortfall,
        feasible=feasible,
        rules_applied=_rules_applied(params, radius, crop_name),
        explanation=_explanation(
            selected=selected,
            unselected=unselected,
            excluded=excluded,
            params=params,
            crop_name=crop_name,
            target=target,
            radius=radius,
            selected_total=selected_total,
            shortfall=shortfall,
            required=required,
            feasible=feasible,
        ),
    )


def _allocatable_kg(candidate: CandidateInput) -> Decimal:
    """Available kilograms at 2 decimals, rounded down so an allocation never exceeds them."""
    return to_decimal(candidate.available_kg).quantize(_CENT, rounding=ROUND_DOWN)


def _assess(candidate: CandidateInput, params: MatchParams, radius: Decimal) -> Decimal | str:
    """Road distance to the collection point when compatible, else the first failed rule."""
    if candidate.status not in POOLABLE_STATUSES:
        return f"Not available for pooling (status: {candidate.status.replace('_', ' ')})"
    if _allocatable_kg(candidate) <= 0:
        return "Nothing left to allocate"
    if candidate.grade != params.grade and not (
        params.include_ungraded and candidate.grade == "ungraded"
    ):
        if candidate.grade == "ungraded":
            return f"Ungraded produce does not match requested grade {params.grade}"
        return f"Grade {candidate.grade} does not match requested grade {params.grade}"
    if params.pickup_date < candidate.available_from:
        return f"Not available until {candidate.available_from.isoformat()}"
    if params.pickup_date > candidate.sell_by:
        return "Sell-by date passes before pickup"
    if candidate.latitude is None or candidate.longitude is None:
        return "Location missing"
    distance = road_km(
        candidate.latitude,
        candidate.longitude,
        params.collection_latitude,
        params.collection_longitude,
    )
    if distance > radius:
        return f"Outside {format_number(radius)} km radius ({distance} km)"
    age_days = (params.pickup_date - candidate.harvest_date).days
    if age_days > params.perishability_days:
        return f"Too old by pickup ({age_days} days > {params.perishability_days}-day shelf life)"
    return distance


def _score(
    candidate: CandidateInput,
    available: Decimal,
    distance: Decimal,
    days_to_sell_by: int,
    *,
    target: Decimal,
    radius: Decimal,
) -> Decimal:
    distance_points = DISTANCE_POINTS * (1 - distance / radius)
    urgency_days = min(max(days_to_sell_by, 0), URGENCY_HORIZON_DAYS)
    urgency_points = URGENCY_POINTS * (1 - Decimal(urgency_days) / URGENCY_HORIZON_DAYS)
    quality_points = Decimal(QUALITY_POINTS[candidate.quality_status])
    size_points = SIZE_POINTS * min(available / target, Decimal(1))
    total = distance_points + urgency_points + quality_points + size_points
    return total.quantize(_CENT, rounding=ROUND_HALF_UP)


def _sell_by_reason(days_to_sell_by: int) -> str:
    if days_to_sell_by <= 0:
        when = "Sell-by today"
    else:
        when = f"Sell-by in {days_to_sell_by} {'day' if days_to_sell_by == 1 else 'days'}"
    if days_to_sell_by <= URGENT_SELL_BY_DAYS:
        return f"{when} — prioritised to avoid spoilage"
    return when


_QUALITY_REASONS: dict[str, str] = {
    "inspected": "Quality inspected",
    "pending_inspection": "Quality inspection pending",
    "self_reported": "Quality self-reported",
}


def _reasons(item: _Ranked, proposed: Decimal, params: MatchParams) -> list[str]:
    reasons = [
        f"{item.distance_km} km from collection point",
        _sell_by_reason(item.days_to_sell_by),
        _QUALITY_REASONS[item.candidate.quality_status],
    ]
    if item.candidate.grade == "ungraded" and params.grade != "ungraded":
        reasons.append("Ungraded — inspection required before pickup")
    if proposed == 0:
        reasons.append("Not needed — target already reached")
    elif proposed < item.available_kg:
        reasons.append(
            f"{format_number(proposed)} of {format_number(item.available_kg)} kg needed "
            "to complete the target"
        )
    else:
        reasons.append(f"All {format_number(item.available_kg)} kg available included")
    return reasons


def _rules_applied(params: MatchParams, radius: Decimal, crop_name: str) -> list[str]:
    grade_rule = f"Grade {params.grade} only — produce of different grades is never mixed"
    if params.include_ungraded and params.grade != "ungraded":
        grade_rule += "; ungraded listings included, inspection required before pickup"
    return [
        f"Same crop only: {crop_name}",
        "Only harvests that are listed or pooled and still have kilograms available",
        grade_rule,
        f"Available on the pickup date ({params.pickup_date.isoformat()}) and not past sell-by",
        f"Farm within {format_number(radius)} km by road of the collection point",
        f"No older than {params.perishability_days} days at pickup (shelf life)",
    ]


def _harvests(count: int) -> str:
    return f"{count} {'harvest' if count == 1 else 'harvests'}"


def _explanation(
    *,
    selected: list[ScoredCandidate],
    unselected: list[ScoredCandidate],
    excluded: list[tuple[CandidateInput, str]],
    params: MatchParams,
    crop_name: str,
    target: Decimal,
    radius: Decimal,
    selected_total: Decimal,
    shortfall: Decimal,
    required: Decimal,
    feasible: bool,
) -> str:
    crop = crop_name.lower()
    excluded_count = len(excluded)
    excluded_sentence = (
        f"{_harvests(excluded_count)} {'was' if excluded_count == 1 else 'were'} excluded."
        if excluded_count
        else "No harvests were excluded."
    )
    if not selected:
        return (
            f"No compatible {crop} harvests of grade {params.grade} were found within "
            f"{format_number(radius)} km for pickup on {params.pickup_date.isoformat()}. "
            f"{excluded_sentence}"
        )

    nearest = min(item.distance_km for item in selected)
    earliest_sell_by = min(item.candidate.sell_by for item in selected)
    total_sentence = (
        f"Selected {_harvests(len(selected))} of {crop} (grade {params.grade}) totalling "
        f"{format_number(selected_total)} kg against a {format_number(target)} kg target"
    )
    total_sentence += f", {format_number(shortfall)} kg short." if shortfall > 0 else "."
    sentences = [
        total_sentence,
        f"The nearest is {nearest} km from the collection point and the earliest sell-by is "
        f"{earliest_sell_by.isoformat()}.",
    ]
    if not feasible:
        sentences.append(f"Not enough to proceed: at least {format_number(required)} kg is needed.")
    elif shortfall > 0:
        sentences.append(f"Enough to proceed: at least {format_number(required)} kg is needed.")
    if unselected:
        backup = "harvest is" if len(unselected) == 1 else "harvests are"
        sentences.append(f"{len(unselected)} more compatible {backup} available as backup.")
    sentences.append(excluded_sentence)
    return " ".join(sentences)
