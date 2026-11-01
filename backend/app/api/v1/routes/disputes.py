"""Disputes about lots and settlements."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app import schemas
from app.core.deps import CurrentUser, DbSession, require_roles
from app.models import User
from app.services import dispute_service

router = APIRouter(prefix="/disputes", tags=["disputes"])

Coordinator = Annotated[User, Depends(require_roles("coordinator"))]


@router.get("", response_model=list[schemas.Dispute])
async def list_disputes(
    db: DbSession,
    user: CurrentUser,
    status_filter: Annotated[schemas.DisputeStatus | None, Query(alias="status")] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[schemas.Dispute]:
    """Own raised disputes and those on the caller's lots; coordinators and admins see all."""
    disputes = await dispute_service.list_disputes(db, user, status=status_filter, limit=limit)
    return [dispute_service.dispute_out(dispute, user) for dispute in disputes]


@router.post("", response_model=schemas.Dispute, status_code=status.HTTP_201_CREATED)
async def create_dispute(
    body: schemas.DisputeCreateRequest, db: DbSession, user: CurrentUser
) -> schemas.Dispute:
    """Raise a dispute on a lot you take part in (its settlement becomes ``disputed``)."""
    dispute = await dispute_service.create_dispute(db, user, body)
    return dispute_service.dispute_out(dispute, user)


@router.patch("/{dispute_id}", response_model=schemas.Dispute)
async def update_dispute(
    dispute_id: uuid.UUID, body: schemas.DisputeUpdateRequest, db: DbSession, user: Coordinator
) -> schemas.Dispute:
    dispute = await dispute_service.update_dispute(db, user, dispute_id, body)
    return dispute_service.dispute_out(dispute, user)
