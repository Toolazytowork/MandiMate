"""Role dashboards: stats, action items and recent activity for each role.

Action-item links follow the frontend route map (docs/ARCHITECTURE.md). Every list is built with
a fixed number of queries (aggregates or batched loads), never one query per row.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Iterable
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING, Literal

from sqlalchemy import and_, func, or_, select

from app import schemas
from app.core.time import IST, today_ist, utcnow
from app.models import (
    Crop,
    Delivery,
    Demand,
    Dispute,
    FarmerPayout,
    Harvest,
    Lot,
    LotMember,
    Notification,
    Offer,
    OfferConsent,
    Settlement,
    TransportQuote,
    TransportRequest,
    TransportStop,
    User,
)
from app.models.enums import OPEN_OFFER_STATUSES, ROLES
from app.services import harvest_service, lot_service, metrics, selling_options
from app.services.pricing import format_number, format_rupees, road_km, round_money
from app.services.settlement_service import PAID_TOLERANCE, mark_overdue_settlements
from app.services.transport_service import (
    QUOTABLE_STATUSES,
    TRIP_STATUSES,
    format_date,
    money,
    transport_requests_out,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

ACTIVE_HARVEST_STATUSES = ("listed", "pooled", "committed", "picked_up", "delivered")
CURRENT_HARVEST_STATUSES = ("listed", "pooled", "committed")
FORMING_LOT_STATUSES = ("forming", "awaiting_consent")
ACTIVE_LOT_STATUSES = (
    "open_for_offers",
    "offer_accepted",
    "transport_booked",
    "in_transit",
    "delivered",
)
ORDER_IN_PROGRESS_STATUSES = ("offer_accepted", "transport_booked", "in_transit")
OPEN_DISPUTE_STATUSES = ("open", "under_review")
DEADLINE_DAYS = 2
SEASON_DAYS = 365
"""Season earnings and uplift cover the last 12 months."""
RECENT_ACTIVITY_LIMIT = 10
MAX_ACTION_ITEMS = 30
RECOMMENDED_SUPPLY_LIMIT = 6
OPEN_REQUESTS_LIMIT = 5
PIPELINE_SETTLED_DAYS = 30
"""Settled lots stay on the coordinator board for this many days."""
PIPELINE_LIMIT = 500

JOURNEY_COLUMNS: tuple[tuple[int, schemas.JourneyKey, str], ...] = (
    (1, "listed", "Listed"),
    (2, "grouped", "Grouped"),
    (3, "offers", "Offers"),
    (4, "compared", "Compared"),
    (5, "consent", "Consent"),
    (6, "transport", "Transport"),
    (7, "delivered", "Delivered"),
    (8, "settled", "Settled"),
)
QUALITY_RANK = {"self_reported": 0, "pending_inspection": 1, "inspected": 2}

Priority = Literal["high", "normal"]


# ─────────────────────────────── Helpers ───────────────────────────────


def day_start(day: date) -> datetime:
    """Midnight (IST) of ``day`` as a UTC timestamp, used as an action item's ``due_at``."""
    return datetime.combine(day, time.min, tzinfo=IST).astimezone(UTC)


def action(
    item_id: str,
    kind: schemas.ActionKind,
    title: str,
    description: str,
    link: str,
    *,
    due_at: datetime | None = None,
    priority: Priority = "normal",
) -> schemas.ActionItem:
    return schemas.ActionItem(
        id=item_id,
        kind=kind,
        title=title,
        description=description,
        link=link,
        due_at=due_at,
        priority=priority,
    )


def sort_actions(items: Iterable[schemas.ActionItem]) -> list[schemas.ActionItem]:
    """High priority first, then the soonest due; undated items last within each group."""
    far = datetime.max.replace(tzinfo=UTC)
    ordered = sorted(items, key=lambda item: (item.priority != "high", item.due_at or far))
    return ordered[:MAX_ACTION_ITEMS]


async def recent_activity(db: AsyncSession, user: User) -> list[schemas.ActivityItem]:
    """The user's latest notifications as an activity feed."""
    notifications = await db.scalars(
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(RECENT_ACTIVITY_LIMIT)
    )
    return [
        schemas.ActivityItem(
            id=str(n.id),
            title=n.title,
            description=n.body,
            at=n.created_at,
            link=n.link,
            kind=n.type,
        )
        for n in notifications
    ]


def kg(value: Decimal | float | int | None) -> str:
    return f"{format_number(value or 0)} kg"


def verification_action(user: User) -> schemas.ActionItem | None:
    if user.verification_status == "verified":
        return None
    descriptions = {
        "unverified": "Share your business documents so farmers and coordinators can trust you.",
        "pending": "Your documents are with a coordinator for review.",
        "rejected": user.verification_note
        or "Your verification was rejected; update your documents.",
    }
    return action(
        f"verification-{user.id}",
        "verification",
        "Get verified" if user.verification_status != "pending" else "Verification in review",
        descriptions.get(user.verification_status, ""),
        "/app/verification",
        priority="high" if user.verification_status in ("unverified", "rejected") else "normal",
    )


