"""The deal-negotiation assistant: a deepagents agent with a logistics-analyst sub-agent.

Built per request for one harvest and one viewer. Its tools (``app.ai.tools``) are read-only views
of engine output; the agent only adds language. ``run_deal_agent`` bounds the run in time, extracts
the final answer and rejects answers that quote numbers the tools never returned, so the caller
can fall back to the rules template.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from deepagents import create_deep_agent
from deepagents.middleware.filesystem import FilesystemPermission
from langchain_core.messages import AIMessage, HumanMessage

from app.ai import prompts
from app.ai.grounding import ungrounded
from app.ai.llm import message_text
from app.ai.templates import kg
from app.ai.tools import DealContext, build_deal_tools, build_logistics_tools
from app.core.config import settings

if TYPE_CHECKING:
    from langchain_core.language_models.chat_models import BaseChatModel

LOGISTICS_ANALYST = "logistics-analyst"
RECURSION_LIMIT = 30
MAX_ANSWER_WORDS = 220
"""The prompt asks for ≤ 120 words; anything far longer is treated as malformed."""


class DealAgentError(RuntimeError):
    """The agent produced no usable answer (empty, too long or ungrounded numbers)."""


def build_deal_agent(
    model: BaseChatModel,
    context: DealContext,
    *,
    subagent_model: BaseChatModel | None = None,
) -> Any:
    """A compiled deepagents graph for ``context``.

    The ``logistics-analyst`` sub-agent gets only transport tools; it uses ``subagent_model``
    when given (tests script it separately), otherwise the main model. Writes to the agent's
    scratch filesystem are denied: the agent only reads tool output.
    """
    logistics: dict[str, Any] = {
        "name": LOGISTICS_ANALYST,
        "description": prompts.LOGISTICS_ANALYST_DESCRIPTION,
        "system_prompt": prompts.LOGISTICS_ANALYST_PROMPT,
        "tools": build_logistics_tools(context),
    }
    if subagent_model is not None:
        logistics["model"] = subagent_model
    return create_deep_agent(
        model=model,
        tools=build_deal_tools(context),
        system_prompt=prompts.deal_agent_prompt(context.language),
        subagents=[logistics],  # type: ignore[list-item]
        permissions=[FilesystemPermission(operations=["write"], paths=["/**"], mode="deny")],
        name="mandimate-deal-advisor",
    )


def _final_answer(result: Any) -> str:
    messages = result.get("messages", []) if isinstance(result, dict) else []
    for message in reversed(messages):
        if isinstance(message, AIMessage) and not message.tool_calls:
            return message_text(message.content).strip()
    return ""


async def run_deal_agent(
    model: BaseChatModel,
    context: DealContext,
    *,
    subagent_model: BaseChatModel | None = None,
    time_limit: float | None = None,
) -> str:
    """The agent's explanation, validated: non-empty, bounded, numbers from the tools only.

    Raises ``DealAgentError`` (or the model's own exception / ``TimeoutError``) when the answer
    cannot be used.
    """
    agent = build_deal_agent(model, context, subagent_model=subagent_model)
    question = prompts.deal_question(
        context.crop_name, kg("en", context.quantity_kg), context.language
    )
    limit = time_limit if time_limit is not None else settings.AI_TIMEOUT_SECONDS
    async with asyncio.timeout(limit):
        result = await agent.ainvoke(
            {"messages": [HumanMessage(content=question)]},
            config={"recursion_limit": RECURSION_LIMIT},
        )
    answer = _final_answer(result)
    if not answer:
        raise DealAgentError("The agent returned no answer")
    if len(answer.split()) > MAX_ANSWER_WORDS:
        raise DealAgentError("The agent's answer is too long")
    invented = ungrounded(answer, context.allowed_numbers())
    if invented:
        raise DealAgentError(
            "The agent quoted numbers the tools did not return: "
            + ", ".join(str(number) for number in invented[:5])
        )
    return answer
