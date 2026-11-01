"""Selling options and per-offer net-proceeds breakdowns (DOMAIN_RULES §3).

For a harvest, every live way to sell it is priced by what the farmer **keeps**:

* direct offers on the harvest (``pending|countered|accepted``),
* offers on the lots that contain it (``pending|countered|proposed|accepted``) for the farmer's
  share, and
* the credible alternative: selling alone at the local mandi (the baseline).

Inputs for an offer: rejection ``min(offer max, crop default × 0.5 if inspected grade A)``,
handling = offer handling + loading, the offer's commission, and transport = the booked quote of
the lot (else a route-plan estimate from the members' farms to the buyer), shared by weight.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import select

from app import schemas
from app.core.errors import forbidden, not_found
from app.core.time import utcnow
from app.models import Demand, Harvest, Lot, LotMember, Offer, TransportQuote, TransportRequest
from app.services import market_service, pricing, routing
from app.services.lot_service import active_members, buyer_name, direct_sale_kg_map, is_privileged
from app.services.offer_service import expire_stale_offers, scale_quantity

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models import Crop, User

DIRECT_OPTION_STATUSES = ("pending", "countered", "accepted")
POOLED_OPTION_STATUSES = ("pending", "countered", "proposed", "accepted")
BOOKED_REQUEST_STATUSES = ("booked", "in_progress", "completed")
INSPECTED_GRADE_A_FACTOR = Decimal("0.5")


@dataclass(frozen=True)
class _Party:
    """One farm moved under an offer, with the kilograms it contributes."""

    key: uuid.UUID
    harvest: Harvest
    member: LotMember | None
    quantity_kg: Decimal


@dataclass(frozen=True)
class _Transport:
    total: Decimal
    certainty: schemas.Certainty
    note: str
    unresolved: tuple[str, ...]


# ─────────────────────────────── Shipment & inputs ───────────────────────────────


def _shipment(offer: Offer, direct_room: dict[uuid.UUID, Decimal]) -> list[_Party]:
    """Every farm the offer moves and how much each sells under the offer's current terms.

    ``direct_room`` (:func:`direct_sale_kg_map`) excludes only kg in lots with an accepted deal, so
    a direct offer is compared at ``min(offer qty, harvest qty − kg already sold in pools)``.
    """
    if offer.target_type == "harvest":
        harvest = offer.harvest
        assert harvest is not None
        member = None
        committed = Decimal(0)
        if offer.lot is not None:  # accepted: the solo lot holds the committed quantity
            member = next((m for m in offer.lot.members if m.harvest_id == harvest.id), None)
            committed = member.quantity_kg if member is not None else Decimal(0)
        quantity = min(offer.quantity_kg, direct_room.get(harvest.id, Decimal(0)) + committed)
        return [_Party(harvest.id, harvest, member, quantity)]

    lot = offer.lot
    assert lot is not None
    members = active_members(lot)
    total = sum((member.quantity_kg for member in members), Decimal(0))
    accepted_kg = min(offer.quantity_kg, total)
    consents = {consent.member_id: consent for consent in offer.consents}
    parties: list[_Party] = []
    for member in members:
        if offer.status == "accepted":
            share = member.quantity_kg
        elif offer.status == "proposed" and member.id in consents:
            share = consents[member.id].quantity_kg
        else:
            share = scale_quantity(member.quantity_kg, accepted_kg, total)
        parties.append(_Party(member.id, member.harvest, member, share))
    return parties


async def _booked_quote_total(db: AsyncSession, offer: Offer) -> Decimal | None:
    """The booked transport quote of the offer's lot, when this offer is the lot's deal."""
    lot = offer.lot
    if lot is None or lot.accepted_offer_id != offer.id:
        return None
    return await db.scalar(
        select(TransportQuote.price_total)
        .join(TransportRequest, TransportRequest.booked_quote_id == TransportQuote.id)
        .where(
            TransportRequest.lot_id == lot.id,
            TransportRequest.status.in_(BOOKED_REQUEST_STATUSES),
        )
        .order_by(TransportRequest.created_at.desc())
        .limit(1)
    )


async def _destination(
    db: AsyncSession, offer: Offer, parties: list[_Party]
) -> tuple[tuple[float, float], Decimal] | None:
    """(point, extra km): the offer's delivery point, else the demand's, else the collection
    point plus ``BASELINE_DISTANCE_KM``."""
    if offer.delivery_latitude is not None and offer.delivery_longitude is not None:
        return (offer.delivery_latitude, offer.delivery_longitude), Decimal(0)
    demand_id = offer.demand_id or (offer.lot.demand_id if offer.lot is not None else None)
    if demand_id is not None:
        demand = await db.get(Demand, demand_id)
        if (
            demand is not None
            and demand.delivery_latitude is not None
            and demand.delivery_longitude is not None
        ):
            return (demand.delivery_latitude, demand.delivery_longitude), Decimal(0)
    lot = offer.lot
    if lot is not None:
        return (lot.collection_latitude, lot.collection_longitude), pricing.BASELINE_DISTANCE_KM
    harvest = parties[0].harvest
    if harvest.latitude is None or harvest.longitude is None:
        return None
    return (harvest.latitude, harvest.longitude), pricing.BASELINE_DISTANCE_KM


async def _transport(
    db: AsyncSession,
    offer: Offer,
    parties: list[_Party],
    subject: list[_Party],
    crop: Crop,
) -> _Transport:
    """Total transport for the offer's shipment and how certain it is."""
    if offer.pickup_terms == "buyer_pickup":
        return _Transport(Decimal(0), "confirmed", "Buyer collects: no transport cost", ())
    pending = (pricing.UNRESOLVED_TRANSPORT_QUOTE,)
    booked = await _booked_quote_total(db, offer)
    if booked is not None:
        return _Transport(
            booked, "confirmed", f"Booked transport quote {pricing.format_rupees(booked)}", ()
        )
    stops = [
        routing.RouteStop(
            id=party.key,
            latitude=party.harvest.latitude,
            longitude=party.harvest.longitude,
            quantity_kg=party.quantity_kg,
            label=party.harvest.village or "Farm",
        )
        for party in parties
        if party.harvest.latitude is not None and party.harvest.longitude is not None
    ]
    subject_located = all(
        party.harvest.latitude is not None and party.harvest.longitude is not None
        for party in subject
    )
    destination = await _destination(db, offer, parties) if stops else None
    if not stops or not subject_located or destination is None:
        return _Transport(Decimal(0), "unresolved", "Location missing", pending)
    point, extra_km = destination
    plan = routing.plan_route(stops, point)
    total_kg = sum((party.quantity_kg for party in parties), Decimal(0))
    estimate = pricing.estimate_transport_cost(
        total_kg, plan.total_distance_km + extra_km, crop.requires_refrigeration
    )
    return _Transport(
        estimate.cost_total,
        "estimated",
        f"Estimated: {pricing.describe_transport_estimate(estimate)}",
        pending,
    )


