"""Sign-up, login, token refresh, logout and the current user."""

from typing import Annotated

from fastapi import APIRouter, Cookie, Request, Response, status

from app import schemas
from app.core.deps import CurrentUser, DbSession, get_client_ip
from app.core.security import REFRESH_COOKIE
from app.services import auth_service
from app.services.presenters import user_out

router = APIRouter(prefix="/auth", tags=["auth"])

RefreshCookie = Annotated[str | None, Cookie(alias=REFRESH_COOKIE, include_in_schema=False)]


def _client(request: Request) -> auth_service.ClientInfo:
    return auth_service.ClientInfo(
        ip=get_client_ip(request), user_agent=request.headers.get("user-agent")
    )


@router.post(
    "/signup",
    response_model=schemas.AuthResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create an account and sign in",
)
async def signup(
    body: schemas.SignupRequest, request: Request, response: Response, db: DbSession
) -> schemas.AuthResponse:
    user = await auth_service.signup(db, body, response, _client(request))
    return schemas.AuthResponse(user=user_out(user))


@router.post("/login", response_model=schemas.AuthResponse, summary="Sign in with email or phone")
async def login(
    body: schemas.LoginRequest, request: Request, response: Response, db: DbSession
) -> schemas.AuthResponse:
    user = await auth_service.login(db, body, response, _client(request))
    return schemas.AuthResponse(user=user_out(user))


@router.post("/refresh", response_model=schemas.AuthResponse, summary="Rotate the session cookies")
async def refresh(
    request: Request, response: Response, db: DbSession, refresh_token: RefreshCookie = None
) -> schemas.AuthResponse:
    user = await auth_service.refresh(db, refresh_token, response, _client(request))
    return schemas.AuthResponse(user=user_out(user))


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Sign out (revokes the refresh token and clears both cookies)",
)
async def logout(response: Response, db: DbSession, refresh_token: RefreshCookie = None) -> None:
    await auth_service.logout(db, refresh_token, response)


@router.get("/me", response_model=schemas.User, summary="The signed-in user")
async def me(user: CurrentUser) -> schemas.User:
    return user_out(user)
