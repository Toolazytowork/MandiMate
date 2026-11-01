"""Health endpoints and application plumbing: middleware, CORS, error bodies, media."""

from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.core.database import get_db
from app.core.errors import conflict
from app.core.ratelimit import SlidingWindowLimiter
from app.main import create_app
from tests.conftest import BASE_URL


@pytest.mark.parametrize("path", ["/health", "/api/v1/health"])
async def test_health_reports_database_and_ai_mode(client: AsyncClient, path: str) -> None:
    response = await client.get(path)

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "database": "ok",
        "ai_mode": "mock",
        "version": settings.APP_VERSION,
    }


async def test_health_is_degraded_when_database_is_unreachable(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    unreachable = create_async_engine(
        "postgresql+asyncpg://mandimate:mandimate@127.0.0.1:1/mandimate", poolclass=NullPool
    )
    sessions = async_sessionmaker(unreachable, expire_on_commit=False)

    async def unreachable_db() -> AsyncIterator[AsyncSession]:
        async with sessions() as session:
            yield session

    monkeypatch.setitem(app.dependency_overrides, get_db, unreachable_db)
    async with AsyncClient(transport=ASGITransport(app=app), base_url=BASE_URL) as http:
        response = await http.get("/health")
    await unreachable.dispose()

    assert response.status_code == 200
    assert response.json()["status"] == "degraded"
    assert response.json()["database"] == "error"


async def test_responses_carry_security_headers_and_request_id(client: AsyncClient) -> None:
    response = await client.get("/health")

    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert response.headers["Permissions-Policy"] == "microphone=(self), camera=(self)"
    assert len(response.headers["X-Request-ID"]) == 32
    assert "Strict-Transport-Security" not in response.headers


async def test_request_id_is_echoed_only_when_well_formed(client: AsyncClient) -> None:
    echoed = await client.get("/health", headers={"X-Request-ID": "trace-123.abc"})
    replaced = await client.get("/health", headers={"X-Request-ID": "bad id\twith spaces"})

    assert echoed.headers["X-Request-ID"] == "trace-123.abc"
    assert replaced.headers["X-Request-ID"] != "bad id\twith spaces"


async def test_cors_allows_configured_origins_with_credentials(client: AsyncClient) -> None:
    preflight = {"Access-Control-Request-Method": "POST"}

    allowed = await client.options(
        "/api/v1/health", headers={"Origin": "http://localhost:5173", **preflight}
    )
    denied = await client.options(
        "/api/v1/health", headers={"Origin": "https://evil.example.com", **preflight}
    )

    assert allowed.status_code == 200
    assert allowed.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
    assert allowed.headers["Access-Control-Allow-Credentials"] == "true"
    assert "Access-Control-Allow-Origin" not in denied.headers


async def test_unknown_route_returns_api_error_body(client: AsyncClient) -> None:
    response = await client.get("/api/v1/does-not-exist")

    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


async def test_openapi_document_is_served_under_the_api_prefix(client: AsyncClient) -> None:
    response = await client.get("/api/v1/openapi.json")

    assert response.status_code == 200
    assert response.json()["info"]["title"] == "MandiMate API"
    assert "/api/v1/health" in response.json()["paths"]


async def test_errors_are_rendered_as_api_error_bodies() -> None:
    probe = create_app()
    limiter = SlidingWindowLimiter(1, 60)
    limiter.hit("caller")

    @probe.get("/probe/conflict")
    async def raise_conflict() -> None:
        raise conflict("Lot is not open for offers")

    @probe.get("/probe/limited")
    async def raise_limited() -> None:
        limiter.ensure_allowed("caller", "Too many attempts. Try again later.")

    @probe.get("/probe/crash")
    async def crash() -> None:
        raise RuntimeError("boom")

    transport = ASGITransport(app=probe, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url=BASE_URL) as http:
        conflicted = await http.get("/probe/conflict")
        limited = await http.get("/probe/limited")
        crashed = await http.get("/probe/crash")

    assert conflicted.status_code == 409
    assert conflicted.json() == {"detail": "Lot is not open for offers", "code": "conflict"}
    assert limited.status_code == 429
    assert limited.json()["code"] == "rate_limited"
    assert 1 <= int(limited.headers["Retry-After"]) <= 60
    assert crashed.status_code == 500
    assert crashed.json() == {"detail": "Internal server error", "code": "internal_error"}


async def test_media_directory_is_served_with_security_headers(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "MEDIA_DIR", tmp_path / "media")
    probe = create_app()
    photo = settings.MEDIA_DIR / "harvests" / "sample.webp"
    photo.parent.mkdir(parents=True)
    photo.write_bytes(b"RIFF....WEBP")

    async with AsyncClient(transport=ASGITransport(app=probe), base_url=BASE_URL) as http:
        found = await http.get("/media/harvests/sample.webp")
        missing = await http.get("/media/harvests/missing.webp")

    assert found.status_code == 200
    assert found.content == b"RIFF....WEBP"
    assert found.headers["X-Content-Type-Options"] == "nosniff"
    assert missing.status_code == 404
