"""In-memory sliding-window limiter (single process) used to throttle failed logins."""

from __future__ import annotations

import math
import time
from collections import deque
from collections.abc import Callable

from fastapi import status

from app.core.errors import DomainError

LOGIN_MAX_FAILURES = 5
LOGIN_WINDOW_SECONDS = 5 * 60


class SlidingWindowLimiter:
    """Allows at most ``max_events`` events per key within any ``window_seconds`` window.

    Events are recorded explicitly with ``hit`` (e.g. a failed login) and cleared with
    ``reset`` (e.g. a successful login). State lives in this process only.
    """

    def __init__(
        self,
        max_events: int,
        window_seconds: float,
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.max_events = max_events
        self.window_seconds = window_seconds
        self._clock = clock
        self._events: dict[str, deque[float]] = {}

    def _prune(self, key: str, now: float) -> deque[float] | None:
        events = self._events.get(key)
        if events is None:
            return None
        cutoff = now - self.window_seconds
        while events and events[0] <= cutoff:
            events.popleft()
        if not events:
            del self._events[key]
            return None
        return events

    def is_limited(self, key: str) -> bool:
        events = self._prune(key, self._clock())
        return events is not None and len(events) >= self.max_events

    def retry_after(self, key: str) -> int:
        """Whole seconds until the oldest event in the window expires (0 when not limited)."""
        now = self._clock()
        events = self._prune(key, now)
        if events is None or len(events) < self.max_events:
            return 0
        return max(1, math.ceil(events[0] + self.window_seconds - now))

    def hit(self, key: str) -> None:
        now = self._clock()
        events = self._prune(key, now)
        if events is None:
            events = self._events[key] = deque()
        events.append(now)
        if len(events) > self.max_events:
            events.popleft()
        self._sweep(now)

    def reset(self, key: str) -> None:
        self._events.pop(key, None)

    def clear(self) -> None:
        self._events.clear()

    def ensure_allowed(self, key: str, detail: str) -> None:
        """Raise a 429 ``DomainError`` (with ``Retry-After``) when ``key`` is limited."""
        wait = self.retry_after(key)
        if wait:
            raise DomainError(
                status.HTTP_429_TOO_MANY_REQUESTS,
                detail,
                "rate_limited",
                headers={"Retry-After": str(wait)},
            )

    def _sweep(self, now: float) -> None:
        """Drop expired keys once the table grows, so memory stays bounded."""
        if len(self._events) < 10_000:
            return
        for key in list(self._events):
            self._prune(key, now)


login_limiter = SlidingWindowLimiter(LOGIN_MAX_FAILURES, LOGIN_WINDOW_SECONDS)
"""Failed logins per ``"<identifier>|<ip>"`` key: 5 failures within 5 minutes ⇒ 429."""


def login_throttle_key(identifier: str, ip: str | None) -> str:
    return f"{identifier.strip().lower()}|{ip or 'unknown'}"
