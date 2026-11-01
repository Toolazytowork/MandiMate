"""Passwords, identifiers, JWTs, cookies, auth dependencies, throttling and name masking."""

import uuid
from collections.abc import AsyncIterator
from datetime import timedelta
from typing import Annotated

import jwt
import pytest
import pytest_asyncio
from fastapi import Depends, FastAPI, Response
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.requests import Request

from app.core.config import DEFAULT_JWT_SECRET, Settings, settings
from app.core.database import get_db
from app.core.deps import CurrentUser, DbSession, OptionalUser, get_client_ip, require_roles
from app.core.errors import DomainError
from app.core.ratelimit import SlidingWindowLimiter, login_throttle_key
from app.core.security import (
    ACCESS_COOKIE,
    REFRESH_COOKIE,
    TokenError,
    check_password_policy,
    clear_auth_cookies,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    issue_token,
    normalize_email,
    normalize_phone,
    password_needs_rehash,
    set_auth_cookies,
    verify_password,
)
from app.main import create_app
from app.models import User
from app.services.presenters import farmer_display_name, mask_name
from tests.conftest import BASE_URL, MakeUser

# ─────────────────────────────── Passwords ───────────────────────────────


def test_password_hash_is_argon2id_and_verifies() -> None:
    hashed = hash_password("Tomato2026")

    assert hashed.startswith("$argon2id$")
    assert verify_password("Tomato2026", hashed)
    assert not verify_password("tomato2026", hashed)
    assert not password_needs_rehash(hashed)


def test_verify_password_rejects_malformed_hashes() -> None:
    assert not verify_password("Tomato2026", "not-a-hash")


@pytest.mark.parametrize(
    ("password", "problem"),
    [
        ("Tomato2026", None),
        ("రైతు2026ab", None),
        ("Tom2026", "Password must be at least 8 characters long"),
        ("tomatoesonly", "Password must contain at least one digit"),
        ("2026202620", "Password must contain at least one letter"),
        ("a1" * 65, "Password must be at most 128 characters long"),
    ],
)
def test_password_policy(password: str, problem: str | None) -> None:
    assert check_password_policy(password) == problem


# ─────────────────────────────── Identifiers ─────────────────────────────


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("9876543210", "+919876543210"),
        ("98765 43210", "+919876543210"),
        ("098765-43210", "+919876543210"),
        ("919876543210", "+919876543210"),
        ("+91 98765 43210", "+919876543210"),
        ("0091 9876543210", "+919876543210"),
        ("(+91) 98765.43210", "+919876543210"),
        ("08571 234567", "+918571234567"),
        ("+44 20 7946 0958", "+442079460958"),
    ],
)
def test_normalize_phone(raw: str, expected: str) -> None:
    assert normalize_phone(raw) == expected


@pytest.mark.parametrize(
    "raw", ["", "12345", "0987654321", "+91 98765", "+9198765432101", "98765abcde", "+0123456789"]
)
def test_normalize_phone_rejects_invalid_numbers(raw: str) -> None:
    with pytest.raises(ValueError, match="valid phone number"):
        normalize_phone(raw)


def test_normalize_email_trims_and_lowercases() -> None:
    assert normalize_email("  Ravi.Reddy@Example.COM ") == "ravi.reddy@example.com"


# ────────────────────────────────── JWT ──────────────────────────────────


def _user(role: str = "farmer", **fields: object) -> User:
    return User(id=uuid.uuid4(), role=role, full_name="Ravi Kumar", is_active=True, **fields)


def test_access_token_round_trip() -> None:
    user = _user("buyer")

    payload = decode_token(create_access_token(user), "access")

    assert payload.sub == user.id
    assert payload.role == "buyer"
    assert payload.type == "access"
    assert len(payload.jti) == 32
    assert payload.exp - payload.iat == timedelta(minutes=settings.ACCESS_TOKEN_MINUTES)


def test_refresh_token_round_trip_and_unique_jti() -> None:
    user = _user()

    first = create_refresh_token(user)
    second = create_refresh_token(user)
    payload = decode_token(first.token, "refresh")

    assert payload.jti == first.jti != second.jti
    assert payload.exp == first.expires_at
    assert payload.exp - payload.iat == timedelta(days=settings.REFRESH_TOKEN_DAYS)


def test_token_of_the_wrong_type_is_rejected() -> None:
    user = _user()

    with pytest.raises(TokenError):
        decode_token(create_refresh_token(user).token, "access")
    with pytest.raises(TokenError):
        decode_token(create_access_token(user), "refresh")


def test_expired_token_is_rejected() -> None:
    expired = issue_token(uuid.uuid4(), "farmer", "access", lifetime=timedelta(minutes=-5))

    with pytest.raises(TokenError):
        decode_token(expired.token, "access")


def test_tampered_or_foreign_tokens_are_rejected() -> None:
    token = create_access_token(_user())
    header, claims, signature = token.split(".")
    tampered = f"{header}.{claims}.{signature[::-1]}"
    foreign = jwt.encode(
        jwt.decode(token, options={"verify_signature": False}),
        "another-secret-of-at-least-thirty-two-bytes",
        algorithm="HS256",
    )
    missing_jti = jwt.encode(
        {"sub": str(uuid.uuid4()), "role": "farmer", "type": "access", "iat": 0, "exp": 2**33},
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )

    for bad in (tampered, foreign, missing_jti, "not-a-jwt"):
        with pytest.raises(TokenError):
            decode_token(bad, "access")


