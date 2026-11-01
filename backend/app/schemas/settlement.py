"""Settlement, payment & farmer payout schemas."""

import uuid
from datetime import date, datetime

from app.schemas.common import (
    Amount,
    ApiModel,
    OptionalShortText,
    PaymentStatus,
    PayoutStatus,
    RequestModel,
    UtcDateTime,
)


class FarmerPayout(ApiModel):
    id: uuid.UUID
    settlement_id: uuid.UUID
    farmer_id: uuid.UUID
    farmer_name: str
    accepted_kg: float
    rejected_kg: float
    gross_amount: float
    transport_share: float
    handling_share: float
    commission_share: float
    net_amount: float
    net_per_kg: float
    baseline_net_per_kg: float | None
    uplift_per_kg: float | None
    status: PayoutStatus
    reference: str | None
    paid_at: datetime | None


class PaymentRecord(ApiModel):
    id: uuid.UUID
    amount: float
    reference: str | None
    paid_at: datetime
    recorded_by_name: str


class Settlement(ApiModel):
    id: uuid.UUID
    code: str
    lot_id: uuid.UUID
    lot_code: str
    offer_id: uuid.UUID
    buyer_id: uuid.UUID
    buyer_name: str
    crop_name: str
    price_per_kg: float
    total_accepted_kg: float
    gross_amount: float
    """What the buyer owes: price × accepted kg."""
    transport_cost: float
    handling_cost: float
    commission_amount: float
    net_to_farmers: float
    amount_paid: float
    payment_status: PaymentStatus
    due_date: date
    paid_at: datetime | None
    payouts: list[FarmerPayout]
    """For farmers this contains only their own payout."""
    payments: list[PaymentRecord]
    created_at: datetime


class RecordPaymentRequest(RequestModel):
    amount: Amount
    reference: OptionalShortText = None
    paid_at: UtcDateTime | None = None
    """Defaults to the time the payment is recorded."""


class MarkPayoutPaidRequest(RequestModel):
    reference: OptionalShortText = None
