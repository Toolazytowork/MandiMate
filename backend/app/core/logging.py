"""Logging setup. Every record carries the id of the request that produced it."""

from __future__ import annotations

import logging
from contextvars import ContextVar

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")
"""Id of the HTTP request being served (set by ``RequestIdMiddleware``)."""

LOG_FORMAT = "%(asctime)s %(levelname)-8s %(name)s [%(request_id)s] %(message)s"


class RequestIdFilter(logging.Filter):
    """Adds ``record.request_id`` from the current request context."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


class _MandiMateHandler(logging.StreamHandler):
    """Marker type so repeated configuration does not stack handlers."""


def configure_logging(level: str = "INFO", *, echo_sql: bool = False) -> None:
    """Install one stderr handler on the root logger (idempotent)."""
    root = logging.getLogger()
    root.setLevel(level)
    if not any(isinstance(handler, _MandiMateHandler) for handler in root.handlers):
        handler = _MandiMateHandler()
        handler.setFormatter(logging.Formatter(LOG_FORMAT))
        handler.addFilter(RequestIdFilter())
        root.addHandler(handler)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.INFO if echo_sql else logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
