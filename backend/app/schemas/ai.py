"""AI assistant schemas. Numbers in AI responses always come from the calculation engines."""

import uuid
from datetime import date, datetime
from typing import Literal

from app.schemas.common import AiSource, ApiModel, Grade, Language, LongText, RequestModel
from app.schemas.matching import MatchProposal
from app.schemas.pricing import SellingOption

HarvestDraftField = Literal[
    "crop_id",
    "crop_name",
    "variety",
    "quantity_kg",
    "grade",
    "harvest_date",
    "available_from",
    "sell_by",
    "quality_notes",
    "min_price_per_kg",
]
"""Field names of HarvestDraft (TS: ``keyof HarvestDraft``)."""


class AiStatus(ApiModel):
    mode: Literal["live", "mock"]
    """'mock' = no API key configured; deterministic rule-based responses only."""
    provider: Literal["deepseek"]
    model: str
    features: list[str]


class AiText(ApiModel):
    text: str
    source: AiSource
    model: str | None
    generated_at: datetime
    disclaimer: str


class VoiceListingRequest(RequestModel):
    transcript: LongText
    language: Language


class HarvestDraft(ApiModel):
    crop_id: uuid.UUID | None
    crop_name: str | None
    variety: str | None
    quantity_kg: float | None
    grade: Grade | None
    harvest_date: date | None
    available_from: date | None
    sell_by: date | None
    quality_notes: str | None
    min_price_per_kg: float | None


class VoiceDraft(ApiModel):
    transcript: str
    language: Language
    draft: HarvestDraft
    missing_fields: list[HarvestDraftField]
    """Keys of HarvestDraft that still need the farmer's confirmation."""
    follow_up_question: str
    confidence: float
    source: AiSource


class DealAdviceRequest(RequestModel):
    harvest_id: uuid.UUID


class CounterSuggestion(ApiModel):
    offer_id: uuid.UUID
    current_price_per_kg: float
    suggested_price_per_kg: float
    floor_price_per_kg: float | None
    market_reference_per_kg: float | None
    rationale: str
    source: AiSource


class DealAdvice(ApiModel):
    harvest_id: uuid.UUID
    options: list[SellingOption]
    recommended_option_id: str | None
    explanation: AiText
    counteroffer: CounterSuggestion | None


class MatchExplanationRequest(RequestModel):
    proposal: MatchProposal
