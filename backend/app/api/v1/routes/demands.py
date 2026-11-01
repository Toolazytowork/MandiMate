"""Buyer requirements."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app import schemas
from app.core.deps import CurrentUser, DbSession, require_roles
from app.models import User
from app.services import demand_service

router = APIRouter(prefix="/demands", tags=["demands"])


@router.get("", response_model=list[schemas.Demand], summary="List requirements")
async def list_demands(
    db: DbSession,
    user: Annotated[User, Depends(require_roles("buyer", "farmer", "coordinator"))],
    status: schemas.DemandStatus | None = None,
    crop_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[schemas.Demand]:
    """Buyers: their own. Farmers: open requirements (read-only). Coordinators/admins: all."""
    demands = await demand_service.list_demands(
        db, user, status=status, crop_id=crop_id, limit=limit
    )
    return await demand_service.demands_out(db, demands)


@router.post(
    "",
    response_model=schemas.Demand,
    status_code=status.HTTP_201_CREATED,
    summary="Post a requirement",
)
async def create_demand(
    req: schemas.DemandCreateRequest,
    db: DbSession,
    user: Annotated[User, Depends(require_roles("buyer"))],
) -> schemas.Demand:
    """Minimum quantity defaults to the quantity; maximum rejection to the crop's default."""
    demand = await demand_service.create_demand(db, req, user)
    return await demand_service.demand_out(db, demand)


@router.get("/{demand_id}", response_model=schemas.Demand, summary="Get a requirement")
async def get_demand(demand_id: uuid.UUID, db: DbSession, user: CurrentUser) -> schemas.Demand:
    """The owner buyer, farmers while it is open, coordinators and admins."""
    demand = await demand_service.get_demand_for_viewer(db, demand_id, user)
    return await demand_service.demand_out(db, demand)


@router.patch("/{demand_id}", response_model=schemas.Demand, summary="Edit a requirement")
async def update_demand(
    demand_id: uuid.UUID, req: schemas.DemandUpdateRequest, db: DbSession, user: CurrentUser
) -> schemas.Demand:
    """The owner buyer, while the requirement is open."""
    demand = await demand_service.get_demand_for_viewer(db, demand_id, user)
    demand = await demand_service.update_demand(db, demand, req, user)
    return await demand_service.demand_out(db, demand)


@router.post("/{demand_id}/cancel", response_model=schemas.Demand, summary="Cancel a requirement")
async def cancel_demand(demand_id: uuid.UUID, db: DbSession, user: CurrentUser) -> schemas.Demand:
    """The owner buyer or a coordinator, while the requirement is open."""
    demand = await demand_service.get_demand_for_viewer(db, demand_id, user)
    demand = await demand_service.cancel_demand(db, demand, user)
    return await demand_service.demand_out(db, demand)
