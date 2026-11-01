"""String enums used by the models. Values are exactly the literals in frontend/src/types/api.ts."""

from __future__ import annotations

from typing import Literal, get_args

Role = Literal["farmer", "buyer", "transporter", "coordinator", "admin"]
Language = Literal["en", "hi", "te", "kn", "ur"]
VerificationStatus = Literal["unverified", "pending", "verified", "rejected"]
Grade = Literal["A", "B", "C", "ungraded"]
CropCategory = Literal["vegetable", "fruit", "grain", "pulse", "spice", "oilseed"]

HarvestStatus = Literal[
    "draft",
    "listed",
    "pooled",
    "committed",
    "picked_up",
    "delivered",
    "settled",
    "cancelled",
    "expired",
]
QualityStatus = Literal["self_reported", "pending_inspection", "inspected"]
ListingSource = Literal["manual", "voice", "assisted"]

DemandStatus = Literal["open", "matched", "fulfilled", "cancelled", "expired"]

LotStatus = Literal[
    "forming",
    "awaiting_consent",
    "open_for_offers",
    "offer_accepted",
    "transport_booked",
    "in_transit",
    "delivered",
    "settled",
    "cancelled",
]
ConsentDecision = Literal["pending", "accepted", "declined"]

OfferStatus = Literal[
    "pending", "countered", "proposed", "accepted", "rejected", "withdrawn", "expired"
]
OfferTargetType = Literal["lot", "harvest"]
Awaiting = Literal["buyer", "seller", "farmers"]
PickupTerms = Literal["buyer_pickup", "mandimate_delivery"]
NegotiationAction = Literal[
    "offer", "counter", "accept", "reject", "withdraw", "propose", "consent", "note"
]
NegotiationAuthorRole = Literal["farmer", "buyer", "transporter", "coordinator", "admin", "system"]

VehicleType = Literal["mini_truck", "pickup", "light_truck", "medium_truck", "reefer_truck"]
TransportRequestStatus = Literal[
    "open", "quoted", "booked", "in_progress", "completed", "cancelled"
]
QuoteStatus = Literal["submitted", "accepted", "rejected", "withdrawn"]
StopStatus = Literal["pending", "picked_up", "skipped"]

PaymentStatus = Literal["pending", "partially_paid", "paid", "overdue", "disputed"]
PayoutStatus = Literal["pending", "paid"]

DisputeCategory = Literal["quantity", "quality", "payment", "transport", "other"]
DisputeStatus = Literal["open", "under_review", "resolved", "rejected"]

NotificationType = Literal[
    "offer",
    "consent",
    "lot",
    "pickup",
    "delivery",
    "payment",
    "harvest_deadline",
    "dispute",
    "verification",
    "system",
]

AiSource = Literal["ai", "rules"]

ROLES: tuple[str, ...] = get_args(Role)
LANGUAGES: tuple[str, ...] = get_args(Language)
VERIFICATION_STATUSES: tuple[str, ...] = get_args(VerificationStatus)
GRADES: tuple[str, ...] = get_args(Grade)
CROP_CATEGORIES: tuple[str, ...] = get_args(CropCategory)
HARVEST_STATUSES: tuple[str, ...] = get_args(HarvestStatus)
QUALITY_STATUSES: tuple[str, ...] = get_args(QualityStatus)
LISTING_SOURCES: tuple[str, ...] = get_args(ListingSource)
DEMAND_STATUSES: tuple[str, ...] = get_args(DemandStatus)
LOT_STATUSES: tuple[str, ...] = get_args(LotStatus)
CONSENT_DECISIONS: tuple[str, ...] = get_args(ConsentDecision)
OFFER_STATUSES: tuple[str, ...] = get_args(OfferStatus)
OFFER_TARGET_TYPES: tuple[str, ...] = get_args(OfferTargetType)
AWAITING_SIDES: tuple[str, ...] = get_args(Awaiting)
PICKUP_TERMS: tuple[str, ...] = get_args(PickupTerms)
NEGOTIATION_ACTIONS: tuple[str, ...] = get_args(NegotiationAction)
NEGOTIATION_AUTHOR_ROLES: tuple[str, ...] = get_args(NegotiationAuthorRole)
VEHICLE_TYPES: tuple[str, ...] = get_args(VehicleType)
TRANSPORT_REQUEST_STATUSES: tuple[str, ...] = get_args(TransportRequestStatus)
QUOTE_STATUSES: tuple[str, ...] = get_args(QuoteStatus)
STOP_STATUSES: tuple[str, ...] = get_args(StopStatus)
PAYMENT_STATUSES: tuple[str, ...] = get_args(PaymentStatus)
PAYOUT_STATUSES: tuple[str, ...] = get_args(PayoutStatus)
DISPUTE_CATEGORIES: tuple[str, ...] = get_args(DisputeCategory)
DISPUTE_STATUSES: tuple[str, ...] = get_args(DisputeStatus)
NOTIFICATION_TYPES: tuple[str, ...] = get_args(NotificationType)
AI_SOURCES: tuple[str, ...] = get_args(AiSource)

OPEN_OFFER_STATUSES: tuple[str, ...] = ("pending", "countered", "proposed")
"""Offers still under negotiation (at most one per buyer per target)."""
