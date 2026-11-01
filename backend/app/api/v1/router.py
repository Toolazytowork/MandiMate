"""API v1 router: every area router under ``/api/v1``, plus the health check."""

import asyncio
import logging
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api.v1.routes import (
    admin,
    ai,
    auth,
    calculator,
    coordinator,
    crops,
    dashboards,
    deliveries,
    demands,
    disputes,
    earnings,
    harvests,
    insights,
    lots,
    market,
    notifications,
    offers,
    public,
    settlements,
    supply,
    timeline,
    transport,
    users,
)
from app.core.config import settings
from app.core.deps import DbSession

logger = logging.getLogger(__name__)

HEALTH_DB_TIMEOUT_SECONDS = 3.0


class HealthStatus(BaseModel):
    """``HealthStatus`` from api.ts. Declared here so the health check never depends on the
    rest of the API surface being importable."""

    status: Literal["ok", "degraded"]
    database: Literal["ok", "error"]
    ai_mode: Literal["live", "mock"]
    version: str


health_router = APIRouter(tags=["health"])


@health_router.get("/health", summary="Service health")
async def health(db: DbSession) -> HealthStatus:
    """Liveness plus a ``SELECT 1`` database probe; ``degraded`` when the database is down."""
    try:
        async with asyncio.timeout(HEALTH_DB_TIMEOUT_SECONDS):
            await db.execute(text("SELECT 1"))
        database: Literal["ok", "error"] = "ok"
    except (SQLAlchemyError, OSError):
        logger.warning("Health check: database unavailable", exc_info=True)
        await db.rollback()
        database = "error"
    return HealthStatus(
        status="ok" if database == "ok" else "degraded",
        database=database,
        ai_mode=settings.ai_effective_mode,
        version=settings.APP_VERSION,
    )


AREA_ROUTERS = (
    auth.router,
    users.router,
    crops.router,
    market.router,
    harvests.router,
    demands.router,
    supply.router,
    calculator.router,
    lots.router,
    offers.router,
    timeline.router,
    transport.router,
    deliveries.router,
    settlements.router,
    disputes.router,
    dashboards.router,
    earnings.router,
    insights.router,
    notifications.router,
    coordinator.router,
    admin.router,
    ai.router,
    public.router,
)

api_router = APIRouter(prefix=settings.API_PREFIX)
api_router.include_router(health_router)
for area_router in AREA_ROUTERS:
    api_router.include_router(area_router)
