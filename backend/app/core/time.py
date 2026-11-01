"""Clock helpers. Timestamps are stored in UTC; business "today" is the India date."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30), "IST")
"""Asia/Kolkata. India has no daylight saving time, so a fixed offset is exact."""


def utcnow() -> datetime:
    """Current time as a timezone-aware UTC datetime."""
    return datetime.now(UTC)


def today_ist() -> date:
    """Today's date in India; every business rule about "today" uses this."""
    return datetime.now(IST).date()
