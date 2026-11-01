"""The demo seed: the seeded world obeys DOMAIN_RULES and tells the product brief's story.

The seed runs once for the module into the per-process test schema; each test reads it with its
own session. The command-line tests at the end reset the database themselves.
"""

from collections import defaultdict
from collections.abc import AsyncIterator
from datetime import timedelta
from decimal import Decimal

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.core.config import settings
from app.core.security import ACCESS_COOKIE, create_access_token, verify_password
from app.core.time import IST, utcnow
from app.models import (
    CODE_SEQUENCES,
    AuditLog,
    Base,
    Crop,
    Delivery,
    Demand,
    Dispute,
    FarmerPayout,
    Harvest,
    Lot,
    LotMember,
    MarketPrice,
    Notification,
    Offer,
    Settlement,
    TransportRequest,
    User,
)
from app.models.enums import LOT_STATUSES
from app.seed import DEMO_PASSWORD, SeedRefusedError, SeedReport, run_seed, seed_database
from app.seed.__main__ import main
from app.seed.markets import HISTORY_DAYS, MADANAPALLE, SOURCE, modal_price, nearest_market
from app.seed.summary import render_report
from app.services.pricing import (
    DEFAULT_RADIUS_KM,
    LOADING_PER_KG,
    baseline_net_proceeds,
    road_km,
    round_money,
)

DEMO_ACCOUNTS = {
    "ravi@mandimate.demo": "farmer",
    "lakshmi@mandimate.demo": "farmer",
    "procurement@freshbasket.demo": "buyer",
    "kitchen@annapurna.demo": "buyer",
    "trader@venkateswara.demo": "buyer",
    "dispatch@swiftagri.demo": "transporter",
    "bookings@rayalaseemaroadways.demo": "transporter",
    "coordinator@madanapallefpo.demo": "coordinator",
    "admin@mandimate.demo": "admin",
}
MIRROR = {
    "forming": "pooled",
    "awaiting_consent": "pooled",
    "open_for_offers": "pooled",
    "offer_accepted": "committed",
    "transport_booked": "committed",
    "in_transit": "picked_up",
    "delivered": "delivered",
    "settled": "settled",
}
RANK = {status: rank for rank, status in enumerate(MIRROR)}
ACCEPTED_STAGES = ("offer_accepted", "transport_booked", "in_transit", "delivered", "settled")


async def _truncate(engine: AsyncEngine) -> None:
    tables = ", ".join(f'"{table.name}"' for table in Base.metadata.sorted_tables)
    async with engine.begin() as connection:
        await connection.execute(text(f"TRUNCATE TABLE {tables} RESTART IDENTITY CASCADE"))
        for sequence in CODE_SEQUENCES:
            await connection.execute(text(f"ALTER SEQUENCE {sequence.name} RESTART WITH 1"))


@pytest_asyncio.fixture(scope="module")
async def seeded(
    engine: AsyncEngine, session_factory: async_sessionmaker[AsyncSession]
) -> SeedReport:
    await _truncate(engine)
    async with session_factory() as db:
        report = await run_seed(db)
        await db.commit()
    return report


@pytest_asyncio.fixture
async def s(
    seeded: SeedReport, session_factory: async_sessionmaker[AsyncSession]
) -> AsyncIterator[AsyncSession]:
    async with session_factory() as db:
        yield db


async def _user(db: AsyncSession, email: str) -> User:
    return (await db.scalars(select(User).where(User.email == email))).one()


async def _lots(db: AsyncSession) -> list[Lot]:
    return list((await db.scalars(select(Lot))).all())


# ─────────────────────────────── catalogue & prices ───────────────────────────────