# ──────────────────────────────── Farmer ───────────────────────────────


async def farmer_dashboard(db: AsyncSession, user: User) -> schemas.FarmerDashboard:
    today = today_ist()
    await mark_overdue_settlements(db)

    active_harvests = await db.scalar(
        select(func.count(Harvest.id)).where(
            Harvest.farmer_id == user.id, Harvest.status.in_(ACTIVE_HARVEST_STATUSES)
        )
    )
    supply = await metrics.supply_rows(db, farmer_id=user.id)
    listed_kg = sum((row.available_kg for row in supply), Decimal(0))

    member_lots = select(LotMember.lot_id).where(
        LotMember.farmer_id == user.id, LotMember.consent_status != "declined"
    )
    own_harvests = select(Harvest.id).where(Harvest.farmer_id == user.id)
    offers = (
        await db.execute(
            select(
                Offer.id,
                Offer.code,
                Offer.target_type,
                Offer.awaiting,
                Offer.price_per_kg,
                Offer.quantity_kg,
                Offer.valid_until,
                Crop.name,
            )
            .join(Crop, Crop.id == Offer.crop_id)
            .where(
                Offer.status.in_(OPEN_OFFER_STATUSES),
                or_(
                    and_(Offer.target_type == "harvest", Offer.harvest_id.in_(own_harvests)),
                    and_(Offer.target_type == "lot", Offer.lot_id.in_(member_lots)),
                ),
            )
            .order_by(Offer.valid_until)
        )
    ).all()

    lot_consents = (
        await db.execute(
            select(
                LotMember.id, LotMember.quantity_kg, Lot.id, Lot.code, Lot.pickup_date, Crop.name
            )
            .join(Lot, Lot.id == LotMember.lot_id)
            .join(Crop, Crop.id == Lot.crop_id)
            .where(
                LotMember.farmer_id == user.id,
                LotMember.consent_status == "pending",
                Lot.status.in_(FORMING_LOT_STATUSES),
            )
            .order_by(Lot.pickup_date)
        )
    ).all()
    offer_consents = (
        await db.execute(
            select(
                OfferConsent.id,
                OfferConsent.quantity_kg,
                Offer.id,
                Offer.code,
                Offer.price_per_kg,
                Offer.valid_until,
            )
            .join(Offer, Offer.id == OfferConsent.offer_id)
            .where(
                OfferConsent.farmer_id == user.id,
                OfferConsent.decision == "pending",
                Offer.status == "proposed",
            )
            .order_by(Offer.valid_until)
        )
    ).all()
    pickups = (
        await db.execute(
            select(
                TransportStop.id,
                TransportStop.quantity_kg,
                TransportRequest.pickup_date,
                Lot.id,
                Lot.code,
            )
            .join(LotMember, LotMember.id == TransportStop.member_id)
            .join(TransportRequest, TransportRequest.id == TransportStop.request_id)
            .join(Lot, Lot.id == TransportRequest.lot_id)
            .where(
                LotMember.farmer_id == user.id,
                TransportStop.status == "pending",
                TransportRequest.status.in_(TRIP_STATUSES),
            )
            .order_by(TransportRequest.pickup_date)
        )
    ).all()

    season_start = utcnow() - timedelta(days=SEASON_DAYS)
    season_net, uplift_sum, uplift_kg = (
        await db.execute(
            select(
                func.sum(FarmerPayout.net_amount),
                func.sum(FarmerPayout.uplift_per_kg * FarmerPayout.dispatched_kg).filter(
                    FarmerPayout.uplift_per_kg.is_not(None)
                ),
                func.sum(FarmerPayout.dispatched_kg).filter(
                    FarmerPayout.uplift_per_kg.is_not(None)
                ),
            )
            .join(Settlement, Settlement.id == FarmerPayout.settlement_id)
            .where(FarmerPayout.farmer_id == user.id, Settlement.created_at >= season_start)
        )
    ).one()
    pending_payouts = (
        await db.execute(
            select(
                FarmerPayout.id,
                FarmerPayout.net_amount,
                Settlement.payment_status,
                Lot.code,
            )
            .join(Settlement, Settlement.id == FarmerPayout.settlement_id)
            .join(Lot, Lot.id == Settlement.lot_id)
            .where(FarmerPayout.farmer_id == user.id, FarmerPayout.status == "pending")
            .order_by(Settlement.created_at)
        )
    ).all()

    stats = schemas.FarmerDashboardStats(
        active_harvests=int(active_harvests or 0),
        listed_kg=money(listed_kg),
        open_offers=len(offers),
        pending_consents=len(lot_consents) + len(offer_consents),
        upcoming_pickups=len(pickups),
        season_net_earnings=money(season_net),
        avg_uplift_per_kg=metrics.ratio(uplift_sum, uplift_kg),
        pending_payments=money(sum((row.net_amount for row in pending_payouts), Decimal(0))),
    )

    current = await db.scalar(
        select(Harvest)
        .where(Harvest.farmer_id == user.id, Harvest.status.in_(CURRENT_HARVEST_STATUSES))
        .order_by(Harvest.sell_by, Harvest.created_at)
        .limit(1)
    )
    current_harvest = await harvest_service.harvest_out(db, current, user) if current else None
    options = await selling_options.build_selling_options(db, current, user) if current else None

    items: list[schemas.ActionItem] = []
    for member_id, quantity, lot_id, code, pickup_date, crop_name in lot_consents:
        items.append(
            action(
                f"lot-consent-{member_id}",
                "consent",
                f"Join pooled lot {code}?",
                f"Consent to pool {kg(quantity)} of {crop_name} for pickup on "
                f"{format_date(pickup_date)}.",
                f"/app/farmer/lots/{lot_id}",
                due_at=day_start(pickup_date),
                priority="high",
            )
        )
    for consent_id, quantity, offer_id, code, price, valid_until in offer_consents:
        items.append(
            action(
                f"offer-consent-{consent_id}",
                "consent",
                f"Review deal {code}",
                f"{format_rupees(price)}/kg for your {kg(quantity)}. Your consent is needed.",
                f"/app/farmer/offers/{offer_id}",
                due_at=valid_until,
                priority="high",
            )
        )
    for offer in offers:
        if offer.target_type == "harvest" and offer.awaiting == "seller":
            items.append(
                action(
                    f"offer-{offer.id}",
                    "offer",
                    f"New offer {offer.code}: {format_rupees(offer.price_per_kg)}/kg",
                    f"{kg(offer.quantity_kg)} of {offer.name}. Compare it, then accept, "
                    "counter or reject.",
                    f"/app/farmer/offers/{offer.id}",
                    due_at=offer.valid_until,
                    priority="high",
                )
            )
    for stop_id, quantity, pickup_date, lot_id, code in pickups:
        items.append(
            action(
                f"pickup-{stop_id}",
                "pickup",
                f"Pickup on {format_date(pickup_date)}",
                f"Keep {kg(quantity)} packed and ready for lot {code}.",
                f"/app/farmer/lots/{lot_id}",
                due_at=day_start(pickup_date),
                priority="high" if pickup_date <= today + timedelta(days=1) else "normal",
            )
        )
    crop_names = await _crop_names(db, {row.crop_id for row in supply})
    for row in supply:
        if row.available_kg > 0 and row.sell_by <= today + timedelta(days=DEADLINE_DAYS):
            items.append(
                action(
                    f"deadline-{row.harvest_id}",
                    "deadline",
                    f"Sell {crop_names.get(row.crop_id, 'harvest')} by {format_date(row.sell_by)}",
                    f"{kg(row.available_kg)} is still unsold. Review offers or ask your "
                    "coordinator to add it to a lot.",
                    f"/app/farmer/harvests/{row.harvest_id}",
                    due_at=day_start(row.sell_by),
                    priority="high",
                )
            )
    for payout_id, net_amount, payment_status, code in pending_payouts:
        waiting = "the buyer's payment" if payment_status != "paid" else "MandiMate's transfer"
        items.append(
            action(
                f"payout-{payout_id}",
                "payment",
                f"Payment pending: {format_rupees(net_amount)}",
                f"Lot {code}: waiting for {waiting}.",
                "/app/farmer/earnings",
            )
        )

    return schemas.FarmerDashboard(
        stats=stats,
        current_harvest=current_harvest,
        selling_options=options,
        action_items=sort_actions(items),
        recent_activity=await recent_activity(db, user),
    )


