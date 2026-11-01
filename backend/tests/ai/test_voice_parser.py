"""Rules-based voice-listing parser: numbers, units, crops, dates, grades, prices, never guessing."""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Any

import pytest

from app.ai import templates, voice_parser
from app.ai.voice_parser import CropRef, merge_number_words, parse, tokenize

TODAY = date(2026, 10, 27)  # a Tuesday
TOMORROW = TODAY + timedelta(days=1)

TOMATO = CropRef(
    uuid.UUID("00000000-0000-0000-0000-000000000001"),
    "Tomato",
    "टमाटर",
    "టమాటా",
    ("tomato", "tomatoes", "tamatar"),
    name_kn="ಟೊಮೆಟೊ",
    name_ur="ٹماٹر",
)
ONION = CropRef(
    uuid.UUID("00000000-0000-0000-0000-000000000002"),
    "Onion",
    "प्याज",
    "ఉల్లిపాయ",
    name_kn="ಈರುಳ್ಳಿ",
    name_ur="پیاز",
)
CHILLI = CropRef(
    uuid.UUID("00000000-0000-0000-0000-000000000003"),
    "Green Chilli",
    "हरी मिर्च",
    "పచ్చిమిర్చి",
    name_kn="ಹಸಿರು ಮೆಣಸಿನಕಾಯಿ",
    name_ur="ہری مرچ",
)
POTATO = CropRef(
    uuid.UUID("00000000-0000-0000-0000-000000000004"),
    "Potato",
    "आलू",
    "బంగాళాదుంప",
    name_kn="ಆಲೂಗಡ್ಡೆ",
    name_ur="آلو",
)
MANGO = CropRef(
    uuid.UUID("00000000-0000-0000-0000-000000000005"),
    "Mango",
    "आम",
    "మామిడి",
    name_kn="ಮಾವಿನಹಣ್ಣು",
    name_ur="آم",
)
CROPS = [TOMATO, ONION, CHILLI, POTATO, MANGO]


def draft_of(transcript: str, language: str = "en") -> tuple[dict[str, Any], list[str], float]:
    draft, missing, confidence = parse(transcript, language, CROPS, TODAY)  # type: ignore[arg-type]
    return draft.model_dump(), missing, confidence


def numbers(text: str) -> list[str]:
    return merge_number_words(tokenize(text))


# ─────────────────────────────── The brief's examples ───────────────────────────────


def test_english_brief_example() -> None:
    draft, missing, confidence = draft_of(
        "I have 400 kilos of tomatoes ready for pickup tomorrow morning"
    )
    assert draft["crop_id"] == TOMATO.id
    assert draft["crop_name"] == "Tomato"
    assert draft["quantity_kg"] == 400.0
    assert draft["available_from"] == TOMORROW
    assert draft["sell_by"] is None
    assert draft["harvest_date"] is None
    assert draft["grade"] is None
    assert missing == ["sell_by", "grade", "harvest_date"]
    assert confidence == 0.5


def test_telugu_brief_example_quintals() -> None:
    draft, missing, _ = draft_of("నా దగ్గర 5 క్వింటాళ్ల టమాటాలు రేపు సిద్ధంగా ఉన్నాయి", "te")
    assert draft["crop_id"] == TOMATO.id
    assert draft["quantity_kg"] == 500.0
    assert draft["available_from"] == TOMORROW
    assert "sell_by" in missing


def test_hindi_brief_example_sell_by_day_after_tomorrow() -> None:
    draft, missing, _ = draft_of("मेरे पास 300 किलो प्याज है, परसों तक बेचना है", "hi")
    assert draft["crop_id"] == ONION.id
    assert draft["quantity_kg"] == 300.0
    assert draft["sell_by"] == TODAY + timedelta(days=2)
    assert draft["available_from"] is None
    assert missing == ["available_from", "grade", "harvest_date"]


def test_kannada_brief_example_quintals() -> None:
    draft, missing, _ = draft_of("ನನ್ನ ಬಳಿ 5 ಕ್ವಿಂಟಾಲ್ ಟೊಮೆಟೊ ನಾಳೆ ಸಿದ್ಧವಾಗಿದೆ", "kn")
    assert draft["crop_id"] == TOMATO.id
    assert draft["quantity_kg"] == 500.0
    assert draft["available_from"] == TOMORROW
    assert "sell_by" in missing


