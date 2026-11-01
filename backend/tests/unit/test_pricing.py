"""Net proceeds engine (DOMAIN_RULES §3): transport, breakdown, baseline, counter-offers, calculator."""

import math
import random
from decimal import Decimal

import pytest

from app import schemas
from app.services import pricing
from app.services.pricing import (
    BASELINE_LABEL,
    CALCULATOR_LABEL,
    LINE_ORDER,
    PLATFORM_FEE_NOTE,
    UNRESOLVED_QUALITY,
    UNRESOLVED_TRANSPORT_LOCATION,
    UNRESOLVED_TRANSPORT_QUOTE,
    baseline_net_proceeds,
    calculate,
    compute_net_proceeds,
    estimate_transport_cost,
    floor_price_for_min_net,
    net_linear_coefficients,
    suggest_counter_price,
)

pytestmark = []

MADANAPALLE = (13.5503, 78.5029)
PUNGANUR = (13.3650, 78.5730)
PALAMANER = (13.2000, 78.7500)
B_KOTHAKOTA = (13.6575, 78.2697)


def line(result: schemas.NetProceeds, key: str) -> schemas.BreakdownLine:
    return next(item for item in result.lines if item.key == key)


def money(value: float) -> Decimal:
    """A 2-decimal float from the engine as an exact Decimal."""
    return Decimal(str(value))


def pooled_offer(**overrides: object) -> schemas.NetProceeds:
    """Worked example: 400 kg of tomatoes in a 4-farmer pooled lot at ₹16/kg, paid in 7 days."""
    arguments: dict[str, object] = {
        "label": "Pooled sale · FreshMart",
        "quantity_kg": 400,
        "price_per_kg": 16,
        "transport_cost": Decimal("695"),
        "transport_certainty": "estimated",
        "rejection_pct": 5,
        "rejection_certainty": "unresolved",
        "handling_per_kg": pricing.LOADING_PER_KG,
        "commission_pct": 0,
        "commission_certainty": "confirmed",
        "payment_terms_days": 7,
        "transport_note": "Shared by weight across 4 farmers",
        "rejection_note": "Expected 5% rejection (crop average)",
        "unresolved": [UNRESOLVED_TRANSPORT_QUOTE],
    }
    arguments.update(overrides)
    return compute_net_proceeds(**arguments)  # type: ignore[arg-type]


# ─────────────────────────────── Constants ───────────────────────────────


def test_constants_match_domain_rules() -> None:
    expected = {
        "LOADING_PER_KG": Decimal("0.25"),
        "MANDI_HANDLING_PER_KG": Decimal("0.50"),
        "MANDI_COMMISSION_PCT": Decimal("8"),
        "CAPITAL_COST_ANNUAL_PCT": Decimal("18"),
        "BASELINE_DISTANCE_KM": Decimal("25"),
        "BASELINE_PAYMENT_DAYS": 1,
        "ROAD_FACTOR": Decimal("1.3"),
        "DEFAULT_RADIUS_KM": Decimal("40"),
    }
    assert {name: getattr(pricing, name) for name in expected} == expected
    assert all(isinstance(getattr(pricing, name), type(value)) for name, value in expected.items())


def test_vehicle_classes_match_domain_rules() -> None:
    table = {
        vehicle.vehicle_type: (
            vehicle.capacity_kg,
            vehicle.base_charge,
            vehicle.per_km_rate,
            vehicle.refrigerated,
        )
        for vehicle in pricing.VEHICLE_CLASSES
    }
    assert table == {
        "mini_truck": (750, Decimal("600"), Decimal("18"), False),
        "pickup": (1500, Decimal("900"), Decimal("24"), False),
        "light_truck": (3500, Decimal("1500"), Decimal("32"), False),
        "medium_truck": (9000, Decimal("2500"), Decimal("45"), False),
        "reefer_truck": (5000, Decimal("3500"), Decimal("55"), True),
    }


# ──────────────────────────── Number helpers ────────────────────────────


def test_to_decimal_uses_the_shortest_float_repr() -> None:
    assert pricing.to_decimal(0.1) == Decimal("0.1")
    assert pricing.to_decimal(16) == Decimal(16)
    assert pricing.to_decimal(Decimal("2.50")) == Decimal("2.50")


@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf, Decimal("NaN")])
def test_to_decimal_rejects_non_finite_numbers(value: float | Decimal) -> None:
    with pytest.raises(ValueError, match="finite"):
        pricing.to_decimal(value)


