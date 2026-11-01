"""Shared fixtures: an isolated PostgreSQL test database, ASGI clients and signed-in users.

* Tables are dropped and recreated once per session on ``TEST_DATABASE_URL``, inside a
  PostgreSQL schema private to this pytest process (``pytest_<pid>``), so parallel runs
  against the same test database never interfere. The schema is removed afterwards.
* Every test that uses ``db``, ``client``, ``auth_client`` or ``make_user`` starts from empty
  tables (``TRUNCATE … RESTART IDENTITY CASCADE``) and code sequences restarted at 1.
* AI is forced to ``mock`` and constructing ``ChatDeepSeek`` raises, so no test can reach the
  network; tests that need a model inject a fake chat model.
"""

import os
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

import pytest
import pytest_asyncio
from asgi_lifespan import LifespanManager
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from langchain_deepseek import ChatDeepSeek
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.core import database
from app.core.config import settings
from app.core.ratelimit import login_limiter
from app.core.security import ACCESS_COOKIE, create_access_token
from app.main import create_app
from app.models import CODE_SEQUENCES, Base, User
from app.models.enums import Role
from tests import factories

BASE_URL = "http://test"
TEST_SCHEMA = f"pytest_{os.getpid()}"

MakeUser = Callable[..., Awaitable[tuple[User, str]]]
AuthClientFactory = Callable[[User], AsyncClient]


def _forbid_network_llm(*args: Any, **kwargs: Any) -> None:
    raise RuntimeError("Network LLM calls are forbidden in tests")


@pytest.fixture(autouse=True)
def _offline_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """Deterministic, offline configuration for every test."""
    monkeypatch.setattr(settings, "AI_MODE", "mock")
    monkeypatch.setattr(settings, "DEEPSEEK_API_KEY", "")
    monkeypatch.setattr(settings, "COOKIE_SECURE", False)
    monkeypatch.setattr(ChatDeepSeek, "__init__", _forbid_network_llm)


@pytest.fixture(autouse=True)
def _reset_login_limiter() -> None:
    login_limiter.clear()


@pytest_asyncio.fixture(scope="session")
async def engine() -> AsyncIterator[AsyncEngine]:
    """Session-wide engine on the test database with freshly created tables."""
    admin_engine = create_async_engine(settings.TEST_DATABASE_URL, poolclass=NullPool)
    async with admin_engine.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{TEST_SCHEMA}"'))
    test_engine = create_async_engine(
        settings.TEST_DATABASE_URL,
        poolclass=NullPool,
        connect_args={"server_settings": {"search_path": TEST_SCHEMA}},
    )
    async with test_engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)
    # Code that opens its own sessions (outside a request) must also use the test database.
    database.SessionLocal.configure(bind=test_engine)
    yield test_engine
    database.SessionLocal.configure(bind=database.engine)
    await test_engine.dispose()
    async with admin_engine.begin() as connection:
        await connection.execute(text(f'DROP SCHEMA IF EXISTS "{TEST_SCHEMA}" CASCADE'))
    await admin_engine.dispose()


@pytest.fixture(scope="session")
def session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


@pytest_asyncio.fixture(scope="session")
async def app(session_factory: async_sessionmaker[AsyncSession]) -> AsyncIterator[FastAPI]:
    """The application with ``get_db`` bound to the test database, lifespan running."""

    async def get_test_db() -> AsyncIterator[AsyncSession]:
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except BaseException:
                await session.rollback()
                raise

    application = create_app()
    application.dependency_overrides[database.get_db] = get_test_db
    async with LifespanManager(application):
        yield application


@pytest_asyncio.fixture
async def clean_db(engine: AsyncEngine) -> None:
    """Empty every table and restart the code sequences."""
    tables = ", ".join(f'"{table.name}"' for table in Base.metadata.sorted_tables)
    async with engine.begin() as connection:
        await connection.execute(text(f"TRUNCATE TABLE {tables} RESTART IDENTITY CASCADE"))
        for sequence in CODE_SEQUENCES:
            await connection.execute(text(f"ALTER SEQUENCE {sequence.name} RESTART WITH 1"))


@pytest_asyncio.fixture
async def db(
    session_factory: async_sessionmaker[AsyncSession], clean_db: None
) -> AsyncIterator[AsyncSession]:
    """A session for arranging and inspecting data (factories commit through it)."""
    async with session_factory() as session:
        yield session


@pytest_asyncio.fixture
async def client(app: FastAPI, clean_db: None) -> AsyncIterator[AsyncClient]:
    """Anonymous API client."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url=BASE_URL) as http:
        yield http


@pytest_asyncio.fixture
async def auth_client(app: FastAPI, clean_db: None) -> AsyncIterator[AuthClientFactory]:
    """``auth_client(user)`` → a client signed in as ``user`` via the ``mandimate_access`` cookie."""
    clients: list[AsyncClient] = []

    def make(user: User) -> AsyncClient:
        http = AsyncClient(
            transport=ASGITransport(app=app),
            base_url=BASE_URL,
            cookies={ACCESS_COOKIE: create_access_token(user)},
        )
        clients.append(http)
        return http

    yield make
    for http in clients:
        await http.aclose()


@pytest.fixture
def make_user(db: AsyncSession) -> MakeUser:
    """``await make_user("buyer", full_name=…)`` → ``(user, password)`` (committed)."""

    async def make(role: Role = "farmer", **overrides: Any) -> tuple[User, str]:
        password = overrides.pop("password", factories.DEFAULT_PASSWORD)
        user = await factories.create_user(db, role, password=password, **overrides)
        return user, password

    return make
