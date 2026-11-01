"""Net proceeds engine & selling option schemas."""

import uuid
from datetime import datetime

from app.schemas.common import (
    ApiModel,
    Awaiting,
    BreakdownKey,
    Certainty,
    DistanceKm,
    NonNegativeAmount,
    OfferStatus,
    PaymentTermsDays,
    Percent,
    Price,
    Quantity,
    Rate,
    RequestModel,
    SellingOptionSource,
)


class BreakdownLine(ApiModel):
    key: BreakdownKey
    label: str
    amount: float
    """Signed: positive for income (gross), negative for deductions, 0 for informational lines."""
    per_kg: float
    certainty: Certainty
    note: str | None


class NetProceeds(ApiModel):
    label: str
    quantity_kg: float
    expected_accepted_kg: float
    gross_price_per_kg: float
    gross_amount: float
    lines: list[BreakdownLine]
    total_deductions: float
    """Positive number: sum of all deductions."""
    net_amount: float
    net_per_kg: float
    payment_terms_days: int
    confidence: Certainty
    """'confirmed' only when every line is confirmed; 'unresolved' if any line is unresolved."""
    unresolved: list[str]
    """Human-readable open conditions, e.g. "Transport quote pending"."""


class NetProceedsCalcRequest(RequestModel):
    """Public calculator input; omitted values fall back to the engine's baseline constants."""

    quantity_kg: Quantity
    price_per_kg: Price
    transport_cost_total: NonNegativeAmount | None = None
    distance_km: DistanceKm | None = None
    handling_charge_per_kg: Rate | None = None
    commission_pct: Percent | None = None
    expected_rejection_pct: Percent | None = None
    payment_terms_days: PaymentTermsDays | None = None


class SellingOption(NetProceeds):
    option_id: str
    """Offer id, or the literal 'baseline'."""
    source: SellingOptionSource
    title: str
    buyer_name: str | None
    buyer_verified: bool | None
    offer_status: OfferStatus | None
    awaiting: Awaiting | None
    lot_id: uuid.UUID | None
    valid_until: datetime | None
    meets_min_price: bool | None
    """null when the farmer set no minimum price."""
    is_best: bool


class SellingOptions(ApiModel):
    harvest_id: uuid.UUID
    crop_name: str
    quantity_kg: float
    min_price_per_kg: float | None
    options: list[SellingOption]
    """Sorted by net_amount descending; the baseline is included when it can be computed."""
    best_option_id: str | None
    uplift_vs_baseline_per_kg: float | None
    generated_at: datetime
