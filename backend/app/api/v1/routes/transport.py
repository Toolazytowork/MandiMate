"""Vehicles, transport plans, transport requests, quotes, pickups and trips."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Body, Depends, Query, Response, status

from app import schemas
from app.core.deps import CurrentUser, DbSession, require_roles
from app.models import User
from app.services import transport_service

router = APIRouter(tags=["transport"])

Transporter = Annotated[User, Depends(require_roles("transporter"))]
Coordinator = Annotated[User, Depends(require_roles("coordinator"))]
Limit = Annotated[int, Query(ge=1, le=500)]


# ─────────────────────────────── Vehicles ──────────────────────────────


@router.get("/vehicles", response_model=list[schemas.Vehicle])
async def list_vehicles(db: DbSession, user: Transporter) -> list[schemas.Vehicle]:
    """The transporter's own vehicles, newest first."""
    vehicles = await transport_service.list_vehicles(db, user)
    return [transport_service.vehicle_out(vehicle) for vehicle in vehicles]


@router.post("/vehicles", response_model=schemas.Vehicle, status_code=status.HTTP_201_CREATED)
async def create_vehicle(
    body: schemas.VehicleCreateRequest, db: DbSession, user: Transporter
) -> schemas.Vehicle:
    """Register a vehicle (registration numbers are unique; capacity 100–40,000 kg)."""
    vehicle = await transport_service.create_vehicle(db, user, body)
    return transport_service.vehicle_out(vehicle)


@router.patch("/vehicles/{vehicle_id}", response_model=schemas.Vehicle)
async def update_vehicle(
    vehicle_id: uuid.UUID, body: schemas.VehicleUpdateRequest, db: DbSession, user: Transporter
) -> schemas.Vehicle:
    vehicle = await transport_service.update_vehicle(db, user, vehicle_id, body)
    return transport_service.vehicle_out(vehicle)


@router.delete("/vehicles/{vehicle_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_vehicle(vehicle_id: uuid.UUID, db: DbSession, user: Transporter) -> Response:
    await transport_service.delete_vehicle(db, user, vehicle_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ──────────────────────────────── Plans ────────────────────────────────


@router.post("/lots/{lot_id}/transport-plan", response_model=schemas.TransportPlan)
async def transport_plan(
    lot_id: uuid.UUID, db: DbSession, user: CurrentUser
) -> schemas.TransportPlan:
    """Preview of the pickup route, vehicle and cost for a lot (not persisted)."""
    lot, _ = await transport_service.load_lot_for_participant(db, lot_id, user)
    return await transport_service.build_transport_plan(db, lot, user)


# ─────────────────────────── Transport requests ────────────────────────


@router.get("/transport-requests", response_model=list[schemas.TransportRequest])
async def list_transport_requests(
    db: DbSession,
    user: CurrentUser,
    status_filter: Annotated[schemas.TransportRequestStatus | None, Query(alias="status")] = None,
    mine: bool = False,
    limit: Limit = 100,
) -> list[schemas.TransportRequest]:
    reqs = await transport_service.list_requests(
        db, user, status=status_filter, mine=mine, limit=limit
    )
    return transport_service.transport_requests_out(reqs, user)


@router.post(
    "/transport-requests",
    response_model=schemas.TransportRequest,
    status_code=status.HTTP_201_CREATED,
)
async def create_transport_request(
    body: schemas.TransportRequestCreateRequest, db: DbSession, user: Coordinator
) -> schemas.TransportRequest:
    req = await transport_service.create_request(db, user, body)
    return await transport_service.transport_request_out(db, req, user)


@router.get("/transport-requests/{request_id}", response_model=schemas.TransportRequest)
async def get_transport_request(
    request_id: uuid.UUID, db: DbSession, user: CurrentUser
) -> schemas.TransportRequest:
    req = await transport_service.get_request_for_viewer(db, request_id, user)
    return await transport_service.transport_request_out(db, req, user)


@router.post(
    "/transport-requests/{request_id}/quotes",
    response_model=schemas.TransportQuote,
    status_code=status.HTTP_201_CREATED,
)
async def submit_quote(
    request_id: uuid.UUID, body: schemas.QuoteCreateRequest, db: DbSession, user: Transporter
) -> schemas.TransportQuote:
    quote = await transport_service.submit_quote(db, user, request_id, body)
    return transport_service.quote_out(quote)


@router.post("/transport-quotes/{quote_id}/accept", response_model=schemas.TransportRequest)
async def accept_quote(
    quote_id: uuid.UUID, db: DbSession, user: Coordinator
) -> schemas.TransportRequest:
    req = await transport_service.accept_quote(db, user, quote_id)
    return await transport_service.transport_request_out(db, req, user)


@router.post("/transport-quotes/{quote_id}/withdraw", response_model=schemas.TransportQuote)
async def withdraw_quote(
    quote_id: uuid.UUID, db: DbSession, user: Transporter
) -> schemas.TransportQuote:
    quote = await transport_service.withdraw_quote(db, user, quote_id)
    return transport_service.quote_out(quote)


@router.post(
    "/transport-requests/{request_id}/stops/{stop_id}/pickup",
    response_model=schemas.TransportRequest,
)
async def confirm_pickup(
    request_id: uuid.UUID,
    stop_id: uuid.UUID,
    body: schemas.PickupConfirmRequest,
    db: DbSession,
    user: Transporter,
) -> schemas.TransportRequest:
    req = await transport_service.confirm_pickup(db, user, request_id, stop_id, body)
    return await transport_service.transport_request_out(db, req, user)


@router.post("/transport-requests/{request_id}/complete", response_model=schemas.TransportRequest)
async def complete_trip(
    request_id: uuid.UUID,
    db: DbSession,
    user: Transporter,
    body: Annotated[schemas.TripCompleteRequest | None, Body()] = None,
) -> schemas.TransportRequest:
    req = await transport_service.complete_trip(
        db, user, request_id, body or schemas.TripCompleteRequest()
    )
    return await transport_service.transport_request_out(db, req, user)
