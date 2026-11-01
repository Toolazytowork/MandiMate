"""Async factories for realistic test data in the Madanapalle tomato cluster (Andhra Pradesh).

Each factory adds its object, **commits** (so API requests made later in the test, which use
their own sessions, can see it) and returns the object refreshed with its eager relationships.
Keyword overrides are model field names. Objects returned here are not updated by later API
calls: use ``await db.refresh(obj)`` before asserting on them.
"""

from __future__ import annotations

import itertools
from collections.abc import Sequence
from datetime import timedelta
from decimal import Decimal
from functools import lru_cache
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.core.time import today_ist, utcnow
from app.models import (
    Base,
    Crop,
    Demand,
    Fpo,
    Harvest,
    Lot,
    LotMember,
    MarketPrice,
    NegotiationEntry,
    Offer,
    User,
)
from app.models.enums import LotStatus, Role
from app.services.codes import next_code

DEFAULT_PASSWORD = "Tomato2026"

DISTRICT = "Annamayya"
STATE = "Andhra Pradesh"
MADANAPALLE_MARKET = ("Madanapalle APMC", 13.5503, 78.5029)

FARM_VILLAGES: tuple[tuple[str, float, float], ...] = (
    ("Kurabalakota", 13.6496, 78.4867),
    ("Nimmanapalle", 13.5925, 78.4583),
    ("Angallu", 13.6237, 78.5367),
    ("Ramasamudram", 13.4005, 78.4510),
    ("Valmikipuram", 13.8247, 78.4528),
)

FARMER_NAMES = (
    "Ravi Kumar Reddy",
    "Lakshmi Devi",
    "Venkatesh Naidu",
    "Sreenivasulu Gowd",
    "Padmavathi Yadav",
    "Chandrasekhar Rao",
)

BENGALURU_BUYER = {
    "delivery_location": "Kalasipalya Wholesale Market, Bengaluru",
    "delivery_district": "Bengaluru Urban",
    "delivery_state": "Karnataka",
    "delivery_latitude": 12.9592,
    "delivery_longitude": 77.5760,
}

ROLE_DEFAULTS: dict[str, dict[str, Any]] = {
    "farmer": {"verification_status": "verified", "preferred_language": "te"},
    "buyer": {
        "full_name": "Anitha Sharma",
        "organization_name": "FreshBasket Retail Pvt Ltd",
        "village": None,
        "district": "Bengaluru Urban",
        "state": "Karnataka",
        "latitude": 12.9716,
        "longitude": 77.5946,
        "verification_status": "verified",
    },
    "transporter": {
        "full_name": "Mahesh Babu",
        "organization_name": "Sri Venkateswara Transports",
        "village": "Madanapalle",
        "district": DISTRICT,
        "state": STATE,
        "latitude": 13.5503,
        "longitude": 78.5029,
        "verification_status": "verified",
    },
    "coordinator": {
        "full_name": "Suresh Chowdary",
        "organization_name": "Madanapalle Tomato Growers FPO",
        "village": "Madanapalle",
        "district": DISTRICT,
        "state": STATE,
        "latitude": 13.5503,
        "longitude": 78.5029,
        "verification_status": "verified",
    },
    "admin": {
        "full_name": "Priya Menon",
        "organization_name": "MandiMate",
        "verification_status": "verified",
    },
}

HARVEST_STATUS_FOR_LOT: dict[str, str] = {
    "forming": "pooled",
    "awaiting_consent": "pooled",
    "open_for_offers": "pooled",
    "offer_accepted": "committed",
    "transport_booked": "committed",
    "in_transit": "picked_up",
    "delivered": "delivered",
    "settled": "settled",
    "cancelled": "listed",
}
"""Harvest status that mirrors a lot status (DOMAIN_RULES §2)."""

_sequence = itertools.count(1)


@lru_cache
def _password_hash(password: str) -> str:
    """Argon2 is deliberately slow; hash each distinct test password once per session."""
    return hash_password(password)


async def _save[ModelT: Base](db: AsyncSession, obj: ModelT) -> ModelT:
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return obj


async def create_fpo(db: AsyncSession, **overrides: Any) -> Fpo:
    fields: dict[str, Any] = {
        "name": "Madanapalle Tomato Growers FPO",
        "district": DISTRICT,
        "state": STATE,
    }
    return await _save(db, Fpo(**(fields | overrides)))


