"""Transport: vehicles, route plans, transport requests, quotes, pickups and trips.

Rules: DOMAIN_RULES §2 (transport request status machine), §5 (route planning) and §8
(notifications). The module also holds the lot-participant checks shared by the delivery,
settlement and dispute services (DOMAIN_RULES §1, "Lot participants").

Every ORM object returned by a ``load``/``get`` helper here is fully loaded (``selectin``
relationships), so the ``*_out`` presenters never touch the database.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from fastapi.exceptions import RequestValidationError
from sqlalchemy import exists, or_, select

from app import schemas
from app.core.errors import conflict, forbidden, not_found
from app.core.time import utcnow
from app.models import (
    Demand,
    Lot,
    LotMember,
    Offer,
    TransportQuote,
    TransportRequest,
    TransportStop,
    User,
    Vehicle,
)
from app.services import lot_service, pricing, routing
from app.services.audit import audit
from app.services.notify import coordinator_ids_for, notify
from app.services.presenters import farmer_display_name

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

STAFF_ROLES = frozenset({"coordinator", "admin"})
QUOTABLE_STATUSES = ("open", "quoted")
"""Requests still accepting quotes."""
TRIP_STATUSES = ("booked", "in_progress")
"""Requests with a booked transporter whose trip is not finished."""
MIN_VEHICLE_CAPACITY_KG = Decimal("100")
MAX_VEHICLE_CAPACITY_KG = Decimal("40000")
PICKUP_TOLERANCE = Decimal("1.05")
"""A stop may weigh in at most 5% above the planned quantity."""


# ─────────────────────────────── Helpers ───────────────────────────────


def invalid_input(loc: Sequence[str | int], msg: str, value: Any = None) -> RequestValidationError:
    """A ``422`` with the standard validation body, for rules checked against stored state."""
    return RequestValidationError(
        [{"type": "value_error", "loc": tuple(loc), "msg": msg, "input": value}]
    )


def is_staff(user: User) -> bool:
    return user.role in STAFF_ROLES


def org_or_name(user: User) -> str:
    """Business name for buyers and transporters, falling back to the person's name."""
    return user.organization_name or user.full_name


def active_members(lot: Lot) -> list[LotMember]:
    """Members whose consent is not ``declined`` (they make up the lot's quantity)."""
    return [member for member in lot.members if member.consent_status != "declined"]


def money(value: Decimal | float | int | None) -> float:
    """Decimal → 2-dp float for the API."""
    return float(pricing.round_money(value if value is not None else 0))


def opt_money(value: Decimal | float | int | None) -> float | None:
    return None if value is None else money(value)


def format_date(value: Any) -> str:
    """``29 Oct 2026``."""
    return value.strftime("%d %b %Y").lstrip("0")


async def lock_row(db: AsyncSession, model: Any, row_id: uuid.UUID | None) -> None:
    """``SELECT … FOR UPDATE`` one row, serialising concurrent state changes on it.

    Call it **before** loading the object, so the load sees the state committed by whichever
    request held the lock first (READ COMMITTED). A missing row locks nothing.
    """
    if row_id is not None:
        await db.execute(select(model.id).where(model.id == row_id).with_for_update())


# ─────────────────────────── Lot participants ──────────────────────────


@dataclass(frozen=True)
class LotAccess:
    """What a viewer may do with a lot (DOMAIN_RULES §1)."""

    visible: bool
    """May read the lot's operations (plan, delivery, disputes)."""
    active: bool
    """An acting participant: member farmer, accepted buyer, booked transporter or staff."""
    is_accepted_buyer: bool = False
    is_booked_transporter: bool = False


NO_ACCESS = LotAccess(visible=False, active=False)


async def booked_transporter_id(db: AsyncSession, lot_id: uuid.UUID) -> uuid.UUID | None:
    """The transporter whose quote is booked on the lot's (non-cancelled) transport request."""
    return await db.scalar(
        select(TransportQuote.transporter_id)
        .join(TransportRequest, TransportRequest.booked_quote_id == TransportQuote.id)
        .where(TransportRequest.lot_id == lot_id, TransportRequest.status != "cancelled")
        .limit(1)
    )


