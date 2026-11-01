"""Async SQLAlchemy engine, session factory and the request-scoped session dependency."""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=10,
)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
"""Session factory. ``expire_on_commit=False`` keeps loaded objects usable after commit."""


async def get_db() -> AsyncIterator[AsyncSession]:
    """Yield one session per request: commit when the handler succeeds, roll back otherwise.

    Declare it through ``app.core.deps.DbSession`` (function scope) so the commit happens
    before the response is sent and a failing commit becomes an error response.
    """
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except BaseException:
            await session.rollback()
            raise