async def test_catalog_has_ten_crops_with_three_languages(s: AsyncSession) -> None:
    crops = {crop.code: crop for crop in (await s.scalars(select(Crop))).all()}
    assert set(crops) == {"TOM", "ONI", "CHI", "POT", "MNG", "GNT", "OKR", "BRN", "CAB", "BAN"}
    perishability = {code: crop.perishability_days for code, crop in crops.items()}
    assert perishability == {
        "TOM": 7,
        "ONI": 30,
        "CHI": 6,
        "POT": 45,
        "MNG": 8,
        "GNT": 120,
        "OKR": 4,
        "BRN": 6,
        "CAB": 10,
        "BAN": 7,
    }
    tomato = crops["TOM"]
    assert (tomato.name_hi, tomato.name_te) == ("टमाटर", "టమాటా")
    assert (tomato.name_kn, tomato.name_ur) == ("ಟೊಮೆಟೊ", "ٹماٹر")
    assert tomato.default_rejection_pct == Decimal("5")
    for crop in crops.values():
        assert crop.grades == ["A", "B", "C"]
        assert not crop.requires_refrigeration
        assert crop.name.lower() in crop.synonyms
        assert crop.name_hi.lower() in crop.synonyms
        assert crop.name_te.lower() in crop.synonyms
        assert crop.name_kn and crop.name_kn.lower() in crop.synonyms
        assert crop.name_ur and crop.name_ur.lower() in crop.synonyms
        assert all(word == word.lower() for word in crop.synonyms)


async def test_market_prices_are_illustrative_and_cover_sixty_days(
    s: AsyncSession, seeded: SeedReport
) -> None:
    prices = (await s.scalars(select(MarketPrice))).all()
    assert len(prices) == HISTORY_DAYS * 4 * 10
    assert {p.market_name for p in prices} == {
        "Madanapalle APMC",
        "Punganur Market Yard",
        "Palamaner Market Yard",
        "Kolar APMC",
    }
    assert {p.price_date for p in prices} == {
        seeded.today - timedelta(days=back) for back in range(HISTORY_DAYS)
    }
    tomato = (await s.scalars(select(Crop).where(Crop.code == "TOM"))).one()
    for price in prices:
        assert price.is_illustrative
        assert price.source == SOURCE
        assert price.min_price_per_kg <= price.modal_price_per_kg <= price.max_price_per_kg
        if price.crop_id == tomato.id:
            assert Decimal("12") <= price.modal_price_per_kg <= Decimal("18")
    today_madanapalle = next(
        p
        for p in prices
        if p.crop_id == tomato.id
        and p.market_name == MADANAPALLE.name
        and p.price_date == seeded.today
    )
    assert today_madanapalle.modal_price_per_kg == Decimal("14.00")


# ─────────────────────────────── accounts ───────────────────────────────


async def test_demo_accounts_exist_and_passwords_verify(s: AsyncSession) -> None:
    users = (await s.scalars(select(User))).all()
    by_email = {user.email: user for user in users if user.email}
    for email, role in DEMO_ACCOUNTS.items():
        assert by_email[email].role == role
    for user in users:
        assert verify_password(DEMO_PASSWORD, user.password_hash), user.full_name
        assert user.is_active

    ravi = by_email["ravi@mandimate.demo"]
    assert (ravi.full_name, ravi.preferred_language, ravi.village, ravi.phone) == (
        "Ravi Kumar Reddy",
        "te",
        "Kurabalakota",
        "+919876500001",
    )
    assert by_email["lakshmi@mandimate.demo"].preferred_language == "en"
    assert by_email["lakshmi@mandimate.demo"].village == "Punganur"
    assert by_email["trader@venkateswara.demo"].verification_status == "unverified"
    for email in ("procurement@freshbasket.demo", "kitchen@annapurna.demo"):
        assert by_email[email].verification_status == "verified"
    coordinator = by_email["coordinator@madanapallefpo.demo"]
    assert coordinator.full_name == "Sravani Naidu"
    assert coordinator.fpo is not None
    assert coordinator.fpo.name == "Madanapalle Tomato Growers FPO"

    farmers = [user for user in users if user.role == "farmer"]
    assert len(farmers) >= 17
    assert all(farmer.fpo_id == coordinator.fpo_id for farmer in farmers)
    phone_only = [farmer for farmer in farmers if farmer.email is None]
    assert len(phone_only) >= 10
    assert all(farmer.created_by_id == coordinator.id for farmer in phone_only)
    assert {farmer.preferred_language for farmer in farmers} == {"te", "hi", "en"}

    transporters = [user for user in users if user.role == "transporter"]
    verified = [t for t in transporters if t.verification_status == "verified"]
    assert {t.organization_name for t in verified} == {
        "Swift Agri Logistics",
        "Rayalaseema Roadways",
    }