async def lot_access(db: AsyncSession, lot: Lot, viewer: User) -> LotAccess:
    """Participants: member farmers (consent ≠ declined), the accepted offer's buyer, buyers with
    an offer on the lot (read-only), the booked transporter, coordinators and admins."""
    if is_staff(viewer):
        return LotAccess(visible=True, active=True)
    if viewer.role == "farmer":
        member = any(m.farmer_id == viewer.id for m in active_members(lot))
        return LotAccess(visible=member, active=member)
    if viewer.role == "buyer":
        offer = lot.accepted_offer
        if offer is not None and offer.buyer_id == viewer.id:
            return LotAccess(visible=True, active=True, is_accepted_buyer=True)
        has_offer = await db.scalar(
            select(exists().where(Offer.lot_id == lot.id, Offer.buyer_id == viewer.id))
        )
        return LotAccess(visible=bool(has_offer), active=False)
    if viewer.role == "transporter":
        booked = await booked_transporter_id(db, lot.id) == viewer.id
        return LotAccess(visible=booked, active=booked, is_booked_transporter=booked)
    return NO_ACCESS


async def load_lot_for_participant(
    db: AsyncSession, lot_id: uuid.UUID, viewer: User
) -> tuple[Lot, LotAccess]:
    """The lot and the viewer's access; 404 when it is missing or the viewer is not a participant."""
    lot = await db.get(Lot, lot_id)
    if lot is None:
        raise not_found("Lot")
    access = await lot_access(db, lot, viewer)
    if not access.visible:
        raise not_found("Lot")
    return lot, access


def participant_lot_ids_query(viewer: User) -> Any:
    """``SELECT lot_id`` of the lots ``viewer`` acts in (not for staff, who see every lot)."""
    if viewer.role == "farmer":
        return select(LotMember.lot_id).where(
            LotMember.farmer_id == viewer.id, LotMember.consent_status != "declined"
        )
    if viewer.role == "buyer":
        return (
            select(Lot.id)
            .join(Offer, Offer.id == Lot.accepted_offer_id)
            .where(Offer.buyer_id == viewer.id)
        )
    if viewer.role == "transporter":
        return (
            select(TransportRequest.lot_id)
            .join(TransportQuote, TransportQuote.id == TransportRequest.booked_quote_id)
            .where(TransportQuote.transporter_id == viewer.id)
        )
    return select(Lot.id).where(Lot.id.is_(None))


# ─────────────────────────────── Vehicles ──────────────────────────────


def vehicle_out(vehicle: Vehicle) -> schemas.Vehicle:
    return schemas.Vehicle(
        id=vehicle.id,
        transporter_id=vehicle.transporter_id,
        vehicle_type=vehicle.vehicle_type,
        registration_number=vehicle.registration_number,
        capacity_kg=money(vehicle.capacity_kg),
        has_refrigeration=vehicle.has_refrigeration,
        base_charge=money(vehicle.base_charge),
        per_km_rate=money(vehicle.per_km_rate),
        is_active=vehicle.is_active,
        created_at=vehicle.created_at,
    )


def _check_capacity(capacity_kg: float) -> Decimal:
    capacity = pricing.to_decimal(capacity_kg)
    if not MIN_VEHICLE_CAPACITY_KG <= capacity <= MAX_VEHICLE_CAPACITY_KG:
        raise invalid_input(
            ("body", "capacity_kg"),
            "Vehicle capacity must be between 100 and 40,000 kg",
            capacity_kg,
        )
    return pricing.round_money(capacity)


async def _ensure_registration_free(
    db: AsyncSession, registration_number: str, vehicle_id: uuid.UUID | None = None
) -> None:
    query = select(Vehicle.id).where(Vehicle.registration_number == registration_number)
    if vehicle_id is not None:
        query = query.where(Vehicle.id != vehicle_id)
    if await db.scalar(query.limit(1)) is not None:
        raise conflict(f"Vehicle {registration_number} is already registered")


async def list_vehicles(db: AsyncSession, transporter: User) -> list[Vehicle]:
    return list(
        await db.scalars(
            select(Vehicle)
            .where(Vehicle.transporter_id == transporter.id)
            .order_by(Vehicle.created_at.desc(), Vehicle.id.desc())
        )
    )


async def create_vehicle(
    db: AsyncSession, transporter: User, body: schemas.VehicleCreateRequest
) -> Vehicle:
    capacity = _check_capacity(body.capacity_kg)
    await _ensure_registration_free(db, body.registration_number)
    vehicle = Vehicle(
        transporter_id=transporter.id,
        vehicle_type=body.vehicle_type,
        registration_number=body.registration_number,
        capacity_kg=capacity,
        has_refrigeration=body.has_refrigeration,
        base_charge=pricing.round_money(body.base_charge),
        per_km_rate=pricing.round_money(body.per_km_rate),
        is_active=True,
    )
    db.add(vehicle)
    await db.flush()
    await audit(
        db,
        transporter,
        "vehicle.create",
        "vehicle",
        vehicle.id,
        f"Added vehicle {vehicle.registration_number} ({pricing.vehicle_label(vehicle.vehicle_type)})",
    )
    return vehicle


