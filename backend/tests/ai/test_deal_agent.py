"""Live AI paths exercised offline with scripted LangChain fake chat models.

Proves the deal agent calls its tools and delegates to the logistics-analyst sub-agent, that
answers quoting numbers the tools never returned are rejected, and that every live failure
(exception, timeout, malformed or ungrounded output, missing client) falls back to the rules.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import Callable, Iterator
from datetime import timedelta
from decimal import Decimal
from typing import Any

import pytest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatResult
from langchain_core.runnables import RunnableLambda
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import schemas
from app.ai import llm, service, templates
from app.ai.agents import DealAgentError, build_deal_agent, run_deal_agent
from app.ai.tools import DealContext, MarketReference, build_deal_tools
from app.core.config import settings
from app.core.time import today_ist
from app.models import AiInteraction, Crop
from app.services import pricing
from tests import factories
from tests.ai.test_ai_service_mock import (
    OFFER_B,
    balances,
    farmer_and_harvest,
    proposal,
    two_offers_and_baseline,
    use_options,
)

# ─────────────────────────────── Fake models ───────────────────────────────


class FakeToolModel(GenericFakeChatModel):
    """Scripted chat model that accepts tool binding (deepagents binds its tools)."""

    def bind_tools(self, tools: Any, **kwargs: Any) -> FakeToolModel:  # type: ignore[override]
        return self


class FailingModel(FakeToolModel):
    def _generate(self, *args: Any, **kwargs: Any) -> ChatResult:
        raise RuntimeError("provider unavailable")

    def _stream(self, *args: Any, **kwargs: Any) -> Iterator[Any]:
        raise RuntimeError("provider unavailable")


class SlowModel(FakeToolModel):
    async def _agenerate(self, *args: Any, **kwargs: Any) -> ChatResult:
        await asyncio.sleep(5)
        return await super()._agenerate(*args, **kwargs)


class FakeStructuredModel(FakeToolModel):
    """``with_structured_output`` returns ``payload`` parsed by the schema (or raises)."""

    payload: dict[str, Any] | None = None
    error: str | None = None

    def with_structured_output(self, schema: Any, **kwargs: Any) -> Any:  # type: ignore[override]
        async def run(_: Any) -> Any:
            if self.error is not None:
                raise ValueError(self.error)
            return schema.model_validate(self.payload or {})

        return RunnableLambda(run)


def call(name: str, args: dict[str, Any] | None = None, call_id: str = "c1") -> AIMessage:
    return AIMessage(
        content="",
        tool_calls=[{"name": name, "args": args or {}, "id": call_id, "type": "tool_call"}],
    )


def scripted(*messages: BaseMessage) -> FakeToolModel:
    return FakeToolModel(messages=iter(messages))


@pytest.fixture
def live_mode(monkeypatch: pytest.MonkeyPatch) -> Iterator[Callable[[Any], None]]:
    """Switch to live mode with an injected model factory (never DeepSeek)."""
    monkeypatch.setattr(settings, "AI_MODE", "live")
    monkeypatch.setattr(settings, "DEEPSEEK_API_KEY", "sk-test-key")
    previous = llm.set_chat_model_factory(None)

    def use(model: Any) -> None:
        llm.set_chat_model_factory(lambda: model)

    yield use
    llm.set_chat_model_factory(previous)
    llm.reset_cache()


@pytest.fixture
async def tomato(db: AsyncSession) -> Crop:
    return await factories.create_crop(db)


async def interactions_of(db: AsyncSession) -> list[AiInteraction]:
    return list((await db.scalars(select(AiInteraction).order_by(AiInteraction.created_at))).all())


def deal_context(language: str = "en") -> DealContext:
    options = two_offers_and_baseline(uuid.uuid4(), min_price=12)
    counter = schemas.CounterSuggestion(
        offer_id=uuid.UUID(OFFER_B),
        current_price_per_kg=18,
        suggested_price_per_kg=18,
        floor_price_per_kg=13.05,
        market_reference_per_kg=14,
        rationale="",
        source="rules",
    )
    return DealContext(
        crop_name="Tomato",
        quantity_kg=400,
        language=language,
        options=options,
        counteroffer=counter,
        market=MarketReference(14.0, "Madanapalle APMC", today_ist(), True),
        min_price_per_kg=12,
    )


def best_numbers(ctx: DealContext) -> tuple[str, str]:
    best = next(o for o in ctx.options.options if o.option_id == ctx.options.best_option_id)
    return pricing.format_rupees(best.net_per_kg), pricing.format_rupees(best.net_amount)


# ─────────────────────────────── The agent itself ───────────────────────────────


async def test_agent_uses_tools_and_logistics_sub_agent() -> None:
    ctx = deal_context()
    net_per_kg, net_total = best_numbers(ctx)
    answer = (
        f"The FreshBasket lot offer is best: you keep {net_per_kg} per kg, {net_total} in total. "
        "It pays ₹2.00 more per kg than Kisan Mart, but transport costs ₹1.50 more per kg. "
        "The transport quote is still pending. You decide."
    )
    main = scripted(
        call("get_selling_options"),
        call("get_option_breakdown", {"option_id": OFFER_B}, "c2"),
        call("get_counter_suggestion", call_id="c3"),
        call(
            "task",
            {
                "description": "Compare shared vs solo transport",
                "subagent_type": "logistics-analyst",
            },
            "c4",
        ),
        AIMessage(content=answer),
    )
    analyst = scripted(
        call("get_transport_comparison", call_id="s1"),
        AIMessage(content="Shared transport costs ₹2.50 per kg; the quote is pending."),
    )

    text = await run_deal_agent(main, ctx, subagent_model=analyst)

    assert text == answer
    assert ctx.tool_calls == [
        "get_selling_options",
        "get_option_breakdown",
        "get_counter_suggestion",
        "get_transport_comparison",
    ]


async def test_tool_outputs_are_engine_numbers() -> None:
    ctx = deal_context()
    tools = {tool.name: tool for tool in build_tool_list(ctx)}
    options = json.loads(tools["get_selling_options"].invoke({}))
    assert options["best_option_id"] == OFFER_B
    assert options["comparison_best_vs_next_offer"]["price_difference_per_kg"] == 2.0
    assert (
        options["comparison_best_vs_next_offer"]["transport_and_handling_difference_per_kg"] == 1.5
    )
    best = next(o for o in ctx.options.options if o.option_id == OFFER_B)
    by_id = {o["option_id"]: o for o in options["options"]}
    assert by_id[OFFER_B]["net_per_kg"] == best.net_per_kg
    breakdown = json.loads(tools["get_option_breakdown"].invoke({"option_id": OFFER_B}))
    assert [line["key"] for line in breakdown["lines"]] == list(pricing.LINE_ORDER)
    assert breakdown["net_amount"] == best.net_amount
    unknown = json.loads(tools["get_option_breakdown"].invoke({"option_id": "nope"}))
    assert unknown["error"] == "Unknown option_id"
    minimum = json.loads(tools["get_farmer_minimum"].invoke({}))
    assert minimum["min_net_price_per_kg"] == 12
    market = json.loads(tools["get_market_reference"].invoke({}))
    assert market["modal_price_per_kg"] == 14.0
    counter = json.loads(tools["get_counter_suggestion"].invoke({}))
    assert counter["accept_advised"] is True


def build_tool_list(ctx: DealContext) -> list[Any]:
    return build_deal_tools(ctx)


async def test_agent_answer_with_invented_numbers_is_rejected() -> None:
    ctx = deal_context()
    main = scripted(
        call("get_selling_options"),
        AIMessage(content="Take the FreshBasket offer: you will earn ₹19.75 per kg."),
    )
    with pytest.raises(DealAgentError, match=r"19\.75"):
        await run_deal_agent(main, ctx)


async def test_agent_empty_answer_is_rejected() -> None:
    main = scripted(AIMessage(content="   "))
    with pytest.raises(DealAgentError):
        await run_deal_agent(main, deal_context())


async def test_agent_too_long_answer_is_rejected() -> None:
    main = scripted(AIMessage(content="word " * 400))
    with pytest.raises(DealAgentError):
        await run_deal_agent(main, deal_context())


async def test_agent_is_read_only_with_the_logistics_sub_agent() -> None:
    """The agent sees the engine tools and the sub-agent; it cannot run commands or write."""
    main = scripted(
        call("execute", {"command": "ls /"}),
        call("write_file", {"file_path": "/notes.txt", "content": "x"}, "c2"),
        AIMessage(content="done"),
    )
    graph = build_deal_agent(main, deal_context())
    tools = graph.nodes["tools"].bound.tools_by_name
    assert {
        "get_selling_options",
        "get_option_breakdown",
        "get_market_reference",
        "get_farmer_minimum",
        "get_counter_suggestion",
        "task",
    } <= set(tools)
    assert "logistics-analyst" in tools["task"].description

    result = await graph.ainvoke({"messages": [HumanMessage(content="Explain")]})

    replies = [m.content for m in result["messages"] if isinstance(m, ToolMessage)]
    assert replies[0].startswith("Error: Execution not available")
    assert replies[1] == "Error: permission denied for write on /notes.txt"


# ─────────────────────────────── Service live paths ───────────────────────────────


async def test_live_deal_advice_uses_the_agent(
    db: AsyncSession, tomato: Crop, monkeypatch: pytest.MonkeyPatch, live_mode: Any
) -> None:
    farmer, harvest = await farmer_and_harvest(db, tomato, language="hi")
    options = two_offers_and_baseline(harvest.id)
    use_options(monkeypatch, options)
    best = next(o for o in options.options if o.option_id == OFFER_B)
    answer = (
        f"FreshBasket का लॉट ऑफ़र सबसे अच्छा है: आपको प्रति किलो {pricing.format_rupees(best.net_per_kg)} "
        "मिलेंगे। ढुलाई का कोटेशन अभी बाकी है। फ़ैसला आपका है।"
    )
    live_mode(scripted(call("get_selling_options"), AIMessage(content=answer)))

    advice = await service.advise_deal(db, harvest, farmer)

    assert advice.explanation.source == "ai"
    assert advice.explanation.text == answer
    assert advice.explanation.model == settings.DEEPSEEK_MODEL
    assert advice.explanation.disclaimer == templates.disclaimer("hi", "ai")
    assert advice.recommended_option_id == OFFER_B  # engine decides, not the model
    assert advice.options == options.options
    (row,) = await interactions_of(db)
    assert (row.feature, row.source, row.success, row.model) == (
        "deal_advice",
        "ai",
        True,
        settings.DEEPSEEK_MODEL,
    )


async def test_live_deal_advice_falls_back_when_the_model_raises(
    db: AsyncSession, tomato: Crop, monkeypatch: pytest.MonkeyPatch, live_mode: Any
) -> None:
    farmer, harvest = await farmer_and_harvest(db, tomato)
    use_options(monkeypatch, two_offers_and_baseline(harvest.id))
    live_mode(FailingModel(messages=iter([])))

    advice = await service.advise_deal(db, harvest, farmer)

    assert advice.explanation.source == "rules"
    assert advice.explanation.model is None
    assert advice.explanation.text.startswith(
        "The pooled offer from FreshBasket is your best option"
    )
    assert advice.explanation.disclaimer == templates.disclaimer("en", "rules")
    (row,) = await interactions_of(db)
    assert (row.source, row.success, row.model) == ("rules", False, settings.DEEPSEEK_MODEL)
    assert row.error is not None and "provider unavailable" in row.error
    assert "sk-test-key" not in row.error


async def test_live_deal_advice_falls_back_on_ungrounded_numbers(
    db: AsyncSession, tomato: Crop, monkeypatch: pytest.MonkeyPatch, live_mode: Any
) -> None:
    farmer, harvest = await farmer_and_harvest(db, tomato)
    use_options(monkeypatch, two_offers_and_baseline(harvest.id))
    live_mode(scripted(AIMessage(content="Accept now and you will get ₹99.99 per kg.")))

    advice = await service.advise_deal(db, harvest, farmer)

    assert advice.explanation.source == "rules"
    (row,) = await interactions_of(db)
    assert row.success is False and "99.99" in (row.error or "")


async def test_live_deal_advice_falls_back_on_timeout(
    db: AsyncSession, tomato: Crop, monkeypatch: pytest.MonkeyPatch, live_mode: Any
) -> None:
    farmer, harvest = await farmer_and_harvest(db, tomato)
    use_options(monkeypatch, two_offers_and_baseline(harvest.id))
    monkeypatch.setattr(settings, "AI_TIMEOUT_SECONDS", 0.05)
    live_mode(SlowModel(messages=iter([AIMessage(content="late")])))

    advice = await service.advise_deal(db, harvest, farmer)

    assert advice.explanation.source == "rules"
    (row,) = await interactions_of(db)
    assert row.success is False and (row.error or "").startswith("TimeoutError")


async def test_live_mode_without_a_working_client_falls_back(
    db: AsyncSession, tomato: Crop, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Live mode with no injected model tries ChatDeepSeek, which the test-suite forbids."""
    monkeypatch.setattr(settings, "AI_MODE", "live")
    monkeypatch.setattr(settings, "DEEPSEEK_API_KEY", "sk-test-key")
    llm.reset_cache()
    farmer, harvest = await farmer_and_harvest(db, tomato)
    use_options(monkeypatch, two_offers_and_baseline(harvest.id))

    advice = await service.advise_deal(db, harvest, farmer)

    assert advice.explanation.source == "rules"
    (row,) = await interactions_of(db)
    assert row.success is False and "forbidden" in (row.error or "")
    llm.reset_cache()