def test_to_decimal_rejects_non_numbers() -> None:
    with pytest.raises(TypeError):
        pricing.to_decimal("16")  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (Decimal("0.125"), Decimal("0.13")),
        (Decimal("2.675"), Decimal("2.68")),
        (Decimal("-1.7375"), Decimal("-1.74")),
        (Decimal("-0.004"), Decimal("0.00")),
        (1.005, Decimal("1.01")),
    ],
)
def test_round_money_is_half_up_without_negative_zero(value: Decimal, expected: Decimal) -> None:
    result = pricing.round_money(value)
    assert result == expected
    assert str(result) == str(expected)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (400, "400"),
        (1250, "1,250"),
        (Decimal("1240000"), "12,40,000"),
        (Decimal("123456789.5"), "12,34,56,789.5"),
        (Decimal("2.50"), "2.5"),
        (Decimal("-1500.25"), "-1,500.25"),
    ],
)
def test_format_number_uses_indian_grouping(value: Decimal, expected: str) -> None:
    assert pricing.format_number(value) == expected


def test_format_rupees_always_shows_paise() -> None:
    assert pricing.format_rupees(Decimal("1050")) == "₹1,050.00"
    assert pricing.format_rupees(Decimal("0.5")) == "₹0.50"
    assert pricing.format_rupees(Decimal("-12.345")) == "-₹12.35"


# ─────────────────────────────── Distances ───────────────────────────────


def test_haversine_between_madanapalle_and_punganur() -> None:
    assert pricing.haversine_km(*MADANAPALLE, *PUNGANUR) == Decimal("21.95")


def test_road_km_applies_the_road_factor_at_one_decimal() -> None:
    assert pricing.road_km(*MADANAPALLE, *PUNGANUR) == Decimal("28.5")
    assert pricing.road_km(*MADANAPALLE, *PALAMANER) == Decimal("61.4")
    assert pricing.road_km(*MADANAPALLE, *B_KOTHAKOTA) == Decimal("36.2")


def test_distances_are_symmetric_and_zero_for_the_same_point() -> None:
    assert pricing.road_km(*PUNGANUR, *PALAMANER) == pricing.road_km(*PALAMANER, *PUNGANUR)
    assert pricing.haversine_km(*PUNGANUR, *PUNGANUR) == Decimal("0.00")
    assert pricing.road_km(*PUNGANUR, *PUNGANUR) == Decimal("0.0")


# ─────────────────────────────── Transport ───────────────────────────────


@pytest.mark.parametrize(
    ("total_kg", "vehicle_type", "capacity", "trips"),
    [
        (1, "mini_truck", 750, 1),
        (750, "mini_truck", 750, 1),
        (751, "pickup", 1500, 1),
        (1500, "pickup", 1500, 1),
        (1501, "light_truck", 3500, 1),
        (3500, "light_truck", 3500, 1),
        (3501, "medium_truck", 9000, 1),
        (9000, "medium_truck", 9000, 1),
        (9001, "medium_truck", 9000, 2),
        (20000, "medium_truck", 9000, 3),
    ],
)
def test_vehicle_selection_boundaries(
    total_kg: int, vehicle_type: str, capacity: int, trips: int
) -> None:
    estimate = estimate_transport_cost(total_kg, 10)
    assert (estimate.vehicle_type, estimate.capacity_kg, estimate.trips) == (
        vehicle_type,
        capacity,
        trips,
    )


def test_transport_cost_formula_single_trip() -> None:
    estimate = estimate_transport_cost(400, 25)
    assert estimate.vehicle_type == "mini_truck"
    assert estimate.distance_km == Decimal("25.00")
    assert estimate.cost_total == Decimal("1050.00")  # 600 + 18 × 25
    assert estimate.cost_per_kg == Decimal("2.63")  # 2.625 rounds half-up
    assert estimate.utilization_pct == Decimal("53.33")


def test_transport_full_vehicle_is_fully_utilised() -> None:
    estimate = estimate_transport_cost(750, Decimal("12.5"))
    assert estimate.utilization_pct == Decimal("100.00")
    assert estimate.cost_total == Decimal("825.00")  # 600 + 18 × 12.5


