"""Deterministic comparisons over engine output, shared by the rules templates and agent tools.

Both the mock explanation and the deal agent's tools read the same ``OptionComparison``, so the
differences a farmer sees ("pays ₹2.00 more per kg, but transport costs ₹1.50 more per kg") are
identical whichever path produced the text. Only engine numbers go in; the differences are plain
subtractions of rounded engine values.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING

from app.services.pricing import round_money, to_decimal

if TYPE_CHECKING:
    from app import schemas

TRANSPORT_KEYS: tuple[str, ...] = ("transport", "handling")
OTHER_KEYS: tuple[str, ...] = ("rejection", "commission", "payment_wait")


def line(option: schemas.NetProceeds, key: str) -> schemas.BreakdownLine | None:
    return next((item for item in option.lines if item.key == key), None)


def cost_per_kg(option: schemas.NetProceeds, keys: tuple[str, ...]) -> Decimal:
    """Positive ₹/kg cost of the given deduction lines (lines are signed negative)."""
    total = sum((to_decimal(item.per_kg) for item in option.lines if item.key in keys), Decimal(0))
    return round_money(-total)


@dataclass(frozen=True)
class OptionComparison:
    best: schemas.SellingOption | None
    runner_up: schemas.SellingOption | None
    """The second-best buyer offer (never the baseline)."""
    baseline: schemas.SellingOption | None
    price_diff_per_kg: Decimal | None
    """best.gross_price_per_kg − runner_up.gross_price_per_kg."""
    cost_diff_per_kg: Decimal | None
    """Transport + handling ₹/kg of best minus runner-up (positive: best costs more)."""
    other_diff_per_kg: Decimal | None
    """Rejection + commission + payment-wait ₹/kg of best minus runner-up (positive: best loses more)."""
    net_diff_per_kg: Decimal | None
    """best.net_per_kg − runner_up.net_per_kg."""
    uplift_vs_baseline_per_kg: Decimal | None
    """best.net_per_kg − baseline.net_per_kg."""

    @property
    def offers(self) -> int:
        return 0 if self.best is None else (2 if self.runner_up is not None else 1)


def compare_options(options: schemas.SellingOptions) -> OptionComparison:
    """Best offer (as chosen by the engine), runner-up offer and baseline, with differences."""
    by_id = {option.option_id: option for option in options.options}
    best = by_id.get(options.best_option_id) if options.best_option_id else None
    baseline = next((option for option in options.options if option.source == "baseline"), None)
    runner_up = None
    if best is not None:
        runner_up = next(
            (
                option
                for option in options.options
                if option.source != "baseline" and option.option_id != best.option_id
            ),
            None,
        )

    price_diff = cost_diff = other_diff = net_diff = None
    if best is not None and runner_up is not None:
        price_diff = round_money(
            to_decimal(best.gross_price_per_kg) - to_decimal(runner_up.gross_price_per_kg)
        )
        cost_diff = round_money(
            cost_per_kg(best, TRANSPORT_KEYS) - cost_per_kg(runner_up, TRANSPORT_KEYS)
        )
        net_diff = round_money(to_decimal(best.net_per_kg) - to_decimal(runner_up.net_per_kg))
        other_diff = round_money(price_diff - cost_diff - net_diff)

    uplift = None
    if best is not None and baseline is not None:
        uplift = round_money(to_decimal(best.net_per_kg) - to_decimal(baseline.net_per_kg))

    return OptionComparison(
        best=best,
        runner_up=runner_up,
        baseline=baseline,
        price_diff_per_kg=price_diff,
        cost_diff_per_kg=cost_diff,
        other_diff_per_kg=other_diff,
        net_diff_per_kg=net_diff,
        uplift_vs_baseline_per_kg=uplift,
    )


def estimated_line_keys(option: schemas.NetProceeds) -> list[str]:
    """Deduction lines that are estimates, most consequential first."""
    order = ("transport", "rejection", "gross", "commission", "handling", "payment_wait")
    estimated = {item.key for item in option.lines if item.certainty == "estimated"}
    return [key for key in order if key in estimated]