async def _own_vehicle(db: AsyncSession, transporter: User, vehicle_id: uuid.UUID) -> Vehicle:
    vehicle = await db.get(Vehicle, vehicle_id)
    if vehicle is None or vehicle.transporter_id != transporter.id:
        raise not_found("Vehicle")
    return vehicle


async def update_vehicle(
    db: AsyncSession,
    transporter: User,
    vehicle_id: uuid.UUID,
    body: schemas.VehicleUpdateRequest,
) -> Vehicle:
    vehicle = await _own_vehicle(db, transporter, vehicle_id)
    changes = body.model_dump(exclude_unset=True)
    if "capacity_kg" in changes:
        changes["capacity_kg"] = _check_capacity(changes["capacity_kg"])
    if "registration_number" in changes:
        await _ensure_registration_free(db, changes["registration_number"], vehicle.id)
    for field in ("base_charge", "per_km_rate"):
        if field in changes:
            changes[field] = pricing.round_money(changes[field])
    for field, value in changes.items():
        setattr(vehicle, field, value)
    await db.flush()
    await audit(
        db,
        transporter,
        "vehicle.update",
        "vehicle",
        vehicle.id,
        f"Updated vehicle {vehicle.registration_number}",
        {"fields": sorted(changes)},
    )
    return vehicle


async def delete_vehicle(db: AsyncSession, transporter: User, vehicle_id: uuid.UUID) -> None:
    vehicle = await _own_vehicle(db, transporter, vehicle_id)
    on_trip = await db.scalar(
        select(
            exists().where(
                TransportQuote.vehicle_id == vehicle.id,
                TransportQuote.status == "accepted",
                TransportQuote.request_id == TransportRequest.id,
                TransportRequest.status.in_(TRIP_STATUSES),
            )
        )
    )
    if on_trip:
        raise conflict("This vehicle is booked on an active trip")
    registration = vehicle.registration_number
    await db.delete(vehicle)
    await db.flush()
    await audit(
        db, transporter, "vehicle.delete", "vehicle", vehicle_id, f"Removed vehicle {registration}"
    )


# ─────────────────────────────── Planning ──────────────────────────────


@dataclass(frozen=True)
class _Destination:
    name: str
    latitude: float
    longitude: float
    extra_km: Decimal
    """Added to the route when the real destination is unknown (DOMAIN_RULES §3 fallback)."""


@dataclass(frozen=True)
class _PlannedStop:
    member: LotMember
    sequence: int
    latitude: float
    longitude: float


@dataclass(frozen=True)
class _Plan:
    stops: list[_PlannedStop]
    destination: _Destination
    total_kg: Decimal
    total_km: Decimal
    estimate: pricing.TransportEstimate
    points: list[tuple[float, float]]


def _stop_coordinates(member: LotMember, lot: Lot) -> tuple[float, float]:
    """The farm (harvest location, else the farmer's profile), else the collection point."""
    harvest = member.harvest
    if harvest.latitude is not None and harvest.longitude is not None:
        return harvest.latitude, harvest.longitude
    farmer = member.farmer
    if farmer.latitude is not None and farmer.longitude is not None:
        return farmer.latitude, farmer.longitude
    return lot.collection_latitude, lot.collection_longitude


async def _destination(db: AsyncSession, lot: Lot) -> _Destination:
    """Accepted offer's delivery point → the demand's → the collection point (+ baseline km)."""
    offer = lot.accepted_offer
    if offer is not None and offer.delivery_latitude is not None:
        assert offer.delivery_longitude is not None
        return _Destination(
            offer.delivery_location, offer.delivery_latitude, offer.delivery_longitude, Decimal(0)
        )
    demand_id = (offer.demand_id if offer is not None else None) or lot.demand_id
    if demand_id is not None:
        demand = await db.get(Demand, demand_id)
        if demand is not None and demand.delivery_latitude is not None:
            assert demand.delivery_longitude is not None
            return _Destination(
                demand.delivery_location,
                demand.delivery_latitude,
                demand.delivery_longitude,
                Decimal(0),
            )
    return _Destination(
        lot.collection_point_name,
        lot.collection_latitude,
        lot.collection_longitude,
        pricing.BASELINE_DISTANCE_KM,
    )