async def _crop_names(db: AsyncSession, crop_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, str]:
    ids = list(crop_ids)
    if not ids:
        return {}
    return dict((await db.execute(select(Crop.id, Crop.name).where(Crop.id.in_(ids)))).all())


# ──────────────────────────────── Buyer ────────────────────────────────


async def buyer_dashboard(db: AsyncSession, user: User) -> schemas.BuyerDashboard:
    today = today_ist()
    await mark_overdue_settlements(db)

    open_demands = list(
        (
            await db.execute(
                select(Demand.crop_id, Demand.grade_required).where(
                    Demand.buyer_id == user.id, Demand.status == "open"
                )
            )
        ).all()
    )
    active_offers = await db.scalar(
        select(func.count(Offer.id)).where(
            Offer.buyer_id == user.id, Offer.status.in_(OPEN_OFFER_STATUSES)
        )
    )
    buyer_lots = (
        select(Lot.id, Lot.code, Lot.status, Lot.pickup_terms, Lot.pickup_date, Lot.delivered_at)
        .join(Offer, Offer.id == Lot.accepted_offer_id)
        .where(Offer.buyer_id == user.id)
    )
    lots = (await db.execute(buyer_lots)).all()
    orders_in_progress = sum(1 for lot in lots if lot.status in ORDER_IN_PROGRESS_STATUSES)

    kg_sourced, gross_total = (
        await db.execute(
            select(func.sum(Settlement.total_accepted_kg), func.sum(Settlement.gross_amount)).where(
                Settlement.buyer_id == user.id
            )
        )
    ).one()
    unpaid = (
        await db.execute(
            select(
                Settlement.id,
                Settlement.code,
                Settlement.gross_amount - Settlement.amount_paid,
                Settlement.due_date,
                Settlement.payment_status,
                Lot.code,
            )
            .join(Lot, Lot.id == Settlement.lot_id)
            .where(
                Settlement.buyer_id == user.id,
                Settlement.amount_paid < Settlement.gross_amount - PAID_TOLERANCE,
            )
            .order_by(Settlement.due_date)
        )
    ).all()

    stats = schemas.BuyerDashboardStats(
        open_demands=len(open_demands),
        active_offers=int(active_offers or 0),
        orders_in_progress=orders_in_progress,
        kg_sourced=money(kg_sourced),
        amount_due=money(sum((row[2] for row in unpaid), Decimal(0))),
        avg_price_per_kg=metrics.ratio(gross_total, kg_sourced),
        on_time_delivery_pct=await _on_time_delivery_pct(db, user),
    )

    items: list[schemas.ActionItem] = []
    awaiting_buyer = (
        await db.execute(
            select(Offer.id, Offer.code, Offer.price_per_kg, Offer.valid_until)
            .where(
                Offer.buyer_id == user.id,
                Offer.status.in_(OPEN_OFFER_STATUSES),
                Offer.awaiting == "buyer",
            )
            .order_by(Offer.valid_until)
        )
    ).all()
    for offer_id, code, price, valid_until in awaiting_buyer:
        items.append(
            action(
                f"offer-{offer_id}",
                "offer",
                f"Counter-offer on {code}",
                f"The seller countered at {format_rupees(price)}/kg. Accept, counter or withdraw.",
                f"/app/buyer/offers/{offer_id}",
                due_at=valid_until,
                priority="high",
            )
        )
    delivered_lot_ids = (
        set(
            (
                await db.scalars(
                    select(Delivery.lot_id).where(Delivery.lot_id.in_([lot.id for lot in lots]))
                )
            ).all()
        )
        if lots
        else set()
    )
    for lot in lots:
        awaiting_delivery = (
            lot.status == "in_transit"
            or (lot.status == "offer_accepted" and lot.pickup_terms == "buyer_pickup")
        ) and lot.id not in delivered_lot_ids
        if awaiting_delivery:
            items.append(
                action(
                    f"delivery-{lot.id}",
                    "delivery",
                    f"Record delivery of lot {lot.code}",
                    "Weigh the consignment, record accepted and rejected kg per farmer.",
                    f"/app/buyer/orders/{lot.id}",
                    due_at=day_start(lot.pickup_date),
                    priority="high",
                )
            )
    for settlement_id, code, outstanding, due_date, payment_status, lot_code in unpaid:
        overdue = due_date < today
        items.append(
            action(
                f"payment-{settlement_id}",
                "payment",
                f"{'Overdue' if overdue else 'Payment due'}: {format_rupees(outstanding)}",
                f"Settlement {code} for lot {lot_code}, due {format_date(due_date)}"
                + (" (disputed)" if payment_status == "disputed" else "")
                + ".",
                "/app/buyer/payments",
                due_at=day_start(due_date),
                priority="high" if overdue or due_date <= today + timedelta(days=2) else "normal",
            )
        )
    verification = verification_action(user)
    if verification is not None:
        items.append(verification)

    return schemas.BuyerDashboard(
        stats=stats,
        verification_status=user.verification_status,
        recommended_supply=await recommended_supply(db, user, open_demands),
        action_items=sort_actions(items),
        recent_activity=await recent_activity(db, user),
    )


