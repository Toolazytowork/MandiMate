"""In-app notification schemas."""

import uuid
from datetime import datetime

from app.schemas.common import ApiModel, NotificationType


class Notification(ApiModel):
    id: uuid.UUID
    type: NotificationType
    title: str
    body: str
    link: str | None
    """In-app path, e.g. "/app/farmer/offers"."""
    read_at: datetime | None
    created_at: datetime


class UnreadCount(ApiModel):
    count: int
