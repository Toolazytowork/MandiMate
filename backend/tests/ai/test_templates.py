"""Rules-path texts: every language has every text, and catalogue names follow the language."""

from __future__ import annotations

import uuid

import pytest

from app.ai import prompts, templates
from app.ai.voice_parser import CropRef
from app.models.enums import LANGUAGES

TEXT_TABLES = {
    "follow_up": templates._FOLLOW_UP,
    "line_names": templates._LINE_NAMES,
    "option_labels": templates._OPTION_LABELS,
    "deal": templates._DEAL,
    "counter": templates._COUNTER,
    "match": templates._MATCH,
    "insights": templates._INSIGHTS,
}

TOMATO = CropRef(uuid.uuid4(), "Tomato", "टमाटर", "టమాటా", (), name_kn="ಟೊಮೆಟೊ", name_ur="ٹماٹر")


def test_every_api_language_has_rules_texts() -> None:
    assert set(LANGUAGES) == {"en", "hi", "te", "kn", "ur"}
    assert set(templates.LANGUAGE_NAMES) == set(LANGUAGES)
    assert templates.LANGUAGE_NAMES["kn"] == "Kannada"
    assert templates.LANGUAGE_NAMES["ur"] == "Urdu"


@pytest.mark.parametrize("table", list(TEXT_TABLES))
@pytest.mark.parametrize("language", ["hi", "te", "kn", "ur"])
def test_each_table_has_every_key_in_every_language(table: str, language: str) -> None:
    texts = TEXT_TABLES[table]
    assert set(texts[language]) == set(texts["en"])


@pytest.mark.parametrize("language", ["en", "hi", "te", "kn", "ur"])
def test_disclaimers_exist_and_name_mandimate(language: str) -> None:
    for source in ("ai", "rules"):
        assert "MandiMate" in templates.disclaimer(language, source)


@pytest.mark.parametrize("language", ["hi", "te", "kn", "ur"])
def test_unresolved_items_are_translated(language: str) -> None:
    for item in templates._UNRESOLVED:
        assert templates.unresolved_text(language, item) != item


@pytest.mark.parametrize(
    ("language", "per_kg", "kg", "listed"),
    [
        ("kn", "ಕಿಲೋಗೆ ₹16.50", "1,000 ಕಿಲೋ", "ಟೊಮೆಟೊ, ಈರುಳ್ಳಿ ಮತ್ತು ಮಾವು"),
        ("ur", "₹16.50 فی کلو", "1,000 کلو", "ٹماٹر، پیاز اور آم"),
    ],
)
def test_formatting_in_kannada_and_urdu(language: str, per_kg: str, kg: str, listed: str) -> None:
    crops = {"kn": ["ಟೊಮೆಟೊ", "ಈರುಳ್ಳಿ", "ಮಾವು"], "ur": ["ٹماٹر", "پیاز", "آم"]}[language]
    assert templates.per_kg(language, 16.5) == per_kg
    assert templates.kg(language, 1000) == kg
    assert templates.join_list(language, crops) == listed


@pytest.mark.parametrize(
    ("language", "label"),
    [("en", "tomato"), ("hi", "टमाटर"), ("te", "టమాటా"), ("kn", "ಟೊಮೆಟೊ"), ("ur", "ٹماٹر")],
)
def test_crop_label_uses_the_catalogue_name(language: str, label: str) -> None:
    assert templates.crop_label(TOMATO, language) == label


def test_crop_label_falls_back_to_english_without_a_translation() -> None:
    crop = CropRef(uuid.uuid4(), "Onion", "प्याज", "ఉల్లిపాయ")
    assert templates.crop_label(crop, "kn") == "onion"
    assert templates.crop_label(crop, "fr") == "onion"


@pytest.mark.parametrize(
    ("language", "expected"),
    [("kn", "ಡೆಲಿವರಿ ಸಮಯದಲ್ಲಿ"), ("ur", "ڈلیوری پر")],
)
def test_payment_on_delivery(language: str, expected: str) -> None:
    assert templates._payment_when(language, 0) == expected


def test_prompts_name_the_new_languages() -> None:
    assert prompts.language_name("kn") == "Kannada"
    assert prompts.language_name("ur") == "Urdu"
    prompt = prompts.voice_extraction_prompt("2026-10-29", "Tomato")
    assert "Kannada" in prompt and "Urdu" in prompt


def test_unknown_language_falls_back_to_english() -> None:
    assert templates.follow_up_question("fr", ["crop_id"]) == "Which crop are you selling?"