async def _on_time_delivery_pct(db: AsyncSession, user: User) -> float | None:
    """Delivered on or before the demand's ``needed_by`` (else the day after pickup)."""
    rows = (
        await db.execute(
            select(Lot.delivered_at, Lot.pickup_date, Demand.needed_by)
            .join(Offer, Offer.id == Lot.accepted_offer_id)
            .outerjoin(Demand, Demand.id == func.coalesce(Offer.demand_id, Lot.demand_id))
            .where(Offer.buyer_id == user.id, Lot.delivered_at.is_not(None))
        )
    ).all()
    if not rows:
        return None
    on_time = 0
    for delivered_at, pickup_date, needed_by in rows:
        deadline = needed_by or pickup_date + timedelta(days=1)
        if delivered_at.astimezone(IST).date() <= deadline:
            on_time += 1
    return float(round_money(Decimal(on_time) * 100 / len(rows)))


async def recommended_supply(
    db: AsyncSession, user: User, demands: list[tuple[uuid.UUID, str]]
) -> list[schemas.SupplyItem]:
    """Open lots and listed harvests of the crops in the buyer's open demands (top 6).

    Lots and harvests of the wanted grade come first, then nearer ones, then larger ones.
    """
    if not demands:
        return []
    today = today_ist()
    wanted_grades: dict[uuid.UUID, set[str]] = defaultdict(set)
    for crop_id, grade in demands:
        wanted_grades[crop_id].add(grade)
    crop_ids = list(wanted_grades)

    lots = list(
        await db.scalars(
            select(Lot)
            .where(Lot.status == "open_for_offers", Lot.crop_id.in_(crop_ids))
            .order_by(Lot.pickup_date)
            .limit(50)
        )
    )
    supply = [
        row
        for row in await metrics.supply_rows(db, crop_ids=crop_ids, statuses=("listed",))
        if row.available_kg > 0 and row.sell_by >= today
    ]
    available = {row.harvest_id: row.available_kg for row in supply}
    harvests = (
        list(await db.scalars(select(Harvest).where(Harvest.id.in_(list(available)))))
        if available
        else []
    )

    lot_ids = [lot.id for lot in lots]
    harvest_ids = [harvest.id for harvest in harvests]
    offer_counts: dict[uuid.UUID, int] = {}
    my_status: dict[uuid.UUID, str] = {}
    if lot_ids or harvest_ids:
        target = func.coalesce(Offer.lot_id, Offer.harvest_id)
        target_filter = or_(Offer.lot_id.in_(lot_ids), Offer.harvest_id.in_(harvest_ids))
        offer_counts = dict(
            (
                await db.execute(
                    select(target, func.count(Offer.id))
                    .where(target_filter, Offer.status.in_(OPEN_OFFER_STATUSES))
                    .group_by(target)
                )
            ).all()
        )
        for target_id, offer_status in (
            await db.execute(
                select(target, Offer.status)
                .where(target_filter, Offer.buyer_id == user.id)
                .order_by(Offer.created_at.desc())
            )
        ).all():
            my_status.setdefault(target_id, offer_status)

    def distance(latitude: float | None, longitude: float | None) -> float | None:
        if None in (user.latitude, user.longitude, latitude, longitude):
            return None
        return float(road_km(user.latitude, user.longitude, latitude, longitude))

    items: list[schemas.SupplyItem] = []
    for lot in lots:
        members = [m for m in lot.members if m.consent_status != "declined"]
        if not members:
            continue
        quality = min(
            (m.harvest.quality_status for m in members), key=lambda q: QUALITY_RANK.get(q, 0)
        )
        items.append(
            schemas.SupplyItem(
                kind="lot",
                id=lot.id,
                code=lot.code,
                crop_id=lot.crop_id,
                crop_name=lot.crop.name,
                grade=lot.grade,
                quantity_kg=money(sum((m.quantity_kg for m in members), Decimal(0))),
                member_count=len(members),
                village=lot.collection_point_name,
                district=lot.district,
                quality_status=quality,
                available_from=max(m.harvest.available_from for m in members),
                sell_by=min(m.harvest.sell_by for m in members),
                pickup_date=lot.pickup_date,
                distance_km=distance(lot.collection_latitude, lot.collection_longitude),
                offers_count=offer_counts.get(lot.id, 0),
                my_offer_status=my_status.get(lot.id),
            )
        )
    for harvest in harvests:
        items.append(
            schemas.SupplyItem(
                kind="harvest",
                id=harvest.id,
                code=None,
                crop_id=harvest.crop_id,
                crop_name=harvest.crop.name,
                grade=harvest.grade,
                quantity_kg=money(available[harvest.id]),
                member_count=1,
                village=harvest.village,
                district=harvest.district,
                quality_status=harvest.quality_status,
                available_from=harvest.available_from,
                sell_by=harvest.sell_by,
                pickup_date=None,
                distance_km=distance(harvest.latitude, harvest.longitude),
                offers_count=offer_counts.get(harvest.id, 0),
                my_offer_status=my_status.get(harvest.id),
            )
        )

    def rank(item: schemas.SupplyItem) -> tuple[bool, bool, float, float]:
        return (
            item.grade not in wanted_grades[item.crop_id],
            item.kind != "lot",
            item.distance_km if item.distance_km is not None else float("inf"),
            -item.quantity_kg,
        )

    return sorted(items, key=rank)[:RECOMMENDED_SUPPLY_LIMIT]


