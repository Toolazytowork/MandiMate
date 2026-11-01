"""Matching engine (DOMAIN_RULES §4): compatibility rules, scoring, allocation and feasibility."""

import uuid
from dataclasses import replace
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.services.matching import (
    CandidateInput,
    MatchParams,
    MatchResult,
    ScoredCandidate,
    select_candidates,
)

pytestmark = []

TODAY = date(2026, 10, 27)
PICKUP = date(2026, 10, 28)
MADANAPALLE = (13.5503, 78.5029)  # collection point
PUNGANUR = (13.3650, 78.5730)  # 28.5 km by road
B_KOTHAKOTA = (13.6575, 78.2697)  # 36.2 km by road
PALAMANER = (13.2000, 78.7500)  # 61.4 km by road


def candidate(
    location: tuple[float, float] | None = PUNGANUR, **overrides: object
) -> CandidateInput:
    latitude, longitude = location if location is not None else (None, None)
    base = CandidateInput(
        harvest_id=uuid.uuid4(),
        farmer_id=uuid.uuid4(),
        farmer_name="Ravi Kumar",
        village="Punganur",
        grade="A",
        quality_status="inspected",
        status="listed",
        available_kg=Decimal("300"),
        available_from=TODAY,
        sell_by=TODAY + timedelta(days=5),
        harvest_date=TODAY,
        latitude=latitude,
        longitude=longitude,
    )
    return replace(base, **overrides)  # type: ignore[arg-type]


def params(**overrides: object) -> MatchParams:
    base = MatchParams(
        grade="A",
        target_quantity_kg=Decimal("1000"),
        collection_latitude=MADANAPALLE[0],
        collection_longitude=MADANAPALLE[1],
        pickup_date=PICKUP,
        perishability_days=7,
        today=TODAY,
    )
    return replace(base, **overrides)  # type: ignore[arg-type]


def match(candidates: list[CandidateInput], **overrides: object) -> MatchResult:
    return select_candidates(candidates, params(**overrides), crop_name="Tomato")


def exclusion_reason(item: CandidateInput, **overrides: object) -> str:
    result = match([item], **overrides)
    assert result.selected == []
    assert result.compatible_unselected == []
    [(excluded, reason)] = result.excluded
    assert excluded is item
    return reason


def ids(items: list[ScoredCandidate]) -> list[uuid.UUID]:
    return [item.candidate.harvest_id for item in items]


# ─────────────────────────── Compatibility rules ───────────────────────────


@pytest.mark.parametrize(
    ("overrides", "location", "expected"),
    [
        ({"status": "committed"}, PUNGANUR, "Not available for pooling (status: committed)"),
        ({"status": "picked_up"}, PUNGANUR, "Not available for pooling (status: picked up)"),
        ({"status": "draft"}, PUNGANUR, "Not available for pooling (status: draft)"),
        ({"status": "expired"}, PUNGANUR, "Not available for pooling (status: expired)"),
        ({"available_kg": Decimal("0")}, PUNGANUR, "Nothing left to allocate"),
        ({"grade": "B"}, PUNGANUR, "Grade B does not match requested grade A"),
        ({"grade": "ungraded"}, PUNGANUR, "Ungraded produce does not match requested grade A"),
        (
            {"available_from": date(2026, 11, 2), "sell_by": date(2026, 11, 6)},
            PUNGANUR,
            "Not available until 2026-11-02",
        ),
        ({"sell_by": TODAY}, PUNGANUR, "Sell-by date passes before pickup"),
        ({}, None, "Location missing"),
        ({}, PALAMANER, "Outside 40 km radius (61.4 km)"),
        (
            {"harvest_date": PICKUP - timedelta(days=9)},
            PUNGANUR,
            "Too old by pickup (9 days > 7-day shelf life)",
        ),
    ],
)
def test_each_rule_excludes_with_a_reason(
    overrides: dict[str, object], location: tuple[float, float] | None, expected: str
) -> None:
    assert exclusion_reason(candidate(location, **overrides)) == expected


def test_location_missing_when_only_one_coordinate_is_known() -> None:
    item = replace(candidate(), longitude=None)
    assert exclusion_reason(item) == "Location missing"


def test_radius_reason_uses_the_requested_radius() -> None:
    assert exclusion_reason(candidate(PUNGANUR), radius_km=Decimal("12.5")) == (
        "Outside 12.5 km radius (28.5 km)"
    )