def _rejection(
    offer: Offer, subject: list[_Party], crop: Crop
) -> tuple[Decimal, schemas.Certainty, str | None]:
    """Expected rejection %, its certainty and an explanatory note."""
    members = [party.member for party in subject]
    if subject and all(m is not None and m.accepted_kg is not None for m in members):
        quantity = sum((party.quantity_kg for party in subject), Decimal(0))
        accepted = sum(
            (m.accepted_kg for m in members if m is not None and m.accepted_kg is not None),
            Decimal(0),
        )
        if quantity > 0:
            actual = max(Decimal(0), min(Decimal(100), (quantity - accepted) / quantity * 100))
            return (
                pricing.round_money(actual),
                "confirmed",
                f"Actual rejection at delivery: {pricing.format_number(actual)}%",
            )
    harvests = [party.harvest for party in subject]
    inspected = bool(harvests) and all(h.quality_status == "inspected" for h in harvests)
    factor = (
        INSPECTED_GRADE_A_FACTOR
        if inspected and all(h.grade == "A" for h in harvests)
        else Decimal(1)
    )
    pct = min(offer.max_rejection_pct, crop.default_rejection_pct * factor)
    note = f"Expected {pricing.format_number(pct)}% rejection"
    if factor != 1:
        note += " (inspected grade A)"
    elif pct == offer.max_rejection_pct and pct < crop.default_rejection_pct:
        note += " (buyer's maximum)"
    return pct, ("estimated" if inspected else "unresolved"), note