async def _plan(db: AsyncSession, lot: Lot) -> _Plan:
    members = active_members(lot)
    if not members:
        raise conflict("This lot has no members to collect from")
    by_id = {member.id: member for member in members}
    route_stops = []
    for member in members:
        latitude, longitude = _stop_coordinates(member, lot)
        route_stops.append(
            routing.RouteStop(
                id=member.id,
                latitude=latitude,
                longitude=longitude,
                quantity_kg=member.quantity_kg,
                label=member.harvest.village or member.farmer.village or lot.collection_point_name,
            )
        )
    destination = await _destination(db, lot)
    route = routing.plan_route(route_stops, (destination.latitude, destination.longitude))
    total_kg = sum((member.quantity_kg for member in members), Decimal(0))
    total_km = route.total_distance_km + destination.extra_km
    estimate = pricing.estimate_transport_cost(total_kg, total_km, lot.crop.requires_refrigeration)
    stops = [
        _PlannedStop(by_id[stop.id], index, stop.latitude, stop.longitude)
        for index, stop in enumerate(route.ordered_stops, start=1)
    ]
    return _Plan(stops, destination, total_kg, total_km, estimate, route.points)


async def build_transport_plan(
    db: AsyncSession, lot: Lot, viewer: User | None = None
) -> schemas.TransportPlan:
    """Route, vehicle and cost estimate for collecting a lot's members (DOMAIN_RULES §5).

    Stops are the lot's non-declined members in visiting order; in this preview each stop's
    ``id`` is the member id. Farmer names are masked unless ``viewer`` may see them in full.
    """
    plan = await _plan(db, lot)
    reveal = False
    if viewer is not None and viewer.role == "transporter":
        reveal = await booked_transporter_id(db, lot.id) == viewer.id
    estimate = plan.estimate
    return schemas.TransportPlan(
        lot_id=lot.id,
        stops=[
            schemas.PickupStop(
                id=stop.member.id,
                sequence=stop.sequence,
                member_id=stop.member.id,
                farmer_name=farmer_display_name(stop.member.farmer, viewer, reveal=reveal),
                village=stop.member.harvest.village or stop.member.farmer.village,
                latitude=stop.latitude,
                longitude=stop.longitude,
                quantity_kg=money(stop.member.quantity_kg),
                status="pending",
                picked_kg=None,
                picked_up_at=None,
            )
            for stop in plan.stops
        ],
        destination_name=plan.destination.name,
        destination_latitude=plan.destination.latitude,
        destination_longitude=plan.destination.longitude,
        total_distance_km=float(plan.total_km),
        suggested_vehicle_type=estimate.vehicle_type,
        vehicle_capacity_kg=float(estimate.capacity_kg),
        trips_needed=estimate.trips,
        utilization_pct=float(estimate.utilization_pct),
        estimated_cost=float(estimate.cost_total),
        cost_per_kg=float(estimate.cost_per_kg),
        route=[(latitude, longitude) for latitude, longitude in plan.points],
    )


# ───────────────────────────── Presentation ────────────────────────────


def quote_out(quote: TransportQuote) -> schemas.TransportQuote:
    transporter = quote.transporter
    return schemas.TransportQuote(
        id=quote.id,
        request_id=quote.request_id,
        transporter_id=quote.transporter_id,
        transporter_name=org_or_name(transporter),
        transporter_verified=transporter.verification_status == "verified",
        vehicle_id=quote.vehicle_id,
        vehicle_type=quote.vehicle_type,
        capacity_kg=money(quote.capacity_kg),
        price_total=money(quote.price_total),
        price_per_kg=money(quote.price_per_kg),
        eta_hours=float(quote.eta_hours),
        notes=quote.notes,
        status=quote.status,
        created_at=quote.created_at,
    )


def stop_out(stop: TransportStop, viewer: User, *, reveal: bool) -> schemas.PickupStop:
    return schemas.PickupStop(
        id=stop.id,
        sequence=stop.sequence,
        member_id=stop.member_id,
        farmer_name=farmer_display_name(stop.member.farmer, viewer, reveal=reveal),
        village=stop.village,
        latitude=stop.latitude,
        longitude=stop.longitude,
        quantity_kg=money(stop.quantity_kg),
        status=stop.status,
        picked_kg=opt_money(stop.picked_kg),
        picked_up_at=stop.picked_up_at,
    )