# ─────────────────────────────── the brief's scene ───────────────────────────────


async def test_ravis_current_harvest_has_both_offers(s: AsyncSession, seeded: SeedReport) -> None:
    ravi = await _user(s, "ravi@mandimate.demo")
    harvest = (
        await s.scalars(
            select(Harvest).where(
                Harvest.farmer_id == ravi.id,
                Harvest.quantity_kg == 400,
                Harvest.harvest_date == seeded.today + timedelta(days=1),
            )
        )
    ).one()
    assert harvest.crop.code == "TOM"
    assert harvest.quality_status == "pending_inspection"
    assert harvest.min_price_per_kg == Decimal("12")
    assert harvest.available_from == seeded.today + timedelta(days=1)

    direct = (await s.scalars(select(Offer).where(Offer.harvest_id == harvest.id))).one()
    assert direct.target_type == "harvest"
    assert direct.buyer.organization_name == "Sri Venkateswara Traders"
    assert direct.buyer.verification_status == "unverified"
    assert (direct.status, direct.awaiting) == ("pending", "seller")
    assert direct.price_per_kg == Decimal("14")
    assert direct.pickup_terms == "buyer_pickup"
    assert direct.payment_terms_days <= 1
    assert direct.valid_until > utcnow()

    member = (await s.scalars(select(LotMember).where(LotMember.harvest_id == harvest.id))).one()
    lot = (await s.scalars(select(Lot).where(Lot.id == member.lot_id))).one()
    assert lot.status == "open_for_offers"
    assert len(lot.members) == 4
    total = sum(m.quantity_kg for m in lot.members if m.consent_status != "declined")
    assert Decimal("1150") <= total <= Decimal("1350")

    pooled = (await s.scalars(select(Offer).where(Offer.lot_id == lot.id))).one()
    assert pooled.buyer.organization_name == "FreshBasket Retail"
    assert (pooled.status, pooled.awaiting) == ("proposed", "farmers")
    assert pooled.price_per_kg == Decimal("16")
    assert pooled.pickup_terms == "mandimate_delivery"
    assert pooled.payment_terms_days == 7
    decisions = {consent.farmer_id: consent.decision for consent in pooled.consents}
    assert decisions.pop(ravi.id) == "pending"
    assert len(decisions) == 3
    assert set(decisions.values()) == {"accepted"}
    actions = [entry.action for entry in pooled.negotiation]
    assert actions[:5] == ["offer", "counter", "counter", "accept", "propose"]


async def test_ravi_has_a_lot_awaiting_his_pooling_consent(s: AsyncSession) -> None:
    ravi = await _user(s, "ravi@mandimate.demo")
    lots = (await s.scalars(select(Lot).where(Lot.status == "awaiting_consent"))).all()
    waiting = [
        member
        for lot in lots
        for member in lot.members
        if member.farmer_id == ravi.id and member.consent_status == "pending"
    ]
    assert len(waiting) == 1
    assert waiting[0].harvest.crop.code == "CHI"


async def test_ravi_and_lakshmi_have_settled_history(s: AsyncSession) -> None:
    for email, low, high in (("ravi@mandimate.demo", 6, 8), ("lakshmi@mandimate.demo", 3, 5)):
        farmer = await _user(s, email)
        payouts = (
            await s.scalars(
                select(FarmerPayout).where(
                    FarmerPayout.farmer_id == farmer.id, FarmerPayout.status == "paid"
                )
            )
        ).all()
        assert low <= len(payouts) <= high, email
        assert all(p.uplift_per_kg is not None for p in payouts)
        average_uplift = sum(p.uplift_per_kg for p in payouts) / len(payouts)
        assert Decimal("1") < average_uplift < Decimal("6")
        months = {p.paid_at.astimezone(IST).strftime("%Y-%m") for p in payouts}
        if email.startswith("ravi"):
            assert len(months) >= 6


# ─────────────────────────────── lots & journey ───────────────────────────────


async def test_every_lot_status_is_present(s: AsyncSession, seeded: SeedReport) -> None:
    statuses = {lot.status for lot in await _lots(s)}
    assert statuses == set(LOT_STATUSES)
    assert set(seeded.lots_by_status) == set(LOT_STATUSES)
    crops = {lot.crop.code for lot in await _lots(s)}
    assert {"TOM", "ONI", "CHI"} <= crops


