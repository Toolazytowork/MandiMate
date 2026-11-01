"""Pickup route planning (DOMAIN_RULES §5), pure.

The route starts at the stop farthest from the destination, then repeatedly visits the nearest
remaining stop, and ends at the destination. Every leg is an estimated road distance
(great-circle × ``ROAD_FACTOR``, 1 decimal).
"""

from __future__ import annotations

from collections.abc import Hashable, Sequence
from dataclasses import dataclass
from decimal import Decimal
from itertools import pairwise

from app.services.pricing import haversine_km, road_km


@dataclass(frozen=True)
class RouteStop:
    id: Hashable
    """The caller's identifier for the stop (a lot member or harvest id)."""
    latitude: float
    longitude: float
    quantity_kg: Decimal
    label: str


@dataclass
class RoutePlan:
    ordered_stops: list[RouteStop]
    legs_km: list[Decimal]
    """One leg per stop: to the next stop, and from the last stop to the destination."""
    total_distance_km: Decimal
    points: list[tuple[float, float]]
    """``(latitude, longitude)`` of the stops in visiting order, then the destination."""


def plan_route(stops: Sequence[RouteStop], destination: tuple[float, float]) -> RoutePlan:
    """Order ``stops`` for a single vehicle that delivers everything to ``destination``.

    Ties (equal distances) keep the input order. With no stops the plan is just the destination.
    """
    destination_point = (destination[0], destination[1])
    if not stops:
        return RoutePlan(
            ordered_stops=[],
            legs_km=[],
            total_distance_km=Decimal("0.0"),
            points=[destination_point],
        )

    remaining = list(stops)
    current = max(
        remaining, key=lambda stop: haversine_km(stop.latitude, stop.longitude, *destination_point)
    )
    remaining.remove(current)
    ordered = [current]
    while remaining:
        origin = current
        current = min(
            remaining,
            key=lambda stop: haversine_km(
                origin.latitude, origin.longitude, stop.latitude, stop.longitude
            ),
        )
        remaining.remove(current)
        ordered.append(current)

    points = [(stop.latitude, stop.longitude) for stop in ordered] + [destination_point]
    legs = [road_km(start[0], start[1], end[0], end[1]) for start, end in pairwise(points)]
    return RoutePlan(
        ordered_stops=ordered,
        legs_km=legs,
        total_distance_km=sum(legs, Decimal("0.0")),
        points=points,
    )