async def create_user(
    db: AsyncSession, role: Role = "farmer", *, password: str = DEFAULT_PASSWORD, **overrides: Any
) -> User:
    """A user of ``role`` with a unique email and +91 phone; farmers live in nearby villages."""
    number = next(_sequence)
    village, latitude, longitude = FARM_VILLAGES[number % len(FARM_VILLAGES)]
    fields: dict[str, Any] = {
        "email": f"{role}{number}@example.com",
        "phone": f"+9198480{number:05d}",
        "password_hash": _password_hash(password),
        "full_name": FARMER_NAMES[number % len(FARMER_NAMES)],
        "role": role,
        "preferred_language": "en",
        "organization_name": None,
        "village": village,
        "district": DISTRICT,
        "state": STATE,
        "latitude": latitude,
        "longitude": longitude,
        "verification_status": "unverified",
        "is_active": True,
    }
    fields |= ROLE_DEFAULTS[role]
    return await _save(db, User(**(fields | overrides)))


async def create_crop(db: AsyncSession, **overrides: Any) -> Crop:
    """Tomato by default (code ``TOM``); pass ``code`` and names for a second crop."""
    fields: dict[str, Any] = {
        "code": "TOM",
        "name": "Tomato",
        "name_hi": "टमाटर",
        "name_te": "టమాటా",
        "name_kn": "ಟೊಮೆಟೊ",
        "name_ur": "ٹماٹر",
        "category": "vegetable",
        "perishability_days": 7,
        "grades": ["A", "B", "C"],
        "default_rejection_pct": Decimal("5"),
        "requires_refrigeration": False,
        "synonyms": ["tomato", "tomatoes", "tamatar", "टमाटर", "టమాటా", "టమోటా"],
    }
    if "name" in overrides:
        # Another crop: its Kannada / Urdu names default to the English name unless given.
        fields |= {"name_kn": overrides["name"], "name_ur": overrides["name"]}
    return await _save(db, Crop(**(fields | overrides)))


async def create_market_price(db: AsyncSession, crop: Crop, **overrides: Any) -> MarketPrice:
    """Today's illustrative Madanapalle APMC price for ``crop`` (₹10 / ₹14 / ₹18 per kg)."""
    market_name, _, _ = MADANAPALLE_MARKET
    fields: dict[str, Any] = {
        "crop_id": crop.id,
        "market_name": market_name,
        "district": DISTRICT,
        "state": STATE,
        "price_date": today_ist(),
        "min_price_per_kg": Decimal("10"),
        "modal_price_per_kg": Decimal("14"),
        "max_price_per_kg": Decimal("18"),
        "source": "Illustrative pilot data",
        "is_illustrative": True,
    }
    return await _save(db, MarketPrice(**(fields | overrides)))


async def create_harvest(db: AsyncSession, farmer: User, crop: Crop, **overrides: Any) -> Harvest:
    """400 kg of grade-A produce at the farmer's location, ready tomorrow, sell within 5 days."""
    today = today_ist()
    fields: dict[str, Any] = {
        "farmer_id": farmer.id,
        "crop_id": crop.id,
        "variety": "Arka Rakshak",
        "quantity_kg": Decimal("400"),
        "grade": "A",
        "quality_status": "self_reported",
        "harvest_date": today,
        "available_from": today + timedelta(days=1),
        "sell_by": today + timedelta(days=5),
        "village": farmer.village,
        "district": farmer.district,
        "state": farmer.state,
        "latitude": farmer.latitude,
        "longitude": farmer.longitude,
        "min_price_per_kg": None,
        "status": "listed",
        "source": "manual",
        "created_by_id": farmer.id,
    }
    return await _save(db, Harvest(**(fields | overrides)))


async def create_demand(db: AsyncSession, buyer: User, crop: Crop, **overrides: Any) -> Demand:
    """1,000 kg (minimum 800 kg) of grade A delivered to Bengaluru in 4 days, paid in 7 days."""
    fields: dict[str, Any] = {
        "buyer_id": buyer.id,
        "crop_id": crop.id,
        "grade_required": "A",
        "quantity_kg": Decimal("1000"),
        "min_quantity_kg": Decimal("800"),
        "target_price_per_kg": Decimal("16"),
        "needed_by": today_ist() + timedelta(days=4),
        "payment_terms_days": 7,
        "max_rejection_pct": Decimal("5"),
        "quality_spec": "Firm, uniformly red, 60–80 g, no cracks",
        "notes": None,
        "status": "open",
        **BENGALURU_BUYER,
    }
    return await _save(db, Demand(**(fields | overrides)))