async def test_live_voice_listing_fills_gaps_with_validated_model_output(
    db: AsyncSession, tomato: Crop, live_mode: Any
) -> None:
    farmer = await factories.create_user(db, "farmer")
    today = today_ist()
    live_mode(
        FakeStructuredModel(
            messages=iter([]),
            payload={
                "crop": "Tomato",
                "quantity_kg": 999,  # rules heard 400: the rules win
                "grade": "a",
                "sell_by": (today + timedelta(days=4)).isoformat(),
                "harvest_date": "not a date",
                "min_price_per_kg": 15,
            },
        )
    )
    req = schemas.VoiceListingRequest(
        transcript="I have 400 kilos of tomatoes ready for pickup tomorrow morning", language="en"
    )

    draft = await service.parse_voice_listing(db, req, farmer)

    assert draft.source == "ai"
    assert draft.draft.quantity_kg == 400.0
    assert draft.draft.crop_id == tomato.id
    assert draft.draft.grade == "A"
    assert draft.draft.sell_by == today + timedelta(days=4)
    assert draft.draft.min_price_per_kg == 15.0
    assert draft.missing_fields == ["harvest_date"]
    assert draft.follow_up_question == "When was it harvested, or when will it be?"
    (row,) = await interactions_of(db)
    assert (row.source, row.success) == ("ai", True)


