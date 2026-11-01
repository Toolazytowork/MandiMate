"""Illustrative daily mandi prices for the pilot cluster (never presented as live data).

Prices follow a smooth, crop-specific seasonal wave plus small day-to-day noise, anchored so
that *today's* modal price at Madanapalle APMC equals the crop's reference level (tomato:
₹14/kg). ``modal_price`` is a pure function of (crop, market, days from today), so the same
curve also prices the baseline of historical settlements older than the stored 60 days.
"""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy.dialects.postgresql import insert

from app.core.time import utcnow
from app.models import MarketPrice
from app.seed.helpers import (
    DISTRICT_ANNAMAYYA,
    DISTRICT_CHITTOOR,
    STATE_AP,
    STATE_KA,
    round_to_step,
    stable_rng,
)
from app.services.pricing import haversine_km, round_money

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models import Crop

SOURCE = "Illustrative seed data — not live market prices"
HISTORY_DAYS = 60
"""Days of stored prices, ending today."""
PRICE_STEP = Decimal("0.10")
"""Mandis quote per quintal in ₹10 steps, i.e. ₹0.10/kg."""


@dataclass(frozen=True)
class Market:
    key: str
    name: str
    district: str
    state: str
    latitude: float
    longitude: float
    factor: Decimal
    """Price level relative to Madanapalle APMC."""


MARKETS: tuple[Market, ...] = (
    Market(
        "madanapalle",
        "Madanapalle APMC",
        DISTRICT_ANNAMAYYA,
        STATE_AP,
        13.5560,
        78.5010,
        Decimal("1.00"),
    ),
    Market(
        "punganur",
        "Punganur Market Yard",
        DISTRICT_CHITTOOR,
        STATE_AP,
        13.3680,
        78.5770,
        Decimal("0.97"),
    ),
    Market(
        "palamaner",
        "Palamaner Market Yard",
        DISTRICT_CHITTOOR,
        STATE_AP,
        13.2010,
        78.7460,
        Decimal("0.98"),
    ),
    Market("kolar", "Kolar APMC", "Kolar", STATE_KA, 13.1367, 78.1292, Decimal("1.05")),
)
MARKETS_BY_KEY: dict[str, Market] = {market.key: market for market in MARKETS}
MADANAPALLE = MARKETS_BY_KEY["madanapalle"]


@dataclass(frozen=True)
class PriceProfile:
    today_level: Decimal
    """Modal ₹/kg at Madanapalle today."""
    low: Decimal
    high: Decimal
    """Every generated modal price is clamped to [low, high]."""
    amplitude: float
    """Relative swing of the main seasonal wave."""
    period_days: int
    noise: float
    """Relative day-to-day noise."""


PRICE_PROFILES: dict[str, PriceProfile] = {
    "TOM": PriceProfile(Decimal("14.0"), Decimal("12"), Decimal("18"), 0.10, 47, 0.03),
    "ONI": PriceProfile(Decimal("26.0"), Decimal("20"), Decimal("32"), 0.10, 61, 0.025),
    "CHI": PriceProfile(Decimal("34.0"), Decimal("26"), Decimal("44"), 0.12, 37, 0.040),
    "POT": PriceProfile(Decimal("24.0"), Decimal("19"), Decimal("29"), 0.07, 73, 0.020),
    "MNG": PriceProfile(Decimal("52.0"), Decimal("40"), Decimal("65"), 0.10, 53, 0.030),
    "GNT": PriceProfile(Decimal("64.0"), Decimal("55"), Decimal("75"), 0.05, 89, 0.015),
    "OKR": PriceProfile(Decimal("30.0"), Decimal("22"), Decimal("38"), 0.12, 29, 0.045),
    "BRN": PriceProfile(Decimal("24.0"), Decimal("18"), Decimal("30"), 0.11, 33, 0.040),
    "CAB": PriceProfile(Decimal("11.0"), Decimal("7"), Decimal("15"), 0.15, 41, 0.045),
    "BAN": PriceProfile(Decimal("26.0"), Decimal("20"), Decimal("32"), 0.06, 67, 0.020),
}


def modal_price(crop_code: str, market: Market, day: date, today: date) -> Decimal:
    """Illustrative modal ₹/kg of ``crop_code`` at ``market`` on ``day``."""
    profile = PRICE_PROFILES[crop_code]
    offset = (day - today).days
    wave = profile.amplitude * math.sin(2 * math.pi * offset / profile.period_days)
    ripple = 0.03 * math.sin(2 * math.pi * offset / 9)
    noise = 0.0
    if offset != 0:
        noise = stable_rng("modal", crop_code, offset).uniform(-profile.noise, profile.noise)
    level = profile.today_level * Decimal(str(round(1 + wave + ripple + noise, 6))) * market.factor
    clamped = min(max(level, profile.low), profile.high)
    return round_to_step(clamped, PRICE_STEP)


def price_range(
    crop_code: str, market: Market, day: date, today: date
) -> tuple[Decimal, Decimal, Decimal]:
    """``(min, modal, max)`` ₹/kg with a realistic spread around the modal price."""
    modal = modal_price(crop_code, market, day, today)
    rng = stable_rng("spread", crop_code, market.key, (day - today).days)
    low = round_to_step(modal * Decimal(str(round(rng.uniform(0.72, 0.85), 3))), PRICE_STEP)
    high = round_to_step(modal * Decimal(str(round(rng.uniform(1.12, 1.28), 3))), PRICE_STEP)
    return min(low, modal), modal, max(high, modal)


def nearest_market(latitude: float, longitude: float) -> Market:
    """The mandi a farmer at this point would sell at alone."""
    return min(MARKETS, key=lambda m: haversine_km(latitude, longitude, m.latitude, m.longitude))


async def seed_market_prices(db: AsyncSession, crops: dict[str, Crop], today: date) -> int:
    """Insert ``HISTORY_DAYS`` of daily prices for every crop at every market.

    Rows that already exist (same crop, market and date) are skipped. Returns rows inserted.
    """
    created_at = utcnow()
    rows = []
    for code, crop in sorted(crops.items()):
        if code not in PRICE_PROFILES:
            continue
        for market in MARKETS:
            for back in range(HISTORY_DAYS - 1, -1, -1):
                day = today - timedelta(days=back)
                low, modal, high = price_range(code, market, day, today)
                rows.append(
                    {
                        "id": uuid.uuid4(),
                        "crop_id": crop.id,
                        "market_name": market.name,
                        "district": market.district,
                        "state": market.state,
                        "price_date": day,
                        "min_price_per_kg": round_money(low),
                        "modal_price_per_kg": round_money(modal),
                        "max_price_per_kg": round_money(high),
                        "source": SOURCE,
                        "is_illustrative": True,
                        "created_at": created_at,
                    }
                )
    inserted = 0
    for start in range(0, len(rows), 500):
        statement = (
            insert(MarketPrice)
            .values(rows[start : start + 500])
            .on_conflict_do_nothing(index_elements=["crop_id", "market_name", "price_date"])
            .returning(MarketPrice.id)
        )
        inserted += len((await db.execute(statement)).all())
    return inserted