# ───────────────────────────── Transporter ─────────────────────────────


async def transporter_dashboard(db: AsyncSession, user: User) -> schemas.TransporterDashboard:
    today = today_ist()
    open_count = await db.scalar(
        select(func.count(TransportRequest.id)).where(
            TransportRequest.status.in_(QUOTABLE_STATUSES)
        )
    )
    quotes_submitted = await db.scalar(
        select(func.count(TransportQuote.id)).where(
            TransportQuote.transporter_id == user.id, TransportQuote.status == "submitted"
        )
    )
    open_requests = list(
        await db.scalars(
            select(TransportRequest)
            .where(TransportRequest.status.in_(QUOTABLE_STATUSES))
            .order_by(TransportRequest.pickup_date, TransportRequest.created_at.desc())
            .limit(OPEN_REQUESTS_LIMIT)
        )
    )
    mine = (
        select(TransportRequest)
        .join(TransportQuote, TransportQuote.id == TransportRequest.booked_quote_id)
        .where(TransportQuote.transporter_id == user.id)
    )
    active_trips = list(
        await db.scalars(
            mine.where(TransportRequest.status.in_(TRIP_STATUSES)).order_by(
                TransportRequest.pickup_date
            )
        )
    )

    picked_per_trip = (
        select(
            TransportStop.request_id.label("request_id"),
            func.sum(TransportStop.picked_kg).label("picked"),
        )
        .where(TransportStop.status == "picked_up")
        .group_by(TransportStop.request_id)
        .subquery()
    )
    trips = (
        await db.execute(
            select(
                TransportRequest.status,
                TransportQuote.price_total,
                TransportQuote.capacity_kg,
                func.coalesce(picked_per_trip.c.picked, 0),
            )
            .join(TransportQuote, TransportQuote.id == TransportRequest.booked_quote_id)
            .outerjoin(picked_per_trip, picked_per_trip.c.request_id == TransportRequest.id)
            .where(TransportQuote.transporter_id == user.id)
        )
    ).all()
    completed = [trip for trip in trips if trip.status == "completed"]
    utilizations = [
        Decimal(picked) / capacity * 100 for _, _, capacity, picked in completed if capacity > 0
    ]
    stats = schemas.TransporterDashboardStats(
        open_requests=int(open_count or 0),
        quotes_submitted=int(quotes_submitted or 0),
        active_trips=len(active_trips),
        completed_trips=len(completed),
        kg_moved=money(
            sum(
                (Decimal(picked) for status, _, _, picked in trips if status != "booked"),
                Decimal(0),
            )
        ),
        earnings_total=money(sum((price for _, price, _, _ in completed), Decimal(0))),
        avg_utilization_pct=(
            float(round_money(sum(utilizations, Decimal(0)) / len(utilizations)))
            if utilizations
            else None
        ),
    )

    items: list[schemas.ActionItem] = []
    for trip in active_trips:
        pending = [stop for stop in trip.stops if stop.status == "pending"]
        if pending:
            items.append(
                action(
                    f"trip-{trip.id}",
                    "pickup",
                    f"Pickups for lot {trip.lot.code} on {format_date(trip.pickup_date)}",
                    f"{len(pending)} of {len(trip.stops)} stops still to collect "
                    f"({kg(sum((s.quantity_kg for s in pending), Decimal(0)))}).",
                    f"/app/transporter/trips/{trip.id}",
                    due_at=day_start(trip.pickup_date),
                    priority="high" if trip.pickup_date <= today + timedelta(days=1) else "normal",
                )
            )
        else:
            items.append(
                action(
                    f"trip-complete-{trip.id}",
                    "pickup",
                    f"Complete the trip for lot {trip.lot.code}",
                    f"Every stop is done. Mark the trip complete at {trip.destination_name}.",
                    f"/app/transporter/trips/{trip.id}",
                    priority="high",
                )
            )
    for req in open_requests:
        if not any(quote.transporter_id == user.id for quote in req.quotes):
            items.append(
                action(
                    f"quote-{req.id}",
                    "quote",
                    f"Quote for lot {req.lot.code}",
                    f"{kg(req.total_quantity_kg)} of {req.lot.crop.name}, "
                    f"{format_number(req.estimated_distance_km)} km to {req.destination_name}.",
                    f"/app/transporter/requests/{req.id}",
                    due_at=day_start(req.pickup_date),
                )
            )
    verification = verification_action(user)
    if verification is not None:
        items.append(verification)

    return schemas.TransporterDashboard(
        stats=stats,
        verification_status=user.verification_status,
        open_requests=transport_requests_out(open_requests, user),
        active_trips=transport_requests_out(active_trips, user),
        action_items=sort_actions(items),
        recent_activity=await recent_activity(db, user),
    )


