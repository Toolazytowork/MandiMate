"""Farmer earnings history."""

from typing import Annotated

from fastapi import APIRouter, Depends

from app import schemas
from app.core.deps import DbSession, require_roles
from app.models import User
from app.services import earnings_service

router = APIRouter(prefix="/earnings", tags=["earnings"])


@router.get("", response_model=schemas.FarmerEarnings)
async def farmer_earnings(
    db: DbSession, user: Annotated[User, Depends(require_roles("farmer"))]
) -> schemas.FarmerEarnings:
    """Totals, the last 12 months and every sale (newest first) against the mandi baseline."""
    return await earnings_service.farmer_earnings(db, user)