async def create_lot(
    db: AsyncSession,
    crop: Crop,
    members: Sequence[Harvest | tuple[Harvest, Decimal | float | int]],
    *,
    coordinator: User | None = None,
    consent_status: str = "accepted",
    **overrides: Any,
) -> Lot:
    """A lot at the Madanapalle collection point (``open_for_offers`` by default).

    ``members`` are harvests (their whole quantity) or ``(harvest, quantity_kg)`` pairs.
    Member harvests get the status that mirrors the lot's status.
    """
    point, latitude, longitude = MADANAPALLE_MARKET
    entries = [
        member if isinstance(member, tuple) else (member, member.quantity_kg) for member in members
    ]
    total = sum((Decimal(str(quantity)) for _, quantity in entries), Decimal("0"))
    status: LotStatus = overrides.pop("status", "open_for_offers")
    fields: dict[str, Any] = {
        "code": await next_code(db, "lot", crop.code),
        "crop_id": crop.id,
        "grade": entries[0][0].grade if entries else "A",
        "target_quantity_kg": total or Decimal("1000"),
        "collection_point_name": point,
        "collection_latitude": latitude,
        "collection_longitude": longitude,
        "district": DISTRICT,
        "state": STATE,
        "pickup_date": today_ist() + timedelta(days=2),
        "status": status,
        "coordinator_id": coordinator.id if coordinator else None,
        "created_by_id": coordinator.id if coordinator else None,
    }
    consented_at = utcnow() if consent_status != "pending" else None
    lot = Lot(
        **(fields | overrides),
        members=[
            LotMember(
                harvest_id=harvest.id,
                farmer_id=harvest.farmer_id,
                quantity_kg=Decimal(str(quantity)),
                consent_status=consent_status,
                consented_at=consented_at,
            )
            for harvest, quantity in entries
        ],
    )
    for harvest, _ in entries:
        harvest.status = HARVEST_STATUS_FOR_LOT[status]
    return await _save(db, lot)


async def create_offer(
    db: AsyncSession,
    buyer: User,
    *,
    lot: Lot | None = None,
    harvest: Harvest | None = None,
    **overrides: Any,
) -> Offer:
    """A pending ₹16/kg MandiMate-delivery offer on ``lot`` or (directly) on ``harvest``.

    The thread starts with the buyer's ``offer`` entry, as every offer does.
    """
    if (lot is None) == (harvest is None):
        raise ValueError("Pass exactly one of lot= or harvest=")
    if lot is not None:
        target: dict[str, Any] = {
            "target_type": "lot",
            "lot_id": lot.id,
            "crop_id": lot.crop_id,
            "grade": lot.grade,
            "quantity_kg": sum(
                (m.quantity_kg for m in lot.members if m.consent_status != "declined"),
                Decimal("0"),
            ),
            "demand_id": lot.demand_id,
        }
    else:
        assert harvest is not None
        target = {
            "target_type": "harvest",
            "harvest_id": harvest.id,
            "crop_id": harvest.crop_id,
            "grade": harvest.grade,
            "quantity_kg": harvest.quantity_kg,
        }
    fields: dict[str, Any] = {
        "code": await next_code(db, "offer"),
        "buyer_id": buyer.id,
        "price_per_kg": Decimal("16"),
        "pickup_terms": "mandimate_delivery",
        "delivery_location": BENGALURU_BUYER["delivery_location"],
        "delivery_latitude": BENGALURU_BUYER["delivery_latitude"],
        "delivery_longitude": BENGALURU_BUYER["delivery_longitude"],
        "payment_terms_days": 7,
        "max_rejection_pct": Decimal("5"),
        "quality_spec": "Grade A, firm and uniformly red",
        "handling_charge_per_kg": Decimal("0"),
        "commission_pct": Decimal("0"),
        "valid_until": utcnow() + timedelta(days=3),
        "status": "pending",
        "awaiting": "seller",
        **target,
    }
    fields |= overrides
    offer = Offer(
        **fields,
        negotiation=[
            NegotiationEntry(
                author_id=buyer.id,
                author_role="buyer",
                action="offer",
                price_per_kg=fields["price_per_kg"],
                quantity_kg=fields["quantity_kg"],
                payment_terms_days=fields["payment_terms_days"],
                message=None,
            )
        ],
    )
    return await _save(db, offer)
