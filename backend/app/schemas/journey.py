"""Eight-step journey tracking schemas."""

from datetime import datetime

from app.schemas.common import ApiModel, JourneyKey, JourneyStepStatus


class JourneyStep(ApiModel):
    step: int
    key: JourneyKey
    label: str
    status: JourneyStepStatus
    at: datetime | None
    detail: str | None