async def test_lot_states_are_consistent_with_offers_transport_and_settlement(
    s: AsyncSession,
) -> None:
    requests = {r.lot_id: r for r in (await s.scalars(select(TransportRequest))).all()}
    deliveries = {d.lot_id for d in (await s.scalars(select(Delivery))).all()}
    settlements = {x.lot_id: x for x in (await s.scalars(select(Settlement))).all()}
    for lot in await _lots(s):
        active = [m for m in lot.members if m.consent_status != "declined"]
        if lot.status == "forming":
            assert not lot.members
        if lot.status == "awaiting_consent":
            assert any(m.consent_status == "pending" for m in lot.members)
        if lot.status in ("open_for_offers", *ACCEPTED_STAGES):
            assert all(m.consent_status != "pending" for m in lot.members)
            assert any(m.consent_status == "accepted" for m in lot.members)
        if lot.status in ACCEPTED_STAGES:
            offer = lot.accepted_offer
            assert offer is not None and offer.status == "accepted", lot.code
            assert offer.lot_id == lot.id
            assert lot.pickup_terms == offer.pickup_terms
            assert offer.quantity_kg == sum(m.quantity_kg for m in active)
            assert all(c.decision != "pending" for c in offer.consents)
        else:
            assert lot.accepted_offer_id is None
        request = requests.get(lot.id)
        if lot.pickup_terms == "buyer_pickup" or lot.status not in ACCEPTED_STAGES:
            assert request is None, lot.code
        else:
            expected = {
                "offer_accepted": {"open", "quoted"},
                "transport_booked": {"booked"},
                "in_transit": {"in_progress"},
                "delivered": {"completed"},
                "settled": {"completed"},
            }[lot.status]
            assert request.status in expected, lot.code
            assert {stop.member_id for stop in request.stops} == {m.id for m in active}
            if request.status in ("booked", "in_progress", "completed"):
                assert request.booked_quote.status == "accepted"
                assert all(
                    q.status == "rejected"
                    for q in request.quotes
                    if q.id != request.booked_quote_id
                )
            picked = [stop for stop in request.stops if stop.status == "picked_up"]
            if request.status == "in_progress":
                assert 0 < len(picked) < len(request.stops)
            if request.status == "completed":
                assert len(picked) == len(request.stops)
        if lot.status in ("delivered", "settled"):
            assert lot.id in deliveries and lot.id in settlements
            assert lot.delivered_at is not None
        else:
            assert lot.id not in deliveries and lot.id not in settlements
        if lot.status == "settled":
            assert settlements[lot.id].payment_status == "paid"
            assert all(p.status == "paid" for p in settlements[lot.id].payouts)
            assert lot.settled_at is not None
        if lot.status == "delivered":
            assert any(p.status == "pending" for p in settlements[lot.id].payouts)
        if lot.status == "cancelled":
            assert lot.cancelled_reason


async def test_pooled_lots_respect_the_matching_rules(s: AsyncSession) -> None:
    for lot in await _lots(s):
        if lot.is_solo:
            assert len(lot.members) == 1
            continue
        for member in lot.members:
            harvest = member.harvest
            assert harvest.crop_id == lot.crop_id
            assert harvest.grade == lot.grade
            assert harvest.available_from <= lot.pickup_date <= harvest.sell_by
            assert (lot.pickup_date - harvest.harvest_date).days <= harvest.crop.perishability_days
            distance = road_km(
                harvest.latitude,
                harvest.longitude,
                lot.collection_latitude,
                lot.collection_longitude,
            )
            assert distance <= DEFAULT_RADIUS_KM
            assert member.distance_km == distance
            assert member.farmer_id == harvest.farmer_id


async def test_available_kg_is_never_negative(s: AsyncSession) -> None:
    lots = {lot.id: lot for lot in await _lots(s)}
    committed: dict = defaultdict(Decimal)
    for lot in lots.values():
        if lot.status == "cancelled":
            continue
        for member in lot.members:
            if member.consent_status != "declined":
                committed[member.harvest_id] += member.quantity_kg
    for harvest in (await s.scalars(select(Harvest))).all():
        assert harvest.quantity_kg - committed[harvest.id] >= 0, harvest.id