def test_first_failing_rule_is_reported() -> None:
    item = candidate(None, status="committed", grade="B")
    assert exclusion_reason(item) == "Not available for pooling (status: committed)"


def test_boundaries_are_inclusive() -> None:
    item = candidate(
        PUNGANUR,
        available_from=PICKUP,
        sell_by=PICKUP,
        harvest_date=PICKUP - timedelta(days=7),
    )
    result = match([item], radius_km=Decimal("28.5"))
    assert ids(result.selected) == [item.harvest_id]
    assert result.selected[0].distance_km == Decimal("28.5")
    assert result.excluded == []


def test_pooled_harvests_with_remaining_kilograms_are_compatible() -> None:
    item = candidate(status="pooled", available_kg=Decimal("120.5"))
    result = match([item])
    assert result.selected[0].proposed_kg == Decimal("120.50")


def test_ungraded_listings_are_included_and_flagged_only_on_request() -> None:
    item = candidate(grade="ungraded")
    graded = candidate(grade="A")
    result = match([item, graded], include_ungraded=True)
    assert set(ids(result.selected)) == {item.harvest_id, graded.harvest_id}
    flagged = next(entry for entry in result.selected if entry.candidate is item)
    assert "Ungraded — inspection required before pickup" in flagged.reasons
    unflagged = next(entry for entry in result.selected if entry.candidate is graded)
    assert "Ungraded — inspection required before pickup" not in unflagged.reasons


def test_include_ungraded_never_mixes_other_grades() -> None:
    result = match([candidate(grade="B")], include_ungraded=True)
    assert result.excluded[0][1] == "Grade B does not match requested grade A"


def test_excluded_harvests_keep_input_order() -> None:
    first = candidate(grade="C")
    second = candidate(None)
    third = candidate(status="settled")
    result = match([first, candidate(), second, third])
    assert [item for item, _ in result.excluded] == [first, second, third]


# ─────────────────────────────── Scoring ───────────────────────────────


def test_score_components() -> None:
    # distance 40 × (1 − 28.5/40) = 11.5; urgency 30 × (1 − 5/7) = 8.571…; inspected 20;
    # size 10 × 300/1000 = 3 → 43.07.
    result = match([candidate()])
    assert result.selected[0].score == Decimal("43.07")


@pytest.mark.parametrize(
    ("quality_status", "expected"),
    [("inspected", "43.07"), ("pending_inspection", "33.07"), ("self_reported", "28.07")],
)
def test_quality_points(quality_status: str, expected: str) -> None:
    result = match([candidate(quality_status=quality_status)])
    assert result.selected[0].score == Decimal(expected)


def test_urgency_is_clamped_to_a_week() -> None:
    week = match([candidate(sell_by=TODAY + timedelta(days=7))]).selected[0].score
    month = match([candidate(sell_by=TODAY + timedelta(days=30))]).selected[0].score
    tomorrow = match([candidate(sell_by=PICKUP)]).selected[0].score
    assert week == month == Decimal("34.50")  # 11.5 + 0 + 20 + 3
    assert tomorrow == Decimal("60.21")  # 11.5 + 30 × 6/7 + 20 + 3


def test_size_points_are_capped_at_the_target() -> None:
    result = match([candidate(available_kg=Decimal("5000"))])
    assert result.selected[0].score == Decimal("50.07")  # 11.5 + 8.57 + 20 + 10


def scenario() -> tuple[CandidateInput, CandidateInput, CandidateInput]:
    urgent = candidate(PUNGANUR, sell_by=PICKUP, available_kg=Decimal("300"))
    near = candidate(
        MADANAPALLE,
        quality_status="self_reported",
        sell_by=TODAY + timedelta(days=6),
        available_kg=Decimal("200"),
    )
    far = candidate(
        B_KOTHAKOTA,
        quality_status="pending_inspection",
        sell_by=TODAY + timedelta(days=7),
        available_kg=Decimal("1000"),
    )
    return urgent, near, far


def test_candidates_are_ranked_by_score() -> None:
    urgent, near, far = scenario()
    result = match([far, near, urgent])
    assert ids(result.selected) == [urgent.harvest_id, near.harvest_id, far.harvest_id]
    assert [item.score for item in result.selected] == [
        Decimal("60.21"),  # 11.5 + 25.71 + 20 + 3
        Decimal("51.29"),  # 40 + 4.29 + 5 + 2
        Decimal("23.80"),  # 3.8 + 0 + 10 + 10
    ]


