"""Assisted farmer registration and FPO views."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app import schemas
from app.core.deps import DbSession, require_roles
from app.models import User
from app.services import user_service

router = APIRouter(prefix="/coordinator", tags=["coordinator"])

Coordinator = Annotated[User, Depends(require_roles("coordinator"))]


@router.get(
    "/farmers",
    response_model=list[schemas.FarmerSummary],
    summary="Farmers of my FPO (plus unaffiliated farmers) with activity totals",
)
async def list_farmers(
    user: Coordinator, db: DbSession, limit: Annotated[int, Query(ge=1, le=500)] = 500
) -> list[schemas.FarmerSummary]:
    return await user_service.list_farmer_summaries(db, user, limit=limit)


@router.post(
    "/farmers",
    response_model=schemas.RegisteredFarmer,
    status_code=status.HTTP_201_CREATED,
    summary="Register a farmer in person (returns a one-time temporary password)",
)
async def register_farmer(
    body: schemas.RegisterFarmerRequest, user: Coordinator, db: DbSession
) -> schemas.RegisteredFarmer:
    return await user_service.register_farmer(db, user, body)