async def test_harvest_statuses_mirror_their_lots(s: AsyncSession, seeded: SeedReport) -> None:
    lots = {lot.id: lot for lot in await _lots(s)}
    memberships: dict = defaultdict(list)
    for lot in lots.values():
        for member in lot.members:
            memberships[member.harvest_id].append((lot, member))
    statuses = set()
    for harvest in (await s.scalars(select(Harvest))).all():
        statuses.add(harvest.status)
        active = [
            lot
            for lot, member in memberships[harvest.id]
            if lot.status != "cancelled" and member.consent_status != "declined"
        ]
        if active:
            best = max(active, key=lambda lot: RANK[lot.status])
            assert harvest.status == MIRROR[best.status], harvest.id
        else:
            assert harvest.status in ("listed", "draft", "cancelled", "expired")
            if harvest.status == "listed":
                assert harvest.sell_by >= seeded.today
            if harvest.status == "expired":
                assert harvest.sell_by < seeded.today
    assert {"listed", "draft", "pooled", "committed", "picked_up", "delivered", "settled"} <= (
        statuses
    )
    assert {"cancelled", "expired"} <= statuses


# ─────────────────────────────── offers ───────────────────────────────


async def test_offer_statuses_and_consents_match(s: AsyncSession) -> None:
    offers = (await s.scalars(select(Offer))).all()
    assert {"pending", "countered", "proposed", "accepted", "rejected", "withdrawn", "expired"} <= {
        offer.status for offer in offers
    }
    demands = {d.id: d for d in (await s.scalars(select(Demand))).all()}
    open_targets = set()
    for offer in offers:
        if offer.demand_id is not None:
            assert demands[offer.demand_id].buyer_id == offer.buyer_id, offer.code
            assert demands[offer.demand_id].crop_id == offer.crop_id
        assert offer.negotiation[0].action == "offer"
        assert offer.negotiation[0].author_id == offer.buyer_id
        expected_awaiting = {"pending": "seller", "countered": "buyer", "proposed": "farmers"}
        assert offer.awaiting == expected_awaiting.get(offer.status), offer.code
        if offer.status in ("pending", "countered", "proposed"):
            key = (offer.buyer_id, offer.lot_id, offer.harvest_id)
            assert key not in open_targets
            open_targets.add(key)
            assert offer.valid_until > utcnow()
        if offer.status == "proposed":
            assert offer.target_type == "lot"
            members = [m for m in offer.lot.members if m.consent_status != "declined"]
            assert {c.member_id: c.quantity_kg for c in offer.consents} == {
                m.id: m.quantity_kg for m in members
            }
            assert any(c.decision == "pending" for c in offer.consents)
        if offer.status == "accepted" and offer.target_type == "lot":
            assert any(c.decision == "accepted" for c in offer.consents)
            assert all(c.decision != "pending" for c in offer.consents)
        if offer.status == "countered":
            assert offer.negotiation[-1].action == "counter"
            assert offer.negotiation[-1].price_per_kg == offer.price_per_kg


# ─────────────────────────────── settlements ───────────────────────────────


