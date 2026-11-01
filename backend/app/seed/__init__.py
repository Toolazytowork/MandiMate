"""Demo data for MandiMate: the Madanapalle pilot cluster (Annamayya district, Andhra Pradesh).

Command line (from ``backend/``)::

    uv run python -m app.seed                 # refuses when the database already has users
    uv run python -m app.seed --reset         # truncate every table, restart sequences, reseed
    uv run python -m app.seed --catalog-only  # just the crops and 60 days of illustrative prices

Every account uses the password ``MandiMate@2026``. All dates are relative to today (India), so the
demo always looks fresh. Programmatic use (tests): ``await run_seed(session)`` then commit.
"""

from app.seed.helpers import DEMO_PASSWORD, Clock
from app.seed.runner import (
    AccountRow,
    SeedRefusedError,
    SeedReport,
    reset_database,
    run_seed,
    seed_database,
)

__all__ = [
    "DEMO_PASSWORD",
    "AccountRow",
    "Clock",
    "SeedRefusedError",
    "SeedReport",
    "reset_database",
    "run_seed",
    "seed_database",
]