def test_transport_multi_trip_uses_the_largest_class() -> None:
    estimate = estimate_transport_cost(20000, 40)
    assert estimate.vehicle_type == "medium_truck"
    assert estimate.trips == 3
    assert estimate.cost_total == Decimal("12900.00")  # 3 × (2500 + 45 × 40)
    assert estimate.cost_per_kg == Decimal("0.65")  # 0.645
    assert estimate.utilization_pct == Decimal("74.07")  # 20000 / 27000


def test_refrigerated_loads_only_use_refrigerated_vehicles() -> None:
    small = estimate_transport_cost(400, 10, refrigerated=True)
    assert small.vehicle_type == "reefer_truck"
    assert small.trips == 1
    assert small.cost_total == Decimal("4050.00")  # 3500 + 55 × 10

    large = estimate_transport_cost(12000, 10, refrigerated=True)
    assert large.vehicle_type == "reefer_truck"
    assert large.trips == 3
    assert large.cost_total == Decimal("12150.00")
    assert large.utilization_pct == Decimal("80.00")


def test_non_refrigerated_loads_never_get_a_reefer() -> None:
    # 4,000 kg would fit the 5,000 kg reefer, but plain produce takes the medium truck.
    assert estimate_transport_cost(4000, 10).vehicle_type == "medium_truck"


def test_zero_load_needs_no_trip() -> None:
    estimate = estimate_transport_cost(0, 30)
    assert estimate.trips == 0
    assert estimate.cost_total == Decimal("0.00")
    assert estimate.cost_per_kg == Decimal("0.00")
    assert estimate.utilization_pct == Decimal("0.00")


def test_transport_accepts_floats_and_rejects_negative_inputs() -> None:
    assert estimate_transport_cost(400.0, 25.0).cost_total == Decimal("1050.00")
    with pytest.raises(ValueError, match="total_kg"):
        estimate_transport_cost(-1, 10)
    with pytest.raises(ValueError, match="distance_km"):
        estimate_transport_cost(10, -1)


def test_describe_transport_estimate() -> None:
    assert pricing.describe_transport_estimate(estimate_transport_cost(400, 25)) == (
        "Mini truck, 1 trip, 25 km"
    )
    assert pricing.describe_transport_estimate(estimate_transport_cost(20000, 12.5)) == (
        "Medium truck, 3 trips, 12.5 km"
    )


# ───────────────────── Worked example: pooled vs mandi ─────────────────────


def test_worked_example_pooled_offer_breakdown() -> None:
    result = pooled_offer()

    assert [item.key for item in result.lines] == list(LINE_ORDER)
    amounts = {item.key: item.amount for item in result.lines}
    assert amounts == {
        "gross": 6400.0,
        "rejection": -320.0,
        "transport": -695.0,
        "handling": -100.0,
        "commission": 0.0,
        "payment_wait": -20.99,  # 6,080 × 18% × 7/365 = 20.988…
        "platform_fee": 0.0,
    }
    per_kg = {item.key: item.per_kg for item in result.lines}
    assert per_kg == {
        "gross": 16.0,
        "rejection": -0.8,
        "transport": -1.74,
        "handling": -0.25,
        "commission": 0.0,
        "payment_wait": -0.05,
        "platform_fee": 0.0,
    }
    assert result.label == "Pooled sale · FreshMart"
    assert result.quantity_kg == 400.0
    assert result.expected_accepted_kg == 380.0
    assert result.gross_price_per_kg == 16.0
    assert result.gross_amount == 6400.0
    assert result.net_amount == 5264.01
    assert result.net_per_kg == 13.16
    assert result.total_deductions == 1135.99
    assert result.payment_terms_days == 7
    assert result.confidence == "unresolved"
    assert result.unresolved == [UNRESOLVED_TRANSPORT_QUOTE, UNRESOLVED_QUALITY]


def test_worked_example_notes_are_human_readable() -> None:
    notes = {item.key: item.note for item in pooled_offer().lines}
    assert notes == {
        "gross": "400 kg × ₹16.00/kg",
        "rejection": "Expected 5% rejection (crop average)",
        "transport": "Shared by weight across 4 farmers",
        "handling": "₹0.25/kg loading & handling",
        "commission": "No commission",
        "payment_wait": "Cost of waiting 7 days at 18%/yr",
        "platform_fee": PLATFORM_FEE_NOTE,
    }


