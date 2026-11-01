"""/auth: sign-up, login (email or phone), throttling, refresh rotation, logout and /me."""

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import ACCESS_COOKIE, REFRESH_COOKIE, decode_token
from app.models import AuditLog, Fpo, Notification, RefreshToken, User
from tests.conftest import AuthClientFactory, MakeUser

SIGNUP = "/api/v1/auth/signup"
LOGIN = "/api/v1/auth/login"
REFRESH = "/api/v1/auth/refresh"
LOGOUT = "/api/v1/auth/logout"
ME = "/api/v1/auth/me"


def _signup_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "full_name": "Ravi Kumar",
        "email": "Ravi.Kumar@Example.com",
        "phone": "98480 12345",
        "password": "Tomato2026",
        "role": "farmer",
        "preferred_language": "te",
        "village": "Kurabalakota",
        "district": "Annamayya",
        "state": "Andhra Pradesh",
        "latitude": 13.6496,
        "longitude": 78.4867,
    }
    return body | overrides


def _refresh_cookie(token: str) -> dict[str, str]:
    """An explicit Cookie header (it replaces whatever the client's cookie jar holds)."""
    return {"Cookie": f"{REFRESH_COOKIE}={token}"}


def _set_cookies(response: Any) -> dict[str, str]:
    return {header.split("=", 1)[0]: header for header in response.headers.get_list("set-cookie")}


# ──────────────────────────────── Sign-up ────────────────────────────────


async def test_cookie_flow_signup_me_refresh_logout(client: AsyncClient, db: AsyncSession) -> None:
    signup = await client.post(SIGNUP, json=_signup_body())

    assert signup.status_code == 201
    user = signup.json()["user"]
    assert user["email"] == "ravi.kumar@example.com"
    assert user["phone"] == "+919848012345"
    assert user["role"] == "farmer"
    assert user["verification_status"] == "unverified"
    assert user["preferred_language"] == "te"
    assert user["fpo_id"] is None and user["fpo_name"] is None
    cookies = _set_cookies(signup)
    assert "HttpOnly" in cookies[ACCESS_COOKIE] and "Path=/;" in cookies[ACCESS_COOKIE]
    assert "Path=/api/v1/auth" in cookies[REFRESH_COOKIE]

    me = await client.get(ME)
    assert me.status_code == 200
    assert me.json()["id"] == user["id"]

    old_refresh = client.cookies.get(REFRESH_COOKIE)
    refreshed = await client.post(REFRESH)
    assert refreshed.status_code == 200
    assert refreshed.json()["user"]["id"] == user["id"]
    new_refresh = client.cookies.get(REFRESH_COOKIE)
    assert new_refresh and new_refresh != old_refresh
    tokens = (await db.scalars(select(RefreshToken).order_by(RefreshToken.created_at))).all()
    assert len(tokens) == 2
    assert tokens[0].jti == decode_token(old_refresh, "refresh").jti
    assert tokens[0].revoked_at is not None and tokens[1].revoked_at is None

    assert (await client.get(ME)).status_code == 200

    logout = await client.post(LOGOUT)
    assert logout.status_code == 204
    assert all("Max-Age=0" in header for header in logout.headers.get_list("set-cookie"))
    assert client.cookies.get(ACCESS_COOKIE) is None

    after = await client.get(ME)
    assert after.status_code == 401
    await db.refresh(tokens[1])
    assert tokens[1].revoked_at is not None
    assert (await client.post(REFRESH)).status_code == 401

    actions = set((await db.scalars(select(AuditLog.action))).all())
    assert {"user.signup", "auth.logout"} <= actions