def test_urdu_brief_example_sell_by_day_after_tomorrow() -> None:
    draft, missing, _ = draft_of("میرے پاس 300 کلو پیاز ہے، پرسوں تک بیچنا ہے", "ur")
    assert draft["crop_id"] == ONION.id
    assert draft["quantity_kg"] == 300.0
    assert draft["sell_by"] == TODAY + timedelta(days=2)
    assert draft["available_from"] is None
    assert missing == ["available_from", "grade", "harvest_date"]


@pytest.mark.parametrize(
    ("transcript", "language"),
    [
        (
            "ನಾನೂರು ಕೆಜಿ ಟೊಮೆಟೊ, ಎ ಗ್ರೇಡ್, ಇಂದು ಕೊಯ್ಲು, ನಾಳೆ ಸಿದ್ಧ, 5 ದಿನಗಳಲ್ಲಿ ಮಾರಬೇಕು, "
            "ಕನಿಷ್ಠ ಕಿಲೋಗೆ 12 ರೂಪಾಯಿ, ಹಣ್ಣಾಗಿವೆ ಮತ್ತು ಗಟ್ಟಿಯಾಗಿವೆ",
            "kn",
        ),
        (
            "چار سو کلو ٹماٹر، اے گریڈ، آج توڑے، کل تیار، 5 دن میں بیچنا ہے، "
            "کم از کم 12 روپے فی کلو، پکے اور سخت",
            "ur",
        ),
    ],
)
def test_complete_listing_in_kannada_and_urdu(transcript: str, language: str) -> None:
    draft, missing, confidence = draft_of(transcript, language)
    assert draft == {
        "crop_id": TOMATO.id,
        "crop_name": "Tomato",
        "variety": None,
        "quantity_kg": 400.0,
        "grade": "A",
        "harvest_date": TODAY,
        "available_from": TOMORROW,
        "sell_by": TODAY + timedelta(days=5),
        "quality_notes": "Ripe, firm",
        "min_price_per_kg": 12.0,
    }
    assert missing == []
    assert confidence == 1.0


def test_complete_listing_has_nothing_missing() -> None:
    draft, missing, confidence = draft_of(
        "Four hundred kg tamatar, A grade, harvested today, ready tomorrow, "
        "sell within 5 days, minimum 12 rupees per kg, ripe and firm"
    )
    assert draft == {
        "crop_id": TOMATO.id,
        "crop_name": "Tomato",
        "variety": None,
        "quantity_kg": 400.0,
        "grade": "A",
        "harvest_date": TODAY,
        "available_from": TOMORROW,
        "sell_by": TODAY + timedelta(days=5),
        "quality_notes": "Ripe, firm",
        "min_price_per_kg": 12.0,
    }
    assert missing == []
    assert confidence == 1.0


# ─────────────────────────────── Numbers ───────────────────────────────


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("four hundred", ["400"]),
        ("two and a half", ["2.5"]),
        ("one and half", ["1.5"]),
        ("one hundred and fifty", ["150"]),
        ("two thousand five hundred", ["2500"]),
        ("twenty five", ["25"]),
        ("a hundred kilos", ["100", "kilos"]),
        ("a quintal", ["1", "quintal"]),
        ("half a tonne", ["0.5", "tonne"]),
        ("2 lakh", ["200000"]),
        ("4 hundred", ["400"]),
        ("1,200 kg", ["1200", "kg"]),
        ("1,00,000", ["100000"]),
        ("2.5 quintal", ["2.5", "quintal"]),
        ("चार सौ", ["400"]),
        ("ढाई सौ", ["250"]),
        ("डेढ़ क्विंटल", ["1.5", "क्विंटल"]),
        ("साढ़े तीन", ["3.5"]),
        ("दो हज़ार पांच सौ", ["2500"]),
        ("char sau", ["400"]),
        ("do quintal", ["2", "quintal"]),
        ("३००", ["300"]),
        ("నాలుగు వందల", ["400"]),
        ("ఐదు వందల యాభై", ["550"]),
        ("రెండున్నర", ["2.5"]),
        ("రెండొందల", ["200"]),
        ("అర టన్ను", ["0.5", "టన్ను"]),
        ("౪౦౦", ["400"]),
        ("ನಾಲ್ಕು ನೂರು", ["400"]),
        ("ಇನ್ನೂರ ಐವತ್ತು", ["250"]),
        ("ನೂರ ಐವತ್ತು", ["150"]),
        ("ಎರಡು ಸಾವಿರ ಐನೂರು", ["2500"]),
        ("ಎರಡೂವರೆ", ["2.5"]),
        ("ಅರ್ಧ ಟನ್", ["0.5", "ಟನ್"]),
        ("೪೦೦", ["400"]),
        ("چار سو", ["400"]),
        ("ڈھائی سو", ["250"]),
        ("ڈیڑھ کوئنٹل", ["1.5", "کوئنٹل"]),
        ("ساڑھے تین", ["3.5"]),
        ("دو ہزار پانچ سو", ["2500"]),
        ("۴۰۰", ["400"]),
        ("٤٠٠", ["400"]),
    ],
)
def test_spoken_numbers_become_digits(text: str, expected: list[str]) -> None:
    assert numbers(text) == expected


