"""Net proceeds engine (DOMAIN_RULES §3).

Transport estimates, the per-line net-proceeds breakdown, the "sell alone at the mandi" baseline,
the counter-offer floor and suggestion, and the public calculator. Every function is pure: inputs
may be ``Decimal``, ``float`` or ``int``, arithmetic is done in ``Decimal`` and results are rounded
half-up only when they are produced (money to 2 decimals, road distances to 1 decimal).
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal

from app import schemas

type NumberLike = Decimal | float | int

# ─────────────────────────────── Constants ───────────────────────────────

LOADING_PER_KG = Decimal("0.25")
"""₹/kg for loading & crates at the collection point (estimate)."""
MANDI_HANDLING_PER_KG = Decimal("0.50")
"""₹/kg hamali / unloading at a mandi (baseline)."""
MANDI_COMMISSION_PCT = Decimal("8")
"""Commission agent fee at a mandi, % of the accepted value (baseline)."""
CAPITAL_COST_ANNUAL_PCT = Decimal("18")
"""Informal credit rate used to price a payment delay, % per year."""
BASELINE_DISTANCE_KM = Decimal("25")
"""Farm → nearest mandi when the real distance is unknown."""
BASELINE_PAYMENT_DAYS = 1
"""A mandi pays the next day."""
ROAD_FACTOR = Decimal("1.3")
"""Great-circle → road distance."""
DEFAULT_RADIUS_KM = Decimal("40")
"""Matching radius around a collection point."""
DEFAULT_REJECTION_PCT = Decimal("5")
"""Expected rejection used by the public calculator when none is entered."""
EARTH_RADIUS_KM = 6371.0088
"""Mean Earth radius (IUGG)."""
DAYS_PER_YEAR = Decimal("365")

COUNTER_MARKET_PREMIUM = Decimal("1.05")
"""A counter-offer never asks for more than 5% above the market reference before rounding."""
COUNTER_MIN_STEP = Decimal("0.50")
"""Smallest price step (₹/kg) of a counter-offer below the market reference."""
COUNTER_ROUNDING_STEP = Decimal("0.50")
"""Counter-offers are rounded up to the nearest ₹0.50."""

BASELINE_LABEL = "Sell alone at local mandi"
CALCULATOR_LABEL = "Your estimate"
PLATFORM_FEE_NOTE = "MandiMate charges buyers, not farmers"

UNRESOLVED_QUALITY = "Quality inspection pending"
UNRESOLVED_TRANSPORT_LOCATION = "Transport cost unknown: location missing"
UNRESOLVED_TRANSPORT_QUOTE = "Transport quote pending"
UNRESOLVED_BUYER_UNVERIFIED = "Buyer not yet verified"
UNRESOLVED_FARMER_CONSENT = "Awaiting farmer consent"
UNRESOLVED_BUYER_RESPONSE = "Awaiting buyer response"

LINE_ORDER: tuple[schemas.BreakdownKey, ...] = (
    "gross",
    "rejection",
    "transport",
    "handling",
    "commission",
    "payment_wait",
    "platform_fee",
)
LINE_LABELS: dict[schemas.BreakdownKey, str] = {
    "gross": "Gross sale value",
    "rejection": "Expected rejection",
    "transport": "Transport",
    "handling": "Handling & loading",
    "commission": "Commission",
    "payment_wait": "Cost of waiting for payment",
    "platform_fee": "MandiMate fee",
}

_HUNDRED = Decimal(100)
_CENT = Decimal("0.01")
_TENTH = Decimal("0.1")
_ZERO_MONEY = Decimal("0.00")


@dataclass(frozen=True)
class VehicleClass:
    vehicle_type: schemas.VehicleType
    capacity_kg: int
    base_charge: Decimal
    per_km_rate: Decimal
    refrigerated: bool


VEHICLE_CLASSES: tuple[VehicleClass, ...] = (
    VehicleClass("mini_truck", 750, Decimal("600"), Decimal("18"), refrigerated=False),
    VehicleClass("pickup", 1500, Decimal("900"), Decimal("24"), refrigerated=False),
    VehicleClass("light_truck", 3500, Decimal("1500"), Decimal("32"), refrigerated=False),
    VehicleClass("medium_truck", 9000, Decimal("2500"), Decimal("45"), refrigerated=False),
    VehicleClass("reefer_truck", 5000, Decimal("3500"), Decimal("55"), refrigerated=True),
)


@dataclass(frozen=True)
class TransportEstimate:
    vehicle_type: schemas.VehicleType
    capacity_kg: int
    trips: int
    distance_km: Decimal
    cost_total: Decimal
    cost_per_kg: Decimal
    utilization_pct: Decimal


# ──────────────────────────── Number helpers ────────────────────────────


def to_decimal(value: NumberLike) -> Decimal:
    """Exact ``Decimal`` for an int, a Decimal or a float (via its shortest repr, so 0.1 → 0.1)."""
    if isinstance(value, Decimal):
        result = value
    elif isinstance(value, int):
        result = Decimal(value)
    elif isinstance(value, float):
        result = Decimal(repr(value))
    else:
        raise TypeError(f"Expected a number, got {type(value).__name__}")
    if not result.is_finite():
        raise ValueError(f"Expected a finite number, got {value!r}")
    return result


def round_money(value: NumberLike) -> Decimal:
    """Half-up to 2 decimals, never returning a negative zero."""
    result = to_decimal(value).quantize(_CENT, rounding=ROUND_HALF_UP)
    return result if result != 0 else _ZERO_MONEY


def format_number(value: NumberLike) -> str:
    """Up to 2 decimals without trailing zeros, Indian digit grouping: ``1240000.5`` → ``12,40,000.5``."""
    rounded = round_money(value)
    sign = "-" if rounded < 0 else ""
    integer_part, _, fraction = f"{abs(rounded):f}".partition(".")
    fraction = fraction.rstrip("0")
    grouped = _group_indian(integer_part)
    return f"{sign}{grouped}.{fraction}" if fraction else f"{sign}{grouped}"


def format_rupees(value: NumberLike) -> str:
    """``₹1,050.00``: always 2 decimals, Indian digit grouping."""
    rounded = round_money(value)
    sign = "-" if rounded < 0 else ""
    integer_part, _, fraction = f"{abs(rounded):f}".partition(".")
    return f"{sign}₹{_group_indian(integer_part)}.{fraction}"


def _group_indian(digits: str) -> str:
    if len(digits) <= 3:
        return digits
    head, tail = digits[:-3], digits[-3:]
    groups: list[str] = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return ",".join([*groups, tail])


def _non_negative(value: NumberLike, name: str) -> Decimal:
    number = to_decimal(value)
    if number < 0:
        raise ValueError(f"{name} must not be negative, got {value!r}")
    return number


def _percent(value: NumberLike, name: str) -> Decimal:
    number = to_decimal(value)
    if not 0 <= number <= _HUNDRED:
        raise ValueError(f"{name} must be between 0 and 100, got {value!r}")
    return number


def _check_days(days: int) -> int:
    if days < 0:
        raise ValueError(f"payment_terms_days must not be negative, got {days!r}")
    return days


def _plural(count: int, singular: str, plural: str | None = None) -> str:
    return f"{count} {singular if count == 1 else (plural or singular + 's')}"


# ─────────────────────────────── Distances ───────────────────────────────


def _great_circle_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(float(lat1)), math.radians(float(lat2))
    d_phi = phi2 - phi1
    d_lambda = math.radians(float(lon2) - float(lon1))
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> Decimal:
    """Great-circle distance in km, 2 decimals."""
    return round_money(_great_circle_km(lat1, lon1, lat2, lon2))


def road_km(lat1: float, lon1: float, lat2: float, lon2: float) -> Decimal:
    """Estimated road distance: great-circle distance × ``ROAD_FACTOR``, 1 decimal."""
    distance = to_decimal(_great_circle_km(lat1, lon1, lat2, lon2)) * ROAD_FACTOR
    return distance.quantize(_TENTH, rounding=ROUND_HALF_UP)


# ─────────────────────────────── Transport ───────────────────────────────


def vehicle_label(vehicle_type: schemas.VehicleType) -> str:
    """``"mini_truck"`` → ``"Mini truck"``."""
    return vehicle_type.replace("_", " ").capitalize()


def estimate_transport_cost(
    total_kg: NumberLike, distance_km: NumberLike, refrigerated: bool = False
) -> TransportEstimate:
    """Cheapest standard vehicle for the load (DOMAIN_RULES §3, vehicle classes).

    Only classes whose refrigeration matches ``refrigerated`` are eligible. The smallest eligible
    class that carries the whole load is used; when none can, the largest eligible class makes
    ``ceil(total_kg / capacity)`` trips. A zero load needs no trip and costs nothing.
    """
    load = _non_negative(total_kg, "total_kg")
    distance = _non_negative(distance_km, "distance_km")
    eligible = sorted(
        (vehicle for vehicle in VEHICLE_CLASSES if vehicle.refrigerated == refrigerated),
        key=lambda vehicle: vehicle.capacity_kg,
    )
    vehicle = next((v for v in eligible if v.capacity_kg >= load), eligible[-1])
    trips = math.ceil(load / vehicle.capacity_kg)
    cost = trips * (vehicle.base_charge + vehicle.per_km_rate * distance)
    return TransportEstimate(
        vehicle_type=vehicle.vehicle_type,
        capacity_kg=vehicle.capacity_kg,
        trips=trips,
        distance_km=round_money(distance),
        cost_total=round_money(cost),
        cost_per_kg=round_money(cost / load) if load > 0 else _ZERO_MONEY,
        utilization_pct=(
            round_money(load / (vehicle.capacity_kg * trips) * _HUNDRED) if trips else _ZERO_MONEY
        ),
    )


def describe_transport_estimate(estimate: TransportEstimate) -> str:
    """``"Mini truck, 1 trip, 25 km"``."""
    return (
        f"{vehicle_label(estimate.vehicle_type)}, {_plural(estimate.trips, 'trip')}, "
        f"{format_number(estimate.distance_km)} km"
    )


# ───────────────────────────── Net proceeds ─────────────────────────────


def overall_confidence(certainties: Iterable[schemas.Certainty]) -> schemas.Certainty:
    """``unresolved`` if any is unresolved, else ``estimated`` if any is estimated, else ``confirmed``."""
    seen = set(certainties)
    if "unresolved" in seen:
        return "unresolved"
    if "estimated" in seen:
        return "estimated"
    return "confirmed"


def _payment_wait_rate(payment_terms_days: int) -> Decimal:
    """Share of the accepted value lost to waiting ``payment_terms_days`` for the money."""
    return CAPITAL_COST_ANNUAL_PCT / _HUNDRED * payment_terms_days / DAYS_PER_YEAR


def _payment_wait_note(payment_terms_days: int) -> str:
    if payment_terms_days == 0:
        return "Paid on delivery"
    return (
        f"Cost of waiting {_plural(payment_terms_days, 'day')} "
        f"at {format_number(CAPITAL_COST_ANNUAL_PCT)}%/yr"
    )


def _commission_note(commission_pct: Decimal) -> str:
    if commission_pct == 0:
        return "No commission"
    return f"{format_number(commission_pct)}% of the accepted value"


def compute_net_proceeds(
    *,
    label: str,
    quantity_kg: NumberLike,
    price_per_kg: NumberLike,
    transport_cost: NumberLike,
    transport_certainty: schemas.Certainty,
    rejection_pct: NumberLike,
    rejection_certainty: schemas.Certainty,
    handling_per_kg: NumberLike,
    commission_pct: NumberLike,
    commission_certainty: schemas.Certainty,
    payment_terms_days: int,
    gross_certainty: schemas.Certainty = "confirmed",
    handling_certainty: schemas.Certainty = "estimated",
    gross_note: str | None = None,
    transport_note: str | None = None,
    handling_note: str | None = None,
    rejection_note: str | None = None,
    commission_note: str | None = None,
    unresolved: Sequence[str] = (),
) -> schemas.NetProceeds:
    """What the farmer keeps from selling ``quantity_kg`` at ``price_per_kg`` (DOMAIN_RULES §3).

    ``transport_cost`` is the total transport borne by this quantity (already shared by weight
    for a pooled lot). Lines come in the fixed order gross, rejection, transport, handling,
    commission, payment_wait, platform_fee with signed amounts (income positive, deductions
    negative). Each line is computed exactly and rounded to 2 decimals; the net is the sum of the
    rounded lines, so the breakdown always adds up to the net shown and
    ``net_amount == gross_amount - total_deductions``. Missing notes get a plain-language default.

    ``unresolved`` lists the caller's open conditions; "Quality inspection pending" is added when
    the rejection line is unresolved and "Transport cost unknown: location missing" when the
    transport line is. Duplicates are dropped, first occurrence kept.
    """
    quantity = _non_negative(quantity_kg, "quantity_kg")
    price = _non_negative(price_per_kg, "price_per_kg")
    transport_total = _non_negative(transport_cost, "transport_cost")
    handling_rate = _non_negative(handling_per_kg, "handling_per_kg")
    rejection = _percent(rejection_pct, "rejection_pct")
    commission = _percent(commission_pct, "commission_pct")
    days = _check_days(payment_terms_days)

    rejected_kg = quantity * rejection / _HUNDRED
    gross = price * quantity
    rejection_amount = -(price * rejected_kg)
    accepted_value = gross + rejection_amount
    exact_amounts: dict[schemas.BreakdownKey, Decimal] = {
        "gross": gross,
        "rejection": rejection_amount,
        "transport": -transport_total,
        "handling": -(handling_rate * quantity),
        "commission": -(accepted_value * commission / _HUNDRED),
        "payment_wait": -(accepted_value * _payment_wait_rate(days)),
        "platform_fee": Decimal(0),
    }
    certainties: dict[schemas.BreakdownKey, schemas.Certainty] = {
        "gross": gross_certainty,
        "rejection": rejection_certainty,
        "transport": transport_certainty,
        "handling": handling_certainty,
        "commission": commission_certainty,
        "payment_wait": "estimated",
        "platform_fee": "confirmed",
    }
    notes: dict[schemas.BreakdownKey, str | None] = {
        "gross": gross_note or f"{format_number(quantity)} kg × {format_rupees(price)}/kg",
        "rejection": rejection_note or f"Expected {format_number(rejection)}% rejection",
        "transport": transport_note,
        "handling": handling_note or f"{format_rupees(handling_rate)}/kg loading & handling",
        "commission": commission_note or _commission_note(commission),
        "payment_wait": _payment_wait_note(days),
        "platform_fee": PLATFORM_FEE_NOTE,
    }

    def per_kg(amount: Decimal) -> Decimal:
        return round_money(amount / quantity) if quantity > 0 else _ZERO_MONEY

    amounts = {key: round_money(exact_amounts[key]) for key in LINE_ORDER}
    lines = [
        schemas.BreakdownLine(
            key=key,
            label=LINE_LABELS[key],
            amount=float(amounts[key]),
            per_kg=float(per_kg(amounts[key])),
            certainty=certainties[key],
            note=notes[key],
        )
        for key in LINE_ORDER
    ]
    gross_amount = amounts["gross"]
    net = round_money(sum(amounts.values(), Decimal(0)))

    derived: list[str] = []
    if rejection_certainty == "unresolved":
        derived.append(UNRESOLVED_QUALITY)
    if transport_certainty == "unresolved":
        derived.append(UNRESOLVED_TRANSPORT_LOCATION)
    open_conditions = list(dict.fromkeys([*unresolved, *derived]))

    return schemas.NetProceeds(
        label=label,
        quantity_kg=float(round_money(quantity)),
        expected_accepted_kg=float(round_money(quantity - rejected_kg)),
        gross_price_per_kg=float(round_money(price)),
        gross_amount=float(gross_amount),
        lines=lines,
        total_deductions=float(round_money(gross_amount - net)),
        net_amount=float(net),
        net_per_kg=float(per_kg(net)),
        payment_terms_days=days,
        confidence=overall_confidence(certainties.values()),
        unresolved=open_conditions,
    )


def baseline_net_proceeds(
    *,
    quantity_kg: NumberLike,
    market_price_per_kg: NumberLike | None,
    default_rejection_pct: NumberLike,
    distance_km: NumberLike = BASELINE_DISTANCE_KM,
    is_illustrative: bool = False,
    market_name: str | None = None,
) -> schemas.NetProceeds | None:
    """The credible alternative: the farmer sells alone at the local mandi (DOMAIN_RULES §3).

    Priced at the latest modal price with the crop's default rejection, the farmer's own vehicle
    hire over ``distance_km``, mandi hamali and commission, and next-day payment. Every line is an
    estimate. ``None`` when there is no market price to anchor it.
    """
    if market_price_per_kg is None:
        return None
    transport = estimate_transport_cost(quantity_kg, distance_km)
    rejection = _percent(default_rejection_pct, "default_rejection_pct")
    where = f" at {market_name}" if market_name else ""
    gross_note = (
        f"Illustrative modal price{where} (not live market data)"
        if is_illustrative
        else f"Latest modal price{where}"
    )
    trips = f", {_plural(transport.trips, 'trip')}" if transport.trips > 1 else ""
    return compute_net_proceeds(
        label=BASELINE_LABEL,
        quantity_kg=quantity_kg,
        price_per_kg=market_price_per_kg,
        transport_cost=transport.cost_total,
        transport_certainty="estimated",
        rejection_pct=rejection,
        rejection_certainty="estimated",
        handling_per_kg=MANDI_HANDLING_PER_KG,
        commission_pct=MANDI_COMMISSION_PCT,
        commission_certainty="estimated",
        payment_terms_days=BASELINE_PAYMENT_DAYS,
        gross_certainty="estimated",
        handling_certainty="estimated",
        gross_note=gross_note,
        transport_note=(
            f"{vehicle_label(transport.vehicle_type)} hired alone{trips}, "
            f"{format_number(transport.distance_km)} km to the mandi"
        ),
        handling_note=f"Hamali / unloading at the mandi, {format_rupees(MANDI_HANDLING_PER_KG)}/kg",
        rejection_note=f"Expected {format_number(rejection)}% rejection (crop average)",
        commission_note=f"Commission agent at {format_number(MANDI_COMMISSION_PCT)}%",
    )


# ─────────────────────────── Counter-offer rules ───────────────────────────


def net_linear_coefficients(
    *,
    quantity_kg: NumberLike,
    transport_cost: NumberLike,
    handling_per_kg: NumberLike,
    commission_pct: NumberLike,
    rejection_pct: NumberLike,
    payment_terms_days: int,
) -> tuple[Decimal, Decimal]:
    """``(a, b)`` such that the exact (unrounded) net at price ``p`` is ``a·p − b``.

    ``a = q·(1 − r)·(1 − commission − capital cost of the wait)`` and ``b = transport + handling·q``.
    Returned unrounded so callers can solve for prices precisely.
    """
    quantity = _non_negative(quantity_kg, "quantity_kg")
    rejection = _percent(rejection_pct, "rejection_pct")
    commission = _percent(commission_pct, "commission_pct")
    days = _check_days(payment_terms_days)
    accepted_share = 1 - rejection / _HUNDRED
    kept_share = 1 - commission / _HUNDRED - _payment_wait_rate(days)
    a = quantity * accepted_share * kept_share
    b = _non_negative(transport_cost, "transport_cost") + (
        _non_negative(handling_per_kg, "handling_per_kg") * quantity
    )
    return a, b


def floor_price_for_min_net(
    *,
    min_net_per_kg: NumberLike,
    quantity_kg: NumberLike,
    transport_cost: NumberLike,
    handling_per_kg: NumberLike,
    commission_pct: NumberLike,
    rejection_pct: NumberLike,
    payment_terms_days: int,
) -> Decimal:
    """Smallest price per kg (rounded up to the paisa) whose net per kg reaches ``min_net_per_kg``.

    Never negative. Raises ``ValueError`` when no price can reach the minimum because every extra
    rupee of price is consumed by rejection, commission and waiting (``a ≤ 0``).
    """
    a, b = net_linear_coefficients(
        quantity_kg=quantity_kg,
        transport_cost=transport_cost,
        handling_per_kg=handling_per_kg,
        commission_pct=commission_pct,
        rejection_pct=rejection_pct,
        payment_terms_days=payment_terms_days,
    )
    if a <= 0:
        raise ValueError("No price can reach the minimum: deductions absorb the whole price")
    quantity = to_decimal(quantity_kg)
    exact = (to_decimal(min_net_per_kg) * quantity + b) / a
    floor = exact.quantize(_CENT, rounding=ROUND_CEILING)
    return floor if floor > 0 else _ZERO_MONEY


def _round_up_to_step(value: Decimal, step: Decimal) -> Decimal:
    steps = (value / step).to_integral_value(rounding=ROUND_CEILING)
    return round_money(steps * step)


def suggest_counter_price(
    *,
    current_price: NumberLike,
    floor_price: NumberLike | None,
    market_reference: NumberLike | None,
) -> tuple[Decimal, bool]:
    """``(suggested_price_per_kg, accept_advised)`` per the counter-offer rules of DOMAIN_RULES §3.

    The current price is good enough when it reaches both the farmer's floor and 5% above the
    market reference (each only when known); then the suggestion is the current price. Otherwise
    the suggestion is ``max(floor, min(current + max(0.50, (market − current) / 2), market × 1.05))``
    — or ``max(floor, current × 1.05)`` without a market reference — rounded up to ₹0.50.
    """
    current = _non_negative(current_price, "current_price")
    floor = _non_negative(floor_price, "floor_price") if floor_price is not None else None
    market = (
        _non_negative(market_reference, "market_reference")
        if market_reference is not None
        else None
    )
    targets = [floor] if floor is not None else []
    if market is not None:
        targets.append(market * COUNTER_MARKET_PREMIUM)
    if all(current >= target for target in targets):
        return round_money(current), True

    if market is not None:
        step = max(COUNTER_MIN_STEP, (market - current) / 2)
        candidate = min(current + step, market * COUNTER_MARKET_PREMIUM)
    else:
        candidate = current * COUNTER_MARKET_PREMIUM
    if floor is not None:
        candidate = max(floor, candidate)
    return _round_up_to_step(candidate, COUNTER_ROUNDING_STEP), False


# ──────────────────────────── Public calculator ────────────────────────────


def calculate(req: schemas.NetProceedsCalcRequest) -> schemas.NetProceeds:
    """``POST /calculator/net-proceeds``: a quick estimate from whatever the visitor knows.

    Transport: the entered total (confirmed), else an estimate from the distance, else left out
    (0, "Not included"). Handling defaults to the loading estimate, commission to 0 (confirmed),
    rejection to 5% (estimated) and payment terms to 0 days. The price itself is an estimate.
    """
    quantity = to_decimal(req.quantity_kg)

    transport_certainty: schemas.Certainty
    if req.transport_cost_total is not None:
        transport_cost = to_decimal(req.transport_cost_total)
        transport_certainty = "confirmed"
        transport_note = "Transport cost you entered"
    elif req.distance_km is not None:
        estimate = estimate_transport_cost(quantity, req.distance_km)
        transport_cost = estimate.cost_total
        transport_certainty = "estimated"
        transport_note = f"Estimated: {describe_transport_estimate(estimate)}"
    else:
        transport_cost = Decimal(0)
        transport_certainty = "estimated"
        transport_note = "Not included"

    if req.handling_charge_per_kg is not None:
        handling = to_decimal(req.handling_charge_per_kg)
        handling_note = f"{format_rupees(handling)}/kg you entered"
    else:
        handling = LOADING_PER_KG
        handling_note = (
            f"Loading & crates at the collection point, {format_rupees(LOADING_PER_KG)}/kg"
        )

    if req.expected_rejection_pct is not None:
        rejection = to_decimal(req.expected_rejection_pct)
        rejection_note = f"Expected {format_number(rejection)}% rejection"
    else:
        rejection = DEFAULT_REJECTION_PCT
        rejection_note = (
            f"Expected {format_number(rejection)}% rejection (typical for fresh produce)"
        )

    return compute_net_proceeds(
        label=CALCULATOR_LABEL,
        quantity_kg=quantity,
        price_per_kg=req.price_per_kg,
        transport_cost=transport_cost,
        transport_certainty=transport_certainty,
        rejection_pct=rejection,
        rejection_certainty="estimated",
        handling_per_kg=handling,
        commission_pct=req.commission_pct if req.commission_pct is not None else 0,
        commission_certainty="confirmed",
        payment_terms_days=req.payment_terms_days if req.payment_terms_days is not None else 0,
        gross_certainty="estimated",
        handling_certainty="estimated",
        transport_note=transport_note,
        handling_note=handling_note,
        rejection_note=rejection_note,
    )
