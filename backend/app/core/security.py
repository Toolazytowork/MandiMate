"""Password hashing, identifier normalisation, JWTs and auth cookies."""

from __future__ import annotations

import re
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import TYPE_CHECKING, Literal

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Response

from app.core.config import settings
from app.core.time import utcnow

if TYPE_CHECKING:
    from app.models import User

TokenType = Literal["access", "refresh"]

ACCESS_COOKIE = "mandimate_access"
REFRESH_COOKIE = "mandimate_refresh"
ACCESS_COOKIE_PATH = "/"
REFRESH_COOKIE_PATH = f"{settings.API_PREFIX}/auth"

PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128

# ─────────────────────────────── Passwords ───────────────────────────────

_password_hasher = PasswordHasher()  # Argon2id with the library's RFC 9106 low-memory profile


def hash_password(password: str) -> str:
    """Argon2id hash (salted, self-describing PHC string)."""
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Constant-time check of ``password`` against a stored hash; never raises."""
    try:
        return _password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    """True when the hash was produced with weaker parameters than the current ones."""
    return _password_hasher.check_needs_rehash(password_hash)


@lru_cache(maxsize=1)
def _dummy_hash() -> str:
    return hash_password("mandimate-timing-equaliser-0")


def burn_password_check(password: str) -> None:
    """Spend the same effort as ``verify_password`` when there is no account to check.

    Called for unknown login identifiers so response timing does not reveal whether an
    account exists.
    """
    verify_password(password, _dummy_hash())


TEMPORARY_PASSWORD_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
"""Upper-case letters and digits without look-alikes (no I, L, O, 0, 1) for read-aloud handover."""


def generate_temporary_password() -> str:
    """A strong, readable one-time password such as ``Lot-7K4P-9Q2M`` (≈ 40 bits of entropy).

    Always satisfies the password policy (letters from the ``Lot`` prefix, at least one digit).
    """
    while True:
        groups = [
            "".join(secrets.choice(TEMPORARY_PASSWORD_ALPHABET) for _ in range(4)) for _ in range(2)
        ]
        candidate = "Lot-" + "-".join(groups)
        if any(char.isdigit() for char in candidate) and check_password_policy(candidate) is None:
            return candidate


def check_password_policy(password: str) -> str | None:
    """Return why ``password`` breaks the policy, or ``None`` when it is acceptable.

    Policy: 8..128 characters with at least one letter and at least one digit.
    """
    if len(password) < PASSWORD_MIN_LENGTH:
        return f"Password must be at least {PASSWORD_MIN_LENGTH} characters long"
    if len(password) > PASSWORD_MAX_LENGTH:
        return f"Password must be at most {PASSWORD_MAX_LENGTH} characters long"
    if not any(char.isalpha() for char in password):
        return "Password must contain at least one letter"
    if not any(char.isdigit() for char in password):
        return "Password must contain at least one digit"
    return None


# ─────────────────────────────── Identifiers ─────────────────────────────

_PHONE_SEPARATORS = re.compile(r"[\s\-().]")
_INDIAN_NATIONAL_NUMBER = re.compile(r"[1-9]\d{9}")
_INTERNATIONAL_NUMBER = re.compile(r"[1-9]\d{7,14}")


def normalize_phone(raw: str) -> str:
    """Normalise a phone number to E.164; Indian numbers become ``+91XXXXXXXXXX``.

    Accepts ``98765 43210``, ``09876543210``, ``919876543210``, ``+91 98765-43210`` and
    ``0091…``. Other countries must be written with ``+`` and their country code.
    Raises ``ValueError`` when the input is not a phone number.
    """
    compact = _PHONE_SEPARATORS.sub("", raw.strip())
    if compact.startswith("00"):
        compact = "+" + compact[2:]

    if compact.startswith("+"):
        digits = compact[1:]
        if not digits.isdigit():
            raise ValueError("Enter a valid phone number")
        if digits.startswith("91") and len(digits) == 12:
            national = digits[2:]
        elif _INTERNATIONAL_NUMBER.fullmatch(digits) and not digits.startswith("91"):
            return "+" + digits
        else:
            raise ValueError("Enter a valid phone number")
    elif compact.isdigit() and len(compact) == 10:
        national = compact
    elif compact.isdigit() and len(compact) == 11 and compact.startswith("0"):
        national = compact[1:]
    elif compact.isdigit() and len(compact) == 12 and compact.startswith("91"):
        national = compact[2:]
    else:
        raise ValueError("Enter a valid phone number")

    if not _INDIAN_NATIONAL_NUMBER.fullmatch(national):
        raise ValueError("Enter a valid phone number")
    return "+91" + national


def normalize_email(raw: str) -> str:
    """Emails are matched case-insensitively, so they are stored trimmed and lower-cased."""
    return raw.strip().lower()


# ────────────────────────────────── JWT ──────────────────────────────────


class TokenError(Exception):
    """The token is missing a claim, malformed, expired, tampered with or of the wrong type."""


@dataclass(frozen=True, slots=True)
class TokenPayload:
    sub: uuid.UUID
    role: str
    type: TokenType
    jti: str
    iat: datetime
    exp: datetime


@dataclass(frozen=True, slots=True)
class IssuedToken:
    token: str
    jti: str
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class AuthTokens:
    access: IssuedToken
    refresh: IssuedToken


def _lifetime(token_type: TokenType) -> timedelta:
    if token_type == "access":
        return timedelta(minutes=settings.ACCESS_TOKEN_MINUTES)
    return timedelta(days=settings.REFRESH_TOKEN_DAYS)


def issue_token(
    user_id: uuid.UUID,
    role: str,
    token_type: TokenType,
    *,
    lifetime: timedelta | None = None,
) -> IssuedToken:
    """Sign a JWT carrying ``sub``, ``role``, ``type``, ``jti``, ``iat`` and ``exp``."""
    issued_at = utcnow().replace(microsecond=0)
    expires_at = issued_at + (lifetime if lifetime is not None else _lifetime(token_type))
    jti = uuid.uuid4().hex
    claims = {
        "sub": str(user_id),
        "role": role,
        "type": token_type,
        "jti": jti,
        "iat": issued_at,
        "exp": expires_at,
    }
    token = jwt.encode(claims, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return IssuedToken(token=token, jti=jti, expires_at=expires_at)


def create_access_token(user: User) -> str:
    """Short-lived access token for ``user`` (also accepted as ``Authorization: Bearer``)."""
    return issue_token(user.id, user.role, "access").token


def create_refresh_token(user: User) -> IssuedToken:
    """Long-lived refresh token; persist its ``jti`` to support rotation and revocation."""
    return issue_token(user.id, user.role, "refresh")


def decode_token(token: str, expected_type: TokenType) -> TokenPayload:
    """Verify signature, expiry and claims; raise ``TokenError`` on any problem."""
    try:
        claims = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
            options={"require": ["sub", "role", "type", "jti", "iat", "exp"]},
        )
    except jwt.PyJWTError as exc:
        raise TokenError(str(exc)) from exc

    if claims["type"] != expected_type:
        raise TokenError(f"Expected a {expected_type} token")
    try:
        subject = uuid.UUID(str(claims["sub"]))
    except ValueError as exc:
        raise TokenError("Invalid subject") from exc
    return TokenPayload(
        sub=subject,
        role=str(claims["role"]),
        type=expected_type,
        jti=str(claims["jti"]),
        iat=datetime.fromtimestamp(int(claims["iat"]), tz=UTC),
        exp=datetime.fromtimestamp(int(claims["exp"]), tz=UTC),
    )


# ──────────────────────────────── Cookies ────────────────────────────────


def set_auth_cookies(response: Response, user: User) -> AuthTokens:
    """Mint a fresh access/refresh pair for ``user`` and attach both as httpOnly cookies.

    The returned tokens let the caller persist the refresh ``jti`` (``RefreshToken`` model).
    """
    tokens = AuthTokens(
        access=issue_token(user.id, user.role, "access"),
        refresh=create_refresh_token(user),
    )
    response.set_cookie(
        ACCESS_COOKIE,
        tokens.access.token,
        max_age=settings.ACCESS_TOKEN_MINUTES * 60,
        path=ACCESS_COOKIE_PATH,
        domain=settings.COOKIE_DOMAIN,
        secure=settings.COOKIE_SECURE,
        httponly=True,
        samesite="lax",
    )
    response.set_cookie(
        REFRESH_COOKIE,
        tokens.refresh.token,
        max_age=settings.REFRESH_TOKEN_DAYS * 24 * 3600,
        path=REFRESH_COOKIE_PATH,
        domain=settings.COOKIE_DOMAIN,
        secure=settings.COOKIE_SECURE,
        httponly=True,
        samesite="lax",
    )
    return tokens


def clear_auth_cookies(response: Response) -> None:
    """Expire both auth cookies (same name, path and domain as when they were set)."""
    for name, path in ((ACCESS_COOKIE, ACCESS_COOKIE_PATH), (REFRESH_COOKIE, REFRESH_COOKIE_PATH)):
        response.delete_cookie(
            name,
            path=path,
            domain=settings.COOKIE_DOMAIN,
            secure=settings.COOKIE_SECURE,
            httponly=True,
            samesite="lax",
        )