def test_separate_numbers_are_not_merged() -> None:
    assert numbers("5 10") == ["5", "10"]
    assert numbers("two three") == ["2", "3"]


def test_a_after_a_price_means_per_not_one() -> None:
    assert numbers("15 rupees a kg") == ["15", "rupees", "a", "kg"]


# ─────────────────────────────── Units ───────────────────────────────


@pytest.mark.parametrize(
    ("transcript", "language", "kg"),
    [
        ("300 kgs of tomatoes", "en", 300.0),
        ("300 kilogram tomatoes", "en", 300.0),
        ("five quintals of tomatoes", "en", 500.0),
        ("2 tonnes of tomatoes", "en", 2000.0),
        ("one ton tomatoes", "en", 1000.0),
        ("half a tonne of tomatoes", "en", 500.0),
        ("two and a half quintals of tomatoes", "en", 250.0),
        ("3 क्विंटल टमाटर", "hi", 300.0),
        ("2 टन टमाटर", "hi", 2000.0),
        ("डेढ़ क्विंटल टमाटर", "hi", 150.0),
        ("250 కిలోలు టమాటాలు", "te", 250.0),
        ("3 క్వింటాళ్లు టమాటాలు", "te", 300.0),
        ("ఒక టన్ను టమాటాలు", "te", 1000.0),
        ("10 కేజీలు టమాటా", "te", 10.0),
        ("నాలుగు వందల కిలోల టమాటాలు", "te", 400.0),
        ("250 ಕಿಲೋ ಟೊಮೆಟೊ", "kn", 250.0),
        ("3 ಕ್ವಿಂಟಾಲ್ ಟೊಮೆಟೊ", "kn", 300.0),
        ("ಒಂದು ಟನ್ ಟೊಮೆಟೊ", "kn", 1000.0),
        ("10 ಕೆಜಿ ಟೊಮೆಟೊ", "kn", 10.0),
        ("ನಾಲ್ಕು ನೂರು ಕಿಲೋ ಟೊಮೆಟೊಗಳು", "kn", 400.0),
        ("250 کلو ٹماٹر", "ur", 250.0),
        ("3 کوئنٹل ٹماٹر", "ur", 300.0),
        ("2 ٹن ٹماٹر", "ur", 2000.0),
        ("ڈیڑھ کوئنٹل ٹماٹر", "ur", 150.0),
        ("10 کے جی ٹماٹر", "ur", 10.0),
    ],
)
def test_units_convert_to_kg(transcript: str, language: str, kg: float) -> None:
    draft, _, _ = draft_of(transcript, language)
    assert draft["quantity_kg"] == kg
    assert draft["crop_id"] == TOMATO.id


@pytest.mark.parametrize(
    ("transcript", "language"),
    [
        ("టమాటాలు, పొలం 10 కిలోమీటర్లు దూరం", "te"),
        ("ಟೊಮೆಟೊ, ಹೊಲ 10 ಕಿಲೋಮೀಟರ್ ದೂರ", "kn"),
        ("ಟೊಮೆಟೊ, ಹೊಲ 10 ಕಿಲೋ ಮೀಟರ್ ದೂರ", "kn"),
        ("ٹماٹر، کھیت 10 کلومیٹر دور ہے", "ur"),
        ("ٹماٹر، کھیت 10 کلو میٹر دور ہے", "ur"),
    ],
)
def test_kilometres_are_not_kilograms(transcript: str, language: str) -> None:
    draft, missing, _ = draft_of(transcript, language)
    assert draft["quantity_kg"] is None
    assert "quantity_kg" in missing


def test_count_without_a_unit_is_not_guessed() -> None:
    draft, missing, _ = draft_of("I have 20 crates of tomatoes")
    assert draft["quantity_kg"] is None
    assert "quantity_kg" in missing