def _request_out(req: TransportRequest, viewer: User) -> schemas.TransportRequest:
    booked = req.booked_quote
    is_booked_transporter = booked is not None and booked.transporter_id == viewer.id
    if is_staff(viewer):
        quotes = list(req.quotes)
    elif viewer.role == "transporter":
        quotes = [quote for quote in req.quotes if quote.transporter_id == viewer.id]
    else:
        quotes = [booked] if booked is not None else []
    lot = req.lot
    return schemas.TransportRequest(
        id=req.id,
        lot_id=req.lot_id,
        lot_code=lot.code,
        crop_name=lot.crop.name,
        total_quantity_kg=money(req.total_quantity_kg),
        pickup_date=req.pickup_date,
        requires_refrigeration=req.requires_refrigeration,
        stops=[stop_out(stop, viewer, reveal=is_booked_transporter) for stop in req.stops],
        destination_name=req.destination_name,
        destination_latitude=req.destination_latitude,
        destination_longitude=req.destination_longitude,
        estimated_distance_km=float(req.estimated_distance_km),
        suggested_vehicle_type=req.suggested_vehicle_type,
        estimated_cost=money(req.estimated_cost),
        status=req.status,
        quotes=[quote_out(quote) for quote in quotes],
        booked_quote_id=booked.id if booked is not None else None,
        transporter_name=org_or_name(booked.transporter) if booked is not None else None,
        notes=req.notes,
        created_at=req.created_at,
    )


async def transport_request_out(
    db: AsyncSession, req: TransportRequest, viewer: User
) -> schemas.TransportRequest:
    """The API ``TransportRequest`` as ``viewer`` may see it.

    Quotes: coordinators and admins see all, a transporter only their own, everyone else only
    the booked one. Farmer names are full for coordinators, admins, the farmer themself and the
    booked transporter, masked otherwise.
    """
    return _request_out(req, viewer)


def transport_requests_out(
    reqs: Sequence[TransportRequest], viewer: User
) -> list[schemas.TransportRequest]:
    """Batch ``transport_request_out`` (relationships are eager, so no queries)."""
    return [_request_out(req, viewer) for req in reqs]


# ──────────────────────────── Transport requests ───────────────────────


def _transporter_has_quote(req: TransportRequest, transporter: User) -> bool:
    return any(quote.transporter_id == transporter.id for quote in req.quotes)


async def _can_view_request(db: AsyncSession, req: TransportRequest, viewer: User) -> bool:
    if is_staff(viewer):
        return True
    if viewer.role == "transporter":
        return req.status in QUOTABLE_STATUSES or _transporter_has_quote(req, viewer)
    lot = req.lot
    if viewer.role == "farmer":
        return any(member.farmer_id == viewer.id for member in active_members(lot))
    if viewer.role == "buyer":
        offer = lot.accepted_offer
        return offer is not None and offer.buyer_id == viewer.id
    return False


async def get_request_for_viewer(
    db: AsyncSession, request_id: uuid.UUID, viewer: User
) -> TransportRequest:
    """A transport request the viewer may see; 404 otherwise."""
    req = await db.get(TransportRequest, request_id)
    if req is None or not await _can_view_request(db, req, viewer):
        raise not_found("Transport request")
    return req


async def list_requests(
    db: AsyncSession,
    viewer: User,
    *,
    status: schemas.TransportRequestStatus | None = None,
    mine: bool = False,
    limit: int = 100,
) -> list[TransportRequest]:
    """Requests visible to ``viewer``, newest first.

    Transporters see open/quoted requests plus those they quoted on (``mine`` → only the
    latter); coordinators and admins see all (``mine`` → those they created); farmers and buyers
    see the requests of their lots.
    """
    query = select(TransportRequest)
    if is_staff(viewer):
        if mine:
            query = query.where(TransportRequest.requested_by_id == viewer.id)
    elif viewer.role == "transporter":
        own = exists().where(
            TransportQuote.request_id == TransportRequest.id,
            TransportQuote.transporter_id == viewer.id,
        )
        query = query.where(
            own if mine else or_(TransportRequest.status.in_(QUOTABLE_STATUSES), own)
        )
    else:
        query = query.where(TransportRequest.lot_id.in_(participant_lot_ids_query(viewer)))
    if status is not None:
        query = query.where(TransportRequest.status == status)
    query = query.order_by(TransportRequest.created_at.desc(), TransportRequest.id.desc())
    return list(await db.scalars(query.limit(limit)))


def _member_farmer_ids(lot: Lot) -> list[uuid.UUID]:
    return list(dict.fromkeys(member.farmer_id for member in active_members(lot)))


