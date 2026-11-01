"""Role dashboard schemas."""

from datetime import datetime
from typing import Literal

from app.schemas.common import (
    ActionKind,
    ApiModel,
    JourneyKey,
    NotificationType,
    VerificationStatus,
)
from app.schemas.harvest import Harvest
from app.schemas.lot import LotSummary
from app.schemas.pricing import SellingOptions
from app.schemas.supply import SupplyItem
from app.schemas.transport import TransportRequest


class ActionItem(ApiModel):
    id: str
    kind: ActionKind
    title: str
    description: str
    link: str
    due_at: datetime | None
    priority: Literal["high", "normal"]


class ActivityItem(ApiModel):
    id: str
    title: str
    description: str
    at: datetime
    link: str | None
    kind: NotificationType


class PilotMetrics(ApiModel):
    net_uplift_per_kg: float | None
    """Average farmer net ₹/kg above the baseline alternative across settled payouts."""
    completion_rate_pct: float | None
    """% of listed kg that ended in a settled sale."""
    avg_hours_listing_to_buyer: float | None
    transport_cost_per_kg: float | None
    avg_payment_delay_days: float | None
    rejection_rate_pct: float | None
    failed_transactions: int
    repeat_farmers_pct: float | None
    repeat_buyers_pct: float | None


class FarmerDashboardStats(ApiModel):
    active_harvests: int
    listed_kg: float
    open_offers: int
    pending_consents: int
    upcoming_pickups: int
    season_net_earnings: float
    avg_uplift_per_kg: float | None
    pending_payments: float


class FarmerDashboard(ApiModel):
    stats: FarmerDashboardStats
    current_harvest: Harvest | None
    selling_options: SellingOptions | None
    action_items: list[ActionItem]
    recent_activity: list[ActivityItem]


class BuyerDashboardStats(ApiModel):
    open_demands: int
    active_offers: int
    orders_in_progress: int
    kg_sourced: float
    amount_due: float
    avg_price_per_kg: float | None
    on_time_delivery_pct: float | None


class BuyerDashboard(ApiModel):
    stats: BuyerDashboardStats
    verification_status: VerificationStatus
    recommended_supply: list[SupplyItem]
    action_items: list[ActionItem]
    recent_activity: list[ActivityItem]


class TransporterDashboardStats(ApiModel):
    open_requests: int
    quotes_submitted: int
    active_trips: int
    completed_trips: int
    kg_moved: float
    earnings_total: float
    avg_utilization_pct: float | None


class TransporterDashboard(ApiModel):
    stats: TransporterDashboardStats
    verification_status: VerificationStatus
    open_requests: list[TransportRequest]
    active_trips: list[TransportRequest]
    action_items: list[ActionItem]
    recent_activity: list[ActivityItem]


class PipelineColumn(ApiModel):
    step: int
    key: JourneyKey
    label: str
    lots: list[LotSummary]


class CoordinatorDashboardStats(ApiModel):
    farmers: int
    listed_kg: float
    lots_forming: int
    lots_active: int
    offers_pending: int
    deliveries_pending: int
    settlements_pending_amount: float
    open_disputes: int


class CoordinatorDashboard(ApiModel):
    stats: CoordinatorDashboardStats
    pipeline: list[PipelineColumn]
    pilot_metrics: PilotMetrics
    action_items: list[ActionItem]
    recent_activity: list[ActivityItem]


class AdminOverview(ApiModel):
    users_by_role: dict[str, int]
    """Count per Role; every role is present."""
    pending_verifications: int
    total_kg_traded: float
    total_gmv: float
    lots_by_status: dict[str, int]
    """Count per LotStatus; statuses with no lots may be omitted."""
    pilot_metrics: PilotMetrics