@pytest.mark.parametrize("transcript", ["0 kg tomatoes", "2000000 kg tomatoes"])
def test_quantity_outside_limits_is_rejected(transcript: str) -> None:
    draft, missing, _ = draft_of(transcript)
    assert draft["quantity_kg"] is None
    assert "quantity_kg" in missing


# ─────────────────────────────── Crops ───────────────────────────────


@pytest.mark.parametrize(
    ("transcript", "language", "crop"),
    [
        ("200 kg tamatar", "en", TOMATO),
        ("200 kg tamata", "te", TOMATO),
        ("200 kg pyaz", "hi", ONION),
        ("200 kg ullipaya", "te", ONION),
        ("200 kg mirchi", "hi", CHILLI),
        ("200 kg green chillies", "en", CHILLI),
        ("200 kg aloo", "hi", POTATO),
        ("200 kg aam", "hi", MANGO),
        ("200 kg mamidi", "te", MANGO),
        ("200 किलो टमाटर", "hi", TOMATO),
        ("200 किलो हरी मिर्च", "hi", CHILLI),
        ("200 కిలోల ఉల్లిపాయలు", "te", ONION),
        ("200 కిలోల మామిడికాయలు", "te", MANGO),
        ("200 ಕೆಜಿ ಈರುಳ್ಳಿ", "kn", ONION),
        ("200 ಕೆಜಿ ಮೆಣಸಿನಕಾಯಿ", "kn", CHILLI),
        ("200 ಕೆಜಿ ಆಲೂಗಡ್ಡೆ", "kn", POTATO),
        ("200 ಕೆಜಿ ಮಾವು", "kn", MANGO),
        ("200 kg eerulli", "kn", ONION),
        ("200 کلو پیاز", "ur", ONION),
        ("200 کلو ہری مرچ", "ur", CHILLI),
        ("200 کلو آلو", "ur", POTATO),
        ("200 کلو آم", "ur", MANGO),
        ("Tomatoes, 200 kg", "en", TOMATO),
    ],
)
def test_crop_names_and_transliterations(transcript: str, language: str, crop: CropRef) -> None:
    draft, _, _ = draft_of(transcript, language)
    assert draft["crop_id"] == crop.id
    assert draft["crop_name"] == crop.name


def test_two_crops_are_ambiguous() -> None:
    draft, missing, confidence = draft_of("tomatoes and onions 200 kg")
    assert draft["crop_id"] is None
    assert missing[0] == "crop_id"
    assert confidence < 1 / 6


def test_unknown_crop_is_missing() -> None:
    draft, missing, _ = draft_of("400 kg of dragon fruit ready tomorrow")
    assert draft["crop_id"] is None and draft["crop_name"] is None
    assert missing[0] == "crop_id"


def test_green_in_green_chilli_is_not_a_quality_note() -> None:
    draft, _, _ = draft_of("200 kg green chilli, fresh")
    assert draft["crop_id"] == CHILLI.id
    assert draft["quality_notes"] == "Fresh"


def test_match_crop_maps_names_in_any_language() -> None:
    assert voice_parser.match_crop("Tomato", CROPS) == TOMATO
    assert voice_parser.match_crop("ప్యాజ్ కాదు ఉల్లిపాయ", CROPS) == ONION
    assert voice_parser.match_crop("ಈರುಳ್ಳಿ", CROPS) == ONION
    assert voice_parser.match_crop("ٹماٹر", CROPS) == TOMATO
    assert voice_parser.match_crop("Dragon fruit", CROPS) is None
    assert voice_parser.match_crop(None, CROPS) is None


def test_builtin_alias_is_skipped_when_two_catalogue_crops_match() -> None:
    red = CropRef(uuid.uuid4(), "Red Chilli", "लाल मिर्च", "ఎండు మిర్చి")
    draft, _, _ = parse("200 kg mirchi", "hi", [*CROPS, red], TODAY)
    assert draft.crop_id is None


# ─────────────────────────────── Dates ───────────────────────────────


