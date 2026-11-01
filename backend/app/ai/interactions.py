"""Telemetry for AI calls (``ai_interactions``): sizes and timing only, never prompt text."""

from __future__ import annotations

import time
from typing import TYPE_CHECKING

from app.core.config import settings
from app.models import AiInteraction

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models import User
    from app.models.enums import AiSource

MAX_ERROR_LENGTH = 500

FEATURE_VOICE_LISTING = "voice_listing"
FEATURE_DEAL_ADVICE = "deal_advice"
FEATURE_COUNTER_SUGGESTION = "counter_suggestion"
FEATURE_MATCH_EXPLANATION = "match_explanation"
FEATURE_INSIGHTS_SUMMARY = "insights_summary"

FEATURES: tuple[str, ...] = (
    FEATURE_VOICE_LISTING,
    FEATURE_DEAL_ADVICE,
    FEATURE_COUNTER_SUGGESTION,
    FEATURE_MATCH_EXPLANATION,
    FEATURE_INSIGHTS_SUMMARY,
)


def describe_error(exc: BaseException) -> str:
    """``"TimeoutError: …"`` with any configured API key masked, truncated for storage."""
    message = str(exc).strip()
    text = f"{type(exc).__name__}: {message}" if message else type(exc).__name__
    key = settings.DEEPSEEK_API_KEY.strip()
    if key:
        text = text.replace(key, "***")
    return text[:MAX_ERROR_LENGTH]


class Stopwatch:
    """Milliseconds since creation."""

    def __init__(self) -> None:
        self._start = time.perf_counter()

    def elapsed_ms(self) -> int:
        return max(0, round((time.perf_counter() - self._start) * 1000))


async def record(
    db: AsyncSession,
    user: User | None,
    feature: str,
    source: AiSource,
    model: str | None,
    latency_ms: int,
    input_chars: int,
    output_chars: int,
    success: bool,
    error: str | None = None,
) -> AiInteraction:
    """Add one ``ai_interactions`` row (flushed; committed with the request).

    ``success`` is ``False`` when a live model call failed and the rules answered instead;
    ``error`` then says why (API keys are masked, text truncated).
    """
    entry = AiInteraction(
        user_id=user.id if user is not None else None,
        feature=feature,
        source=source,
        model=model,
        latency_ms=max(0, int(latency_ms)),
        input_chars=max(0, int(input_chars)),
        output_chars=max(0, int(output_chars)),
        success=success,
        error=error[:MAX_ERROR_LENGTH] if error else None,
    )
    db.add(entry)
    await db.flush()
    return entry
