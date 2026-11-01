"""Domain errors and the exception handlers that render them as ``ApiErrorBody`` JSON."""

from __future__ import annotations

import logging
from collections.abc import Mapping

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

logger = logging.getLogger(__name__)


class DomainError(Exception):
    """A business-rule failure with an HTTP status, a human-readable detail and a stable code."""

    def __init__(
        self,
        status_code: int,
        detail: str,
        code: str | None = None,
        *,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.code = code
        self.headers = dict(headers) if headers else None


def not_found(entity: str = "Resource") -> DomainError:
    """404 for a missing entity or one the caller is not allowed to see."""
    return DomainError(status.HTTP_404_NOT_FOUND, f"{entity} not found", "not_found")


def forbidden(msg: str = "You do not have permission to perform this action") -> DomainError:
    """403 for a wrong role or a non-owner acting on a visible entity."""
    return DomainError(status.HTTP_403_FORBIDDEN, msg, "forbidden")


def conflict(msg: str) -> DomainError:
    """409 for an invalid state transition."""
    return DomainError(status.HTTP_409_CONFLICT, msg, "conflict")


def bad_request(msg: str) -> DomainError:
    """400 for a request that is well-formed but cannot be processed as sent."""
    return DomainError(status.HTTP_400_BAD_REQUEST, msg, "bad_request")


def error_body(detail: str, code: str | None = None) -> dict[str, str]:
    """``ApiErrorBody`` for a domain error; ``code`` is omitted when not set."""
    body = {"detail": detail}
    if code is not None:
        body["code"] = code
    return body


async def domain_error_handler(request: Request, exc: DomainError) -> JSONResponse:
    return JSONResponse(
        error_body(exc.detail, exc.code), status_code=exc.status_code, headers=exc.headers
    )


async def integrity_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """A constraint violation that slipped past validation (usually a concurrent write)."""
    logger.warning("Integrity error on %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(
        error_body("The request conflicts with existing data", "integrity_error"),
        status_code=status.HTTP_409_CONFLICT,
    )


async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error on %s %s", request.method, request.url.path, exc_info=exc)
    return JSONResponse(
        error_body("Internal server error", "internal_error"),
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(DomainError, domain_error_handler)
    app.add_exception_handler(IntegrityError, integrity_error_handler)
    app.add_exception_handler(Exception, unhandled_error_handler)
