"""AI assistant entry points used by the routes (DOMAIN_RULES §11, docs/AI.md).

Every function computes its structured answer with the rules and engines first; a live model (only
in ``live`` mode) adds language on top. Any live failure (timeout, HTTP error, malformed or
ungrounded output) silently falls back to the rules text with ``source: "rules"``. Each call is
recorded in ``ai_interactions`` (sizes and timing, never text).
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel
from sqlalchemy import select

from app import schemas
from app.ai import facts, interactions, llm, prompts, templates, voice_parser
from app.ai.agents.deal_agent import run_deal_agent
from app.ai.grounding import allowed_numbers, ungrounded
from app.ai.tools import DealContext, MarketReference
from app.core.config import settings
from app.core.errors import conflict, not_found
from app.core.time import today_ist, utcnow
from app.models import Crop, Harvest, Offer, User
from app.services import market_service, pricing, selling_options
from app.services.presenters import mask_name

if TYPE_CHECKING:
    from langchain_core.language_models.chat_models import BaseChatModel
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models.enums import AiSource

logger = logging.getLogger(__name__)

RULES_MODEL = "rules"
"""``AiStatus.model`` in mock mode."""
COUNTER_OPEN_STATUSES = ("pending", "countered", "proposed")
REWRITE_MAX_WORDS = 120
REWRITE_WORD_LIMIT = 220
"""Model rewrites longer than this are treated as malformed."""


# ─────────────────────────────── Shared plumbing ───────────────────────────────


@dataclass(frozen=True)
class _Outcome:
    text: str
    source: AiSource
    attempted_model: str | None
    success: bool
    error: str | None


def _live_model() -> tuple[BaseChatModel | None, str | None]:
    """``(model, None)`` in live mode, ``(None, None)`` in mock mode, ``(None, error)`` when the
    live client cannot be created."""
    try:
        return llm.get_chat_model(), None
    except Exception as exc:
        error = interactions.describe_error(exc)
        logger.warning("AI model unavailable, using rules: %s", error)
        return None, error


async def _with_fallback(
    rules_text: str, live: Callable[[BaseChatModel], Awaitable[str]]
) -> _Outcome:
    """Run ``live`` with the live model when there is one; the rules text otherwise or on error."""
    model, error = _live_model()
    if model is None:
        if error is not None:
            return _Outcome(rules_text, "rules", llm.model_name(), False, error)
        return _Outcome(rules_text, "rules", None, True, None)
    try:
        text = await live(model)
    except Exception as exc:
        error = interactions.describe_error(exc)
        logger.warning("AI call failed, using rules: %s", error)
        return _Outcome(rules_text, "rules", llm.model_name(), False, error)
    return _Outcome(text, "ai", llm.model_name(), True, None)


def _ai_text(outcome: _Outcome, language: str) -> schemas.AiText:
    return schemas.AiText(
        text=outcome.text,
        source=outcome.source,
        model=llm.model_name() if outcome.source == "ai" else None,
        generated_at=utcnow(),
        disclaimer=templates.disclaimer(language, outcome.source),
    )


async def _record(
    db: AsyncSession,
    user: User | None,
    feature: str,
    outcome: _Outcome,
    watch: interactions.Stopwatch,
    input_chars: int,
    output_chars: int,
) -> None:
    await interactions.record(
        db,
        user,
        feature,
        outcome.source,
        outcome.attempted_model,
        watch.elapsed_ms(),
        input_chars,
        output_chars,
        outcome.success,
        outcome.error,
    )


def _language(user: User | None) -> str:
    language = getattr(user, "preferred_language", None)
    return language if language in templates.LANGUAGE_NAMES else "en"


def _dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


async def _rewrite(
    model: BaseChatModel,
    *,
    fact_data: Any,
    rules_text: str,
    task: str,
    language: str,
) -> str:
    """LLM wording of ``rules_text`` constrained to ``fact_data`` (numbers checked)."""
    messages = [
        SystemMessage(content=prompts.REWRITE_PROMPT),
        HumanMessage(
            content=(
                f"<data>\n{_dump(fact_data)}\n</data>\n\n"
                f"<data>\nRules-based draft of the same facts:\n{rules_text}\n</data>\n\n"
                + prompts.rewrite_instruction(task, language, REWRITE_MAX_WORDS)
            )
        ),
    ]
    async with asyncio.timeout(settings.AI_TIMEOUT_SECONDS):
        message = await model.ainvoke(messages)
    text = llm.message_text(getattr(message, "content", "")).strip()
    if not text:
        raise ValueError("The model returned no text")
    if len(text.split()) > REWRITE_WORD_LIMIT:
        raise ValueError("The model's text is too long")
    invented = ungrounded(text, allowed_numbers(fact_data, rules_text))
    if invented:
        raise ValueError(
            "The model used numbers that are not in the facts: "
            + ", ".join(str(number) for number in invented[:5])
        )
    return text


# ─────────────────────────────── Status ───────────────────────────────


def ai_status() -> schemas.AiStatus:
    """Effective AI mode, provider, model and enabled features."""
    mode = llm.ai_mode()
    return schemas.AiStatus(
        mode=mode,
        provider="deepseek",
        model=llm.model_name() if mode == "live" else RULES_MODEL,
        features=list(interactions.FEATURES),
    )


# ─────────────────────────────── Voice listing ───────────────────────────────


class LlmListing(BaseModel):
    """What the model may extract; every value is re-validated by the rules."""

    crop: str | None = None
    variety: str | None = None
    quantity_kg: float | None = None
    grade: str | None = None
    harvest_date: str | None = None
    available_from: str | None = None
    sell_by: str | None = None
    quality_notes: str | None = None
    min_price_per_kg: float | None = None


def _iso_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value.strip()[:10])
    except ValueError:
        return None


async def _llm_listing(
    model: BaseChatModel,
    req: schemas.VoiceListingRequest,
    crops: Sequence[Crop],
    today: date,
) -> dict[str, Any]:
    """Model extraction mapped onto draft fields (crop resolved against the catalogue)."""
    catalogue = ", ".join(crop.name for crop in crops) or "(none)"
    transcript = req.transcript.replace("</transcript>", "")
    runnable = llm.structured_model(model, LlmListing)
    messages = [
        SystemMessage(content=prompts.voice_extraction_prompt(today.isoformat(), catalogue)),
        HumanMessage(
            content=f'<transcript language="{req.language}">\n{transcript}\n</transcript>'
        ),
    ]
    async with asyncio.timeout(settings.AI_TIMEOUT_SECONDS):
        result = await runnable.ainvoke(messages)
    if isinstance(result, dict):
        result = LlmListing.model_validate(result)
    if not isinstance(result, LlmListing):
        raise ValueError("Malformed structured output")

    extra: dict[str, Any] = {
        "variety": result.variety,
        "quantity_kg": result.quantity_kg,
        "grade": result.grade.strip().upper() if result.grade else None,
        "harvest_date": _iso_date(result.harvest_date),
        "available_from": _iso_date(result.available_from),
        "sell_by": _iso_date(result.sell_by),
        "quality_notes": result.quality_notes,
        "min_price_per_kg": result.min_price_per_kg,
    }
    crop = voice_parser.match_crop(result.crop, crops)
    if crop is not None:
        extra["crop_id"] = crop.id
        extra["crop_name"] = crop.name
    return extra


async def parse_voice_listing(
    db: AsyncSession, req: schemas.VoiceListingRequest, user: User
) -> schemas.VoiceDraft:
    """Turn a spoken transcript into a harvest draft, listing fields that still need input."""
    watch = interactions.Stopwatch()
    today = today_ist()
    crops = list((await db.scalars(select(Crop).order_by(Crop.name))).all())
    raw, ambiguities = voice_parser.extract_fields(req.transcript, req.language, crops, today)
    fields = voice_parser.validate_fields(raw, today)

    source: AiSource = "rules"
    model, error = _live_model()
    success = error is None
    attempted = llm.model_name() if model is not None or error is not None else None
    if model is not None:
        try:
            extra = await _llm_listing(model, req, crops, today)
            fields, contributed = voice_parser.merge(fields, extra, today)
            if contributed:
                source = "ai"
        except Exception as exc:
            success, error = False, interactions.describe_error(exc)
            logger.warning("Voice extraction failed, using rules: %s", error)

    draft, missing, confidence = voice_parser.finalize(fields, today, ambiguities)
    result = schemas.VoiceDraft(
        transcript=req.transcript,
        language=req.language,
        draft=draft,
        missing_fields=missing,
        follow_up_question=templates.follow_up_question(req.language, missing),
        confidence=confidence,
        source=source,
    )
    outcome = _Outcome(result.follow_up_question, source, attempted, success, error)
    await _record(
        db,
        user,
        interactions.FEATURE_VOICE_LISTING,
        outcome,
        watch,
        len(req.transcript),
        len(draft.model_dump_json()),
    )
    return result


# ─────────────────────────────── Counter-offer ───────────────────────────────


@dataclass(frozen=True)
class CounterNumbers:
    current: Decimal
    suggested: Decimal
    floor: Decimal | None
    market: Decimal | None
    accept_advised: bool
    floor_driven: bool
    floor_unreachable: bool


def _active_member_harvests(offer: Offer) -> list[Harvest]:
    if offer.lot is None:
        return []
    return [member.harvest for member in offer.lot.members if member.consent_status != "declined"]


def _subject_harvest(offer: Offer, viewer: User, harvest_id: uuid.UUID | None) -> Harvest | None:
    """The harvest whose perspective is asked for (``None`` = the whole lot, coordinators)."""
    if offer.target_type == "harvest":
        harvest = offer.harvest
        if harvest is None or (harvest_id is not None and harvest.id != harvest_id):
            raise not_found("Harvest in this offer")
        if viewer.role == "farmer" and harvest.farmer_id != viewer.id:
            raise not_found("Offer")
        return harvest
    harvests = _active_member_harvests(offer)
    if harvest_id is not None:
        harvest = next((h for h in harvests if h.id == harvest_id), None)
        if harvest is None or (viewer.role == "farmer" and harvest.farmer_id != viewer.id):
            raise not_found("Harvest in this offer")
        return harvest
    if viewer.role == "farmer":
        harvest = next((h for h in harvests if h.farmer_id == viewer.id), None)
        if harvest is None:
            raise not_found("Your share of this offer")
        return harvest
    return None


def _floor_for(
    breakdown: schemas.NetProceeds, offer: Offer, min_price: Decimal | None
) -> tuple[Decimal | None, bool]:
    """Smallest price whose net per kg reaches ``min_price``, with the inputs the engine used
    for ``breakdown`` (its transport share and rejection, the offer's handling, commission and
    payment terms). Returns ``(floor, unreachable)``."""
    if min_price is None:
        return None, False
    quantity = pricing.to_decimal(breakdown.quantity_kg)
    if quantity <= 0:
        return None, False
    gross = facts.line(breakdown, "gross")
    rejection = facts.line(breakdown, "rejection")
    transport = facts.line(breakdown, "transport")
    gross_amount = pricing.to_decimal(gross.amount) if gross else Decimal(0)
    rejection_pct = Decimal(0)
    if gross_amount > 0 and rejection is not None:
        rejection_pct = min(
            Decimal(100),
            max(Decimal(0), -pricing.to_decimal(rejection.amount) / gross_amount * 100),
        )
    transport_cost = -pricing.to_decimal(transport.amount) if transport else Decimal(0)
    try:
        floor = pricing.floor_price_for_min_net(
            min_net_per_kg=min_price,
            quantity_kg=quantity,
            transport_cost=max(Decimal(0), transport_cost),
            handling_per_kg=offer.handling_charge_per_kg + pricing.LOADING_PER_KG,
            commission_pct=offer.commission_pct,
            rejection_pct=rejection_pct,
            payment_terms_days=breakdown.payment_terms_days,
        )
    except ValueError:
        return None, True
    return floor, False


async def counter_numbers(
    db: AsyncSession, offer: Offer, viewer: User, harvest_id: uuid.UUID | None = None
) -> CounterNumbers:
    """Rule-based counter price for ``offer`` from the viewer's (or one member's) perspective.

    Floor: for one harvest, the price at which its share nets the farmer's minimum; for a whole
    lot, the highest such price over members with a minimum (everyone's floor is met).
    """
    harvest = _subject_harvest(offer, viewer, harvest_id)
    floor: Decimal | None = None
    unreachable = False
    if harvest is not None:
        breakdown = await selling_options.offer_breakdown(db, offer, viewer, harvest.id)
        floor, unreachable = _floor_for(breakdown, offer, harvest.min_price_per_kg)
    else:
        for member_harvest in _active_member_harvests(offer):
            if member_harvest.min_price_per_kg is None:
                continue
            breakdown = await selling_options.offer_breakdown(db, offer, viewer, member_harvest.id)
            member_floor, member_unreachable = _floor_for(
                breakdown, offer, member_harvest.min_price_per_kg
            )
            unreachable = unreachable or member_unreachable
            if member_floor is not None and (floor is None or member_floor > floor):
                floor = member_floor

    district = (
        harvest.district
        if harvest is not None
        else (offer.lot.district if offer.lot is not None else None)
    )
    market_price = await market_service.latest_market_price(db, offer.crop_id, district)
    market = (
        pricing.round_money(market_price.modal_price_per_kg) if market_price is not None else None
    )
    current = pricing.round_money(offer.price_per_kg)
    suggested, accept = pricing.suggest_counter_price(
        current_price=current, floor_price=floor, market_reference=market
    )
    floor_driven = False
    if floor is not None and not accept:
        without_floor, _ = pricing.suggest_counter_price(
            current_price=current, floor_price=None, market_reference=market
        )
        floor_driven = without_floor < floor
    return CounterNumbers(
        current=current,
        suggested=suggested,
        floor=floor,
        market=market,
        accept_advised=accept,
        floor_driven=floor_driven,
        floor_unreachable=unreachable and floor is None,
    )


def _counter_rules_text(numbers: CounterNumbers, language: str) -> str:
    return templates.counter_rationale(
        language,
        current=numbers.current,
        suggested=numbers.suggested,
        floor=numbers.floor,
        market=numbers.market,
        accept_advised=numbers.accept_advised,
        floor_driven=numbers.floor_driven,
        floor_unreachable=numbers.floor_unreachable,
    )


def _counter_suggestion(
    offer: Offer, numbers: CounterNumbers, rationale: str, source: AiSource
) -> schemas.CounterSuggestion:
    return schemas.CounterSuggestion(
        offer_id=offer.id,
        current_price_per_kg=float(numbers.current),
        suggested_price_per_kg=float(numbers.suggested),
        floor_price_per_kg=float(numbers.floor) if numbers.floor is not None else None,
        market_reference_per_kg=float(numbers.market) if numbers.market is not None else None,
        rationale=rationale,
        source=source,
    )


async def suggest_counteroffer(
    db: AsyncSession, offer: Offer, viewer: User, harvest_id: uuid.UUID | None = None
) -> schemas.CounterSuggestion:
    """Rule-based counter price for an offer with an AI- or rules-worded rationale."""
    if offer.status not in COUNTER_OPEN_STATUSES:
        raise conflict("Counter-offer suggestions are only available while the offer is open")
    watch = interactions.Stopwatch()
    language = _language(viewer)
    numbers = await counter_numbers(db, offer, viewer, harvest_id)
    rules_text = _counter_rules_text(numbers, language)
    fact_data = {
        "current_price_per_kg": numbers.current,
        "suggested_price_per_kg": numbers.suggested,
        "floor_price_per_kg": numbers.floor,
        "market_reference_per_kg": numbers.market,
        "accept_current_price": numbers.accept_advised,
        "market_premium_cap_pct": 5,
    }

    async def live(model: BaseChatModel) -> str:
        return await _rewrite(
            model,
            fact_data=fact_data,
            rules_text=rules_text,
            task=(
                "Explain to the seller why MandiMate suggests this counter-offer price (or "
                "accepting the current price). Keep every price exactly as given and say the "
                "decision is theirs."
            ),
            language=language,
        )

    outcome = await _with_fallback(rules_text, live)
    await _record(
        db,
        viewer,
        interactions.FEATURE_COUNTER_SUGGESTION,
        outcome,
        watch,
        len(_dump(fact_data)),
        len(outcome.text),
    )
    return _counter_suggestion(offer, numbers, outcome.text, outcome.source)


# ─────────────────────────────── Deal advice ───────────────────────────────


async def _deal_counteroffer(
    db: AsyncSession, options: schemas.SellingOptions, harvest: Harvest, viewer: User
) -> schemas.CounterSuggestion | None:
    """Counter suggestion for the best open offer that waits for the seller (rules wording)."""
    waiting = [
        option
        for option in options.options
        if option.source != "baseline"
        and option.offer_status == "pending"
        and option.awaiting == "seller"
    ]
    if not waiting:
        return None
    offer = await db.get(Offer, uuid.UUID(waiting[0].option_id))
    if offer is None:
        return None
    numbers = await counter_numbers(db, offer, viewer, harvest.id)
    return _counter_suggestion(
        offer, numbers, _counter_rules_text(numbers, _language(viewer)), "rules"
    )


async def _market_reference(db: AsyncSession, harvest: Harvest) -> MarketReference | None:
    price = await market_service.latest_market_price(db, harvest.crop_id, harvest.district)
    if price is None:
        return None
    return MarketReference(
        modal_price_per_kg=float(pricing.round_money(price.modal_price_per_kg)),
        market_name=price.market_name,
        price_date=price.price_date,
        is_illustrative=price.is_illustrative,
    )


async def advise_deal(db: AsyncSession, harvest: Harvest, viewer: User) -> schemas.DealAdvice:
    """Explain the harvest's selling options and recommend one (numbers from the engines)."""
    watch = interactions.Stopwatch()
    language = _language(viewer)
    options = await selling_options.build_selling_options(db, harvest, viewer)
    comparison = facts.compare_options(options)
    counteroffer = await _deal_counteroffer(db, options, harvest, viewer)
    rules_text = templates.deal_explanation(
        language,
        templates.crop_label(harvest.crop, language),
        options,
        comparison,
        counteroffer,
    )

    async def live(model: BaseChatModel) -> str:
        context = DealContext(
            crop_name=harvest.crop.name,
            quantity_kg=float(harvest.quantity_kg),
            language=language,
            options=options,
            counteroffer=counteroffer,
            market=await _market_reference(db, harvest),
            min_price_per_kg=options.min_price_per_kg,
        )
        return await run_deal_agent(model, context)

    outcome = await _with_fallback(rules_text, live)
    await _record(
        db,
        viewer,
        interactions.FEATURE_DEAL_ADVICE,
        outcome,
        watch,
        len(options.model_dump_json()),
        len(outcome.text),
    )
    return schemas.DealAdvice(
        harvest_id=harvest.id,
        options=options.options,
        recommended_option_id=options.best_option_id,
        explanation=_ai_text(outcome, language),
        counteroffer=counteroffer,
    )


# ─────────────────────────────── Matching & insights ───────────────────────────────


async def explain_match(
    db: AsyncSession, proposal: schemas.MatchProposal, user: User
) -> schemas.AiText:
    """Plain-language explanation of why a match proposal is (or is not) promising."""
    watch = interactions.Stopwatch()
    language = _language(user)
    crop = await db.get(Crop, proposal.crop_id)
    label = templates.crop_label(crop, language) if crop is not None else proposal.crop_name.lower()
    rules_text = templates.match_explanation(language, proposal, label)
    # Farmer names leave MandiMate masked ("Ravi R."), in the facts and in the draft alike.
    masked = proposal.model_copy(
        update={
            "candidates": [
                c.model_copy(update={"farmer_name": mask_name(c.farmer_name)})
                for c in proposal.candidates
            ],
            "excluded": [
                e.model_copy(update={"farmer_name": mask_name(e.farmer_name)})
                for e in proposal.excluded
            ],
            "explanation": "",
        }
    )
    masked_draft = templates.match_explanation(language, masked, label)
    fact_data = masked.model_dump(
        mode="json",
        exclude={
            "crop_id": True,
            "demand_id": True,
            "explanation": True,
            "candidates": {"__all__": {"farmer_id", "harvest_id"}},
            "excluded": {"__all__": {"harvest_id"}},
        },
    )

    async def live(model: BaseChatModel) -> str:
        return await _rewrite(
            model,
            fact_data=fact_data,
            rules_text=masked_draft,
            task=(
                "Explain to a coordinator why this group of harvests is or is not a promising "
                "lot and what information is still missing (inspections, shortfall). The "
                "selection itself is fixed; do not change it."
            ),
            language=language,
        )

    outcome = await _with_fallback(rules_text, live)
    await _record(
        db,
        user,
        interactions.FEATURE_MATCH_EXPLANATION,
        outcome,
        watch,
        len(_dump(fact_data)),
        len(outcome.text),
    )
    return _ai_text(outcome, language)


async def summarize_insights(
    db: AsyncSession, insights: Sequence[schemas.CropBalance], user: User
) -> schemas.AiText:
    """Short narrative of supply/demand balance per crop for coordinators."""
    watch = interactions.Stopwatch()
    language = _language(user)
    crop_ids = list({balance.crop_id for balance in insights})
    crops = (
        {crop.id: crop for crop in (await db.scalars(select(Crop).where(Crop.id.in_(crop_ids))))}
        if crop_ids
        else {}
    )
    rows = [
        (
            templates.crop_label(crops[balance.crop_id], language)
            if balance.crop_id in crops
            else balance.crop_name.lower(),
            balance,
        )
        for balance in insights
    ]
    rules_text = templates.insights_summary(language, rows)
    fact_data = [balance.model_dump(mode="json", exclude={"crop_id"}) for balance in insights]

    async def live(model: BaseChatModel) -> str:
        return await _rewrite(
            model,
            fact_data=fact_data,
            rules_text=rules_text,
            task=(
                "Summarise for a coordinator where supply falls short of demand, where there "
                "is surplus, and how offers compare with mandi prices."
            ),
            language=language,
        )

    outcome = await _with_fallback(rules_text, live)
    await _record(
        db,
        user,
        interactions.FEATURE_INSIGHTS_SUMMARY,
        outcome,
        watch,
        len(_dump(fact_data)),
        len(outcome.text),
    )
    return _ai_text(outcome, language)