@pytest.mark.parametrize(
    ("transcript", "language", "days"),
    [
        ("200 kg tomatoes ready today", "en", 0),
        ("200 kg tomatoes ready tomorrow", "en", 1),
        ("200 kg tomatoes ready day after tomorrow", "en", 2),
        ("200 kg tomatoes available next week", "en", 7),
        ("200 kg tomatoes available from friday", "en", 3),
        ("200 किलो टमाटर आज से तैयार", "hi", 0),
        ("200 किलो टमाटर कल तैयार होंगे", "hi", 1),
        ("200 किलो टमाटर परसों तैयार", "hi", 2),
        ("200 కిలోల టమాటాలు ఈరోజు సిద్ధం", "te", 0),
        ("200 కిలోల టమాటాలు ఈ రోజు సిద్ధం", "te", 0),
        ("200 కిలోల టమాటాలు రేపు సిద్ధంగా ఉన్నాయి", "te", 1),
        ("200 కిలోల టమాటాలు ఎల్లుండి సిద్ధం", "te", 2),
        ("200 ಕೆಜಿ ಟೊಮೆಟೊ ಇಂದು ಸಿದ್ಧ", "kn", 0),
        ("200 ಕೆಜಿ ಟೊಮೆಟೊ ಇವತ್ತಿನಿಂದ ಸಿದ್ಧ", "kn", 0),
        ("200 ಕೆಜಿ ಟೊಮೆಟೊ ನಾಳೆ ಸಿದ್ಧವಾಗುತ್ತದೆ", "kn", 1),
        ("200 ಕೆಜಿ ಟೊಮೆಟೊ ನಾಳೆಯಿಂದ ಲಭ್ಯ", "kn", 1),
        ("200 ಕೆಜಿ ಟೊಮೆಟೊ ನಾಡಿದ್ದು ಸಿದ್ಧ", "kn", 2),
        ("200 کلو ٹماٹر آج سے تیار", "ur", 0),
        ("200 کلو ٹماٹر کل تیار ہوں گے", "ur", 1),
        ("200 کلو ٹماٹر پرسوں تیار", "ur", 2),
    ],
)
def test_relative_dates_set_available_from(transcript: str, language: str, days: int) -> None:
    draft, _, _ = draft_of(transcript, language)
    assert draft["available_from"] == TODAY + timedelta(days=days)
    assert draft["sell_by"] is None


@pytest.mark.parametrize(
    ("transcript", "language", "days"),
    [
        ("200 kg tomatoes, sell within 3 days", "en", 3),
        ("200 kg tomatoes, must sell by friday", "en", 3),
        ("200 kg tomatoes, sell before day after tomorrow", "en", 2),
        ("200 kg tomatoes, need to sell within a week", "en", 7),
        ("200 किलो टमाटर, 5 दिन में बेचना है", "hi", 5),
        ("200 किलो टमाटर, अगले हफ्ते तक बेचना है", "hi", 7),
        ("200 కిలోల టమాటాలు ఎల్లుండి లోపు అమ్మాలి", "te", 2),
        ("200 కిలోల టమాటాలు 4 రోజుల్లో అమ్మాలి", "te", 4),
        ("200 ಕೆಜಿ ಟೊಮೆಟೊ ನಾಡಿದ್ದರೊಳಗೆ ಮಾರಬೇಕು", "kn", 2),
        ("200 ಕೆಜಿ ಟೊಮೆಟೊ 4 ದಿನಗಳಲ್ಲಿ ಮಾರಬೇಕು", "kn", 4),
        ("200 ಕೆಜಿ ಟೊಮೆಟೊ, ಮುಂದಿನ ವಾರದೊಳಗೆ ಮಾರಾಟ ಮಾಡಬೇಕು", "kn", 7),
        ("200 کلو ٹماٹر، 5 دن میں بیچنا ہے", "ur", 5),
        ("200 کلو ٹماٹر، اگلے ہفتے تک بیچنا ہے", "ur", 7),
    ],
)
def test_sell_by_from_deadline_words(transcript: str, language: str, days: int) -> None:
    draft, _, _ = draft_of(transcript, language)
    assert draft["sell_by"] == TODAY + timedelta(days=days)


@pytest.mark.parametrize(
    ("transcript", "language", "days"),
    [
        ("200 kg tomatoes harvested yesterday", "en", -1),
        ("200 kg tomatoes, freshly harvested today", "en", 0),
        ("200 किलो टमाटर कल तोड़े", "hi", -1),
        ("200 किलो टमाटर परसों तोड़े", "hi", -2),
        ("200 కిలోల టమాటాలు నిన్న కోశాము", "te", -1),
        ("200 ಕೆಜಿ ಟೊಮೆಟೊ ನಿನ್ನೆ ಕೊಯ್ದೆವು", "kn", -1),
        ("200 ಕೆಜಿ ಟೊಮೆಟೊ ಮೊನ್ನೆ ಕಿತ್ತೆವು", "kn", -2),
        ("200 کلو ٹماٹر کل توڑے", "ur", -1),
        ("200 کلو ٹماٹر پرسوں توڑے", "ur", -2),
    ],
)
def test_harvest_date(transcript: str, language: str, days: int) -> None:
    draft, _, _ = draft_of(transcript, language)
    assert draft["harvest_date"] == TODAY + timedelta(days=days)