async def create_request(
    db: AsyncSession, coordinator: User, body: schemas.TransportRequestCreateRequest
) -> TransportRequest:
    """Open a transport request for a ``mandimate_delivery`` lot whose offer was accepted."""
    await lock_row(db, Lot, body.lot_id)  # one live request per lot, even under concurrency
    lot = await db.get(Lot, body.lot_id)
    if lot is None:
        raise not_found("Lot")
    if lot.status != "offer_accepted":
        raise conflict("Transport can be requested only for a lot whose offer was accepted")
    if lot.pickup_terms != "mandimate_delivery":
        raise conflict("The buyer collects this lot: it does not need MandiMate transport")
    existing = await db.scalar(
        select(TransportRequest.id)
        .where(TransportRequest.lot_id == lot.id, TransportRequest.status != "cancelled")
        .limit(1)
    )
    if existing is not None:
        raise conflict("This lot already has a transport request")

    plan = await _plan(db, lot)
    req = TransportRequest(
        lot=lot,
        requested_by_id=coordinator.id,
        total_quantity_kg=pricing.round_money(plan.total_kg),
        pickup_date=lot.pickup_date,
        requires_refrigeration=lot.crop.requires_refrigeration,
        destination_name=plan.destination.name,
        destination_latitude=plan.destination.latitude,
        destination_longitude=plan.destination.longitude,
        estimated_distance_km=plan.total_km,
        suggested_vehicle_type=plan.estimate.vehicle_type,
        estimated_cost=plan.estimate.cost_total,
        status="open",
        notes=body.notes,
        stops=[
            TransportStop(
                member=stop.member,
                sequence=stop.sequence,
                village=stop.member.harvest.village or stop.member.farmer.village,
                latitude=stop.latitude,
                longitude=stop.longitude,
                quantity_kg=pricing.round_money(stop.member.quantity_kg),
                status="pending",
            )
            for stop in plan.stops
        ],
        quotes=[],
    )
    db.add(req)
    await db.flush()

    transporter_ids = await db.scalars(
        select(User.id).where(User.role == "transporter", User.is_active.is_(True))
    )
    await notify(
        db,
        transporter_ids,
        "pickup",
        "New transport request",
        f"{pricing.format_number(plan.total_kg)} kg of {lot.crop.name} from "
        f"{lot.collection_point_name} to {plan.destination.name} on {format_date(lot.pickup_date)}"
        f" ({len(plan.stops)} pickups, about {pricing.format_number(plan.total_km)} km).",
        f"/app/transporter/requests/{req.id}",
    )
    await audit(
        db,
        coordinator,
        "transport_request.create",
        "transport_request",
        req.id,
        f"Requested transport for lot {lot.code}",
        {
            "lot_id": lot.id,
            "total_kg": plan.total_kg,
            "distance_km": plan.total_km,
            "estimated_cost": plan.estimate.cost_total,
        },
    )
    return req


async def submit_quote(
    db: AsyncSession,
    transporter: User,
    request_id: uuid.UUID,
    body: schemas.QuoteCreateRequest,
) -> TransportQuote:
    """A transporter's price for an open request (one submitted quote per transporter)."""
    req = await get_request_for_viewer(db, request_id, transporter)
    if req.status not in QUOTABLE_STATUSES:
        raise conflict("This transport request is no longer accepting quotes")
    if any(q.transporter_id == transporter.id and q.status == "submitted" for q in req.quotes):
        raise conflict("You already have an active quote on this request; withdraw it first")
    vehicle: Vehicle | None = None
    if body.vehicle_id is not None:
        vehicle = await db.get(Vehicle, body.vehicle_id)
        if vehicle is None or vehicle.transporter_id != transporter.id:
            raise not_found("Vehicle")
        if not vehicle.is_active:
            raise conflict("This vehicle is marked inactive")
    refrigerated = body.vehicle_type == "reefer_truck" or (
        vehicle is not None and vehicle.has_refrigeration
    )
    if req.requires_refrigeration and not refrigerated:
        raise invalid_input(
            ("body", "vehicle_type"), "This load needs a refrigerated vehicle", body.vehicle_type
        )

    price_total = pricing.round_money(body.price_total)
    quote = TransportQuote(
        transporter=transporter,
        vehicle_id=vehicle.id if vehicle is not None else None,
        vehicle_type=body.vehicle_type,
        capacity_kg=pricing.round_money(body.capacity_kg),
        price_total=price_total,
        price_per_kg=pricing.round_money(price_total / req.total_quantity_kg),
        eta_hours=pricing.round_money(body.eta_hours),
        notes=body.notes,
        status="submitted",
    )
    req.quotes.append(quote)
    if req.status == "open":
        req.status = "quoted"
    await db.flush()

    lot = req.lot
    await notify(
        db,
        await coordinator_ids_for(db, _member_farmer_ids(lot)),
        "pickup",
        f"New transport quote for {lot.code}",
        f"{org_or_name(transporter)} quoted {pricing.format_rupees(price_total)} "
        f"({pricing.format_rupees(quote.price_per_kg)}/kg) with a "
        f"{pricing.vehicle_label(body.vehicle_type).lower()}.",
        "/app/coordinator/transport",
    )
    await audit(
        db,
        transporter,
        "transport_quote.create",
        "transport_quote",
        quote.id,
        f"Quoted {pricing.format_rupees(price_total)} for lot {lot.code}",
        {"request_id": req.id, "price_total": price_total, "vehicle_type": body.vehicle_type},
    )
    return quote


