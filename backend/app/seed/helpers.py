"""Small helpers shared by the seed modules: clock, geography, deterministic noise, maths, text."""

from __future__ import annotations

import hashlib
import math
import random
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal

from app.core.time import IST, utcnow
from app.services.pricing import (
    LOADING_PER_KG,
    format_number,
    format_rupees,
    round_money,
    to_decimal,
)

DEMO_PASSWORD = "MandiMate@2026"
"""Password of every seeded account (documented in the README)."""

STATE_AP = "Andhra Pradesh"
STATE_KA = "Karnataka"
DISTRICT_ANNAMAYYA = "Annamayya"
DISTRICT_CHITTOOR = "Chittoor"

FARM_JITTER_KM = 3.0
KM_PER_DEGREE_LAT = 111.32

# ─────────────────────────────── Randomness ───────────────────────────────


def stable_rng(*parts: object) -> random.Random:
    """A ``Random`` seeded from ``parts``: the same inputs always give the same sequence."""
    digest = hashlib.sha256("|".join(str(part) for part in parts).encode()).digest()
    return random.Random(int.from_bytes(digest[:8], "big"))


# ──────────────────────────────── Clock ────────────────────────────────


@dataclass(frozen=True)
class Clock:
    """The seed's notion of "now": every date and timestamp is relative to it."""

    now: datetime
    """Timezone-aware UTC."""

    @classmethod
    def current(cls) -> Clock:
        return cls(now=utcnow())

    @property
    def today(self) -> date:
        """Business "today" (India), consistent with ``app.core.time.today_ist``."""
        return self.now.astimezone(IST).date()

    def day(self, offset: int) -> date:
        return self.today + timedelta(days=offset)

    def at(self, day_offset: int, hour: int, minute: int = 0) -> datetime:
        """IST wall-clock time ``hour:minute`` on ``today + day_offset``, as UTC.

        Never later than one minute ago, so nothing seeded lies in the future.
        """
        return self.on(self.day(day_offset), hour, minute)

    def on(self, day: date, hour: int, minute: int = 0) -> datetime:
        moment = datetime.combine(day, time(hour, minute), tzinfo=IST).astimezone(UTC)
        return min(moment, self.now - timedelta(minutes=1))

    def ago(self, hours: float) -> datetime:
        return self.now - timedelta(hours=hours)

    def ahead(self, hours: float) -> datetime:
        return self.now + timedelta(hours=hours)

    def ist_date(self, moment: datetime) -> date:
        return moment.astimezone(IST).date()


# ─────────────────────────────── Geography ───────────────────────────────


@dataclass(frozen=True)
class Place:
    name: str
    latitude: float
    longitude: float
    district: str
    state: str


VILLAGES: dict[str, Place] = {
    place.name: place
    for place in (
        Place("Madanapalle", 13.5503, 78.5029, DISTRICT_ANNAMAYYA, STATE_AP),
        Place("Punganur", 13.3650, 78.5730, DISTRICT_CHITTOOR, STATE_AP),
        Place("Palamaner", 13.2000, 78.7500, DISTRICT_CHITTOOR, STATE_AP),
        Place("B. Kothakota", 13.6575, 78.2697, DISTRICT_ANNAMAYYA, STATE_AP),
        Place("Thamballapalle", 13.7167, 78.3833, DISTRICT_ANNAMAYYA, STATE_AP),
        Place("Kurabalakota", 13.6500, 78.4800, DISTRICT_ANNAMAYYA, STATE_AP),
        Place("Nimmanapalle", 13.6000, 78.6300, DISTRICT_ANNAMAYYA, STATE_AP),
        Place("Ramasamudram", 13.4000, 78.4200, DISTRICT_ANNAMAYYA, STATE_AP),
        Place("Peddamandyam", 13.7800, 78.5200, DISTRICT_ANNAMAYYA, STATE_AP),
        Place("Mulakalacheruvu", 13.8833, 78.4167, DISTRICT_ANNAMAYYA, STATE_AP),
    )
}
"""The pilot cluster around Madanapalle (Annamayya and Chittoor districts, Andhra Pradesh)."""


def jitter(latitude: float, longitude: float, rng: random.Random, km: float = FARM_JITTER_KM):
    """A point uniformly within ``km`` of the given one (5 decimals ≈ 1 m)."""
    distance = km * math.sqrt(rng.random())
    bearing = rng.uniform(0, 2 * math.pi)
    d_lat = distance * math.cos(bearing) / KM_PER_DEGREE_LAT
    d_lng = distance * math.sin(bearing) / (KM_PER_DEGREE_LAT * math.cos(math.radians(latitude)))
    return round(latitude + d_lat, 5), round(longitude + d_lng, 5)


# ──────────────────────────────── Numbers ────────────────────────────────


def kg(value: int | float | Decimal) -> Decimal:
    """Whole kilograms as ``Decimal`` (every seeded weight is a whole kg)."""
    return Decimal(int(value))


def round_to_step(value: Decimal, step: Decimal) -> Decimal:
    """Nearest multiple of ``step`` (half-up), 2 decimals."""
    steps = (to_decimal(value) / step).quantize(Decimal(1), rounding=ROUND_HALF_UP)
    return round_money(steps * step)


@dataclass(frozen=True)
class PayoutFigures:
    gross: Decimal
    transport_share: Decimal
    handling_share: Decimal
    commission_share: Decimal
    net: Decimal
    net_per_kg: Decimal


def payout_figures(
    *,
    price_per_kg: Decimal,
    accepted_kg: Decimal,
    dispatched_kg: Decimal,
    total_dispatched_kg: Decimal,
    transport_total: Decimal,
    handling_charge_per_kg: Decimal,
    commission_pct: Decimal,
) -> PayoutFigures:
    """One farmer's settlement lines (DOMAIN_RULES §6), each rounded to the paisa.

    ``net`` is computed from the rounded lines, so a payout always adds up exactly.
    """
    gross = round_money(price_per_kg * accepted_kg)
    transport = (
        round_money(transport_total * dispatched_kg / total_dispatched_kg)
        if total_dispatched_kg > 0
        else round_money(0)
    )
    handling = round_money(handling_charge_per_kg * accepted_kg + LOADING_PER_KG * dispatched_kg)
    commission = round_money(commission_pct / Decimal(100) * gross)
    net = round_money(gross - transport - handling - commission)
    net_per_kg = round_money(net / dispatched_kg) if dispatched_kg > 0 else round_money(0)
    return PayoutFigures(gross, transport, handling, commission, net, net_per_kg)


# ───────────────────────────────── Text ─────────────────────────────────


def kg_text(value: int | float | Decimal) -> str:
    """``1,250 kg``."""
    return f"{format_number(value)} kg"


def rupees(value: int | float | Decimal) -> str:
    """``₹5,123.40``."""
    return format_rupees(value)


def per_kg(value: int | float | Decimal) -> str:
    """``₹16.00/kg``."""
    return f"{format_rupees(value)}/kg"


def day_text(day: date) -> str:
    """``28 Oct``."""
    return f"{day.day} {day.strftime('%b')}"
