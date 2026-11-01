"""Read-only tools of the deal agent. They only return numbers the engines already computed.

A ``DealContext`` is built per request from engine output (selling options, the counter-offer
suggestion, the market reference, the farmer's minimum), already masked for the viewer. The tools
serialise slices of it as JSON; they cannot reach the database and compute nothing beyond the
shared ``facts.compare_options`` differences that the rules template also uses.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date
from typing import TYPE_CHECKING, Any

from langchain_core.tools import BaseTool, StructuredTool

from app.ai.facts import (
    OTHER_KEYS,
    TRANSPORT_KEYS,
    compare_options,
    cost_per_kg,
    estimated_line_keys,
    line,
)
from app.ai.grounding import allowed_numbers

if TYPE_CHECKING:
    from decimal import Decimal

    from app import schemas


@dataclass(frozen=True)
class MarketReference:
    modal_price_per_kg: float
    market_name: str
    price_date: date
    is_illustrative: bool


@dataclass
class DealContext:
    """Everything the deal agent may know about one harvest, for one viewer."""

    crop_name: str
    quantity_kg: float
    language: str
    options: schemas.SellingOptions
    counteroffer: schemas.CounterSuggestion | None = None
    market: MarketReference | None = None
    min_price_per_kg: float | None = None
    tool_calls: list[str] = field(default_factory=list)
    """Names of the tools invoked, in order (for telemetry and tests)."""

    def allowed_numbers(self) -> set[Decimal]:
        """Every number any tool can return: the only numbers an answer may quote."""
        payloads: list[Any] = [
            selling_options_payload(self),
            market_reference_payload(self),
            farmer_minimum_payload(self),
            counter_suggestion_payload(self),
            transport_comparison_payload(self),
            [option_breakdown_payload(self, o.option_id) for o in self.options.options],
            {"quantity_kg": self.quantity_kg},
        ]
        return allowed_numbers(*payloads)


def _money(value: Decimal | None) -> float | None:
    return float(value) if value is not None else None


def _option_summary(option: schemas.SellingOption) -> dict[str, Any]:
    return {
        "option_id": option.option_id,
        "source": option.source,
        "title": option.title,
        "buyer_name": option.buyer_name,
        "buyer_verified": option.buyer_verified,
        "offer_status": option.offer_status,
        "awaiting": option.awaiting,
        "quantity_kg": option.quantity_kg,
        "gross_price_per_kg": option.gross_price_per_kg,
        "net_per_kg": option.net_per_kg,
        "net_amount": option.net_amount,
        "total_deductions": option.total_deductions,
        "payment_terms_days": option.payment_terms_days,
        "confidence": option.confidence,
        "estimated_lines": estimated_line_keys(option),
        "unresolved": option.unresolved,
        "meets_min_price": option.meets_min_price,
        "is_best": option.is_best,
    }


def selling_options_payload(ctx: DealContext) -> dict[str, Any]:
    comparison = compare_options(ctx.options)
    return {
        "crop": ctx.crop_name,
        "harvest_quantity_kg": ctx.options.quantity_kg,
        "best_option_id": ctx.options.best_option_id,
        "uplift_vs_baseline_per_kg": ctx.options.uplift_vs_baseline_per_kg,
        "options": [_option_summary(option) for option in ctx.options.options],
        "comparison_best_vs_next_offer": (
            {
                "next_option_id": comparison.runner_up.option_id,
                "price_difference_per_kg": _money(comparison.price_diff_per_kg),
                "transport_and_handling_difference_per_kg": _money(comparison.cost_diff_per_kg),
                "rejection_commission_wait_difference_per_kg": _money(comparison.other_diff_per_kg),
                "net_difference_per_kg": _money(comparison.net_diff_per_kg),
                "note": "Positive cost differences mean the best option costs more per kg.",
            }
            if comparison.runner_up is not None
            else None
        ),
        "comparison_best_vs_mandi": (
            {"net_difference_per_kg": _money(comparison.uplift_vs_baseline_per_kg)}
            if comparison.uplift_vs_baseline_per_kg is not None
            else None
        ),
    }


def option_breakdown_payload(ctx: DealContext, option_id: str) -> dict[str, Any]:
    option = next((o for o in ctx.options.options if o.option_id == option_id), None)
    if option is None:
        return {
            "error": "Unknown option_id",
            "valid_option_ids": [o.option_id for o in ctx.options.options],
        }
    return {
        "option_id": option.option_id,
        "label": option.label,
        "quantity_kg": option.quantity_kg,
        "expected_accepted_kg": option.expected_accepted_kg,
        "gross_amount": option.gross_amount,
        "lines": [item.model_dump(mode="json") for item in option.lines],
        "total_deductions": option.total_deductions,
        "net_amount": option.net_amount,
        "net_per_kg": option.net_per_kg,
        "confidence": option.confidence,
        "unresolved": option.unresolved,
    }


def market_reference_payload(ctx: DealContext) -> dict[str, Any]:
    if ctx.market is None:
        return {"available": False, "reason": "No recent mandi price for this crop"}
    return {
        "available": True,
        "modal_price_per_kg": ctx.market.modal_price_per_kg,
        "market_name": ctx.market.market_name,
        "price_date": ctx.market.price_date.isoformat(),
        "is_illustrative": ctx.market.is_illustrative,
    }


def farmer_minimum_payload(ctx: DealContext) -> dict[str, Any]:
    if ctx.min_price_per_kg is None:
        return {"min_net_price_per_kg": None, "note": "The farmer set no minimum price"}
    return {
        "min_net_price_per_kg": ctx.min_price_per_kg,
        "note": "A net floor: what the farmer must keep per kg after all deductions",
        "options_meeting_minimum": [
            o.option_id for o in ctx.options.options if o.meets_min_price is True
        ],
        "options_below_minimum": [
            o.option_id for o in ctx.options.options if o.meets_min_price is False
        ],
    }


def counter_suggestion_payload(ctx: DealContext) -> dict[str, Any]:
    suggestion = ctx.counteroffer
    if suggestion is None:
        return {"available": False, "reason": "No open offer is waiting for the seller's reply"}
    return {
        "available": True,
        "offer_id": str(suggestion.offer_id),
        "current_price_per_kg": suggestion.current_price_per_kg,
        "suggested_price_per_kg": suggestion.suggested_price_per_kg,
        "floor_price_per_kg": suggestion.floor_price_per_kg,
        "market_reference_per_kg": suggestion.market_reference_per_kg,
        "accept_advised": suggestion.suggested_price_per_kg <= suggestion.current_price_per_kg,
    }


def transport_comparison_payload(ctx: DealContext) -> dict[str, Any]:
    rows = []
    for option in ctx.options.options:
        transport = line(option, "transport")
        handling = line(option, "handling")
        rows.append(
            {
                "option_id": option.option_id,
                "source": option.source,
                "quantity_kg": option.quantity_kg,
                "transport_amount": abs(transport.amount) if transport else None,
                "transport_per_kg": abs(transport.per_kg) if transport else None,
                "transport_certainty": transport.certainty if transport else None,
                "transport_note": transport.note if transport else None,
                "handling_per_kg": abs(handling.per_kg) if handling else None,
                "handling_note": handling.note if handling else None,
                "transport_and_handling_per_kg": float(cost_per_kg(option, TRANSPORT_KEYS)),
                "other_deductions_per_kg": float(cost_per_kg(option, OTHER_KEYS)),
                "open_conditions": option.unresolved,
            }
        )
    return {"options": rows}


def _dump(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, default=str)


def build_deal_tools(ctx: DealContext) -> list[BaseTool]:
    """The main agent's tools, bound to ``ctx``."""

    def get_selling_options() -> str:
        """All selling options for this harvest (offers and the mandi baseline) with net
        proceeds per kg and in total, payment days, open conditions, the best option id and
        ready-made differences between the best option, the next offer and the mandi."""
        ctx.tool_calls.append("get_selling_options")
        return _dump(selling_options_payload(ctx))

    def get_option_breakdown(option_id: str) -> str:
        """Every deduction line (gross, rejection, transport, handling, commission,
        payment wait, platform fee) of one option, with amount, per-kg value and certainty."""
        ctx.tool_calls.append("get_option_breakdown")
        return _dump(option_breakdown_payload(ctx, option_id))

    def get_market_reference() -> str:
        """The latest mandi modal price per kg for this crop and where it comes from."""
        ctx.tool_calls.append("get_market_reference")
        return _dump(market_reference_payload(ctx))

    def get_farmer_minimum() -> str:
        """The farmer's minimum net price per kg (if set) and which options meet it."""
        ctx.tool_calls.append("get_farmer_minimum")
        return _dump(farmer_minimum_payload(ctx))

    def get_counter_suggestion() -> str:
        """MandiMate's rule-based counter-offer for the best offer waiting for the seller:
        current, suggested and floor prices per kg and the market reference."""
        ctx.tool_calls.append("get_counter_suggestion")
        return _dump(counter_suggestion_payload(ctx))

    return [
        StructuredTool.from_function(get_selling_options),
        StructuredTool.from_function(get_option_breakdown),
        StructuredTool.from_function(get_market_reference),
        StructuredTool.from_function(get_farmer_minimum),
        StructuredTool.from_function(get_counter_suggestion),
    ]


def build_logistics_tools(ctx: DealContext) -> list[BaseTool]:
    """The logistics-analyst sub-agent's tools, bound to ``ctx``."""

    def get_transport_comparison() -> str:
        """Transport and handling per kg for every option, how transport is arranged
        (notes such as shared by weight across farmers, buyer pickup, solo vehicle to the
        mandi), its certainty and open conditions such as a pending transport quote."""
        ctx.tool_calls.append("get_transport_comparison")
        return _dump(transport_comparison_payload(ctx))

    def get_option_breakdown(option_id: str) -> str:
        """Every deduction line of one option, with amount, per-kg value and certainty."""
        ctx.tool_calls.append("get_option_breakdown")
        return _dump(option_breakdown_payload(ctx, option_id))

    return [
        StructuredTool.from_function(get_transport_comparison),
        StructuredTool.from_function(get_option_breakdown),
    ]
