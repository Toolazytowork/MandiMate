"""Dispute schemas."""

import uuid
from datetime import datetime
from typing import Literal

from app.schemas.common import (
    ApiModel,
    DisputeCategory,
    DisputeStatus,
    LongText,
    OptionalLongText,
    RequestModel,
    Role,
)


class Dispute(ApiModel):
    id: uuid.UUID
    code: str
    lot_id: uuid.UUID
    lot_code: str
    settlement_id: uuid.UUID | None
    raised_by_id: uuid.UUID
    raised_by_name: str
    raised_by_role: Role
    category: DisputeCategory
    description: str
    status: DisputeStatus
    resolution: str | None
    resolved_by_name: str | None
    created_at: datetime
    resolved_at: datetime | None


class DisputeCreateRequest(RequestModel):
    lot_id: uuid.UUID
    settlement_id: uuid.UUID | None = None
    category: DisputeCategory
    description: LongText


class DisputeUpdateRequest(RequestModel):
    status: Literal["under_review", "resolved", "rejected"]
    resolution: OptionalLongText = None