def test_worked_example_mandi_baseline() -> None:
    baseline = baseline_net_proceeds(
        quantity_kg=400, market_price_per_kg=14, default_rejection_pct=5
    )
    assert baseline is not None
    assert baseline.label == BASELINE_LABEL
    amounts = {item.key: item.amount for item in baseline.lines}
    assert amounts == {
        "gross": 5600.0,
        "rejection": -280.0,
        "transport": -1050.0,  # mini truck alone, 25 km
        "handling": -200.0,  # ₹0.50/kg hamali
        "commission": -425.6,  # 8% of ₹5,320 accepted value
        "payment_wait": -2.62,  # next-day payment
        "platform_fee": 0.0,
    }
    assert baseline.net_amount == 3641.78
    assert baseline.net_per_kg == 9.1
    assert baseline.total_deductions == 1958.22
    assert baseline.payment_terms_days == pricing.BASELINE_PAYMENT_DAYS


def test_worked_example_pooled_sale_beats_the_mandi_by_net_per_kg() -> None:
    baseline = baseline_net_proceeds(
        quantity_kg=400, market_price_per_kg=14, default_rejection_pct=5
    )
    assert baseline is not None
    uplift = money(pooled_offer().net_per_kg) - money(baseline.net_per_kg)
    assert uplift == Decimal("4.06")


# ─────────────────────────────── Certainty ───────────────────────────────


@pytest.mark.parametrize(
    ("certainties", "expected"),
    [
        (["confirmed", "confirmed"], "confirmed"),
        (["confirmed", "estimated"], "estimated"),
        (["estimated", "unresolved", "confirmed"], "unresolved"),
        ([], "confirmed"),
    ],
)
def test_overall_confidence(certainties: list[schemas.Certainty], expected: str) -> None:
    assert pricing.overall_confidence(certainties) == expected


def test_payment_wait_is_always_estimated_and_platform_fee_always_confirmed() -> None:
    result = pooled_offer(
        gross_certainty="confirmed",
        transport_certainty="confirmed",
        rejection_certainty="confirmed",
        handling_certainty="confirmed",
        commission_certainty="confirmed",
        payment_terms_days=0,
        unresolved=[],
    )
    assert line(result, "payment_wait").certainty == "estimated"
    assert line(result, "platform_fee").certainty == "confirmed"
    assert line(result, "platform_fee").amount == 0.0
    assert result.confidence == "estimated"
    assert result.unresolved == []


def test_each_line_takes_the_certainty_it_is_given() -> None:
    result = pooled_offer(
        gross_certainty="estimated",
        transport_certainty="confirmed",
        rejection_certainty="estimated",
        handling_certainty="estimated",
        commission_certainty="estimated",
    )
    certainties = {item.key: item.certainty for item in result.lines}
    assert certainties == {
        "gross": "estimated",
        "rejection": "estimated",
        "transport": "confirmed",
        "handling": "estimated",
        "commission": "estimated",
        "payment_wait": "estimated",
        "platform_fee": "confirmed",
    }
    assert result.confidence == "estimated"


def test_offer_terms_with_booked_transport_and_estimated_handling_are_estimated() -> None:
    result = pooled_offer(transport_certainty="confirmed", rejection_certainty="estimated")
    assert result.confidence == "estimated"
    assert result.unresolved == [UNRESOLVED_TRANSPORT_QUOTE]


def test_unresolved_rejection_adds_quality_inspection_pending() -> None:
    result = pooled_offer(unresolved=[])
    assert line(result, "rejection").certainty == "unresolved"
    assert result.confidence == "unresolved"
    assert result.unresolved == [UNRESOLVED_QUALITY]


def test_unresolved_transport_adds_location_missing() -> None:
    result = pooled_offer(
        transport_cost=0, transport_certainty="unresolved", rejection_certainty="estimated"
    )
    assert line(result, "transport").certainty == "unresolved"
    assert result.confidence == "unresolved"
    assert result.unresolved == [UNRESOLVED_TRANSPORT_QUOTE, UNRESOLVED_TRANSPORT_LOCATION]


def test_unresolved_conditions_are_deduplicated_in_order() -> None:
    result = pooled_offer(
        unresolved=[
            "Buyer not yet verified",
            UNRESOLVED_QUALITY,
            "Awaiting farmer consent",
            "Buyer not yet verified",
        ]
    )
    assert result.unresolved == [
        "Buyer not yet verified",
        UNRESOLVED_QUALITY,
        "Awaiting farmer consent",
    ]


def test_extra_unresolved_conditions_keep_line_certainty_estimated() -> None:
    result = pooled_offer(rejection_certainty="estimated", unresolved=["Awaiting buyer response"])
    assert result.confidence == "estimated"
    assert result.unresolved == ["Awaiting buyer response"]