async def test_live_voice_listing_rejects_unknown_crop_and_bad_values(
    db: AsyncSession, tomato: Crop, live_mode: Any
) -> None:
    farmer = await factories.create_user(db, "farmer")
    live_mode(
        FakeStructuredModel(
            messages=iter([]),
            payload={"crop": "Dragon fruit", "quantity_kg": 5_000_000, "grade": "Z"},
        )
    )
    req = schemas.VoiceListingRequest(transcript="something to sell", language="en")

    draft = await service.parse_voice_listing(db, req, farmer)

    assert draft.source == "rules"  # nothing the model said survived validation
    assert draft.draft.crop_id is None and draft.draft.quantity_kg is None
    assert draft.draft.grade is None


async def test_live_voice_listing_falls_back_on_malformed_output(
    db: AsyncSession, tomato: Crop, live_mode: Any
) -> None:
    farmer = await factories.create_user(db, "farmer")
    live_mode(FakeStructuredModel(messages=iter([]), error="Invalid JSON from model"))
    req = schemas.VoiceListingRequest(transcript="400 kg tomatoes ready tomorrow", language="en")

    draft = await service.parse_voice_listing(db, req, farmer)

    assert draft.source == "rules"
    assert draft.draft.quantity_kg == 400.0
    (row,) = await interactions_of(db)
    assert row.success is False and "Invalid JSON" in (row.error or "")


