"""Seed entry points: load the catalogue and the demo world, reset the database, report."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import func, select, text

from app.models import (
    CODE_SEQUENCES,
    AuditLog,
    Base,
    Crop,
    Delivery,
    Demand,
    Dispute,
    FarmerPayout,
    Harvest,
    Lot,
    MarketPrice,
    Notification,
    Offer,
    Payment,
    Settlement,
    TransportQuote,
    TransportRequest,
    User,
    Vehicle,
)
from app.models.enums import LOT_STATUSES
from app.seed.catalog import seed_crops
from app.seed.demo import build_demo
from app.seed.helpers import DEMO_PASSWORD, Clock
from app.seed.markets import seed_market_prices

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


class SeedRefusedError(RuntimeError):
    """Seeding would mix demo data into a database that already has users."""


@dataclass(frozen=True)
class AccountRow:
    role: str
    name: str
    login: str
    organization: str
    details: str


@dataclass
class SeedReport:
    today: date
    catalog_only: bool
    password: str = DEMO_PASSWORD
    market_prices_inserted: int = 0
    accounts: list[AccountRow] = field(default_factory=list)
    phone_only_farmers: int = 0
    counts: dict[str, int] = field(default_factory=dict)
    lots_by_status: dict[str, int] = field(default_factory=dict)


COUNTED: tuple[tuple[str, type[Base]], ...] = (
    ("Crops", Crop),
    ("Market prices", MarketPrice),
    ("Users", User),
    ("Vehicles", Vehicle),
    ("Harvests", Harvest),
    ("Demands", Demand),
    ("Lots", Lot),
    ("Offers", Offer),
    ("Transport requests", TransportRequest),
    ("Transport quotes", TransportQuote),
    ("Deliveries", Delivery),
    ("Settlements", Settlement),
    ("Farmer payouts", FarmerPayout),
    ("Payments", Payment),
    ("Disputes", Dispute),
    ("Notifications", Notification),
    ("Audit entries", AuditLog),
)
ROLE_ORDER = {"farmer": 0, "buyer": 1, "transporter": 2, "coordinator": 3, "admin": 4}


async def user_count(db: AsyncSession) -> int:
    return int(await db.scalar(select(func.count()).select_from(User)) or 0)


async def reset_database(db: AsyncSession) -> None:
    """Empty every application table and restart the code sequences (keeps the schema)."""
    tables = ", ".join(f'"{table.name}"' for table in Base.metadata.sorted_tables)
    await db.execute(text(f"TRUNCATE TABLE {tables} RESTART IDENTITY CASCADE"))
    for sequence in CODE_SEQUENCES:
        await db.execute(text(f"ALTER SEQUENCE {sequence.name} RESTART WITH 1"))


async def run_seed(
    db: AsyncSession, *, catalog_only: bool = False, clock: Clock | None = None
) -> SeedReport:
    """Load the crop catalogue, 60 days of illustrative prices and (unless ``catalog_only``)
    the demo world into ``db``. Flushes but does not commit.

    The catalogue part is idempotent (existing crops and prices are kept); the demo part
    expects a database without users (see ``seed_database``).
    """
    clock = clock or Clock.current()
    crops = await seed_crops(db)
    report = SeedReport(today=clock.today, catalog_only=catalog_only)
    report.market_prices_inserted = await seed_market_prices(db, crops, clock.today)
    if not catalog_only:
        await build_demo(db, clock, crops)
    await db.flush()
    await _fill_report(db, report)
    return report


async def seed_database(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    reset: bool = False,
    catalog_only: bool = False,
    clock: Clock | None = None,
) -> SeedReport:
    """``python -m app.seed``: one transaction that seeds (after an optional reset) and commits.

    Raises ``SeedRefusedError`` when demo data would be added to a database that has users.
    """
    async with session_factory() as db:
        if reset:
            await reset_database(db)
        elif not catalog_only:
            existing = await user_count(db)
            if existing:
                raise SeedRefusedError(
                    f"The database already has {existing} user{'s' if existing != 1 else ''}; "
                    "refusing to mix demo data into it. Run `uv run python -m app.seed --reset` "
                    "to wipe every table and reseed, or `--catalog-only` to load just the crops "
                    "and market prices."
                )
        report = await run_seed(db, catalog_only=catalog_only, clock=clock)
        await db.commit()
    return report


async def _fill_report(db: AsyncSession, report: SeedReport) -> None:
    for label, model in COUNTED:
        report.counts[label] = int(await db.scalar(select(func.count()).select_from(model)) or 0)
    unread = await db.scalar(
        select(func.count()).select_from(Notification).where(Notification.read_at.is_(None))
    )
    report.counts["Unread notifications"] = int(unread or 0)
    rows = (await db.execute(select(Lot.status, func.count()).group_by(Lot.status))).all()
    found = dict(rows)
    report.lots_by_status = {status: int(found.get(status, 0)) for status in LOT_STATUSES}

    if report.catalog_only:
        return
    users = (await db.scalars(select(User))).all()
    for user in sorted(users, key=lambda u: (ROLE_ORDER.get(u.role, 9), u.created_at)):
        if user.email is None:
            report.phone_only_farmers += 1
            continue
        if user.role == "farmer" and not user.email.endswith("@mandimate.demo"):
            continue
        place = user.organization_name or ", ".join(
            part for part in (user.village, user.district) if part
        )
        details = [user.preferred_language]
        if user.role in ("buyer", "transporter"):
            details.append(user.verification_status)
        report.accounts.append(
            AccountRow(
                role=user.role,
                name=user.full_name,
                login=user.email,
                organization=place,
                details=", ".join(details),
            )
        )