async def test_settlements_recompute_exactly(s: AsyncSession, seeded: SeedReport) -> None:
    settlements = (await s.scalars(select(Settlement))).all()
    assert len(settlements) >= 14
    deliveries = {d.lot_id: d for d in (await s.scalars(select(Delivery))).all()}
    requests = {r.lot_id: r for r in (await s.scalars(select(TransportRequest))).all()}
    for settlement in settlements:
        lot, offer = settlement.lot, settlement.offer
        assert lot.accepted_offer_id == offer.id
        assert settlement.price_per_kg == offer.price_per_kg
        assert settlement.buyer_id == offer.buyer_id
        delivered_on = deliveries[lot.id].recorded_at.astimezone(IST).date()
        assert settlement.due_date == delivered_on + timedelta(days=offer.payment_terms_days)
        transport_total = (
            requests[lot.id].booked_quote.price_total
            if lot.pickup_terms == "mandimate_delivery"
            else Decimal(0)
        )
        members = {m.id: m for m in lot.members if m.consent_status != "declined"}
        assert {p.member_id for p in settlement.payouts} == set(members)
        total_dispatched = sum(m.dispatched_kg for m in members.values())
        for payout in settlement.payouts:
            member = members[payout.member_id]
            assert payout.farmer_id == member.farmer_id
            assert payout.dispatched_kg == member.dispatched_kg
            assert payout.accepted_kg == member.accepted_kg
            assert payout.rejected_kg == member.delivered_kg - member.accepted_kg
            assert member.rejected_kg == payout.rejected_kg
            assert 0 <= member.accepted_kg <= member.delivered_kg
            assert member.delivered_kg <= member.dispatched_kg * Decimal("1.02")

            gross = round_money(offer.price_per_kg * payout.accepted_kg)
            transport = round_money(transport_total * payout.dispatched_kg / total_dispatched)
            handling = round_money(
                offer.handling_charge_per_kg * payout.accepted_kg
                + LOADING_PER_KG * payout.dispatched_kg
            )
            commission = round_money(offer.commission_pct / 100 * gross)
            net = round_money(gross - transport - handling - commission)
            assert payout.gross_amount == gross
            assert payout.transport_share == transport
            assert payout.handling_share == handling
            assert payout.commission_share == commission
            assert payout.net_amount == net
            assert payout.net_per_kg == round_money(net / payout.dispatched_kg)

            harvest = member.harvest
            market = nearest_market(harvest.latitude, harvest.longitude)
            baseline = baseline_net_proceeds(
                quantity_kg=payout.dispatched_kg,
                market_price_per_kg=modal_price(lot.crop.code, market, delivered_on, seeded.today),
                default_rejection_pct=lot.crop.default_rejection_pct,
                distance_km=road_km(
                    harvest.latitude, harvest.longitude, market.latitude, market.longitude
                ),
                is_illustrative=True,
            )
            assert baseline is not None
            assert payout.baseline_net_per_kg == Decimal(str(baseline.net_per_kg))
            assert payout.uplift_per_kg == payout.net_per_kg - payout.baseline_net_per_kg

        payouts = settlement.payouts
        assert settlement.gross_amount == sum(p.gross_amount for p in payouts)
        assert settlement.gross_amount == round_money(
            offer.price_per_kg * settlement.total_accepted_kg
        )
        assert settlement.total_accepted_kg == sum(p.accepted_kg for p in payouts)
        assert settlement.transport_cost == sum(p.transport_share for p in payouts)
        assert abs(settlement.transport_cost - transport_total) <= Decimal("0.01") * len(payouts)
        assert settlement.handling_cost == sum(p.handling_share for p in payouts)
        assert settlement.commission_amount == sum(p.commission_share for p in payouts)
        assert settlement.net_to_farmers == sum(p.net_amount for p in payouts)
        assert settlement.net_to_farmers == (
            settlement.gross_amount
            - settlement.transport_cost
            - settlement.handling_cost
            - settlement.commission_amount
        )
        assert settlement.amount_paid == sum(p.amount for p in settlement.payments)


async def test_settlement_payment_statuses(s: AsyncSession) -> None:
    settlements = (await s.scalars(select(Settlement))).all()
    disputes = (await s.scalars(select(Dispute))).all()
    open_disputes = {
        d.settlement_id
        for d in disputes
        if d.status in ("open", "under_review") and d.settlement_id
    }
    statuses = set()
    for settlement in settlements:
        statuses.add(settlement.payment_status)
        fully_paid = settlement.amount_paid >= settlement.gross_amount - Decimal("0.01")
        if fully_paid:
            assert settlement.payment_status == "paid"
            assert settlement.paid_at is not None
        elif settlement.id in open_disputes:
            assert settlement.payment_status == "disputed"
        elif settlement.amount_paid > 0:
            assert settlement.payment_status == "partially_paid"
        else:
            assert settlement.payment_status == "pending"
        if settlement.payment_status != "paid":
            assert all(p.status == "pending" for p in settlement.payouts)
            assert settlement.due_date >= settlement.created_at.astimezone(IST).date()
        for payout in settlement.payouts:
            if payout.status == "paid":
                assert payout.paid_at is not None and payout.reference
    assert {"paid", "partially_paid", "pending", "disputed"} <= statuses