def _offer_unresolved(offer: Offer) -> list[str]:
    extra: list[str] = []
    if offer.buyer.verification_status != "verified":
        extra.append(pricing.UNRESOLVED_BUYER_UNVERIFIED)
    if offer.status == "proposed":
        extra.append(pricing.UNRESOLVED_FARMER_CONSENT)
    elif offer.status == "countered":
        extra.append(pricing.UNRESOLVED_BUYER_RESPONSE)
    return extra


async def _offer_net(
    db: AsyncSession,
    offer: Offer,
    parties: list[_Party],
    subject: list[_Party],
    *,
    label: str,
) -> schemas.NetProceeds:
    """Net proceeds of ``subject`` (one farm, or the whole shipment) under ``offer``."""
    crop = offer.crop
    quantity = sum((party.quantity_kg for party in subject), Decimal(0))
    total_kg = sum((party.quantity_kg for party in parties), Decimal(0))
    transport = await _transport(db, offer, parties, subject, crop)
    share = transport.total * quantity / total_kg if total_kg > 0 else Decimal(0)
    note = transport.note
    if len(parties) > 1 and len(subject) < len(parties):
        note += f". Shared by weight across {len(parties)} farmers"
    rejection_pct, rejection_certainty, rejection_note = _rejection(offer, subject, crop)
    handling = offer.handling_charge_per_kg + pricing.LOADING_PER_KG
    handling_note = f"Loading {pricing.format_rupees(pricing.LOADING_PER_KG)}/kg" + (
        f" + buyer handling {pricing.format_rupees(offer.handling_charge_per_kg)}/kg"
        if offer.handling_charge_per_kg > 0
        else ""
    )
    return pricing.compute_net_proceeds(
        label=label,
        quantity_kg=quantity,
        price_per_kg=offer.price_per_kg,
        transport_cost=share,
        transport_certainty=transport.certainty,
        rejection_pct=rejection_pct,
        rejection_certainty=rejection_certainty,
        handling_per_kg=handling,
        commission_pct=offer.commission_pct,
        commission_certainty="confirmed",
        payment_terms_days=offer.payment_terms_days,
        gross_certainty="confirmed",
        handling_certainty="estimated",
        gross_note=(
            f"{pricing.format_number(quantity)} kg × {pricing.format_rupees(offer.price_per_kg)}/kg"
            f" (buyer's written offer)"
        ),
        transport_note=note,
        handling_note=handling_note,
        rejection_note=rejection_note,
        unresolved=[*transport.unresolved, *_offer_unresolved(offer)],
    )


def _offer_label(offer: Offer) -> str:
    return f"{offer.code} · {buyer_name(offer.buyer)} at {pricing.format_rupees(offer.price_per_kg)}/kg"


# ─────────────────────────────── Public API ───────────────────────────────