# ─────────────────────────────── Settings ────────────────────────────────


def test_production_refuses_the_default_or_a_short_jwt_secret() -> None:
    with pytest.raises(ValidationError, match="JWT_SECRET"):
        Settings(APP_ENV="production", JWT_SECRET=DEFAULT_JWT_SECRET)
    with pytest.raises(ValidationError, match="JWT_SECRET"):
        Settings(APP_ENV="production", JWT_SECRET="short-secret")

    production = Settings(APP_ENV="production", JWT_SECRET="x" * 48)
    assert production.is_production


@pytest.mark.parametrize(
    ("mode", "key", "effective"),
    [
        ("auto", "", "mock"),
        ("auto", "sk-test", "live"),
        ("live", "", "mock"),
        ("mock", "sk-test", "mock"),
    ],
)
def test_ai_effective_mode(mode: str, key: str, effective: str) -> None:
    assert Settings(AI_MODE=mode, DEEPSEEK_API_KEY=key).ai_effective_mode == effective


def test_settings_parse_origins_and_driver() -> None:
    configured = Settings(
        CORS_ORIGINS="https://mandimate.in/, https://www.mandimate.in",
        DATABASE_URL="postgresql://u:p@db:5432/mandimate",
    )

    assert configured.CORS_ORIGINS == ["https://mandimate.in", "https://www.mandimate.in"]
    assert configured.DATABASE_URL == "postgresql+asyncpg://u:p@db:5432/mandimate"
    assert Settings(CORS_ORIGINS='["http://a.example"]').CORS_ORIGINS == ["http://a.example"]


# ───────────────────────────── Login throttling ──────────────────────────


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_sliding_window_limits_after_five_failures_and_recovers() -> None:
    clock = FakeClock()
    limiter = SlidingWindowLimiter(5, 300, clock=clock)
    key = login_throttle_key(" Ravi@Example.com ", "10.0.0.7")

    for _ in range(4):
        limiter.hit(key)
        clock.now += 10
    assert not limiter.is_limited(key)
    limiter.hit(key)

    assert limiter.is_limited(key)
    assert limiter.retry_after(key) == 260
    with pytest.raises(DomainError) as raised:
        limiter.ensure_allowed(key, "Too many failed logins")
    assert raised.value.status_code == 429
    assert raised.value.headers == {"Retry-After": "260"}

    clock.now += 261
    assert not limiter.is_limited(key)
    limiter.ensure_allowed(key, "Too many failed logins")


def test_successful_login_resets_the_window() -> None:
    limiter = SlidingWindowLimiter(5, 300, clock=FakeClock())
    key = login_throttle_key("9876543210", None)
    for _ in range(5):
        limiter.hit(key)

    limiter.reset(key)

    assert not limiter.is_limited(key)
    assert key == "9876543210|unknown"


# ───────────────────────────── Name masking ──────────────────────────────


@pytest.mark.parametrize(
    ("full_name", "masked"),
    [
        ("Ravi Kumar", "Ravi K."),
        ("Ravi Kumar Reddy", "Ravi R."),
        ("  lakshmi   devi ", "lakshmi D."),
        ("Venkatesh", "Venkatesh"),
        ("", ""),
    ],
)
def test_mask_name(full_name: str, masked: str) -> None:
    assert mask_name(full_name) == masked


def test_farmer_display_name_follows_visibility_rules() -> None:
    farmer = _user("farmer")

    assert farmer_display_name(farmer, farmer) == "Ravi Kumar"
    assert farmer_display_name(farmer, _user("coordinator")) == "Ravi Kumar"
    assert farmer_display_name(farmer, _user("admin")) == "Ravi Kumar"
    assert farmer_display_name(farmer, _user("buyer")) == "Ravi K."
    assert farmer_display_name(farmer, _user("farmer")) == "Ravi K."
    assert farmer_display_name(farmer, None) == "Ravi K."
    assert farmer_display_name(farmer, _user("transporter"), reveal=True) == "Ravi Kumar"


# ─────────────────────── Auth dependencies & cookies ─────────────────────


@pytest_asyncio.fixture
async def probe(
    session_factory: async_sessionmaker[AsyncSession], clean_db: None
) -> AsyncIterator[AsyncClient]:
    """A client for a throwaway app exposing the auth dependencies."""
    probe_app: FastAPI = create_app()

    async def get_test_db() -> AsyncIterator[AsyncSession]:
        async with session_factory() as session:
            yield session

    probe_app.dependency_overrides[get_db] = get_test_db

    @probe_app.get("/probe/me")
    async def me(user: CurrentUser) -> dict[str, str]:
        return {"id": str(user.id)}

    @probe_app.get("/probe/maybe")
    async def maybe(user: OptionalUser) -> dict[str, str | None]:
        return {"id": str(user.id) if user else None}

    @probe_app.get("/probe/operations")
    async def operations(
        user: Annotated[User, Depends(require_roles("coordinator"))],
    ) -> dict[str, str]:
        return {"role": user.role}

    @probe_app.post("/probe/login/{user_id}")
    async def login(user_id: uuid.UUID, response: Response, db: DbSession) -> dict[str, str]:
        user = await db.get(User, user_id)
        assert user is not None
        tokens = set_auth_cookies(response, user)
        return {"refresh_jti": tokens.refresh.jti}

    @probe_app.post("/probe/logout")
    async def logout(response: Response) -> None:
        clear_auth_cookies(response)

    async with AsyncClient(transport=ASGITransport(app=probe_app), base_url=BASE_URL) as http:
        yield http


