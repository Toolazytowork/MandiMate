"""``python -m app.seed [--reset] [--catalog-only]``: load the MandiMate demo data."""

from __future__ import annotations

import argparse
import asyncio
import sys

from app.core.config import settings
from app.core.database import SessionLocal, engine
from app.seed.runner import SeedRefusedError, seed_database
from app.seed.summary import render_report


def _parse(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m app.seed",
        description="Load the MandiMate demo data: the Madanapalle pilot cluster with an account "
        "for every role (password MandiMate@2026), six months of sales and a live pipeline.",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="truncate every table and restart the code sequences before seeding",
    )
    parser.add_argument(
        "--catalog-only",
        action="store_true",
        help="only the crop catalogue and 60 days of illustrative market prices (no accounts)",
    )
    return parser.parse_args(argv)


async def _run(args: argparse.Namespace) -> int:
    try:
        report = await seed_database(SessionLocal, reset=args.reset, catalog_only=args.catalog_only)
    except SeedRefusedError as error:
        print(f"Seed refused: {error}", file=sys.stderr)
        return 1
    finally:
        await engine.dispose()
    print(render_report(report))
    return 0


def main(argv: list[str] | None = None) -> int:
    args = _parse(argv)
    if settings.is_production and (args.reset or not args.catalog_only):
        print(
            "Seed refused: APP_ENV=production. Demo accounts with a published password must "
            "never reach a production database (only --catalog-only is allowed there).",
            file=sys.stderr,
        )
        return 2
    target = settings.DATABASE_URL.rsplit("@", 1)[-1]
    action = "Resetting and seeding" if args.reset else "Seeding"
    print(f"{action} {target} ...", flush=True)
    return asyncio.run(_run(args))


if __name__ == "__main__":
    sys.exit(main())
