"""Admin & verification schemas."""

import uuid
from datetime import datetime
from typing import Literal

from app.schemas.common import ApiModel, OptionalLongText, RequestModel


class VerifyUserRequest(RequestModel):
    status: Literal["verified", "rejected"]
    note: OptionalLongText = None


class AuditEntry(ApiModel):
    id: uuid.UUID
    actor_name: str | None
    action: str
    entity_type: str
    entity_id: str | None
    summary: str
    created_at: datetime
