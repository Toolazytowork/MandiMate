"""In-app notifications."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app import schemas
from app.core.deps import CurrentUser, DbSession
from app.services import notification_service

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=list[schemas.Notification], summary="My notifications")
async def list_notifications(
    user: CurrentUser,
    db: DbSession,
    unread_only: bool = False,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[schemas.Notification]:
    items = await notification_service.list_notifications(
        db, user, unread_only=unread_only, limit=limit
    )
    return [schemas.Notification.model_validate(item) for item in items]


@router.get("/unread-count", response_model=schemas.UnreadCount, summary="Unread notifications")
async def unread_count(user: CurrentUser, db: DbSession) -> schemas.UnreadCount:
    return schemas.UnreadCount(count=await notification_service.unread_count(db, user))


@router.post(
    "/read-all",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Mark all my notifications read",
)
async def read_all(user: CurrentUser, db: DbSession) -> None:
    await notification_service.mark_all_read(db, user)


@router.post(
    "/{notification_id}/read", response_model=schemas.Notification, summary="Mark one read"
)
async def mark_read(
    notification_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> schemas.Notification:
    notification = await notification_service.mark_read(db, user, notification_id)
    return schemas.Notification.model_validate(notification)