async def _load_quote(
    db: AsyncSession, quote_id: uuid.UUID
) -> tuple[TransportQuote, TransportRequest]:
    """The quote and its request, with the request row locked (accept and withdraw race)."""
    await lock_row(
        db,
        TransportRequest,
        await db.scalar(select(TransportQuote.request_id).where(TransportQuote.id == quote_id)),
    )
    quote = await db.get(TransportQuote, quote_id)
    if quote is None:
        raise not_found("Quote")
    req = await db.get(TransportRequest, quote.request_id)
    assert req is not None
    return quote, req


async def accept_quote(
    db: AsyncSession, coordinator: User, quote_id: uuid.UUID
) -> TransportRequest:
    """Book a quote: request ``booked``, other quotes ``rejected``, lot ``transport_booked``."""
    quote, req = await _load_quote(db, quote_id)
    if quote.status != "submitted":
        raise conflict("Only a submitted quote can be accepted")
    if req.status not in QUOTABLE_STATUSES:
        raise conflict("This transport request is already booked")
    lot = req.lot
    if lot.status != "offer_accepted":
        raise conflict("Transport can be booked only for a lot whose offer was accepted")

    quote.status = "accepted"
    rejected = []
    for other in req.quotes:
        if other.id != quote.id and other.status == "submitted":
            other.status = "rejected"
            rejected.append(other.transporter_id)
    req.status = "booked"
    req.booked_quote = quote
    lot.status = "transport_booked"
    await db.flush()

    pickup_day = format_date(req.pickup_date)
    transporter = quote.transporter
    await notify(
        db,
        [quote.transporter_id],
        "pickup",
        f"Trip booked: lot {lot.code}",
        f"Your quote of {pricing.format_rupees(quote.price_total)} was accepted. "
        f"Pickups start on {pickup_day}.",
        f"/app/transporter/trips/{req.id}",
    )
    await notify(
        db,
        _member_farmer_ids(lot),
        "pickup",
        f"Pickup on {pickup_day}",
        f"{org_or_name(transporter)} will collect your {lot.crop.name} for lot {lot.code} "
        f"on {pickup_day}. Keep it packed and ready.",
        f"/app/farmer/lots/{lot.id}",
    )
    if rejected:
        await notify(
            db,
            rejected,
            "pickup",
            f"Quote not selected: lot {lot.code}",
            "Another transporter was booked for this trip.",
            f"/app/transporter/requests/{req.id}",
        )
    await audit(
        db,
        coordinator,
        "transport_quote.accept",
        "transport_request",
        req.id,
        f"Booked {org_or_name(transporter)} for lot {lot.code} at "
        f"{pricing.format_rupees(quote.price_total)}",
        {"quote_id": quote.id, "price_total": quote.price_total},
    )
    return req


async def withdraw_quote(
    db: AsyncSession, transporter: User, quote_id: uuid.UUID
) -> TransportQuote:
    """The quoting transporter withdraws a submitted quote."""
    quote, req = await _load_quote(db, quote_id)
    if quote.transporter_id != transporter.id:
        raise not_found("Quote")
    if quote.status != "submitted":
        raise conflict("Only a submitted quote can be withdrawn")
    quote.status = "withdrawn"
    if req.status == "quoted" and not any(q.status == "submitted" for q in req.quotes):
        req.status = "open"
    await db.flush()
    await audit(
        db,
        transporter,
        "transport_quote.withdraw",
        "transport_quote",
        quote.id,
        f"Withdrew quote for lot {req.lot.code}",
    )
    return quote


def _ensure_booked_transporter(req: TransportRequest, transporter: User) -> None:
    booked = req.booked_quote
    if booked is None or booked.transporter_id != transporter.id:
        raise forbidden("Only the booked transporter can update this trip")