# ──────────────────────────── Rounding & notes ────────────────────────────


def minimal(**overrides: object) -> schemas.NetProceeds:
    arguments: dict[str, object] = {
        "label": "Test",
        "quantity_kg": 1,
        "price_per_kg": 1,
        "transport_cost": 0,
        "transport_certainty": "confirmed",
        "rejection_pct": 0,
        "rejection_certainty": "confirmed",
        "handling_per_kg": 0,
        "commission_pct": 0,
        "commission_certainty": "confirmed",
        "payment_terms_days": 0,
    }
    arguments.update(overrides)
    return compute_net_proceeds(**arguments)  # type: ignore[arg-type]


def test_amounts_round_half_up_to_two_decimals() -> None:
    result = minimal(price_per_kg=Decimal("0.125"))
    assert result.gross_amount == 0.13
    assert result.net_amount == 0.13


def test_breakdown_always_adds_up_to_the_net() -> None:
    # Exact net 3.012 would round to 3.01, but the farmer sees 3.02 − 0.00 lines: net is 3.02.
    result = minimal(quantity_kg=3, price_per_kg=Decimal("1.005"), handling_per_kg=Decimal("0.001"))
    assert line(result, "gross").amount == 3.02
    assert line(result, "handling").amount == 0.0
    assert result.net_amount == 3.02
    assert sum(money(item.amount) for item in result.lines) == money(result.net_amount)


def test_zero_amounts_are_never_negative_zero() -> None:
    result = minimal()
    for item in result.lines:
        if item.key != "gross":
            assert item.amount == 0.0
            assert math.copysign(1.0, item.amount) == 1.0
            assert math.copysign(1.0, item.per_kg) == 1.0


def test_fractional_quantities_and_float_inputs() -> None:
    result = minimal(quantity_kg=123.45, price_per_kg=17.8, rejection_pct=2.5)
    assert result.gross_amount == 2197.41  # 2,197.41
    assert result.expected_accepted_kg == 120.36  # 123.45 × 0.975 = 120.36375
    assert line(result, "rejection").amount == -54.94  # 17.8 × 3.08625


def test_zero_quantity_has_zero_per_kg_values() -> None:
    result = minimal(quantity_kg=0, transport_cost=100)
    assert result.net_amount == -100.0
    assert result.net_per_kg == 0.0
    assert all(item.per_kg == 0.0 for item in result.lines)


def test_payment_wait_notes() -> None:
    assert line(minimal(), "payment_wait").note == "Paid on delivery"
    assert line(minimal(payment_terms_days=1), "payment_wait").note == (
        "Cost of waiting 1 day at 18%/yr"
    )
    assert line(minimal(payment_terms_days=30), "payment_wait").note == (
        "Cost of waiting 30 days at 18%/yr"
    )


def test_commission_is_charged_on_the_accepted_value() -> None:
    result = minimal(quantity_kg=100, price_per_kg=10, rejection_pct=10, commission_pct=8)
    assert line(result, "commission").amount == -72.0  # 8% of ₹900 accepted value
    assert line(result, "commission").note == "8% of the accepted value"


def test_explicit_notes_override_defaults() -> None:
    result = minimal(
        gross_note="Buyer's written quote",
        handling_note="Buyer handling ₹0.10/kg + loading ₹0.25/kg",
        commission_note="MandiMate deal: no commission",
    )
    assert line(result, "gross").note == "Buyer's written quote"
    assert line(result, "handling").note == "Buyer handling ₹0.10/kg + loading ₹0.25/kg"
    assert line(result, "commission").note == "MandiMate deal: no commission"
    assert line(result, "transport").note is None


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("quantity_kg", -1),
        ("price_per_kg", -0.5),
        ("transport_cost", -10),
        ("handling_per_kg", -0.25),
        ("rejection_pct", 101),
        ("rejection_pct", -1),
        ("commission_pct", 100.5),
        ("payment_terms_days", -1),
    ],
)
def test_invalid_inputs_are_rejected(field: str, value: float) -> None:
    with pytest.raises(ValueError, match=field):
        minimal(**{field: value})


# ─────────────────────────────── Baseline ───────────────────────────────


def test_baseline_is_none_without_a_market_price() -> None:
    assert (
        baseline_net_proceeds(quantity_kg=400, market_price_per_kg=None, default_rejection_pct=5)
        is None
    )


