"""FastAPI dependencies: database session, current user, role guards and client IP.

Usage in routes::

    @router.get("/me")
    async def me(user: CurrentUser, db: DbSession) -> schemas.User: ...

    @router.post("/lots")
    async def create_lot(
        body: schemas.LotCreateRequest,
        db: DbSession,
        user: Annotated[User, Depends(require_roles("coordinator"))],
    ) -> schemas.Lot: ...
"""

import ipaddress
from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import Depends, Request, Security, status
from fastapi.security import APIKeyCookie, HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.errors import DomainError, forbidden
from app.core.security import ACCESS_COOKIE, TokenError, decode_token
from app.models import User
from app.models.enums import Role

DbSession = Annotated[AsyncSession, Depends(get_db, scope="function")]
"""The request's session. Function scope: it commits before the response is sent."""

_access_cookie = APIKeyCookie(
    name=ACCESS_COOKIE,
    auto_error=False,
    scheme_name="AccessCookie",
    description="httpOnly access-token cookie set by /auth/login, /auth/signup and /auth/refresh.",
)
_bearer = HTTPBearer(
    auto_error=False,
    scheme_name="BearerToken",
    description="The same access token sent as `Authorization: Bearer <token>` by API clients.",
)

AccessCookie = Annotated[str | None, Security(_access_cookie)]
BearerCredentials = Annotated[HTTPAuthorizationCredentials | None, Security(_bearer)]


def _not_authenticated() -> DomainError:
    return DomainError(
        status.HTTP_401_UNAUTHORIZED,
        "Not authenticated",
        "not_authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def _user_from_token(db: AsyncSession, token: str) -> User | None:
    """The active user an access token belongs to, or ``None`` when the token is unusable."""
    try:
        payload = decode_token(token, "access")
    except TokenError:
        return None
    user = await db.get(User, payload.sub)
    if user is None or not user.is_active:
        return None
    return user


def _presented_token(cookie: str | None, bearer: HTTPAuthorizationCredentials | None) -> str | None:
    """An explicit ``Authorization`` header wins over the browser cookie."""
    if bearer is not None and bearer.credentials:
        return bearer.credentials
    return cookie or None


async def get_current_user(db: DbSession, cookie: AccessCookie, bearer: BearerCredentials) -> User:
    """The signed-in user; 401 ``Not authenticated`` when the token is missing or invalid."""
    token = _presented_token(cookie, bearer)
    if token is None:
        raise _not_authenticated()
    user = await _user_from_token(db, token)
    if user is None:
        raise _not_authenticated()
    return user


async def get_optional_user(
    db: DbSession, cookie: AccessCookie, bearer: BearerCredentials
) -> User | None:
    """The signed-in user, or ``None`` for anonymous callers (a stale token counts as none)."""
    token = _presented_token(cookie, bearer)
    if token is None:
        return None
    return await _user_from_token(db, token)


CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]


def require_roles(*roles: Role) -> Callable[[User], Awaitable[User]]:
    """Dependency allowing only ``roles`` (403 otherwise). Admins pass every coordinator check."""
    if not roles:
        raise ValueError("require_roles() needs at least one role")
    allowed: frozenset[str] = frozenset(roles)
    if "coordinator" in allowed:
        allowed |= {"admin"}

    async def ensure_role(user: CurrentUser) -> User:
        if user.role not in allowed:
            raise forbidden()
        return user

    ensure_role.__name__ = "require_" + "_or_".join(roles)
    return ensure_role


def _is_internal(address: str | None) -> bool:
    if address is None:
        return False
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private


def get_client_ip(request: Request) -> str | None:
    """Best-effort client IP.

    ``X-Forwarded-For`` is honoured only when the direct peer is a local/private proxy
    (Vite dev server, nginx in the compose network); otherwise the peer address is used.
    """
    peer = request.client.host if request.client else None
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded and _is_internal(peer):
        candidate = forwarded.split(",")[0].strip()
        try:
            return str(ipaddress.ip_address(candidate))
        except ValueError:
            return peer
    return peer
