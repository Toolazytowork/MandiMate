"""Guard that model text only uses numbers the engines produced.

``allowed_numbers(*facts)`` collects every number in the facts given to the model (JSON values and
numbers inside strings such as "400 kg × ₹16.00/kg"), with their absolute values. ``ungrounded``
returns the numbers in a model answer that match none of them. Small counting numbers (0–12) are
always allowed, and a whole number is accepted as the rounding of an allowed value ("about ₹15"
for ₹15.20). Anything else means the model computed or invented a number, and the caller falls
back to the rules text.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

from pydantic import BaseModel

_DIGIT_BLOCKS = (0x0966, 0x0C66, 0x0CE6, 0x0660, 0x06F0)
"""Zero of the Devanagari, Telugu, Kannada, Arabic-Indic and Extended Arabic-Indic (Urdu) digits."""
_DIGIT_TABLE = str.maketrans(
    {chr(zero + i): str(i) for zero in _DIGIT_BLOCKS for i in range(10)}
    | {"\u066b": ".", "\u066c": ","}  # Arabic decimal and thousands separators
)
_NUMBER_RE = re.compile(r"\d+(?:,\d+)*(?:\.\d+)?")
_CENT = Decimal("0.01")
ALWAYS_ALLOWED_MAX = 12


def _to_decimal(text: str) -> Decimal | None:
    try:
        value = Decimal(text.replace(",", ""))
    except InvalidOperation:
        return None
    return value if value.is_finite() else None


def numbers_in_text(text: str) -> list[Decimal]:
    """Every number written in ``text`` (ASCII, Devanagari, Telugu, Kannada or Arabic-Indic digits,
    Indian grouping)."""
    normalized = text.translate(_DIGIT_TABLE)
    values = (_to_decimal(match.group(0)) for match in _NUMBER_RE.finditer(normalized))
    return [value for value in values if value is not None]


def _walk(value: Any) -> Iterable[Decimal]:
    if isinstance(value, BaseModel):
        yield from _walk(value.model_dump(mode="json"))
    elif isinstance(value, bool) or value is None:
        return
    elif isinstance(value, int | float | Decimal):
        number = Decimal(str(value))
        if number.is_finite():
            yield number
    elif isinstance(value, str):
        yield from numbers_in_text(value)
    elif isinstance(value, Mapping):
        for item in value.values():
            yield from _walk(item)
    elif isinstance(value, Iterable):
        for item in value:
            yield from _walk(item)


def allowed_numbers(*facts: Any) -> set[Decimal]:
    """Numbers (rounded to the paisa, absolute) that the model may quote."""
    return {abs(number).quantize(_CENT, rounding=ROUND_HALF_UP) for number in _walk(facts)}


def ungrounded(text: str, allowed: set[Decimal]) -> list[Decimal]:
    """Numbers in ``text`` that are not engine numbers (empty when the text is grounded)."""
    rounded_allowed = {value.quantize(Decimal(1), rounding=ROUND_HALF_UP) for value in allowed}
    one_decimal = {value.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP) for value in allowed}
    bad: list[Decimal] = []
    for number in numbers_in_text(text):
        value = number.quantize(_CENT, rounding=ROUND_HALF_UP)
        if value in allowed or (value <= ALWAYS_ALLOWED_MAX and value == value.to_integral_value()):
            continue
        if number == number.to_integral_value() and number in rounded_allowed:
            continue
        if number.as_tuple().exponent == -1 and number in one_decimal:
            continue
        bad.append(number)
    return bad