async def test_live_voice_listing_through_tool_calling_structured_output(
    db: AsyncSession, tomato: Crop, live_mode: Any
) -> None:
    """The default LangChain structured-output path (tool calls) also works with the schema."""
    farmer = await factories.create_user(db, "farmer")
    live_mode(
        scripted(
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "LlmListing",
                        "args": {"crop": "Tomato", "grade": "B"},
                        "id": "x1",
                        "type": "tool_call",
                    }
                ],
            )
        )
    )
    req = schemas.VoiceListingRequest(transcript="400 kg ready tomorrow", language="en")

    draft = await service.parse_voice_listing(db, req, farmer)

    assert draft.source == "ai"
    assert draft.draft.crop_id == tomato.id
    assert draft.draft.grade == "B"


async def test_live_counter_rationale_keeps_numbers_fixed(
    db: AsyncSession, tomato: Crop, live_mode: Any
) -> None:
    await factories.create_market_price(db, tomato)
    farmer, harvest = await farmer_and_harvest(db, tomato)
    buyer = await factories.create_user(db, "buyer")
    offer = await factories.create_offer(
        db, buyer, harvest=harvest, price_per_kg=Decimal("10"), pickup_terms="buyer_pickup"
    )
    wording = "Ask for ₹12.00 per kg: the market is at ₹14.00 per kg and the buyer offers ₹10.00. You decide."
    live_mode(scripted(AIMessage(content=wording)))

    suggestion = await service.suggest_counteroffer(db, offer, farmer)

    assert suggestion.source == "ai"
    assert suggestion.rationale == wording
    assert suggestion.suggested_price_per_kg == 12.0  # numbers come from the rules


