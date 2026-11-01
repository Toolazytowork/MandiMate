# syntax=docker/dockerfile:1.7
#
# MandiMate API — production image.
#
#   docker build -t mandimate-api backend
#
# Stage 1 resolves the locked dependency set with uv into /app/.venv; stage 2 copies only the
# virtualenv and the application code onto a clean python:3.12-slim and runs as a non-root user.
# On start the container applies pending Alembic migrations, then serves uvicorn on :8000.

ARG PYTHON_IMAGE=python:3.12-slim
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.11.2

FROM ${UV_IMAGE} AS uv

# ── Build: install locked dependencies ───────────────────────────────────────────────────────
FROM ${PYTHON_IMAGE} AS build

COPY --from=uv /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /app

# Dependencies first: this layer is reused until pyproject.toml or uv.lock change.
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=.python-version,target=.python-version \
    uv sync --frozen --no-dev --no-install-project

COPY . .

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# ── Runtime ──────────────────────────────────────────────────────────────────────────────────
FROM ${PYTHON_IMAGE} AS runtime

LABEL org.opencontainers.image.title="mandimate-api" \
      org.opencontainers.image.description="MandiMate API (FastAPI)" \
      org.opencontainers.image.licenses="Proprietary"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:${PATH}"

RUN groupadd --system --gid 10001 mandimate \
 && useradd --system --uid 10001 --gid mandimate --home-dir /app --no-create-home \
        --shell /usr/sbin/nologin mandimate

WORKDIR /app

COPY --from=build --chown=mandimate:mandimate /app /app

# Uploaded harvest photos. Owned by the runtime user so a fresh named volume mounted here
# inherits writable permissions.
RUN mkdir -p /app/media && chown mandimate:mandimate /app/media

USER mandimate

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
    CMD ["python", "-c", "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"]

# `exec` hands PID 1 to uvicorn so it receives SIGTERM directly and shuts down gracefully.
# --proxy-headers trusts X-Forwarded-* only from FORWARDED_ALLOW_IPS (uvicorn default
# 127.0.0.1); docker-compose.yml widens it for the private compose network.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers"]