async def test_disputes_open_and_resolved(s: AsyncSession) -> None:
    disputes = (await s.scalars(select(Dispute))).all()
    by_status = {d.status: d for d in disputes}
    assert set(by_status) == {"open", "resolved"}
    open_dispute = by_status["open"]
    assert open_dispute.category == "quality"
    assert open_dispute.lot.status == "delivered"
    settlement = (
        await s.scalars(select(Settlement).where(Settlement.id == open_dispute.settlement_id))
    ).one()
    assert settlement.payment_status == "disputed"
    resolved = by_status["resolved"]
    assert resolved.resolution and resolved.resolved_by_id and resolved.resolved_at
    assert resolved.lot.status == "settled"


async def test_demands_follow_their_lots(s: AsyncSession) -> None:
    demands = (await s.scalars(select(Demand))).all()
    lots = await _lots(s)
    assert {"open", "matched", "fulfilled", "cancelled"} <= {d.status for d in demands}
    for buyer_email in ("procurement@freshbasket.demo", "kitchen@annapurna.demo"):
        buyer = await _user(s, buyer_email)
        assert {"open", "matched", "fulfilled"} <= {
            d.status for d in demands if d.buyer_id == buyer.id
        }
    for demand in demands:
        linked = [lot for lot in lots if lot.demand_id == demand.id]
        if demand.status == "fulfilled":
            assert any(lot.status == "settled" for lot in linked)
        if demand.status == "matched":
            assert any(lot.status in ACCEPTED_STAGES[:-1] for lot in linked)
        assert demand.min_quantity_kg <= demand.quantity_kg


# ─────────────────────────────── activity ───────────────────────────────


async def test_every_demo_account_has_notifications_and_some_are_unread(s: AsyncSession) -> None:
    for email in DEMO_ACCOUNTS:
        user = await _user(s, email)
        notes = (await s.scalars(select(Notification).where(Notification.user_id == user.id))).all()
        assert notes, email
        assert any(note.read_at is None for note in notes), email
        for note in notes:
            assert note.read_at is None or note.read_at >= note.created_at
            assert note.link is None or note.link.startswith("/app/")
            if note.link and user.role != "admin":
                assert note.link.startswith(f"/app/{user.role}") or note.link in (
                    "/app/disputes",
                    "/app/verification",
                    "/app/notifications",
                )
    audit_entries = await s.scalar(select(func.count()).select_from(AuditLog))
    assert audit_entries and audit_entries > 100


async def test_nothing_is_dated_in_the_future(s: AsyncSession) -> None:
    now = utcnow()
    for model in (User, Harvest, Lot, Offer, Settlement, Dispute, Notification, AuditLog):
        latest = await s.scalar(select(func.max(model.created_at)))
        assert latest is not None and latest <= now, model.__name__


async def test_summary_lists_accounts_counts_and_statuses(seeded: SeedReport) -> None:
    rendered = render_report(seeded)
    assert DEMO_PASSWORD in rendered
    for email in DEMO_ACCOUNTS:
        assert email in rendered
    assert "Lots by status" in rendered
    assert "in transit" in rendered
    assert seeded.counts["Users"] >= 26


# ─────────────────────────────── command line ───────────────────────────────