def test_baseline_lines_are_all_estimates() -> None:
    baseline = baseline_net_proceeds(
        quantity_kg=400, market_price_per_kg=14, default_rejection_pct=5
    )
    assert baseline is not None
    for item in baseline.lines:
        expected = "confirmed" if item.key == "platform_fee" else "estimated"
        assert item.certainty == expected
    assert baseline.confidence == "estimated"
    assert baseline.unresolved == []


def test_baseline_notes() -> None:
    baseline = baseline_net_proceeds(
        quantity_kg=400,
        market_price_per_kg=14,
        default_rejection_pct=6,
        market_name="Madanapalle APMC",
    )
    assert baseline is not None
    notes = {item.key: item.note for item in baseline.lines}
    assert notes["gross"] == "Latest modal price at Madanapalle APMC"
    assert notes["rejection"] == "Expected 6% rejection (crop average)"
    assert notes["transport"] == "Mini truck hired alone, 25 km to the mandi"
    assert notes["handling"] == "Hamali / unloading at the mandi, ₹0.50/kg"
    assert notes["commission"] == "Commission agent at 8%"
    assert notes["payment_wait"] == "Cost of waiting 1 day at 18%/yr"


def test_baseline_with_an_illustrative_price_says_so() -> None:
    named = baseline_net_proceeds(
        quantity_kg=400,
        market_price_per_kg=14,
        default_rejection_pct=5,
        is_illustrative=True,
        market_name="Madanapalle APMC",
    )
    unnamed = baseline_net_proceeds(
        quantity_kg=400, market_price_per_kg=14, default_rejection_pct=5, is_illustrative=True
    )
    assert named is not None
    assert unnamed is not None
    assert line(named, "gross").note == (
        "Illustrative modal price at Madanapalle APMC (not live market data)"
    )
    assert line(unnamed, "gross").note == "Illustrative modal price (not live market data)"


def test_baseline_uses_the_given_distance_and_multiple_trips() -> None:
    baseline = baseline_net_proceeds(
        quantity_kg=10000,
        market_price_per_kg=Decimal("12.5"),
        default_rejection_pct=Decimal("7.5"),
        distance_km=Decimal("12.3"),
    )
    assert baseline is not None
    transport = line(baseline, "transport")
    assert transport.amount == -6107.0  # 2 × (2500 + 45 × 12.3)
    assert transport.note == "Medium truck hired alone, 2 trips, 12.3 km to the mandi"


# ─────────────────────────── Counter-offer rules ───────────────────────────


def offer_costs() -> dict[str, object]:
    return {
        "quantity_kg": 400,
        "transport_cost": 695,
        "handling_per_kg": pricing.LOADING_PER_KG,
        "commission_pct": 0,
        "rejection_pct": 5,
        "payment_terms_days": 7,
    }


def test_net_linear_coefficients() -> None:
    a, b = net_linear_coefficients(**offer_costs())  # type: ignore[arg-type]
    expected_a = Decimal(400) * Decimal("0.95") * (1 - Decimal("0.18") * 7 / Decimal(365))
    assert a == expected_a
    assert b == Decimal("795.00")  # 695 transport + 0.25 × 400 handling


def test_linear_net_matches_the_breakdown() -> None:
    a, b = net_linear_coefficients(**offer_costs())  # type: ignore[arg-type]
    exact = a * 16 - b
    assert abs(exact - money(pooled_offer().net_amount)) <= Decimal("0.01")


def test_floor_price_reaches_the_minimum_net_per_kg() -> None:
    floor = floor_price_for_min_net(min_net_per_kg=14, **offer_costs())  # type: ignore[arg-type]
    assert floor == Decimal("16.89")

    a, b = net_linear_coefficients(**offer_costs())  # type: ignore[arg-type]
    assert (a * floor - b) / 400 >= 14
    assert (a * (floor - Decimal("0.01")) - b) / 400 < 14

    result = pooled_offer(price_per_kg=floor)
    assert abs(money(result.net_per_kg) - 14) <= Decimal("0.01")


def test_floor_price_with_commission_and_long_payment_terms() -> None:
    costs = {**offer_costs(), "commission_pct": 8, "payment_terms_days": 30}
    floor = floor_price_for_min_net(min_net_per_kg=Decimal("12.5"), **costs)  # type: ignore[arg-type]
    result = pooled_offer(
        price_per_kg=floor,
        commission_pct=8,
        payment_terms_days=30,
        commission_certainty="estimated",
    )
    assert abs(money(result.net_per_kg) - Decimal("12.5")) <= Decimal("0.01")