async def test_current_user_from_cookie_or_bearer(probe: AsyncClient, make_user: MakeUser) -> None:
    user, _ = await make_user("farmer")
    token = create_access_token(user)

    by_cookie = await probe.get("/probe/me", headers=_cookie(token))
    by_bearer = await probe.get("/probe/me", headers={"Authorization": f"Bearer {token}"})

    assert by_cookie.status_code == by_bearer.status_code == 200
    assert by_cookie.json() == by_bearer.json() == {"id": str(user.id)}


async def test_missing_or_invalid_credentials_are_401(
    probe: AsyncClient, make_user: MakeUser
) -> None:
    inactive, _ = await make_user("farmer", is_active=False)
    active, _ = await make_user("farmer")
    attempts: list[dict[str, str]] = [
        {},
        _cookie("garbage"),
        _cookie(create_access_token(inactive)),
        _cookie(create_refresh_token(active).token),
        {"Authorization": "Bearer garbage"},
        _cookie(create_access_token(_user())),
    ]

    for attempt in attempts:
        response = await probe.get("/probe/me", headers=attempt)
        assert response.status_code == 401, attempt
        assert response.json() == {"detail": "Not authenticated", "code": "not_authenticated"}
        assert response.headers["WWW-Authenticate"] == "Bearer"


async def test_optional_user_treats_missing_or_stale_tokens_as_anonymous(
    probe: AsyncClient, make_user: MakeUser
) -> None:
    user, _ = await make_user("buyer")

    anonymous = await probe.get("/probe/maybe")
    stale = await probe.get("/probe/maybe", headers=_cookie("garbage"))
    signed_in = await probe.get("/probe/maybe", headers=_cookie(create_access_token(user)))

    assert anonymous.json() == stale.json() == {"id": None}
    assert signed_in.json() == {"id": str(user.id)}


@pytest.mark.parametrize(
    ("role", "status"),
    [("coordinator", 200), ("admin", 200), ("farmer", 403), ("buyer", 403), ("transporter", 403)],
)
async def test_require_roles_lets_admins_pass_coordinator_checks(
    probe: AsyncClient, make_user: MakeUser, role: str, status: int
) -> None:
    user, _ = await make_user(role)

    response = await probe.get("/probe/operations", headers=_cookie(create_access_token(user)))

    assert response.status_code == status
    if status == 403:
        assert response.json()["code"] == "forbidden"


async def test_auth_cookies_are_http_only_lax_and_scoped(
    probe: AsyncClient, make_user: MakeUser
) -> None:
    user, _ = await make_user("farmer")

    login = await probe.post(f"/probe/login/{user.id}")
    logout = await probe.post("/probe/logout")

    issued = {cookie.split("=", 1)[0]: cookie for cookie in login.headers.get_list("set-cookie")}
    access, refresh = issued[ACCESS_COOKIE], issued[REFRESH_COOKIE]
    assert "HttpOnly" in access and "SameSite=lax" in access and "Path=/;" in access
    assert "Path=/api/v1/auth" in refresh and "HttpOnly" in refresh
    assert f"Max-Age={settings.REFRESH_TOKEN_DAYS * 86400}" in refresh
    assert "Secure" not in access
    refresh_token = refresh.split(";", 1)[0].split("=", 1)[1]
    assert decode_token(refresh_token, "refresh").jti == login.json()["refresh_jti"]

    cleared = logout.headers.get_list("set-cookie")
    assert len(cleared) == 2
    assert all("Max-Age=0" in cookie for cookie in cleared)


def _cookie(token: str) -> dict[str, str]:
    return {"Cookie": f"{ACCESS_COOKIE}={token}"}


def _request(peer: str, forwarded: str | None = None) -> Request:
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded else []
    return Request({"type": "http", "headers": headers, "client": (peer, 5000)})


def test_client_ip_trusts_forwarded_for_only_from_internal_proxies() -> None:
    assert get_client_ip(_request("127.0.0.1", "49.205.12.7, 10.0.0.2")) == "49.205.12.7"
    assert get_client_ip(_request("172.18.0.5", "49.205.12.7")) == "49.205.12.7"
    assert get_client_ip(_request("49.205.12.7", "1.2.3.4")) == "49.205.12.7"
    assert get_client_ip(_request("127.0.0.1", "not-an-ip")) == "127.0.0.1"
    assert get_client_ip(_request("49.205.12.7")) == "49.205.12.7"