async def test_seed_refuses_a_database_with_users(
    seeded: SeedReport, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    with pytest.raises(SeedRefusedError, match="--reset"):
        await seed_database(session_factory)


async def test_reset_wipes_and_reseeds_with_codes_from_one(
    seeded: SeedReport, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    report = await seed_database(session_factory, reset=True)
    for table in ("Users", "Harvests", "Lots", "Offers", "Settlements", "Farmer payouts"):
        assert report.counts[table] == seeded.counts[table]
    async with session_factory() as db:
        codes = set((await db.scalars(select(Lot.code))).all())
        assert "MM-TOM-0001" in codes
        assert await db.scalar(select(func.count()).select_from(User)) == seeded.counts["Users"]


async def test_catalog_only_loads_crops_and_prices_without_accounts(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    report = await seed_database(session_factory, reset=True, catalog_only=True)
    assert report.catalog_only
    assert report.counts["Crops"] == 10
    assert report.counts["Market prices"] == HISTORY_DAYS * 40
    assert report.counts["Users"] == 0
    assert not report.accounts
    # Idempotent: a second catalogue load adds nothing and keeps the crops.
    again = await seed_database(session_factory, catalog_only=True)
    assert again.market_prices_inserted == 0
    assert again.counts["Crops"] == 10


def test_production_refuses_demo_data(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "APP_ENV", "production")
    assert main(["--reset"]) == 2
    assert main([]) == 2


# ─────────────────────────────── screens ───────────────────────────────


async def test_every_screen_loads_for_the_seeded_accounts(
    app: FastAPI, session_factory: async_sessionmaker[AsyncSession], engine: AsyncEngine
) -> None:
    """Smoke test: the API can present the seeded world to every role without errors."""
    await _truncate(engine)
    async with session_factory() as db:
        await run_seed(db)
        await db.commit()
        users = {u.email: u for u in (await db.scalars(select(User))).all() if u.email}
        ravi = users["ravi@mandimate.demo"]
        harvests = (await db.scalars(select(Harvest).where(Harvest.farmer_id == ravi.id))).all()
        lots = (await db.scalars(select(Lot))).all()
        offers = (await db.scalars(select(Offer))).all()
        settlements = (await db.scalars(select(Settlement))).all()
        requests = (await db.scalars(select(TransportRequest))).all()

    paths: dict[str, list[str]] = {
        "ravi@mandimate.demo": [
            "/dashboard/farmer",
            "/harvests",
            "/offers",
            "/lots",
            "/earnings",
            "/settlements",
            "/demands",
            "/disputes",
            "/notifications",
            "/notifications/unread-count",
            *(f"/harvests/{h.id}" for h in harvests),
            *(f"/harvests/{h.id}/options" for h in harvests if h.status != "draft"),
            *(f"/harvests/{h.id}/timeline" for h in harvests),
        ],
        "lakshmi@mandimate.demo": ["/dashboard/farmer", "/earnings", "/lots", "/offers"],
        "procurement@freshbasket.demo": [
            "/dashboard/buyer",
            "/demands",
            "/supply",
            "/offers",
            "/lots",
            "/settlements",
            "/transport-requests",
        ],
        "kitchen@annapurna.demo": ["/dashboard/buyer", "/offers", "/settlements"],
        "trader@venkateswara.demo": ["/dashboard/buyer", "/offers", "/supply"],
        "dispatch@swiftagri.demo": [
            "/dashboard/transporter",
            "/vehicles",
            "/transport-requests",
            *(
                f"/transport-requests/{r.id}"
                for r in requests
                if r.status in ("open", "quoted")
                or any(q.transporter_id == users["dispatch@swiftagri.demo"].id for q in r.quotes)
            ),
        ],
        "coordinator@madanapallefpo.demo": [
            "/dashboard/coordinator",
            "/coordinator/farmers",
            "/harvests",
            "/lots",
            "/offers",
            "/settlements",
            "/disputes",
            "/demands",
            "/transport-requests",
            "/insights/supply-demand",
            "/admin/users",
            *(f"/lots/{lot.id}" for lot in lots),
            *(f"/lots/{lot.id}/timeline" for lot in lots),
            *(f"/lots/{lot.id}/delivery" for lot in lots if lot.status in ("delivered", "settled")),
            *(f"/offers/{offer.id}" for offer in offers),
            *(f"/settlements/{x.id}" for x in settlements),
        ],
        "admin@mandimate.demo": ["/dashboard/admin", "/admin/audit-log", "/admin/users"],
    }
    failures = []
    for email, user_paths in paths.items():
        cookies = {ACCESS_COOKIE: create_access_token(users[email])}
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test", cookies=cookies
        ) as http:
            for path in user_paths:
                response = await http.get(f"/api/v1{path}")
                if response.status_code != 200:
                    failures.append(
                        f"{email} GET {path}: {response.status_code} {response.text[:200]}"
                    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
        for path in ("/public/stats", "/crops"):
            response = await http.get(f"/api/v1{path}")
            if response.status_code != 200:
                failures.append(f"public GET {path}: {response.status_code}")
    assert not failures, "\n".join(failures)
