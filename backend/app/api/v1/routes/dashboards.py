"""Role dashboards."""

from typing import Annotated

from fastapi import APIRouter, Depends

from app import schemas
from app.core.deps import DbSession, require_roles
from app.models import User
from app.services import dashboard_service

router = APIRouter(prefix="/dashboard", tags=["dashboards"])


@router.get("/farmer", response_model=schemas.FarmerDashboard)
async def farmer_dashboard(
    db: DbSession, user: Annotated[User, Depends(require_roles("farmer"))]
) -> schemas.FarmerDashboard:
    return await dashboard_service.farmer_dashboard(db, user)


@router.get("/buyer", response_model=schemas.BuyerDashboard)
async def buyer_dashboard(
    db: DbSession, user: Annotated[User, Depends(require_roles("buyer"))]
) -> schemas.BuyerDashboard:
    return await dashboard_service.buyer_dashboard(db, user)


@router.get("/transporter", response_model=schemas.TransporterDashboard)
async def transporter_dashboard(
    db: DbSession, user: Annotated[User, Depends(require_roles("transporter"))]
) -> schemas.TransporterDashboard:
    return await dashboard_service.transporter_dashboard(db, user)


@router.get("/coordinator", response_model=schemas.CoordinatorDashboard)
async def coordinator_dashboard(
    db: DbSession, user: Annotated[User, Depends(require_roles("coordinator"))]
) -> schemas.CoordinatorDashboard:
    return await dashboard_service.coordinator_dashboard(db, user)


@router.get("/admin", response_model=schemas.AdminOverview)
async def admin_overview(
    db: DbSession, user: Annotated[User, Depends(require_roles("admin"))]
) -> schemas.AdminOverview:
    return await dashboard_service.admin_overview(db)
