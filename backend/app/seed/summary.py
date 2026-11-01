"""Plain-text summary of a seed run: boxed tables that read well in any terminal."""

from __future__ import annotations

import unicodedata
from collections.abc import Sequence
from typing import TYPE_CHECKING

from app.services.pricing import format_number

if TYPE_CHECKING:
    from app.seed.runner import SeedReport


def _width(text: str) -> int:
    """Display width: combining marks take no column, wide characters take two."""
    width = 0
    for char in text:
        if unicodedata.combining(char):
            continue
        width += 2 if unicodedata.east_asian_width(char) in ("W", "F") else 1
    return width


def _pad(text: str, width: int, align: str) -> str:
    gap = " " * max(width - _width(text), 0)
    return gap + text if align == "right" else text + gap


def table(
    title: str,
    headers: Sequence[str],
    rows: Sequence[Sequence[str]],
    *,
    align: Sequence[str] | None = None,
) -> str:
    """A box-drawn table with a title bar."""
    align = align or ["left"] * len(headers)
    widths = [
        max([_width(headers[i]), *(_width(row[i]) for row in rows)]) for i in range(len(headers))
    ]
    inner = sum(widths) + 3 * len(widths) - 1
    title_width = max(inner, _width(title) + 2)
    if title_width > inner:
        widths[-1] += title_width - inner
        inner = title_width

    def line(left: str, middle: str, right: str) -> str:
        return left + middle.join("─" * (w + 2) for w in widths) + right

    def render(cells: Sequence[str]) -> str:
        return (
            "│ "
            + " │ ".join(_pad(cell, widths[i], align[i]) for i, cell in enumerate(cells))
            + " │"
        )

    out = [
        "┌" + "─" * inner + "┐",
        "│" + _pad(f" {title}", inner, "left") + "│",
        line("├", "┬", "┤"),
        render(headers),
        line("├", "┼", "┤"),
        *(render(row) for row in rows),
        line("└", "┴", "┘"),
    ]
    return "\n".join(out)


def render_report(report: SeedReport) -> str:
    parts: list[str] = []
    if report.accounts:
        rows = [
            [account.role, account.name, account.login, account.organization, account.details]
            for account in report.accounts
        ]
        parts.append(
            table(
                f"Demo accounts · password {report.password}",
                ["Role", "Name", "Sign in with", "Organisation / village", "Lang, status"],
                rows,
            )
        )
        if report.phone_only_farmers:
            parts.append(
                f"  + {report.phone_only_farmers} more farmers registered by the coordinator sign "
                f"in with their phone number (+91 98765 000xx) and the same password."
            )
    count_rows = [[label, format_number(value)] for label, value in report.counts.items()]
    parts.append(
        table("Rows in the database", ["Table", "Rows"], count_rows, align=["left", "right"])
    )
    if not report.catalog_only and report.lots_by_status:
        status_rows = [
            [status.replace("_", " "), str(count)]
            for status, count in report.lots_by_status.items()
        ]
        parts.append(
            table("Lots by status", ["Status", "Lots"], status_rows, align=["left", "right"])
        )
    mode = "catalogue only" if report.catalog_only else "full demo"
    parts.append(
        f"MandiMate seed complete ({mode}), dates relative to {report.today.isoformat()} (IST). "
        "Market prices are illustrative, not live data."
    )
    return "\n\n".join(parts)
