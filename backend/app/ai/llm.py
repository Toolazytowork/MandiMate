"""The single chat-model factory shared by every AI feature.

* ``get_chat_model()`` returns ``None`` in mock mode (``AI_MODE=mock`` or no ``DEEPSEEK_API_KEY``),
  so no client is ever constructed and no network call can happen.
* In live mode it lazily creates one ``ChatDeepSeek`` with the shared settings (temperature 0.2,
  700 output tokens, ``AI_TIMEOUT_SECONDS``, one retry) and reuses it while the settings are
  unchanged.
* Tests inject fake chat models with ``set_chat_model_factory(lambda: fake)``; the override is
  only consulted in live mode, so mock mode stays model-free even when an override is set.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import TYPE_CHECKING, Any, Literal

from langchain_deepseek import ChatDeepSeek

from app.core.config import settings

if TYPE_CHECKING:
    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.runnables import Runnable
    from pydantic import BaseModel

logger = logging.getLogger(__name__)

TEMPERATURE = 0.2
MAX_TOKENS = 700
MAX_RETRIES = 1

ChatModelFactory = Callable[[], "BaseChatModel | None"]

_factory_override: ChatModelFactory | None = None
_cached_model: BaseChatModel | None = None
_cached_key: tuple[Any, ...] | None = None


def ai_mode() -> Literal["live", "mock"]:
    """The effective mode: ``live`` only when not forced to mock and a key is configured."""
    return settings.ai_effective_mode


def model_name() -> str:
    """The configured DeepSeek model name (used for logging and ``AiText.model``)."""
    return settings.DEEPSEEK_MODEL


def set_chat_model_factory(factory: ChatModelFactory | None) -> ChatModelFactory | None:
    """Replace how live-mode models are built (tests pass a fake); ``None`` restores DeepSeek.

    Returns the previous override so callers can restore it.
    """
    global _factory_override
    previous = _factory_override
    _factory_override = factory
    return previous


def reset_cache() -> None:
    """Forget the cached DeepSeek client (settings changed, or between tests)."""
    global _cached_model, _cached_key
    _cached_model = None
    _cached_key = None


def _settings_key() -> tuple[Any, ...]:
    return (
        settings.DEEPSEEK_MODEL,
        settings.DEEPSEEK_BASE_URL,
        settings.DEEPSEEK_API_KEY,
        settings.AI_TIMEOUT_SECONDS,
    )


def _build_deepseek() -> BaseChatModel:
    return ChatDeepSeek(
        model=settings.DEEPSEEK_MODEL,
        api_key=settings.DEEPSEEK_API_KEY,
        base_url=settings.DEEPSEEK_BASE_URL,
        temperature=TEMPERATURE,
        max_tokens=MAX_TOKENS,
        timeout=settings.AI_TIMEOUT_SECONDS,
        max_retries=MAX_RETRIES,
    )


def get_chat_model() -> BaseChatModel | None:
    """The live chat model, or ``None`` in mock mode. Never constructs a client in mock mode.

    May raise when the client cannot be created; callers fall back to rules.
    """
    global _cached_model, _cached_key
    if ai_mode() == "mock":
        return None
    if _factory_override is not None:
        return _factory_override()
    key = _settings_key()
    if _cached_model is None or _cached_key != key:
        _cached_model = _build_deepseek()
        _cached_key = key
    return _cached_model


def structured_model[SchemaT: BaseModel](
    model: BaseChatModel, schema: type[SchemaT]
) -> Runnable[Any, Any]:
    """``model`` constrained to return ``schema``.

    DeepSeek uses JSON mode (the prompt must mention JSON); other models (fakes in tests) use
    their default structured-output strategy.
    """
    if isinstance(model, ChatDeepSeek):
        return model.with_structured_output(schema, method="json_mode")
    return model.with_structured_output(schema)


def message_text(content: Any) -> str:
    """Plain text from a message ``content`` (a string or a list of content blocks)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text", "")))
        return "".join(parts)
    return ""