async def test_signup_coordinator_creates_fpo_and_awaits_verification(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    admin, _ = await make_user("admin")
    response = await client.post(
        SIGNUP,
        json=_signup_body(
            role="coordinator",
            email="suresh@madanapallefpo.org",
            phone=None,
            organization_name="Madanapalle Tomato Growers FPO",
        ),
    )

    assert response.status_code == 201
    user = response.json()["user"]
    assert user["verification_status"] == "pending"
    assert user["fpo_name"] == "Madanapalle Tomato Growers FPO"
    fpo = await db.get(Fpo, user["fpo_id"])
    assert fpo is not None and fpo.district == "Annamayya" and fpo.state == "Andhra Pradesh"
    reminder = await db.scalar(select(Notification).where(Notification.user_id == admin.id))
    assert reminder is not None and reminder.type == "verification"


@pytest.mark.parametrize("role", ["buyer", "transporter"])
async def test_signup_business_roles_start_unverified(client: AsyncClient, role: str) -> None:
    response = await client.post(
        SIGNUP,
        json=_signup_body(role=role, organization_name="FreshBasket Retail Pvt Ltd"),
    )

    assert response.status_code == 201
    assert response.json()["user"]["verification_status"] == "unverified"
    assert response.json()["user"]["organization_name"] == "FreshBasket Retail Pvt Ltd"


async def test_signup_rejects_duplicate_email_and_phone(
    client: AsyncClient, make_user: MakeUser
) -> None:
    await make_user("farmer", email="ravi@example.com", phone="+919848012345")

    by_email = await client.post(
        SIGNUP, json=_signup_body(email="RAVI@example.com ", phone="9000000001")
    )
    by_phone = await client.post(
        SIGNUP, json=_signup_body(email="other@example.com", phone="+91 98480-12345")
    )

    assert by_email.status_code == 409
    assert by_email.json()["detail"] == "An account with this email already exists"
    assert by_phone.status_code == 409
    assert by_phone.json()["detail"] == "An account with this phone number already exists"


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"password": "short1"}, "Password must be at least 8 characters long"),
        ({"password": "onlyletters"}, "Password must contain at least one letter and one digit"),
        ({"email": None, "phone": None}, "Provide an email address or a phone number"),
        (
            {"role": "buyer", "organization_name": None},
            "Organization name is required for buyers, transporters and coordinators",
        ),
        ({"role": "admin"}, None),
        ({"phone": "0123456789"}, "Enter a valid phone number"),
    ],
)
async def test_signup_validation_is_422(
    client: AsyncClient, overrides: dict[str, Any], message: str | None
) -> None:
    response = await client.post(SIGNUP, json=_signup_body(**overrides))

    assert response.status_code == 422
    if message is not None:
        assert any(message in issue["msg"] for issue in response.json()["detail"])


# ───────────────────────────────── Login ─────────────────────────────────


