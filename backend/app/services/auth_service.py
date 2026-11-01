"""Sign-up, login, refresh-token rotation and logout (DOMAIN_RULES §10, docs/SECURITY.md).

Sessions are a pair of httpOnly cookies. Every refresh token issued is recorded in
``refresh_tokens`` by its ``jti`` so ``/auth/refresh`` can rotate it (single use), logout can
revoke it and replaying a rotated token can be detected.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import TYPE_CHECKING

from fastapi import status
from fastapi.exceptions import RequestValidationError
from sqlalchemy import delete, select, update

from app.core.errors import DomainError
from app.core.ratelimit import login_limiter, login_throttle_key
from app.core.security import (
    TokenError,
    burn_password_check,
    clear_auth_cookies,
    decode_token,
    hash_password,
    normalize_email,
    normalize_phone,
    password_needs_rehash,
    set_auth_cookies,
    verify_password,
)
from app.core.time import utcnow
from app.models import Fpo, RefreshToken, User
from app.services.audit import audit
from app.services.notify import notify

if TYPE_CHECKING:
    from fastapi import Response
    from sqlalchemy.ext.asyncio import AsyncSession

    from app import schemas

INVALID_CREDENTIALS = "Incorrect email/phone or password"
LOGIN_THROTTLED = "Too many attempts. Try again in a few minutes."
ACCOUNT_DISABLED = "This account has been deactivated. Contact your MandiMate coordinator."
SESSION_EXPIRED = "Your session has expired. Please sign in again."
EMAIL_TAKEN = "An account with this email already exists"
PHONE_TAKEN = "An account with this phone number already exists"

REFRESH_REUSE_GRACE = timedelta(seconds=60)
"""A rotated refresh token presented again within this window is treated as a concurrent
refresh from another tab (plain 401); later reuse revokes every session of the user."""

USER_AGENT_MAX_LENGTH = 255


@dataclass(frozen=True, slots=True)
class ClientInfo:
    """Where a request came from (stored with refresh tokens and audit entries)."""

    ip: str | None = None
    user_agent: str | None = None


# ──────────────────────────────── Helpers ────────────────────────────────


def field_error(
    field: str, message: str, error_type: str = "value_error"
) -> RequestValidationError:
    """A 422 whose body points at one request field, exactly like a schema validation error."""
    return RequestValidationError(
        [{"loc": ("body", field), "msg": message, "type": error_type, "input": None}]
    )


def normalized_phone_or_422(raw: str, field: str = "phone") -> str:
    """``normalize_phone`` with a field-level 422 instead of ``ValueError``."""
    try:
        return normalize_phone(raw)
    except ValueError as exc:
        raise field_error(
            field,
            "Enter a valid phone number, for example 98765 43210 or +91 98765 43210",
            "phone_invalid",
        ) from exc


def _unauthenticated(detail: str = SESSION_EXPIRED) -> DomainError:
    return DomainError(
        status.HTTP_401_UNAUTHORIZED,
        detail,
        "not_authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def ensure_contact_available(
    db: AsyncSession,
    *,
    email: str | None,
    phone: str | None,
    exclude_user_id: uuid.UUID | None = None,
) -> None:
    """409 when another account already uses ``email`` or ``phone`` (both already normalised)."""
    if email is not None:
        query = select(User.id).where(User.email == email)
        if exclude_user_id is not None:
            query = query.where(User.id != exclude_user_id)
        if (await db.scalar(query.limit(1))) is not None:
            raise DomainError(status.HTTP_409_CONFLICT, EMAIL_TAKEN, "email_taken")
    if phone is not None:
        query = select(User.id).where(User.phone == phone)
        if exclude_user_id is not None:
            query = query.where(User.id != exclude_user_id)
        if (await db.scalar(query.limit(1))) is not None:
            raise DomainError(status.HTTP_409_CONFLICT, PHONE_TAKEN, "phone_taken")


async def find_user_by_identifier(db: AsyncSession, identifier: str) -> tuple[str, User | None]:
    """Resolve a login identifier (email or phone) to ``(normalised identifier, user)``.

    Emails match case-insensitively; phones are normalised to E.164 (``+91…``) first. An
    identifier that is neither returns ``(lower-cased input, None)``.
    """
    text = identifier.strip()
    if "@" in text:
        email = normalize_email(text)
        return email, await db.scalar(select(User).where(User.email == email))
    try:
        phone = normalize_phone(text)
    except ValueError:
        return text.lower(), None
    return phone, await db.scalar(select(User).where(User.phone == phone))


# ──────────────────────────────── Sessions ───────────────────────────────


async def start_session(
    db: AsyncSession, response: Response, user: User, client: ClientInfo
) -> None:
    """Set fresh auth cookies on ``response`` and record the refresh token for rotation."""
    tokens = set_auth_cookies(response, user)
    now = utcnow()
    # Housekeeping: expired tokens of this user can no longer be presented.
    await db.execute(
        delete(RefreshToken).where(RefreshToken.user_id == user.id, RefreshToken.expires_at < now)
    )
    db.add(
        RefreshToken(
            user_id=user.id,
            jti=tokens.refresh.jti,
            expires_at=tokens.refresh.expires_at,
            ip=client.ip,
            user_agent=client.user_agent[:USER_AGENT_MAX_LENGTH] if client.user_agent else None,
        )
    )
    await db.flush()


async def revoke_all_sessions(db: AsyncSession, user_id: uuid.UUID) -> int:
    """Revoke every unrevoked refresh token of a user; returns how many were revoked."""
    result = await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )
    return result.rowcount or 0


# ──────────────────────────────── Sign-up ────────────────────────────────


async def signup(
    db: AsyncSession, req: schemas.SignupRequest, response: Response, client: ClientInfo
) -> User:
    """Create an account, start its session and audit it.

    Buyers, transporters and farmers start ``unverified``. A coordinator's signup creates
    their FPO and starts ``pending`` until an admin verifies them (they can work meanwhile).
    """
    email = normalize_email(str(req.email)) if req.email is not None else None
    phone = normalized_phone_or_422(req.phone) if req.phone is not None else None
    await ensure_contact_available(db, email=email, phone=phone)

    fpo: Fpo | None = None
    if req.role == "coordinator":
        assert req.organization_name is not None  # enforced by SignupRequest
        fpo = Fpo(name=req.organization_name, district=req.district, state=req.state)
        db.add(fpo)
        await db.flush()

    user = User(
        email=email,
        phone=phone,
        password_hash=hash_password(req.password),
        full_name=req.full_name,
        role=req.role,
        preferred_language=req.preferred_language,
        organization_name=req.organization_name,
        village=req.village,
        district=req.district,
        state=req.state,
        latitude=req.latitude,
        longitude=req.longitude,
        verification_status="pending" if req.role == "coordinator" else "unverified",
        is_active=True,
        last_login_at=utcnow(),
        fpo=fpo,
    )
    db.add(user)
    await db.flush()

    await audit(
        db,
        user,
        "user.signup",
        "user",
        user.id,
        f"{user.full_name} signed up as {user.role}",
        {"role": user.role, "fpo_id": fpo.id if fpo else None},
        ip=client.ip,
    )
    if req.role == "coordinator":
        admin_ids = (
            await db.scalars(select(User.id).where(User.role == "admin", User.is_active.is_(True)))
        ).all()
        await notify(
            db,
            admin_ids,
            "verification",
            "Coordinator awaiting verification",
            f"{user.full_name} signed up as a coordinator for {req.organization_name}. "
            "Verify the account once you have confirmed it with the FPO.",
            link="/app/admin/users",
        )

    await start_session(db, response, user, client)
    return user


# ───────────────────────────────── Login ─────────────────────────────────


async def login(
    db: AsyncSession, req: schemas.LoginRequest, response: Response, client: ClientInfo
) -> User:
    """Check credentials (email or phone + password) and start a session.

    Five failures per (identifier, IP) within five minutes lock further attempts with a 429.
    Failures are audited and committed before the 401 is raised.
    """
    identifier, user = await find_user_by_identifier(db, req.identifier)
    throttle_key = login_throttle_key(identifier, client.ip)
    login_limiter.ensure_allowed(throttle_key, LOGIN_THROTTLED)

    if user is None:
        burn_password_check(req.password)
        valid = False
    else:
        valid = verify_password(req.password, user.password_hash)

    if not valid:
        login_limiter.hit(throttle_key)
        await audit(
            db,
            user,
            "auth.login_failed",
            "user",
            user.id if user else None,
            "Failed login" + (f" for {user.full_name}" if user else " for an unknown account"),
            {"identifier": identifier},
            ip=client.ip,
        )
        await db.commit()
        raise _unauthenticated(INVALID_CREDENTIALS)

    assert user is not None
    if not user.is_active:
        raise DomainError(status.HTTP_403_FORBIDDEN, ACCOUNT_DISABLED, "account_disabled")

    login_limiter.reset(throttle_key)
    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(req.password)
    user.last_login_at = utcnow()
    await audit(
        db, user, "auth.login", "user", user.id, f"{user.full_name} signed in", ip=client.ip
    )
    await start_session(db, response, user, client)
    return user


# ──────────────────────────── Refresh & logout ───────────────────────────


async def refresh(
    db: AsyncSession, refresh_cookie: str | None, response: Response, client: ClientInfo
) -> User:
    """Rotate the refresh token: revoke the presented one and issue a fresh cookie pair.

    401 when the cookie is missing, invalid, expired, unknown or already used, or the user is
    inactive. Replaying a rotated token after the grace window revokes all of the user's
    sessions (the token was probably stolen).
    """
    if not refresh_cookie:
        raise _unauthenticated()
    try:
        payload = decode_token(refresh_cookie, "refresh")
    except TokenError as exc:
        raise _unauthenticated() from exc

    record = await db.scalar(
        select(RefreshToken).where(RefreshToken.jti == payload.jti).with_for_update()
    )
    now = utcnow()
    if record is None or record.user_id != payload.sub or record.expires_at <= now:
        raise _unauthenticated()

    if record.revoked_at is not None:
        if now - record.revoked_at > REFRESH_REUSE_GRACE:
            revoked = await revoke_all_sessions(db, record.user_id)
            await audit(
                db,
                None,
                "auth.refresh_reuse",
                "user",
                record.user_id,
                "A used refresh token was presented again; all sessions were revoked",
                {"jti": record.jti, "sessions_revoked": revoked},
                ip=client.ip,
            )
            await db.commit()
        raise _unauthenticated()

    user = await db.get(User, record.user_id)
    if user is None or not user.is_active:
        raise _unauthenticated()

    record.revoked_at = now
    await start_session(db, response, user, client)
    return user


async def logout(db: AsyncSession, refresh_cookie: str | None, response: Response) -> None:
    """Revoke the presented refresh token (if any is valid) and clear both cookies."""
    clear_auth_cookies(response)
    if not refresh_cookie:
        return
    try:
        payload = decode_token(refresh_cookie, "refresh")
    except TokenError:
        return
    record = await db.scalar(select(RefreshToken).where(RefreshToken.jti == payload.jti))
    if record is None or record.user_id != payload.sub:
        return
    if record.revoked_at is None:
        record.revoked_at = utcnow()
    user = await db.get(User, record.user_id)
    if user is not None:
        await audit(db, user, "auth.logout", "user", user.id, f"{user.full_name} signed out")