async def confirm_pickup(
    db: AsyncSession,
    transporter: User,
    request_id: uuid.UUID,
    stop_id: uuid.UUID,
    body: schemas.PickupConfirmRequest,
) -> TransportRequest:
    """Record the weight collected at one farm; the first pickup starts the trip."""
    req = await get_request_for_viewer(db, request_id, transporter)
    _ensure_booked_transporter(req, transporter)
    if req.status not in TRIP_STATUSES:
        raise conflict("Pickups can be confirmed only on a booked trip that is not finished")
    if req.lot.status not in ("transport_booked", "in_transit"):
        raise conflict("The delivery of this lot has already been recorded")
    stop = next((stop for stop in req.stops if stop.id == stop_id), None)
    if stop is None:
        raise not_found("Stop")
    if stop.status != "pending":
        raise conflict(f"This stop is already {stop.status.replace('_', ' ')}")
    limit = stop.quantity_kg * PICKUP_TOLERANCE
    picked = pricing.to_decimal(body.picked_kg)
    if picked > limit:
        raise invalid_input(
            ("body", "picked_kg"),
            f"Picked quantity cannot exceed {pricing.format_number(limit)} kg "
            f"(planned {pricing.format_number(stop.quantity_kg)} kg + 5%)",
            body.picked_kg,
        )
    picked = pricing.round_money(picked)
    now = utcnow()
    stop.status = "picked_up"
    stop.picked_kg = picked
    stop.picked_up_at = now
    stop.note = body.note
    member = stop.member
    member.dispatched_kg = picked
    lot = req.lot
    if req.status == "booked":
        req.status = "in_progress"
        req.started_at = now
    if lot.status == "transport_booked":
        lot.status = "in_transit"
    await db.flush()
    for harvest_id in dict.fromkeys(m.harvest_id for m in active_members(lot)):
        await lot_service.sync_harvest_status(db, harvest_id)

    await notify(
        db,
        [member.farmer_id],
        "pickup",
        f"Picked up: {pricing.format_number(picked)} kg",
        f"{org_or_name(transporter)} collected {pricing.format_number(picked)} kg of "
        f"{lot.crop.name} from you for lot {lot.code}.",
        f"/app/farmer/lots/{lot.id}",
    )
    await audit(
        db,
        transporter,
        "transport.pickup",
        "transport_request",
        req.id,
        f"Picked up {pricing.format_number(picked)} kg at stop {stop.sequence} of lot {lot.code}",
        {"stop_id": stop.id, "member_id": member.id, "picked_kg": picked},
    )
    return req


async def complete_trip(
    db: AsyncSession,
    transporter: User,
    request_id: uuid.UUID,
    body: schemas.TripCompleteRequest,
) -> TransportRequest:
    """Finish the trip: stops still pending are ``skipped`` (nothing dispatched from them)."""
    req = await get_request_for_viewer(db, request_id, transporter)
    _ensure_booked_transporter(req, transporter)
    if req.status == "booked":
        raise conflict("Confirm at least one pickup before completing the trip")
    if req.status != "in_progress":
        raise conflict("This trip is not in progress")
    skipped = 0
    for stop in req.stops:
        if stop.status == "pending":
            stop.status = "skipped"
            if stop.member.delivered_kg is None:  # weights already recorded stay as they are
                stop.member.dispatched_kg = Decimal("0.00")
            skipped += 1
    req.status = "completed"
    req.completed_at = utcnow()
    req.completion_note = body.note
    await db.flush()

    lot = req.lot
    picked_kg = sum((s.picked_kg or Decimal(0) for s in req.stops), Decimal(0))
    summary = f"{pricing.format_number(picked_kg)} kg of {lot.crop.name} delivered to " + (
        f"{req.destination_name}. Record the delivery and quality check."
    )
    await notify(
        db,
        await coordinator_ids_for(db, _member_farmer_ids(lot)),
        "delivery",
        f"Trip completed: lot {lot.code}",
        summary,
        f"/app/coordinator/lots/{lot.id}",
    )
    if lot.accepted_offer is not None:
        await notify(
            db,
            [lot.accepted_offer.buyer_id],
            "delivery",
            f"Consignment arrived: lot {lot.code}",
            summary,
            f"/app/buyer/orders/{lot.id}",
        )
    await audit(
        db,
        transporter,
        "transport.complete",
        "transport_request",
        req.id,
        f"Completed trip for lot {lot.code}",
        {"picked_kg": picked_kg, "skipped_stops": skipped},
    )
    return req