def test_equal_scores_prefer_the_nearer_harvest() -> None:
    # Punganur: 11.5 distance + 1.0 size; B. Kothakota: 3.8 distance + 8.7 size → both 12.5 + …
    nearer = candidate(PUNGANUR, available_kg=Decimal("100"))
    farther = candidate(B_KOTHAKOTA, available_kg=Decimal("870"))
    result = match([farther, nearer])
    assert result.selected[0].score == result.selected[1].score
    assert ids(result.selected) == [nearer.harvest_id, farther.harvest_id]


def test_reasons_explain_each_selection() -> None:
    urgent, near, far = scenario()
    result = match([urgent, near, far])
    reasons = {item.candidate.harvest_id: item.reasons for item in result.selected}
    assert reasons[urgent.harvest_id] == [
        "28.5 km from collection point",
        "Sell-by in 1 day — prioritised to avoid spoilage",
        "Quality inspected",
        "All 300 kg available included",
    ]
    assert reasons[near.harvest_id] == [
        "0.0 km from collection point",
        "Sell-by in 6 days",
        "Quality self-reported",
        "All 200 kg available included",
    ]
    assert reasons[far.harvest_id] == [
        "36.2 km from collection point",
        "Sell-by in 7 days",
        "Quality inspection pending",
        "500 of 1,000 kg needed to complete the target",
    ]


def test_urgent_sell_by_wording() -> None:
    two_days = match([candidate(sell_by=TODAY + timedelta(days=2))]).selected[0]
    three_days = match([candidate(sell_by=TODAY + timedelta(days=3))]).selected[0]
    assert "Sell-by in 2 days — prioritised to avoid spoilage" in two_days.reasons
    assert "Sell-by in 3 days" in three_days.reasons


def test_sell_by_today_is_prioritised() -> None:
    item = candidate(sell_by=TODAY)
    result = match([item], pickup_date=TODAY)
    assert "Sell-by today — prioritised to avoid spoilage" in result.selected[0].reasons


# ────────────────────────────── Allocation ──────────────────────────────


def test_allocation_never_exceeds_available_or_target() -> None:
    urgent, near, far = scenario()
    result = match([urgent, near, far])
    for item in result.selected:
        assert 0 < item.proposed_kg <= item.candidate.available_kg
    assert [item.proposed_kg for item in result.selected] == [
        Decimal("300"),
        Decimal("200"),
        Decimal("500"),
    ]
    assert result.selected_total_kg == Decimal("1000.00")
    assert result.shortfall_kg == Decimal("0.00")
    assert result.feasible is True


def test_compatible_harvests_beyond_the_target_are_not_needed() -> None:
    first = candidate(available_kg=Decimal("1000"), quality_status="inspected")
    spare = candidate(available_kg=Decimal("400"), quality_status="self_reported")
    result = match([spare, first])
    assert ids(result.selected) == [first.harvest_id]
    assert ids(result.compatible_unselected) == [spare.harvest_id]
    unselected = result.compatible_unselected[0]
    assert unselected.proposed_kg == Decimal("0")
    assert unselected.reasons[-1] == "Not needed — target already reached"


def test_fractional_availability_is_never_rounded_up() -> None:
    item = candidate(available_kg=Decimal("300.456"))
    result = match([item])
    assert result.selected[0].proposed_kg == Decimal("300.45")
    assert result.selected[0].proposed_kg <= item.available_kg


def test_less_than_ten_grams_left_is_nothing_to_allocate() -> None:
    assert exclusion_reason(candidate(available_kg=Decimal("0.004"))) == "Nothing left to allocate"


def test_supply_is_never_invented() -> None:
    items = [candidate(available_kg=Decimal(kg)) for kg in ("120", "80.5", "99.25")]
    result = match(items)
    assert result.selected_total_kg == Decimal("299.75")
    assert sum(item.proposed_kg for item in result.selected) == Decimal("299.75")
    assert result.shortfall_kg == Decimal("700.25")


# ───────────────────────── Shortfall & feasibility ─────────────────────────


