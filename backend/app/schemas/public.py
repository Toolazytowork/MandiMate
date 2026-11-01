"""Public (unauthenticated) schemas: stats, health and contact."""

from typing import Literal

from app.schemas.common import (
    ApiModel,
    Email,
    LongText,
    OptionalShortText,
    RequestModel,
    ShortText,
)


class PublicStats(ApiModel):
    farmers: int
    buyers: int
    transporters: int
    kg_traded: float
    lots_completed: int
    avg_uplift_per_kg: float | None
    is_demo_data: bool


class HealthStatus(ApiModel):
    status: Literal["ok", "degraded"]
    database: Literal["ok", "error"]
    ai_mode: Literal["live", "mock"]
    version: str


class ContactRequest(RequestModel):
    name: ShortText
    email: Email
    organization: OptionalShortText = None
    role: OptionalShortText = None
    message: LongText
