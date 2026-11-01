"""Aggregated supply for buyers."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app import schemas
from app.core.deps import DbSession, require_roles
from app.models import User
from app.services import supply_service

router = APIRouter(prefix="/supply", tags=["supply"])


@router.get("", response_model=list[schemas.SupplyItem], summary="Browse supply")
async def list_supply(
    db: DbSession,
    user: Annotated[User, Depends(require_roles("buyer", "coordinator"))],
    crop_id: uuid.UUID | None = None,
    grade: schemas.Grade | None = None,
    district: Annotated[str | None, Query(max_length=120)] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[schemas.SupplyItem]:
    """Lots open for offers and individually listed harvests with kg still available."""
    return await supply_service.list_supply(
        db, user, crop_id=crop_id, grade=grade, district=district, limit=limit
    )