def test_floor_price_is_never_negative() -> None:
    floor = floor_price_for_min_net(
        min_net_per_kg=0,
        quantity_kg=100,
        transport_cost=0,
        handling_per_kg=0,
        commission_pct=0,
        rejection_pct=0,
        payment_terms_days=0,
    )
    assert floor == Decimal("0.00")


def test_floor_price_is_impossible_when_deductions_absorb_the_price() -> None:
    with pytest.raises(ValueError, match="No price can reach the minimum"):
        floor_price_for_min_net(
            min_net_per_kg=10,
            quantity_kg=100,
            transport_cost=0,
            handling_per_kg=0,
            commission_pct=0,
            rejection_pct=100,
            payment_terms_days=0,
        )


@pytest.mark.parametrize(
    ("current", "floor", "market", "expected", "accept"),
    [
        # Current price already reaches the floor and market + 5% → accept as is.
        (18, 15, 16, Decimal("18.00"), True),
        (Decimal("16.80"), Decimal("16.80"), 16, Decimal("16.80"), True),
        # Halfway to the market reference: 14 + (16 − 14)/2 = 15.
        (14, 13, 16, Decimal("15.00"), False),
        # Small gap: the minimum ₹0.50 step, 15.8 + 0.5 = 16.3 → rounded up to 16.5.
        (Decimal("15.8"), None, 16, Decimal("16.50"), False),
        # Capped at market × 1.05 = 16.8, then rounded up to 17.0.
        (Decimal("16.5"), None, 16, Decimal("17.00"), False),
        # The farmer's floor dominates: max(17.2, 15) = 17.2 → 17.5.
        (14, Decimal("17.2"), 16, Decimal("17.50"), False),
        # No market reference: max(floor, current × 1.05).
        (14, 15, None, Decimal("15.00"), False),
        (14, Decimal("14.2"), None, Decimal("15.00"), False),  # 14.7 → 15.0
        (10, Decimal("10.1"), None, Decimal("10.50"), False),
        # No market reference and the floor is met → accept.
        (14, 13, None, Decimal("14.00"), True),
        # Nothing to compare against → accept.
        (14, None, None, Decimal("14.00"), True),
        # No floor, market reference above the price.
        (12, None, 16, Decimal("14.00"), False),
    ],
)
def test_suggest_counter_price(
    current: float | Decimal,
    floor: float | Decimal | None,
    market: float | Decimal | None,
    expected: Decimal,
    accept: bool,
) -> None:
    suggested, accept_advised = suggest_counter_price(
        current_price=current, floor_price=floor, market_reference=market
    )
    assert suggested == expected
    assert accept_advised is accept


def test_counter_suggestion_is_always_a_multiple_of_fifty_paise_above_the_current_price() -> None:
    rng = random.Random(7)
    for _ in range(300):
        current = Decimal(rng.randint(500, 3000)) / 100
        floor = Decimal(rng.randint(500, 3000)) / 100 if rng.random() < 0.7 else None
        market = Decimal(rng.randint(500, 3000)) / 100 if rng.random() < 0.7 else None
        suggested, accept = suggest_counter_price(
            current_price=current, floor_price=floor, market_reference=market
        )
        if accept:
            assert suggested == current
        else:
            assert suggested > current
            assert suggested % Decimal("0.50") == 0
            if floor is not None:
                assert suggested >= floor


# ──────────────────────────── Public calculator ────────────────────────────


def test_calculator_defaults() -> None:
    result = calculate(schemas.NetProceedsCalcRequest(quantity_kg=400, price_per_kg=16))
    assert result.label == CALCULATOR_LABEL
    transport = line(result, "transport")
    assert (transport.amount, transport.certainty, transport.note) == (
        0.0,
        "estimated",
        "Not included",
    )
    handling = line(result, "handling")
    assert (handling.amount, handling.certainty) == (-100.0, "estimated")
    assert handling.note == "Loading & crates at the collection point, ₹0.25/kg"
    commission = line(result, "commission")
    assert (commission.amount, commission.certainty) == (0.0, "confirmed")
    rejection = line(result, "rejection")
    assert (rejection.amount, rejection.certainty) == (-320.0, "estimated")
    assert rejection.note == "Expected 5% rejection (typical for fresh produce)"
    assert line(result, "gross").certainty == "estimated"
    assert line(result, "payment_wait").amount == 0.0
    assert result.payment_terms_days == 0
    assert result.net_amount == 5980.0
    assert result.net_per_kg == 14.95
    assert result.confidence == "estimated"
    assert result.unresolved == []


