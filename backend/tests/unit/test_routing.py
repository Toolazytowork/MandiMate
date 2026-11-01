"""Route planning (DOMAIN_RULES §5): farthest stop first, then nearest neighbour, then the destination."""

import uuid
from decimal import Decimal
from itertools import pairwise

from app.services.pricing import road_km
from app.services.routing import RoutePlan, RouteStop, plan_route

pytestmark = []

MADANAPALLE = (13.5503, 78.5029)
PUNGANUR = (13.3650, 78.5730)
PALAMANER = (13.2000, 78.7500)
B_KOTHAKOTA = (13.6575, 78.2697)


def stop(label: str, location: tuple[float, float], quantity_kg: str = "250") -> RouteStop:
    return RouteStop(
        id=uuid.uuid4(),
        latitude=location[0],
        longitude=location[1],
        quantity_kg=Decimal(quantity_kg),
        label=label,
    )


def labels(plan: RoutePlan) -> list[str]:
    return [item.label for item in plan.ordered_stops]


def test_no_stops_is_a_zero_plan_ending_at_the_destination() -> None:
    plan = plan_route([], MADANAPALLE)
    assert plan.ordered_stops == []
    assert plan.legs_km == []
    assert plan.total_distance_km == Decimal("0.0")
    assert plan.points == [MADANAPALLE]


def test_single_stop_goes_straight_to_the_destination() -> None:
    punganur = stop("Punganur", PUNGANUR)
    plan = plan_route([punganur], MADANAPALLE)
    assert plan.ordered_stops == [punganur]
    assert plan.legs_km == [Decimal("28.5")]
    assert plan.total_distance_km == Decimal("28.5")
    assert plan.points == [PUNGANUR, MADANAPALLE]


def test_route_starts_farthest_then_visits_nearest_neighbours() -> None:
    stops = [
        stop("Punganur", PUNGANUR),
        stop("B. Kothakota", B_KOTHAKOTA),
        stop("Palamaner", PALAMANER),
    ]
    plan = plan_route(stops, MADANAPALLE)
    # Palamaner is farthest from Madanapalle (61.4 km); Punganur is its nearest neighbour.
    assert labels(plan) == ["Palamaner", "Punganur", "B. Kothakota"]
    assert plan.legs_km == [Decimal("34.5"), Decimal("60.0"), Decimal("36.2")]
    assert plan.total_distance_km == Decimal("130.7")
    assert plan.points == [PALAMANER, PUNGANUR, B_KOTHAKOTA, MADANAPALLE]


def test_destination_changes_the_starting_stop() -> None:
    stops = [
        stop("Punganur", PUNGANUR),
        stop("Madanapalle", MADANAPALLE),
        stop("Palamaner", PALAMANER),
    ]
    plan = plan_route(stops, B_KOTHAKOTA)
    # Palamaner is 94.5 km from B. Kothakota; then Punganur (34.5), then Madanapalle (28.5).
    assert labels(plan) == ["Palamaner", "Punganur", "Madanapalle"]
    assert plan.legs_km == [Decimal("34.5"), Decimal("28.5"), Decimal("36.2")]
    assert plan.total_distance_km == Decimal("99.2")


def test_legs_are_road_distances_and_total_is_their_sum() -> None:
    stops = [stop("Punganur", PUNGANUR), stop("Palamaner", PALAMANER)]
    plan = plan_route(stops, MADANAPALLE)
    expected_legs = [road_km(*start, *end) for start, end in pairwise(plan.points)]
    assert plan.legs_km == expected_legs
    assert plan.total_distance_km == sum(plan.legs_km, Decimal("0.0"))
    assert len(plan.legs_km) == len(stops)
    assert len(plan.points) == len(stops) + 1


def test_equal_distances_keep_input_order() -> None:
    first = stop("Farmer 1", PUNGANUR)
    second = stop("Farmer 2", PUNGANUR)
    plan = plan_route([first, second], MADANAPALLE)
    assert plan.ordered_stops == [first, second]
    assert plan.legs_km == [Decimal("0.0"), Decimal("28.5")]
    assert plan.total_distance_km == Decimal("28.5")


def test_every_stop_is_visited_exactly_once() -> None:
    stops = [
        stop("Punganur", PUNGANUR, "200"),
        stop("Palamaner", PALAMANER, "350"),
        stop("B. Kothakota", B_KOTHAKOTA, "500"),
        stop("Madanapalle", MADANAPALLE, "150"),
    ]
    plan = plan_route(stops, (13.6300, 79.4200))  # Tirupati market
    assert sorted(item.id for item in plan.ordered_stops) == sorted(item.id for item in stops)
    assert sum(item.quantity_kg for item in plan.ordered_stops) == Decimal("1200")
    assert plan.points[-1] == (13.6300, 79.4200)