# ───────────────────────────── Coordinator ─────────────────────────────


async def coordinator_dashboard(db: AsyncSession, user: User) -> schemas.CoordinatorDashboard:
    await mark_overdue_settlements(db)
    farmers = await db.scalar(
        select(func.count(User.id)).where(User.role == "farmer", User.is_active.is_(True))
    )
    supply = await metrics.supply_rows(db)
    lot_counts = dict(
        (await db.execute(select(Lot.status, func.count(Lot.id)).group_by(Lot.status))).all()
    )
    offers_pending = await db.scalar(
        select(func.count(Offer.id)).where(Offer.status.in_(OPEN_OFFER_STATUSES))
    )
    pending_delivery = (
        await db.execute(
            select(Lot.id, Lot.code, Lot.status, Lot.pickup_date)
            .where(
                or_(
                    Lot.status.in_(("transport_booked", "in_transit")),
                    and_(Lot.status == "offer_accepted", Lot.pickup_terms == "buyer_pickup"),
                )
            )
            .order_by(Lot.pickup_date)
        )
    ).all()
    outstanding = await db.scalar(
        select(func.sum(Settlement.gross_amount - Settlement.amount_paid)).where(
            Settlement.amount_paid < Settlement.gross_amount - PAID_TOLERANCE
        )
    )
    open_disputes = (
        await db.execute(
            select(Dispute.id, Dispute.code, Dispute.category, Dispute.status, Lot.code)
            .join(Lot, Lot.id == Dispute.lot_id)
            .where(Dispute.status.in_(OPEN_DISPUTE_STATUSES))
            .order_by(Dispute.created_at)
        )
    ).all()

    stats = schemas.CoordinatorDashboardStats(
        farmers=int(farmers or 0),
        listed_kg=money(sum((row.available_kg for row in supply), Decimal(0))),
        lots_forming=sum(lot_counts.get(s, 0) for s in FORMING_LOT_STATUSES),
        lots_active=sum(lot_counts.get(s, 0) for s in ACTIVE_LOT_STATUSES),
        offers_pending=int(offers_pending or 0),
        deliveries_pending=len(pending_delivery),
        settlements_pending_amount=money(outstanding),
        open_disputes=len(open_disputes),
    )

    return schemas.CoordinatorDashboard(
        stats=stats,
        pipeline=await pipeline(db),
        pilot_metrics=await metrics.pilot_metrics(db),
        action_items=await _coordinator_actions(db, pending_delivery, open_disputes),
        recent_activity=await recent_activity(db, user),
    )


