"""Supply and demand insights."""

from typing import Annotated

from fastapi import APIRouter, Depends

from app import schemas
from app.core.deps import DbSession, require_roles
from app.models import User
from app.services import insights_service

router = APIRouter(prefix="/insights", tags=["insights"])


@router.get("/supply-demand", response_model=schemas.SupplyDemandInsights)
async def supply_demand(
    db: DbSession, user: Annotated[User, Depends(require_roles("coordinator"))]
) -> schemas.SupplyDemandInsights:
    """Per-crop balance, the 14-day supply outlook, pilot metrics and a written summary."""
    return await insights_service.supply_demand_insights(db, user)
