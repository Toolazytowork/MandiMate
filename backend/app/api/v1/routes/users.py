"""Profile, password and verification requests."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status

from app import schemas
from app.core.deps import CurrentUser, DbSession, get_client_ip, require_roles
from app.models import User
from app.services import user_service
from app.services.auth_service import ClientInfo
from app.services.presenters import user_out

router = APIRouter(prefix="/users", tags=["users"])


@router.patch("/me", response_model=schemas.User, summary="Update my profile")
async def update_me(
    body: schemas.UpdateProfileRequest, user: CurrentUser, db: DbSession
) -> schemas.User:
    return user_out(await user_service.update_profile(db, user, body))


@router.post(
    "/me/password",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Change my password (signs out my other sessions)",
)
async def change_password(
    body: schemas.ChangePasswordRequest,
    request: Request,
    response: Response,
    user: CurrentUser,
    db: DbSession,
) -> None:
    client = ClientInfo(ip=get_client_ip(request), user_agent=request.headers.get("user-agent"))
    await user_service.change_password(db, user, body, response, client)


@router.post(
    "/me/verification-request",
    response_model=schemas.User,
    summary="Ask MandiMate to verify my business (buyers and transporters)",
)
async def request_verification(
    body: schemas.VerificationRequest,
    user: Annotated[User, Depends(require_roles("buyer", "transporter"))],
    db: DbSession,
) -> schemas.User:
    return user_out(await user_service.request_verification(db, user, body))
