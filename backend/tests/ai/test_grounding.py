"""Number grounding: digits in every supported script count as the same numbers."""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.ai.grounding import allowed_numbers, numbers_in_text, ungrounded


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("400 kg × ₹16.50/kg = ₹6,600.00", ["400", "16.50", "6600.00"]),
        ("₹१६.५० प्रति किलो, १,००० किलो", ["16.50", "1000"]),
        ("కిలోకు ₹౧౬.౫౦, ౧,౦౦౦ కిలోలు", ["16.50", "1000"]),
        ("ಕಿಲೋಗೆ ₹೧೬.೫೦, ೧,೦೦೦ ಕಿಲೋ", ["16.50", "1000"]),
        ("₹۱۶.۵۰ فی کلو، ۱,۰۰۰ کلو", ["16.50", "1000"]),
        ("₹١٦٫٥٠ فی کلو، ١٬٠٠٠ کلو", ["16.50", "1000"]),
    ],
)
def test_numbers_in_every_script(text: str, expected: list[str]) -> None:
    assert numbers_in_text(text) == [Decimal(value) for value in expected]


@pytest.mark.parametrize(
    "text",
    [
        "ಕಿಲೋಗೆ ₹೧೪.೨೯ ಉಳಿಯುತ್ತದೆ, ಒಟ್ಟು ₹೫,೭೧೬.೩೯.",
        "آپ کو ₹۱۴.۲۹ فی کلو ملیں گے، کل ₹۵,۷۱۶.۳۹۔",
    ],
)
def test_engine_numbers_in_kannada_and_urdu_digits_are_grounded(text: str) -> None:
    allowed = allowed_numbers({"net_per_kg": 14.29, "net_amount": 5716.39})
    assert ungrounded(text, allowed) == []


@pytest.mark.parametrize(
    ("text", "bad"),
    [
        ("ಕಿಲೋಗೆ ₹೧೭.೫೦ ಉಳಿಯುತ್ತದೆ.", "17.50"),
        ("آپ کو ₹۱۷.۵۰ فی کلو ملیں گے۔", "17.50"),
    ],
)
def test_invented_numbers_in_kannada_and_urdu_digits_are_caught(text: str, bad: str) -> None:
    allowed = allowed_numbers({"net_per_kg": 14.29})
    assert ungrounded(text, allowed) == [Decimal(bad)]
