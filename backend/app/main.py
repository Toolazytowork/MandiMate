"""FastAPI application factory. Run with ``uv run uvicorn app.main:app --reload``."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.v1.router import api_router, health_router
from app.core.config import settings
from app.core.database import engine
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging
from app.core.middleware import REQUEST_ID_HEADER, RequestIdMiddleware, SecurityHeadersMiddleware

logger = logging.getLogger("app")

DESCRIPTION = """
MandiMate turns small, fragmented harvests into buyer-ready pooled lots, compares offers by the
farmer's **net** earnings, coordinates consolidated transport, and tracks delivery and settlement.

* Authentication uses httpOnly cookies (`mandimate_access`, `mandimate_refresh`); API clients may send
  the access token as `Authorization: Bearer <token>`.
* Errors are `{"detail": string, "code"?: string}` (422 responses carry a list of issues).
* Money is INR rounded to 2 decimals; quantities are kilograms; timestamps are UTC.
"""

OPENAPI_TAGS = [
    {"name": "health", "description": "Service health."},
    {"name": "auth", "description": "Sign-up, login, token refresh, logout and the current user."},
    {"name": "users", "description": "Profile, password and verification requests."},
    {"name": "crops", "description": "Crop catalogue."},
    {"name": "market", "description": "Mandi market prices."},
    {"name": "harvests", "description": "Harvest listings, photos, verification and options."},
    {"name": "demands", "description": "Buyer requirements."},
    {"name": "supply", "description": "Aggregated supply for buyers."},
    {"name": "calculator", "description": "Public net-proceeds calculator."},
    {"name": "lots", "description": "Lot matching, pooling, consent and opening for offers."},
    {"name": "offers", "description": "Offers, negotiation, farmer consent and breakdowns."},
    {"name": "timeline", "description": "Journey timelines of harvests and lots."},
    {"name": "transport", "description": "Vehicles, transport requests, quotes and trips."},
    {"name": "deliveries", "description": "Delivery and quality-check records."},
    {"name": "settlements", "description": "Settlements, payments and farmer payouts."},
    {"name": "disputes", "description": "Disputes about lots and settlements."},
    {"name": "dashboards", "description": "Role dashboards."},
    {"name": "earnings", "description": "Farmer earnings history."},
    {"name": "insights", "description": "Supply and demand insights."},
    {"name": "notifications", "description": "In-app notifications."},
    {"name": "coordinator", "description": "Assisted farmer registration and FPO views."},
    {"name": "admin", "description": "User administration, verification and the audit log."},
    {"name": "ai", "description": "AI assistants (DeepSeek in live mode, rules otherwise)."},
    {"name": "public", "description": "Public statistics and the contact form."},
]


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    logger.info(
        "Starting %s %s (env=%s, ai=%s)",
        settings.APP_NAME,
        settings.APP_VERSION,
        settings.APP_ENV,
        settings.ai_effective_mode,
    )
    if settings.AI_MODE == "live" and settings.ai_effective_mode == "mock":
        logger.warning("AI_MODE=live but DEEPSEEK_API_KEY is empty: using rule-based responses")
    if settings.is_production and not settings.COOKIE_SECURE:
        logger.warning("COOKIE_SECURE is false in production: auth cookies will be sent over HTTP")
    yield
    await engine.dispose()


def create_app() -> FastAPI:
    """Build the API: middleware, error handlers, routers and the media mount."""
    configure_logging(settings.LOG_LEVEL, echo_sql=settings.DB_ECHO)

    app = FastAPI(
        title="MandiMate API",
        summary="Better deals. Shared logistics. More money for farmers.",
        description=DESCRIPTION,
        version=settings.APP_VERSION,
        openapi_tags=OPENAPI_TAGS,
        openapi_url=f"{settings.API_PREFIX}/openapi.json",
        docs_url=f"{settings.API_PREFIX}/docs",
        redoc_url=f"{settings.API_PREFIX}/redoc",
        lifespan=lifespan,
    )

    # Added innermost first: requests pass RequestId → SecurityHeaders → CORS → routes.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "Accept",
            "Accept-Language",
            REQUEST_ID_HEADER,
        ],
        expose_headers=[REQUEST_ID_HEADER],
        max_age=600,
    )
    app.add_middleware(SecurityHeadersMiddleware, hsts=settings.is_production)
    app.add_middleware(RequestIdMiddleware)

    register_exception_handlers(app)

    app.include_router(health_router)
    app.include_router(api_router)

    settings.MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    app.mount(settings.MEDIA_URL, StaticFiles(directory=settings.MEDIA_DIR), name="media")
    return app


app = create_app()
