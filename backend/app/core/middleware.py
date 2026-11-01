"""Pure-ASGI middleware: request ids and security response headers."""

from __future__ import annotations

import re
import uuid

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.logging import request_id_var

REQUEST_ID_HEADER = "X-Request-ID"
_VALID_REQUEST_ID = re.compile(r"[A-Za-z0-9._-]{1,128}")

SECURITY_HEADERS: tuple[tuple[str, str], ...] = (
    ("X-Content-Type-Options", "nosniff"),
    ("X-Frame-Options", "DENY"),
    ("Referrer-Policy", "strict-origin-when-cross-origin"),
    ("Permissions-Policy", "microphone=(self), camera=(self)"),
)
HSTS_HEADER = ("Strict-Transport-Security", "max-age=31536000; includeSubDomains")


class RequestIdMiddleware:
    """Tags each request with an id (honouring a well-formed incoming ``X-Request-ID``).

    The id is exposed to log records through ``request_id_var`` and echoed in the response.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = Headers(scope=scope).get(REQUEST_ID_HEADER, "")
        request_id = incoming if _VALID_REQUEST_ID.fullmatch(incoming) else uuid.uuid4().hex

        async def send_with_request_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)[REQUEST_ID_HEADER] = request_id
            await send(message)

        token = request_id_var.set(request_id)
        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            request_id_var.reset(token)


class SecurityHeadersMiddleware:
    """Adds defensive headers to every HTTP response (without overriding explicit ones)."""

    def __init__(self, app: ASGIApp, *, hsts: bool = False) -> None:
        self.app = app
        self.headers = (*SECURITY_HEADERS, HSTS_HEADER) if hsts else SECURITY_HEADERS

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in self.headers:
                    headers.setdefault(name, value)
            await send(message)

        await self.app(scope, receive, send_with_headers)