async def test_login_by_email_or_phone_sets_cookies(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    user, password = await make_user("buyer", email="anitha@freshbasket.in", phone="+919876543210")

    by_email = await client.post(
        LOGIN, json={"identifier": " Anitha@FreshBasket.in ", "password": password}
    )
    by_phone = await client.post(LOGIN, json={"identifier": "098765 43210", "password": password})

    for response in (by_email, by_phone):
        assert response.status_code == 200
        assert response.json()["user"]["id"] == str(user.id)
        assert set(_set_cookies(response)) == {ACCESS_COOKIE, REFRESH_COOKIE}
    await db.refresh(user)
    assert user.last_login_at is not None
    assert (await client.get(ME)).json()["id"] == str(user.id)


@pytest.mark.parametrize(
    ("identifier", "password"),
    [("farmer@example.com", "Wrong2026x"), ("nobody@example.com", "Tomato2026"), ("12", "x")],
)
async def test_login_failure_is_generic_401(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, identifier: str, password: str
) -> None:
    await make_user("farmer", email="farmer@example.com")

    response = await client.post(LOGIN, json={"identifier": identifier, "password": password})

    assert response.status_code == 401
    assert response.json()["detail"] == "Incorrect email/phone or password"
    assert ACCESS_COOKIE not in _set_cookies(response)
    failed = (
        await db.scalars(select(AuditLog).where(AuditLog.action == "auth.login_failed"))
    ).all()
    assert len(failed) == 1


async def test_login_is_throttled_after_five_failures(
    client: AsyncClient, make_user: MakeUser
) -> None:
    await make_user("farmer", phone="+919848011111")

    for _ in range(5):
        failed = await client.post(
            LOGIN, json={"identifier": "9848011111", "password": "Wrong2026"}
        )
        assert failed.status_code == 401
    # The same account written another way shares the counter; the right password is refused.
    blocked = await client.post(
        LOGIN, json={"identifier": "+91 98480 11111", "password": "Tomato2026"}
    )

    assert blocked.status_code == 429
    assert blocked.json()["detail"] == "Too many attempts. Try again in a few minutes."
    assert int(blocked.headers["Retry-After"]) > 0


async def test_successful_login_resets_the_failure_counter(
    client: AsyncClient, make_user: MakeUser
) -> None:
    _, password = await make_user("farmer", email="lakshmi@example.com")

    for _ in range(4):
        await client.post(LOGIN, json={"identifier": "lakshmi@example.com", "password": "Bad12345"})
    assert (
        await client.post(LOGIN, json={"identifier": "lakshmi@example.com", "password": password})
    ).status_code == 200
    for _ in range(4):
        response = await client.post(
            LOGIN, json={"identifier": "lakshmi@example.com", "password": "Bad12345"}
        )
        assert response.status_code == 401


async def test_inactive_account_cannot_sign_in(client: AsyncClient, make_user: MakeUser) -> None:
    _, password = await make_user("farmer", email="gone@example.com", is_active=False)

    wrong = await client.post(
        LOGIN, json={"identifier": "gone@example.com", "password": "Nope1234"}
    )
    right = await client.post(LOGIN, json={"identifier": "gone@example.com", "password": password})

    assert wrong.status_code == 401
    assert right.status_code == 403
    assert right.json()["code"] == "account_disabled"


async def test_login_validation_is_422(client: AsyncClient) -> None:
    response = await client.post(LOGIN, json={"identifier": "  ", "password": "x"})

    assert response.status_code == 422


# ──────────────────────────── Refresh & logout ───────────────────────────


async def test_refresh_requires_a_valid_refresh_cookie(
    client: AsyncClient, make_user: MakeUser, auth_client: AuthClientFactory
) -> None:
    user, _ = await make_user("farmer")

    missing = await client.post(REFRESH)
    garbage = await client.post(REFRESH, headers=_refresh_cookie("garbage"))
    # An access token is not a refresh token.
    signed_in = auth_client(user)
    wrong_type = await signed_in.post(
        REFRESH, headers=_refresh_cookie(signed_in.cookies[ACCESS_COOKIE])
    )

    for response in (missing, garbage, wrong_type):
        assert response.status_code == 401
        assert response.json()["code"] == "not_authenticated"


async def test_refresh_token_is_single_use_and_replay_revokes_sessions(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    user, password = await make_user("farmer", email="ravi@example.com")
    await client.post(LOGIN, json={"identifier": "ravi@example.com", "password": password})
    stolen = client.cookies[REFRESH_COOKIE]

    assert (await client.post(REFRESH)).status_code == 200
    # Replayed inside the concurrent-refresh grace window: refused, sessions kept.
    replay = await client.post(REFRESH, headers=_refresh_cookie(stolen))
    assert replay.status_code == 401
    active = await db.scalars(
        select(RefreshToken).where(
            RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None)
        )
    )
    assert len(active.all()) == 1

    # Replayed later: every session of the user is revoked.
    record = await db.scalar(
        select(RefreshToken).where(RefreshToken.jti == decode_token(stolen, "refresh").jti)
    )
    assert record is not None and record.revoked_at is not None
    record.revoked_at = record.revoked_at.replace(year=record.revoked_at.year - 1)
    await db.commit()

    user_id = user.id
    late = await client.post(REFRESH, headers=_refresh_cookie(stolen))
    assert late.status_code == 401
    db.expire_all()
    remaining = await db.scalars(
        select(RefreshToken).where(
            RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None)
        )
    )
    assert remaining.all() == []
    assert (
        await db.scalar(select(AuditLog).where(AuditLog.action == "auth.refresh_reuse"))
    ) is not None


async def test_refresh_refuses_deactivated_users(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    user, password = await make_user("buyer", email="buyer@example.com")
    await client.post(LOGIN, json={"identifier": "buyer@example.com", "password": password})
    stored = await db.get(User, user.id)
    assert stored is not None
    stored.is_active = False
    await db.commit()

    assert (await client.post(REFRESH)).status_code == 401


async def test_logout_without_a_session_still_clears_cookies(client: AsyncClient) -> None:
    response = await client.post(LOGOUT)

    assert response.status_code == 204
    assert len(response.headers.get_list("set-cookie")) == 2


async def test_me_requires_authentication(client: AsyncClient) -> None:
    response = await client.get(ME)

    assert response.status_code == 401


async def test_me_returns_fpo_name(
    auth_client: AuthClientFactory, make_user: MakeUser, db: AsyncSession
) -> None:
    fpo = Fpo(name="Madanapalle Tomato Growers FPO", district="Annamayya", state="Andhra Pradesh")
    db.add(fpo)
    await db.commit()
    coordinator, _ = await make_user("coordinator", fpo_id=fpo.id)

    response = await auth_client(coordinator).get(ME)

    assert response.status_code == 200
    assert response.json()["fpo_name"] == "Madanapalle Tomato Growers FPO"