async def pipeline(db: AsyncSession) -> list[schemas.PipelineColumn]:
    """Every non-cancelled lot (settled ones for 30 days) grouped by journey step."""
    settled_since = utcnow() - timedelta(days=PIPELINE_SETTLED_DAYS)
    lots = await db.scalars(
        select(Lot)
        .where(
            Lot.status != "cancelled",
            or_(Lot.status != "settled", Lot.settled_at >= settled_since),
        )
        .order_by(Lot.pickup_date, Lot.created_at)
        .limit(PIPELINE_LIMIT)
    )
    by_step: dict[int, list[schemas.LotSummary]] = defaultdict(list)
    for summary in await lot_service.lot_summaries(db, list(lots)):
        by_step[min(max(summary.journey_step, 1), 8)].append(summary)
    return [
        schemas.PipelineColumn(step=step, key=key, label=label, lots=by_step.get(step, []))
        for step, key, label in JOURNEY_COLUMNS
    ]


async def _coordinator_actions(
    db: AsyncSession, pending_delivery: list, open_disputes: list
) -> list[schemas.ActionItem]:
    items: list[schemas.ActionItem] = []

    pending_consents = (
        await db.execute(
            select(Lot.id, Lot.code, Lot.pickup_date, func.count(LotMember.id))
            .join(LotMember, LotMember.lot_id == Lot.id)
            .where(Lot.status == "awaiting_consent", LotMember.consent_status == "pending")
            .group_by(Lot.id, Lot.code, Lot.pickup_date)
            .order_by(Lot.pickup_date)
        )
    ).all()
    for lot_id, code, pickup_date, count in pending_consents:
        items.append(
            action(
                f"lot-consent-{lot_id}",
                "consent",
                f"Lot {code}: {count} consent{'s' if count != 1 else ''} pending",
                "Call the farmers or record assisted consent, then open the lot for offers.",
                f"/app/coordinator/lots/{lot_id}",
                due_at=day_start(pickup_date),
                priority="high",
            )
        )

    seller_offers = (
        await db.execute(
            select(Offer.id, Offer.code, Offer.price_per_kg, Offer.valid_until, Lot.code)
            .join(Lot, Lot.id == Offer.lot_id)
            .where(
                Offer.target_type == "lot",
                Offer.status.in_(("pending", "countered")),
                Offer.awaiting == "seller",
            )
            .order_by(Offer.valid_until)
        )
    ).all()
    for offer_id, code, price, valid_until, lot_code in seller_offers:
        items.append(
            action(
                f"offer-{offer_id}",
                "offer",
                f"Offer {code} on lot {lot_code}: {format_rupees(price)}/kg",
                "Compare the farmers' net against the mandi, then accept, counter or reject.",
                f"/app/coordinator/offers/{offer_id}",
                due_at=valid_until,
                priority="high",
            )
        )

    has_request = select(TransportRequest.lot_id).where(TransportRequest.status != "cancelled")
    needs_transport = (
        await db.execute(
            select(Lot.id, Lot.code, Lot.pickup_date)
            .where(
                Lot.status == "offer_accepted",
                Lot.pickup_terms == "mandimate_delivery",
                Lot.id.not_in(has_request),
            )
            .order_by(Lot.pickup_date)
        )
    ).all()
    for lot_id, code, pickup_date in needs_transport:
        items.append(
            action(
                f"transport-{lot_id}",
                "lot",
                f"Book transport for lot {code}",
                f"Create a transport request for pickup on {format_date(pickup_date)}.",
                "/app/coordinator/transport",
                due_at=day_start(pickup_date),
                priority="high",
            )
        )

    quoted = (
        await db.execute(
            select(
                TransportRequest.id,
                TransportRequest.pickup_date,
                Lot.code,
                func.count(TransportQuote.id),
            )
            .join(Lot, Lot.id == TransportRequest.lot_id)
            .join(TransportQuote, TransportQuote.request_id == TransportRequest.id)
            .where(TransportRequest.status == "quoted", TransportQuote.status == "submitted")
            .group_by(TransportRequest.id, TransportRequest.pickup_date, Lot.code)
            .order_by(TransportRequest.pickup_date)
        )
    ).all()
    for request_id, pickup_date, lot_code, count in quoted:
        items.append(
            action(
                f"quotes-{request_id}",
                "quote",
                f"Review {count} quote{'s' if count != 1 else ''} for lot {lot_code}",
                f"Book a transporter before pickup on {format_date(pickup_date)}.",
                "/app/coordinator/transport",
                due_at=day_start(pickup_date),
                priority="high",
            )
        )

    for lot_id, code, status, pickup_date in pending_delivery:
        items.append(
            action(
                f"delivery-{lot_id}",
                "delivery",
                f"Delivery pending: lot {code}",
                "In transit to the buyer."
                if status == "in_transit"
                else "Record the delivery and quality check once the buyer receives it.",
                f"/app/coordinator/lots/{lot_id}",
                due_at=day_start(pickup_date),
                priority="high" if status == "in_transit" else "normal",
            )
        )

    unpaid_payouts = (
        await db.execute(
            select(Settlement.id, Settlement.code, Lot.code, func.count(FarmerPayout.id))
            .join(Lot, Lot.id == Settlement.lot_id)
            .join(FarmerPayout, FarmerPayout.settlement_id == Settlement.id)
            .where(Settlement.payment_status == "paid", FarmerPayout.status == "pending")
            .group_by(Settlement.id, Settlement.code, Lot.code)
            .order_by(Settlement.code)
        )
    ).all()
    for settlement_id, code, lot_code, count in unpaid_payouts:
        items.append(
            action(
                f"payouts-{settlement_id}",
                "payment",
                f"Pay {count} farmer{'s' if count != 1 else ''} for lot {lot_code}",
                f"The buyer has paid settlement {code}; remit each farmer's net and mark it paid.",
                f"/app/coordinator/settlements/{settlement_id}",
                priority="high",
            )
        )

    for dispute_id, code, category, status, lot_code in open_disputes:
        items.append(
            action(
                f"dispute-{dispute_id}",
                "dispute",
                f"Dispute {code} on lot {lot_code}",
                f"{category.capitalize()} dispute, {status.replace('_', ' ')}.",
                "/app/coordinator/disputes",
                priority="high" if status == "open" else "normal",
            )
        )

    verifications = (
        await db.execute(
            select(User.id, User.full_name, User.organization_name, User.role)
            .where(User.verification_status == "pending")
            .order_by(User.updated_at)
        )
    ).all()
    for user_id, full_name, organization, role in verifications:
        items.append(
            action(
                f"verification-{user_id}",
                "verification",
                f"Verify {organization or full_name}",
                f"A {role} is waiting for verification.",
                "/app/coordinator/verifications",
            )
        )
    return sort_actions(items)


# ──────────────────────────────── Admin ────────────────────────────────


async def admin_overview(db: AsyncSession) -> schemas.AdminOverview:
    role_counts = dict(
        (await db.execute(select(User.role, func.count(User.id)).group_by(User.role))).all()
    )
    pending_verifications = await db.scalar(
        select(func.count(User.id)).where(User.verification_status == "pending")
    )
    kg_traded, gmv = (
        await db.execute(
            select(func.sum(Settlement.total_accepted_kg), func.sum(Settlement.gross_amount))
        )
    ).one()
    lots_by_status = dict(
        (await db.execute(select(Lot.status, func.count(Lot.id)).group_by(Lot.status))).all()
    )
    return schemas.AdminOverview(
        users_by_role={role: int(role_counts.get(role, 0)) for role in ROLES},
        pending_verifications=int(pending_verifications or 0),
        total_kg_traded=money(kg_traded),
        total_gmv=money(gmv),
        lots_by_status={status: int(count) for status, count in lots_by_status.items()},
        pilot_metrics=await metrics.pilot_metrics(db),
    )