async def test_live_counter_rationale_with_invented_number_falls_back(
    db: AsyncSession, tomato: Crop, live_mode: Any
) -> None:
    await factories.create_market_price(db, tomato)
    farmer, harvest = await farmer_and_harvest(db, tomato)
    buyer = await factories.create_user(db, "buyer")
    offer = await factories.create_offer(
        db, buyer, harvest=harvest, price_per_kg=Decimal("10"), pickup_terms="buyer_pickup"
    )
    live_mode(scripted(AIMessage(content="Counter at ₹17.25 per kg.")))

    suggestion = await service.suggest_counteroffer(db, offer, farmer)

    assert suggestion.source == "rules"
    assert suggestion.rationale.startswith("The buyer offers ₹10.00/kg.")


async def test_live_match_explanation_and_insights(
    db: AsyncSession, tomato: Crop, live_mode: Any
) -> None:
    coordinator = await factories.create_user(db, "coordinator")
    live_mode(
        scripted(
            AIMessage(content="Two farms give 700 kg of the 1,000 kg target; 300 kg is missing."),
            AIMessage(content="Tomato is short by 600 kg while onion has 1,200 kg extra."),
        )
    )

    match = await service.explain_match(db, proposal(tomato), coordinator)
    summary = await service.summarize_insights(db, balances(tomato), coordinator)

    assert (match.source, match.model) == ("ai", settings.DEEPSEEK_MODEL)
    assert match.text.startswith("Two farms give 700 kg")
    assert summary.source == "ai"
    assert summary.disclaimer == templates.disclaimer("en", "ai")


async def test_live_match_explanation_masks_farmer_names(
    db: AsyncSession, tomato: Crop, live_mode: Any
) -> None:
    coordinator = await factories.create_user(db, "coordinator")
    seen: list[str] = []

    class Recorder(FakeToolModel):
        async def _agenerate(
            self, messages: list[BaseMessage], *args: Any, **kwargs: Any
        ) -> ChatResult:
            seen.append("\n".join(str(m.content) for m in messages))
            return await super()._agenerate(messages, *args, **kwargs)

    live_mode(Recorder(messages=iter([AIMessage(content="A feasible lot.")])))
    await service.explain_match(db, proposal(tomato), coordinator)
    prompt = seen[0]
    assert "Ravi R." in prompt
    assert "Lakshmi D." in prompt
    assert "Ravi Kumar Reddy" not in prompt
    assert "Lakshmi Devi" not in prompt


# ─────────────────────────────── Model factory ───────────────────────────────


def test_get_chat_model_builds_deepseek_once_with_shared_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created: list[dict[str, Any]] = []

    class FakeDeepSeek:
        def __init__(self, **kwargs: Any) -> None:
            created.append(kwargs)

    monkeypatch.setattr(llm, "ChatDeepSeek", FakeDeepSeek)
    monkeypatch.setattr(settings, "AI_MODE", "live")
    monkeypatch.setattr(settings, "DEEPSEEK_API_KEY", "sk-test-key")
    monkeypatch.setattr(settings, "AI_TIMEOUT_SECONDS", 12.5)
    llm.reset_cache()
    try:
        first = llm.get_chat_model()
        second = llm.get_chat_model()
    finally:
        llm.reset_cache()

    assert first is second
    assert created == [
        {
            "model": settings.DEEPSEEK_MODEL,
            "api_key": "sk-test-key",
            "base_url": settings.DEEPSEEK_BASE_URL,
            "temperature": 0.2,
            "max_tokens": 700,
            "timeout": 12.5,
            "max_retries": 1,
        }
    ]


def test_get_chat_model_is_none_in_mock_mode_even_with_an_override() -> None:
    previous = llm.set_chat_model_factory(lambda: scripted(AIMessage(content="x")))
    try:
        assert llm.get_chat_model() is None
    finally:
        llm.set_chat_model_factory(previous)
