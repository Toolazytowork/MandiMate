"""Farmer earnings schemas."""

import uuid
from datetime import datetime

from app.schemas.common import ApiModel, PayoutStatus


class FarmerSale(ApiModel):
    payout_id: uuid.UUID
    settlement_id: uuid.UUID
    lot_id: uuid.UUID
    lot_code: str
    crop_name: str
    buyer_name: str
    accepted_kg: float
    rejected_kg: float
    price_per_kg: float
    gross_amount: float
    transport_share: float
    handling_share: float
    commission_share: float
    net_amount: float
    net_per_kg: float
    baseline_net_per_kg: float | None
    uplift_per_kg: float | None
    status: PayoutStatus
    settled_at: datetime | None


class MonthlyEarnings(ApiModel):
    month: str
    """'YYYY-MM'"""
    gross_amount: float
    net_amount: float
    baseline_net_amount: float
    kg_sold: float


class FarmerEarningsTotals(ApiModel):
    gross_amount: float
    total_deductions: float
    net_amount: float
    kg_sold: float
    avg_net_per_kg: float | None
    avg_uplift_per_kg: float | None
    sales_count: int
    pending_amount: float


class FarmerEarnings(ApiModel):
    totals: FarmerEarningsTotals
    by_month: list[MonthlyEarnings]
    sales: list[FarmerSale]