def test_calculator_estimates_transport_from_distance() -> None:
    result = calculate(
        schemas.NetProceedsCalcRequest(quantity_kg=400, price_per_kg=16, distance_km=25)
    )
    transport = line(result, "transport")
    assert transport.amount == -1050.0
    assert transport.certainty == "estimated"
    assert transport.note == "Estimated: Mini truck, 1 trip, 25 km"


def test_calculator_prefers_an_entered_transport_total() -> None:
    result = calculate(
        schemas.NetProceedsCalcRequest(
            quantity_kg=400, price_per_kg=16, distance_km=25, transport_cost_total=500
        )
    )
    transport = line(result, "transport")
    assert (transport.amount, transport.certainty, transport.note) == (
        -500.0,
        "confirmed",
        "Transport cost you entered",
    )


def test_calculator_with_every_field() -> None:
    result = calculate(
        schemas.NetProceedsCalcRequest(
            quantity_kg=1000,
            price_per_kg=20,
            transport_cost_total=1500,
            handling_charge_per_kg=0.4,
            commission_pct=2,
            expected_rejection_pct=3,
            payment_terms_days=15,
        )
    )
    amounts = {item.key: item.amount for item in result.lines}
    assert amounts == {
        "gross": 20000.0,
        "rejection": -600.0,
        "transport": -1500.0,
        "handling": -400.0,
        "commission": -388.0,  # 2% of 19,400
        "payment_wait": -143.51,  # 19,400 × 18% × 15/365 = 143.506…
        "platform_fee": 0.0,
    }
    assert result.net_amount == 16968.49
    assert result.payment_terms_days == 15
    assert line(result, "handling").note == "₹0.40/kg you entered"
    assert line(result, "rejection").note == "Expected 3% rejection"
    assert line(result, "commission").certainty == "confirmed"


# ───────────────────────────── Property-style ─────────────────────────────

CERTAINTIES: tuple[schemas.Certainty, ...] = ("confirmed", "estimated", "unresolved")


def test_net_equals_gross_minus_deductions_for_random_inputs() -> None:
    rng = random.Random(20261027)
    for _ in range(500):
        quantity = round(rng.uniform(0.01, 25000), rng.choice([0, 1, 2, 3]))
        price = round(rng.uniform(0.5, 250), rng.choice([0, 2, 4]))
        transport_cost = round(rng.uniform(0, 60000), 2)
        rejection = round(rng.uniform(0, 100), 2)
        handling = round(rng.uniform(0, 5), 3)
        commission = round(rng.uniform(0, 100), 1)
        days = rng.randint(0, 180)
        certainties = {name: rng.choice(CERTAINTIES) for name in ("gross", "transport", "rej")}

        result = compute_net_proceeds(
            label="Random",
            quantity_kg=quantity,
            price_per_kg=price,
            transport_cost=transport_cost,
            transport_certainty=certainties["transport"],
            rejection_pct=rejection,
            rejection_certainty=certainties["rej"],
            handling_per_kg=handling,
            commission_pct=commission,
            commission_certainty="confirmed",
            payment_terms_days=days,
            gross_certainty=certainties["gross"],
        )

        gross = money(result.gross_amount)
        net = money(result.net_amount)
        deductions = money(result.total_deductions)
        assert net == gross - deductions
        assert sum(money(item.amount) for item in result.lines) == net
        assert [item.key for item in result.lines] == list(LINE_ORDER)
        assert line(result, "gross").amount >= 0
        assert all(item.amount <= 0 for item in result.lines if item.key != "gross")
        assert deductions >= 0
        assert result.confidence == pricing.overall_confidence(
            item.certainty for item in result.lines
        )
        assert (UNRESOLVED_QUALITY in result.unresolved) is (certainties["rej"] == "unresolved")

        a, b = net_linear_coefficients(
            quantity_kg=quantity,
            transport_cost=transport_cost,
            handling_per_kg=handling,
            commission_pct=commission,
            rejection_pct=rejection,
            payment_terms_days=days,
        )
        exact_net = a * pricing.to_decimal(price) - b
        assert abs(exact_net - net) <= Decimal("0.04")  # ≤ 7 lines × ½ paisa of rounding