def test_ready_and_deadline_in_one_sentence() -> None:
    draft, _, _ = draft_of("200 kg tomatoes harvested yesterday ready today and sell within 4 days")
    assert draft["harvest_date"] == TODAY - timedelta(days=1)
    assert draft["available_from"] == TODAY
    assert draft["sell_by"] == TODAY + timedelta(days=4)


def test_explicit_calendar_dates() -> None:
    draft, _, _ = draft_of("200 kg tomatoes harvested on 25 october, sell by 2nd november")
    assert draft["harvest_date"] == date(2026, 10, 25)
    assert draft["sell_by"] == date(2026, 11, 2)
    draft, _, _ = draft_of("200 kg tomatoes ready 30/10")
    assert draft["available_from"] == date(2026, 10, 30)


def test_dates_outside_the_window_are_dropped() -> None:
    draft, missing, _ = draft_of("200 kg tomatoes harvested on 1 august")  # next year: too far
    assert draft["harvest_date"] is None
    assert "harvest_date" in missing


def test_sell_by_before_available_from_is_dropped() -> None:
    draft, missing, _ = draft_of("200 kg tomatoes ready day after tomorrow, sell by tomorrow")
    assert draft["available_from"] == TODAY + timedelta(days=2)
    assert draft["sell_by"] is None
    assert "sell_by" in missing


def test_no_deadline_means_sell_by_missing() -> None:
    _, missing, _ = draft_of("200 kg tomatoes A grade harvested today ready tomorrow")
    assert missing == ["sell_by"]


# ─────────────────────────────── Grades ───────────────────────────────


@pytest.mark.parametrize(
    ("transcript", "language", "grade"),
    [
        ("200 kg tomatoes A grade", "en", "A"),
        ("200 kg tomatoes grade b", "en", "B"),
        ("200 kg tomatoes c-grade", "en", "C"),
        ("200 kg tomatoes grade one", "en", "A"),
        ("200 kg tomatoes first quality", "en", "A"),
        ("200 kg of the best tomatoes", "en", "A"),
        ("200 kg tomatoes medium quality", "en", "B"),
        ("200 kg tomatoes, medium", "en", "B"),
        ("200 kg tomatoes low quality", "en", "C"),
        ("200 किलो टमाटर ए ग्रेड", "hi", "A"),
        ("200 किलो टमाटर बढ़िया क्वालिटी", "hi", "A"),
        ("200 किलो टमाटर मध्यम", "hi", "B"),
        ("200 కిలోల టమాటాలు బీ గ్రేడ్", "te", "B"),
        ("200 కిలోల టమాటాలు మొదటి రకం", "te", "A"),
        ("200 ಕೆಜಿ ಟೊಮೆಟೊ ಬಿ ಗ್ರೇಡ್", "kn", "B"),
        ("200 ಕೆಜಿ ಟೊಮೆಟೊ ಮೊದಲ ದರ್ಜೆ", "kn", "A"),
        ("200 ಕೆಜಿ ಟೊಮೆಟೊ ಮಧ್ಯಮ ಗುಣಮಟ್ಟ", "kn", "B"),
        ("200 کلو ٹماٹر سی گریڈ", "ur", "C"),
        ("200 کلو ٹماٹر اعلیٰ کوالٹی", "ur", "A"),
        ("200 کلو ٹماٹر درمیانی", "ur", "B"),
    ],
)
def test_grades(transcript: str, language: str, grade: str) -> None:
    draft, _, _ = draft_of(transcript, language)
    assert draft["grade"] == grade


@pytest.mark.parametrize(
    "transcript",
    ["200 kg tomatoes, I want the best price", "200 kg tomatoes, medium size", "200 kg tomatoes"],
)
def test_no_grade_is_guessed(transcript: str) -> None:
    draft, missing, _ = draft_of(transcript)
    assert draft["grade"] is None
    assert "grade" in missing


def test_conflicting_grades_are_ambiguous() -> None:
    draft, _, _ = draft_of("200 kg tomatoes, some A grade and some B grade")
    assert draft["grade"] is None