async def build_selling_options(
    db: AsyncSession, harvest: Harvest, viewer: User
) -> schemas.SellingOptions:
    """Direct offers, pooled offers and the mandi baseline for a harvest, best net first."""
    await expire_stale_offers(db)
    direct_room = await direct_sale_kg_map(db, [harvest.id])

    direct_offers = (
        await db.scalars(
            select(Offer)
            .where(
                Offer.target_type == "harvest",
                Offer.harvest_id == harvest.id,
                Offer.status.in_(DIRECT_OPTION_STATUSES),
            )
            .order_by(Offer.created_at, Offer.id)
        )
    ).all()
    member_lot_ids = select(LotMember.lot_id).where(
        LotMember.harvest_id == harvest.id, LotMember.consent_status != "declined"
    )
    pooled_offers = (
        await db.scalars(
            select(Offer)
            .join(Lot, Lot.id == Offer.lot_id)
            .where(
                Offer.target_type == "lot",
                Offer.lot_id.in_(member_lot_ids),
                Offer.status.in_(POOLED_OPTION_STATUSES),
                Lot.status != "cancelled",
            )
            .order_by(Offer.created_at, Offer.id)
        )
    ).all()

    min_price = harvest.min_price_per_kg

    def meets(net: schemas.NetProceeds) -> bool | None:
        if min_price is None:
            return None
        return pricing.to_decimal(net.net_per_kg) >= min_price

    options: list[schemas.SellingOption] = []
    for offer in direct_offers:
        parties = _shipment(offer, direct_room)
        net = await _offer_net(db, offer, parties, parties, label=_offer_label(offer))
        options.append(
            schemas.SellingOption(
                **net.model_dump(),
                option_id=str(offer.id),
                source="direct_offer",
                title=f"Direct offer from {buyer_name(offer.buyer)}",
                buyer_name=buyer_name(offer.buyer),
                buyer_verified=offer.buyer.verification_status == "verified",
                offer_status=offer.status,
                awaiting=offer.awaiting,
                lot_id=offer.lot_id,
                valid_until=offer.valid_until,
                meets_min_price=meets(net),
                is_best=False,
            )
        )
    for offer in pooled_offers:
        parties = _shipment(offer, direct_room)
        subject = [party for party in parties if party.harvest.id == harvest.id]
        if not subject:
            continue
        net = await _offer_net(db, offer, parties, subject, label=_offer_label(offer))
        lot = offer.lot
        assert lot is not None
        options.append(
            schemas.SellingOption(
                **net.model_dump(),
                option_id=str(offer.id),
                source="pooled_offer",
                title=f"Pooled lot {lot.code} → {buyer_name(offer.buyer)}",
                buyer_name=buyer_name(offer.buyer),
                buyer_verified=offer.buyer.verification_status == "verified",
                offer_status=offer.status,
                awaiting=offer.awaiting,
                lot_id=lot.id,
                valid_until=offer.valid_until,
                meets_min_price=meets(net),
                is_best=False,
            )
        )

    market = await market_service.latest_market_price(db, harvest.crop_id, harvest.district)
    baseline = None
    if market is not None:
        baseline = pricing.baseline_net_proceeds(
            quantity_kg=harvest.quantity_kg,
            market_price_per_kg=market.modal_price_per_kg,
            default_rejection_pct=harvest.crop.default_rejection_pct,
            is_illustrative=market.is_illustrative,
            market_name=market.market_name,
        )
    if baseline is not None:
        options.append(
            schemas.SellingOption(
                **baseline.model_dump(),
                option_id="baseline",
                source="baseline",
                title=pricing.BASELINE_LABEL,
                buyer_name=None,
                buyer_verified=None,
                offer_status=None,
                awaiting=None,
                lot_id=None,
                valid_until=None,
                meets_min_price=meets(baseline),
                is_best=False,
            )
        )

    options.sort(key=lambda option: (-option.net_amount, option.source == "baseline"))
    candidates = [option for option in options if option.source != "baseline"]
    best = max(candidates, key=lambda option: option.net_amount, default=None)
    uplift = None
    if best is not None:
        best.is_best = True
        if baseline is not None:
            uplift = float(
                pricing.round_money(
                    pricing.to_decimal(best.net_per_kg) - pricing.to_decimal(baseline.net_per_kg)
                )
            )
    return schemas.SellingOptions(
        harvest_id=harvest.id,
        crop_name=harvest.crop.name,
        quantity_kg=float(harvest.quantity_kg),
        min_price_per_kg=float(min_price) if min_price is not None else None,
        options=options,
        best_option_id=best.option_id if best is not None else None,
        uplift_vs_baseline_per_kg=uplift,
        generated_at=utcnow(),
    )


async def offer_breakdown(
    db: AsyncSession, offer: Offer, viewer: User, harvest_id: uuid.UUID | None = None
) -> schemas.NetProceeds:
    """Net proceeds of ``offer`` for the viewer's share, or for one member via ``harvest_id``.

    Farmers get their own share (their harvest in the lot, or their harvest for a direct offer);
    coordinators and admins get the whole shipment, or one member's share with ``harvest_id``.
    """
    if viewer.role not in ("farmer", "coordinator", "admin"):
        raise forbidden("Only the farmers and coordinators can see the net breakdown")
    direct_room = await direct_sale_kg_map(
        db,
        [offer.harvest_id] if offer.harvest_id is not None else [],
    )
    parties = _shipment(offer, direct_room)
    if is_privileged(viewer):
        if harvest_id is None:
            subject = parties
        else:
            subject = [party for party in parties if party.harvest.id == harvest_id]
            if not subject:
                raise not_found("Harvest in this offer")
    else:
        subject = [
            party
            for party in parties
            if party.harvest.farmer_id == viewer.id
            and (harvest_id is None or party.harvest.id == harvest_id)
        ]
        if not subject:
            raise not_found("Your share of this offer")
        if harvest_id is None:
            subject = subject[:1]
    return await _offer_net(db, offer, parties, subject, label=_offer_label(offer))