@pytest.mark.parametrize(
    ("available", "min_quantity", "feasible", "shortfall"),
    [
        ("850", None, False, "150.00"),  # needs 90% of 1,000
        ("899.99", None, False, "100.01"),
        ("900", None, True, "100.00"),
        ("920", None, True, "80.00"),
        ("850", Decimal("800"), True, "150.00"),
        ("850", Decimal("900"), False, "150.00"),
        ("1200", Decimal("1000"), True, "0.00"),
    ],
)
def test_feasibility(
    available: str, min_quantity: Decimal | None, feasible: bool, shortfall: str
) -> None:
    result = match([candidate(available_kg=Decimal(available))], min_quantity_kg=min_quantity)
    assert result.feasible is feasible
    assert result.shortfall_kg == Decimal(shortfall)


def test_no_compatible_harvests() -> None:
    result = match([candidate(grade="B"), candidate(PALAMANER)])
    assert result.selected == []
    assert result.selected_total_kg == Decimal("0.00")
    assert result.shortfall_kg == Decimal("1000.00")
    assert result.feasible is False
    assert result.explanation == (
        "No compatible tomato harvests of grade A were found within 40 km for pickup on "
        "2026-10-28. 2 harvests were excluded."
    )


def test_no_candidates_at_all() -> None:
    result = match([])
    assert result.excluded == []
    assert result.feasible is False
    assert result.explanation.endswith("No harvests were excluded.")


# ───────────────────────── Rules & explanation ─────────────────────────


def test_rules_applied_list_rules_one_to_six() -> None:
    result = match([])
    assert result.rules_applied == [
        "Same crop only: Tomato",
        "Only harvests that are listed or pooled and still have kilograms available",
        "Grade A only — produce of different grades is never mixed",
        "Available on the pickup date (2026-10-28) and not past sell-by",
        "Farm within 40 km by road of the collection point",
        "No older than 7 days at pickup (shelf life)",
    ]


def test_rules_applied_mention_ungraded_inclusion() -> None:
    result = match([], include_ungraded=True)
    assert result.rules_applied[2] == (
        "Grade A only — produce of different grades is never mixed; "
        "ungraded listings included, inspection required before pickup"
    )


def test_explanation_for_a_short_match() -> None:
    urgent, _, far = scenario()
    far = replace(far, available_kg=Decimal("400"))
    result = match([urgent, far, candidate(PALAMANER), candidate(grade="B")])
    assert result.explanation == (
        "Selected 2 harvests of tomato (grade A) totalling 700 kg against a 1,000 kg target, "
        "300 kg short. The nearest is 28.5 km from the collection point and the earliest "
        "sell-by is 2026-10-28. Not enough to proceed: at least 900 kg is needed. "
        "2 harvests were excluded."
    )


def test_explanation_for_a_full_match_with_backup() -> None:
    urgent, near, far = scenario()
    spare = candidate(B_KOTHAKOTA, quality_status="self_reported", available_kg=Decimal("50"))
    result = match([urgent, near, far, spare, candidate(None)])
    assert result.explanation == (
        "Selected 3 harvests of tomato (grade A) totalling 1,000 kg against a 1,000 kg target. "
        "The nearest is 0.0 km from the collection point and the earliest sell-by is 2026-10-28. "
        "1 more compatible harvest is available as backup. 1 harvest was excluded."
    )


def test_explanation_when_short_but_feasible() -> None:
    result = match([candidate(available_kg=Decimal("920"))])
    assert "920 kg against a 1,000 kg target, 80 kg short." in result.explanation
    assert "Enough to proceed: at least 900 kg is needed." in result.explanation


def test_matching_is_deterministic() -> None:
    urgent, near, far = scenario()
    items = [far, urgent, candidate(None), near]
    first = match(items)
    second = match(list(items))
    assert ids(first.selected) == ids(second.selected)
    assert first.explanation == second.explanation
    assert [item.reasons for item in first.selected] == [item.reasons for item in second.selected]


# ─────────────────────────────── Inputs ───────────────────────────────


def test_float_radius_and_target_are_accepted() -> None:
    result = match([candidate()], radius_km=40.0, target_quantity_kg=500.0)  # type: ignore[arg-type]
    assert result.selected[0].proposed_kg == Decimal("300")
    assert result.shortfall_kg == Decimal("200.00")


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"target_quantity_kg": Decimal("0")}, "target_quantity_kg"),
        ({"radius_km": Decimal("0")}, "radius_km"),
    ],
)
def test_invalid_parameters_are_rejected(overrides: dict[str, object], message: str) -> None:
    with pytest.raises(ValueError, match=message):
        match([candidate()], **overrides)