# ─────────────────────────────── Prices ───────────────────────────────


@pytest.mark.parametrize(
    ("transcript", "language", "price"),
    [
        ("400 kg tomatoes ₹15 per kilo", "en", 15.0),
        ("400 kg tomatoes, 15 rupees a kg", "en", 15.0),
        ("400 kg tomatoes, rs. 15 per kg", "en", 15.0),
        ("400 kg tomatoes, 15/kg", "en", 15.0),
        ("400 kg tomatoes, minimum 12", "en", 12.0),
        ("400 kg tomatoes, at least twelve rupees", "en", 12.0),
        ("400 kg tomatoes, 1500 rupees per quintal", "en", 15.0),
        ("400 kg tomatoes, ₹16.50 per kg", "en", 16.5),
        ("400 किलो टमाटर, 15 रुपये किलो", "hi", 15.0),
        ("400 किलो टमाटर, किलो के 15 रुपये", "hi", 15.0),
        ("400 किलो टमाटर, कम से कम 14 रुपये", "hi", 14.0),
        ("400 కిలోల టమాటాలు, కిలోకి 20 రూపాయలు", "te", 20.0),
        ("400 కిలోల టమాటాలు, కనీసం 18 రూపాయలు", "te", 18.0),
        ("400 ಕೆಜಿ ಟೊಮೆಟೊ, ಕಿಲೋಗೆ 20 ರೂಪಾಯಿ", "kn", 20.0),
        ("400 ಕೆಜಿ ಟೊಮೆಟೊ, 20 ರೂಪಾಯಿ ಕಿಲೋಗೆ", "kn", 20.0),
        ("400 ಕೆಜಿ ಟೊಮೆಟೊ, ಕನಿಷ್ಠ 18 ರೂಪಾಯಿ", "kn", 18.0),
        ("400 ಕೆಜಿ ಟೊಮೆಟೊ, ಕ್ವಿಂಟಾಲ್‌ಗೆ 1500 ರೂಪಾಯಿ", "kn", 15.0),
        ("400 کلو ٹماٹر، 15 روپے فی کلو", "ur", 15.0),
        ("400 کلو ٹماٹر، کلو کے 15 روپے", "ur", 15.0),
        ("400 کلو ٹماٹر، کم از کم 14 روپے", "ur", 14.0),
        ("۴۰۰ کلو ٹماٹر، ۱۶ روپے کلو", "ur", 16.0),
    ],
)
def test_prices(transcript: str, language: str, price: float) -> None:
    draft, _, _ = draft_of(transcript, language)
    assert draft["min_price_per_kg"] == price
    assert draft["quantity_kg"] == 400.0


def test_large_amount_without_unit_is_not_a_price() -> None:
    draft, _, _ = draft_of("400 kg tomatoes, 1500 rupees")
    assert draft["min_price_per_kg"] is None


def test_price_number_is_not_a_quantity() -> None:
    draft, missing, _ = draft_of("tomatoes at ₹15 per kilo")
    assert draft["min_price_per_kg"] == 15.0
    assert draft["quantity_kg"] is None
    assert "quantity_kg" in missing


# ─────────────────────────────── Notes & variety ───────────────────────────────


def test_quality_notes_are_collected_in_order() -> None:
    draft, _, _ = draft_of("400 kg tomatoes, ripe, firm and slightly soft, no cracks")
    assert draft["quality_notes"] == "Ripe, firm, slightly soft, no cracks"


@pytest.mark.parametrize(
    ("transcript", "language", "notes"),
    [
        ("400 किलो टमाटर, पके और ताज़ा", "hi", "Ripe, fresh"),
        ("400 కిలోల టమాటాలు, తాజాగా గట్టిగా ఉన్నాయి", "te", "Fresh, firm"),
        ("400 ಕೆಜಿ ಟೊಮೆಟೊ, ತಾಜಾ ಮತ್ತು ಗಟ್ಟಿಯಾಗಿವೆ, ಬಿರುಕು ಇಲ್ಲ", "kn", "Fresh, firm, no cracks"),
        ("400 کلو ٹماٹر، تازہ اور تھوڑے نرم", "ur", "Fresh, slightly soft"),
    ],
)
def test_quality_notes_in_indian_languages(transcript: str, language: str, notes: str) -> None:
    draft, _, _ = draft_of(transcript, language)
    assert draft["quality_notes"] == notes


def test_urdu_arabic_letter_variants_and_diacritics_are_unified() -> None:
    # Arabic yeh / kaf and heh, tatweel and zabar/shadda as some keyboards produce them.
    assert tokenize("كلو") == tokenize("کلو")
    assert tokenize("پياز") == tokenize("پیاز")
    assert tokenize("تازه") == tokenize("تازہ")
    assert tokenize("ٹَماٹـر") == tokenize("ٹماٹر")
    draft, _, _ = draft_of("300 كلو پياز، تازه", "ur")
    assert (draft["crop_id"], draft["quantity_kg"], draft["quality_notes"]) == (
        ONION.id,
        300.0,
        "Fresh",
    )


def test_variety() -> None:
    draft, _, _ = draft_of("Arka Rakshak variety tomatoes, 1,200 kg")
    assert draft["variety"] == "Arka Rakshak"
    assert draft["quantity_kg"] == 1200.0
    draft, _, _ = draft_of("1200 kg tomatoes, variety is pusa ruby")
    assert draft["variety"] == "Pusa Ruby"


def test_nothing_recognised() -> None:
    draft, missing, confidence = draft_of("hello, can you hear me")
    assert all(value is None for value in draft.values())
    assert missing == list(voice_parser.FOLLOW_UP_PRIORITY)
    assert confidence == 0.0


# ─────────────────────────────── Merge (model output) ───────────────────────────────


def test_merge_fills_only_gaps_and_validates() -> None:
    rules, _ = voice_parser.extract_fields(
        "I have 400 kilos of tomatoes ready for pickup tomorrow", "en", CROPS, TODAY
    )
    extra = {
        "quantity_kg": 999.0,  # rules already know 400: ignored
        "grade": "A",
        "sell_by": TODAY + timedelta(days=4),
        "harvest_date": TODAY + timedelta(days=90),  # outside the window: rejected
        "crop_id": "not-a-uuid",
        "min_price_per_kg": -5,  # invalid: rejected
        "quality_notes": "  ripe  ",
    }
    merged, contributed = voice_parser.merge(rules, extra, TODAY)
    assert merged["quantity_kg"] == 400.0
    assert merged["crop_id"] == TOMATO.id
    assert merged["grade"] == "A"
    assert merged["sell_by"] == TODAY + timedelta(days=4)
    assert merged["harvest_date"] is None
    assert merged["min_price_per_kg"] is None
    assert merged["quality_notes"] == "ripe"
    assert contributed == {"grade", "sell_by", "quality_notes"}


def test_merge_never_invalidates_rule_values() -> None:
    rules, _ = voice_parser.extract_fields("400 kg tomatoes ready tomorrow", "en", CROPS, TODAY)
    # A harvest date after the rules' available_from would invalidate it: refused.
    merged, contributed = voice_parser.merge(
        rules, {"harvest_date": TODAY + timedelta(days=3), "grade": "Z"}, TODAY
    )
    assert merged["available_from"] == TOMORROW
    assert merged["harvest_date"] is None
    assert merged["grade"] is None
    assert contributed == set()


# ─────────────────────────────── Follow-up questions ───────────────────────────────


@pytest.mark.parametrize(
    ("language", "missing", "expected"),
    [
        ("en", ["sell_by", "grade"], "By which day must it be sold?"),
        ("hi", ["crop_id"], "आप कौन सी फसल बेच रहे हैं?"),
        ("te", ["quantity_kg"], "మీ దగ్గర అమ్మడానికి ఎన్ని కిలోలు ఉన్నాయి?"),
        ("te", [], "నేను విన్నదంతా నింపాను. దయచేసి డ్రాఫ్ట్‌ను సరిచూసి నిర్ధారించండి."),
        ("en", [], "I have filled in everything I heard. Please check the draft and confirm."),
        ("kn", ["crop_id"], "ನೀವು ಯಾವ ಬೆಳೆಯನ್ನು ಮಾರುತ್ತಿದ್ದೀರಿ?"),
        ("kn", ["sell_by", "grade"], "ಯಾವ ದಿನದೊಳಗೆ ಮಾರಬೇಕು?"),
        ("ur", ["quantity_kg"], "آپ کے پاس بیچنے کے لیے کتنے کلو ہیں؟"),
        ("ur", [], "میں نے جو سنا وہ سب بھر دیا ہے۔ براہ کرم مسودہ جانچ کر تصدیق کریں۔"),
    ],
)
def test_follow_up_question_in_request_language(
    language: str, missing: list[str], expected: str
) -> None:
    assert templates.follow_up_question(language, missing) == expected
