"""Rules-based voice-listing parser (English, Hindi, Telugu, Kannada, Urdu). Pure functions, no I/O.

``parse(transcript, language, crops, today)`` turns a browser speech transcript into harvest-draft
fields, the required fields it could not establish (``missing_fields``) and a confidence score.
Nothing is guessed: a value that is not stated, is ambiguous (two crops, two grades) or fails
validation stays ``None`` and is reported missing.

Pipeline: normalise the text (digits in every script → ASCII, nukta and zero-width joiners
removed, Urdu letter variants unified, lower case) → tokenise → canonicalise multi-word phrases → turn number words into digits
("four hundred" → 400, "two and a half" → 2.5, "నాలుగు వందల" → 400, "ढाई सौ" → 250,
"ನಾಲ್ಕು ನೂರು" → 400, "ڈھائی سو" → 250) → extract
price, quantity (with units), crop, dates (relative words classified by nearby keywords), grade,
quality notes and variety → validate.
"""

from __future__ import annotations

import re
import unicodedata
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any, NamedTuple, Protocol

from app import schemas

# ─────────────────────────────── Constants ───────────────────────────────

REQUIRED_FIELDS: tuple[schemas.HarvestDraftField, ...] = (
    "crop_id",
    "quantity_kg",
    "grade",
    "harvest_date",
    "available_from",
    "sell_by",
)
"""Fields a listing needs; when unknown they are reported in ``missing_fields``."""

FOLLOW_UP_PRIORITY: tuple[schemas.HarvestDraftField, ...] = (
    "crop_id",
    "quantity_kg",
    "available_from",
    "sell_by",
    "grade",
    "harvest_date",
)
"""Order in which missing fields are asked about (most important first)."""

DRAFT_FIELDS: tuple[schemas.HarvestDraftField, ...] = (
    "crop_id",
    "crop_name",
    "variety",
    "quantity_kg",
    "grade",
    "harvest_date",
    "available_from",
    "sell_by",
    "quality_notes",
    "min_price_per_kg",
)

MIN_QUANTITY_KG = Decimal(1)
MAX_QUANTITY_KG = Decimal(1_000_000)
MAX_PRICE_PER_KG = Decimal(100_000)
MAX_UNITLESS_PRICE = Decimal(1_000)
"""A price stated without "per kg/quintal" is read as per kg only up to this value."""
PAST_DAYS = 7
FUTURE_DAYS = 60
MAX_NOTES_LENGTH = 2000
MAX_VARIETY_LENGTH = 120
AMBIGUITY_PENALTY = 0.1
CONTEXT_WINDOW = 4
"""Tokens on each side of a date that may classify it (harvest / available / sell-by)."""

_CENT = Decimal("0.01")


class CropLike(Protocol):
    """Anything with the catalogue fields the parser needs (the ORM ``Crop`` qualifies)."""

    id: uuid.UUID
    name: str
    name_hi: str
    name_te: str
    name_kn: str
    name_ur: str
    synonyms: Any


@dataclass(frozen=True)
class CropRef:
    """A light catalogue entry (tests, or callers without ORM objects)."""

    id: uuid.UUID
    name: str
    name_hi: str = ""
    name_te: str = ""
    synonyms: tuple[str, ...] = ()
    name_kn: str = ""
    name_ur: str = ""


class ParsedListing(NamedTuple):
    draft: schemas.HarvestDraft
    missing_fields: list[schemas.HarvestDraftField]
    confidence: float


# ───────────────────────────── Normalisation ─────────────────────────────

_DIGIT_BLOCKS = (0x0966, 0x0C66, 0x0CE6, 0x0660, 0x06F0)
"""Zero of the Devanagari, Telugu, Kannada, Arabic-Indic and Extended Arabic-Indic (Urdu) digits."""
_DIGIT_TABLE = str.maketrans(
    {chr(zero + i): str(i) for zero in _DIGIT_BLOCKS for i in range(10)}
    | {"\u066b": ".", "\u066c": ","}  # Arabic decimal and thousands separators
)
_URDU_TABLE = str.maketrans(
    {
        "\u064a": "\u06cc",  # Arabic yeh → Farsi/Urdu yeh
        "\u0649": "\u06cc",  # alef maksura → Urdu yeh
        "\u0643": "\u06a9",  # Arabic kaf → keheh
        "\u0647": "\u06c1",  # Arabic heh → heh goal
        "\u0640": None,  # tatweel
        "\u0670": None,  # superscript alef
    }
    | dict.fromkeys(range(0x064B, 0x0660))  # harakat (zabar, zer, pesh, shadda, ...)
)
_NUKTA = "़"
_CHANDRABINDU = "ँ"
_ANUSVARA = "ं"
_ZERO_WIDTH = ("‌", "‍", "﻿")
_GROUPED_NUMBER = re.compile(r"(?<![\d,])\d{1,3}(?:,\d{2,3})*,\d{3}(?![\d])")
_DIGIT_HYPHEN = re.compile(r"(?<=\d)-(?=\d)")
_WORD_HYPHEN = re.compile(r"(?<=\S)-(?=\S)")
_TOKEN_RE = re.compile(
    r"\d+(?:\.\d+)?|[a-zऀ-ॣ०-ॿఀ-౿ಀ-೿\u0621-\u065f\u066e-\u06d3\u06d5\u06fa-\u06ff]+|₹|%|/|[^\s]"
)
_NUMBER_RE = re.compile(r"\d+(?:\.\d+)?")
_LATIN_RE = re.compile(r"[a-z]+")


def normalize(text: str) -> str:
    """Comparable form: NFC, ASCII digits, no nukta / zero-width joiners / Arabic diacritics, one
    spelling of the Urdu letters that have Arabic look-alikes, lower case."""
    text = unicodedata.normalize("NFC", text).translate(_DIGIT_TABLE).translate(_URDU_TABLE)
    text = text.replace(_NUKTA, "").replace(_CHANDRABINDU, _ANUSVARA)
    for char in _ZERO_WIDTH:
        text = text.replace(char, "")
    text = text.lower().replace("/-", " ")
    text = _GROUPED_NUMBER.sub(lambda match: match.group(0).replace(",", ""), text)
    text = _DIGIT_HYPHEN.sub("/", text)
    return _WORD_HYPHEN.sub(" ", text)


def tokenize(text: str) -> list[str]:
    """Normalised tokens: numbers, words (any of the five scripts), symbols."""
    return _TOKEN_RE.findall(normalize(text))


def _is_number(token: str) -> bool:
    return _NUMBER_RE.fullmatch(token) is not None


def _phrase_tokens(text: str) -> tuple[str, ...]:
    """Tokens of a lexicon phrase; ``fully_ripe``-style canonical tokens stay whole."""
    if "_" in text:
        return (normalize(text),)
    return tuple(_TOKEN_RE.findall(normalize(text)))


def _norm_set(words: Iterable[str]) -> frozenset[str]:
    return frozenset(normalize(word) for word in words)


def _norm_map[V](mapping: dict[str, V]) -> dict[str, V]:
    return {normalize(key): value for key, value in mapping.items()}


# ─────────────────────────── Phrase canonicalisation ───────────────────────────

_PHRASES: tuple[tuple[str, str], ...] = (
    # minimum price
    ("at least", "minimum"),
    ("atleast", "minimum"),
    ("min", "minimum"),
    ("not less than", "minimum"),
    ("कम से कम", "minimum"),
    ("kam se kam", "minimum"),
    ("న్యూనతమ", "minimum"),
    ("కనీసం", "minimum"),
    ("కనీస", "minimum"),
    ("न्यूनतम", "minimum"),
    ("ಕನಿಷ್ಠ", "minimum"),
    ("ಕನಿಷ್ಟ", "minimum"),
    ("ಕಡಿಮೆ ಅಂದರೂ", "minimum"),
    ("کم از کم", "minimum"),
    ("کم سے کم", "minimum"),
    # readiness phrases that mention selling (they describe availability, not a deadline)
    ("ready to sell", "ready"),
    ("ready for sale", "ready"),
    ("ready for selling", "ready"),
    ("available to sell", "available"),
    ("available for sale", "available"),
    ("for sale", ""),
    ("बेचने के लिए तैयार", "तैयार"),
    ("बिक्री के लिए तैयार", "तैयार"),
    ("అమ్మడానికి సిద్ధంగా", "సిద్ధంగా"),
    ("అమ్మకానికి సిద్ధంగా", "సిద్ధంగా"),
    ("ಮಾರಾಟಕ್ಕೆ ಸಿದ್ಧವಾಗಿದೆ", "ಸಿದ್ಧ"),
    ("ಮಾರಾಟಕ್ಕೆ ಸಿದ್ಧವಾಗಿವೆ", "ಸಿದ್ಧ"),
    ("ಮಾರಾಟಕ್ಕೆ ಸಿದ್ಧ", "ಸಿದ್ಧ"),
    ("ಮಾರಲು ಸಿದ್ಧ", "ಸಿದ್ಧ"),
    ("بیچنے کے لیے تیار", "تیار"),
    ("بیچنے کے لئے تیار", "تیار"),
    ("فروخت کے لیے تیار", "تیار"),
    # explicit deadlines
    ("must be sold", "sellby"),
    ("has to be sold", "sellby"),
    ("have to sell", "sellby"),
    ("has to sell", "sellby"),
    ("need to sell", "sellby"),
    ("needs to be sold", "sellby"),
    ("must sell", "sellby"),
    ("should be sold", "sellby"),
    ("sell it by", "sellby"),
    ("sell them by", "sellby"),
    ("sell by", "sellby"),
    ("sold by", "sellby"),
    ("sell before", "sellby before"),
    ("sold before", "sellby before"),
    ("sell within", "sellby within"),
    ("sold within", "sellby within"),
    ("बेचना है", "बेचना_है"),
    ("बेचनी है", "बेचना_है"),
    ("बेचना होगा", "बेचना_है"),
    ("बेचना पडेगा", "बेचना_है"),
    ("बेचना जरूरी है", "बेचना_है"),
    ("बिक जाना चाहिए", "बेचना_है"),
    ("बेच देना है", "बेचना_है"),
    ("ಮಾರಾಟ ಮಾಡಬೇಕು", "ಮಾರಬೇಕು"),
    ("بیچنا ہے", "بیچنا_ہے"),
    ("بیچنی ہے", "بیچنا_ہے"),
    ("بیچنے ہیں", "بیچنا_ہے"),
    ("بیچنا ہوگا", "بیچنا_ہے"),
    ("بیچنا پڑے گا", "بیچنا_ہے"),
    ("بیچنا ضروری ہے", "بیچنا_ہے"),
    ("بک جانا چاہیے", "بیچنا_ہے"),
    ("بیچ دینا ہے", "بیچنا_ہے"),
    ("فروخت کرنا ہے", "بیچنا_ہے"),
    # misc
    ("pick up", "pickup"),
    ("picked up", "pickup"),
    ("ఈ రోజు", "ఈరోజు"),
    ("వచ్చే వారం", "వచ్చేవారం"),
    ("వారం లోపు", "వారంలోపు"),
    ("day after tomorrow", "dayaftertomorrow"),
    ("the day after", "dayafter"),
    ("day after", "dayafter"),
    ("day before yesterday", "daybeforeyesterday"),
    ("next week", "nextweek"),
    ("अगले हफ्ते", "nextweek"),
    ("अगले सप्ताह", "nextweek"),
    ("अगला हफ्ता", "nextweek"),
    ("agle hafte", "nextweek"),
    ("fully ripe", "fully_ripe"),
    ("half ripe", "half_ripe"),
    ("semi ripe", "half_ripe"),
    ("ladies finger", "ladies_finger"),
    ("lady finger", "ladies_finger"),
    ("پک اپ", "pickup"),
    ("کلو میٹر", "کلومیٹر"),
    ("ಕಿಲೋ ಮೀಟರ್", "ಕಿಲೋಮೀಟರ್"),
    ("کے جی", "kg"),
    # Kannada: dates fused with "from" / "within" are split so each part is a known word
    ("ಈ ದಿನ", "ಇಂದು"),
    ("ಮುಂದಿನ ವಾರದೊಳಗೆ", "nextweek ಒಳಗೆ"),
    ("ಮುಂದಿನ ವಾರ", "nextweek"),
    ("ನಾಳೆಯಿಂದ", "ನಾಳೆ ಇಂದ"),
    ("ಇಂದಿನಿಂದ", "ಇಂದು ಇಂದ"),
    ("ಇವತ್ತಿನಿಂದ", "ಇವತ್ತು ಇಂದ"),
    ("ನಾಡಿದ್ದಿನಿಂದ", "ನಾಡಿದ್ದು ಇಂದ"),
    ("ನಾಳೆಯೊಳಗೆ", "ನಾಳೆ ಒಳಗೆ"),
    ("ನಾಡಿದ್ದರೊಳಗೆ", "ನಾಡಿದ್ದು ಒಳಗೆ"),
    ("ನಾಡಿದ್ದಿನೊಳಗೆ", "ನಾಡಿದ್ದು ಒಳಗೆ"),
    ("اگلے ہفتے", "nextweek"),
    ("اگلا ہفتہ", "nextweek"),
)


def _phrase_table() -> list[tuple[tuple[str, ...], tuple[str, ...]]]:
    table = [(_phrase_tokens(source), tuple(target.split())) for source, target in _PHRASES]
    return sorted(table, key=lambda entry: -len(entry[0]))


_PHRASE_TABLE = _phrase_table()


def _canonicalize(tokens: list[str]) -> list[str]:
    out: list[str] = []
    i = 0
    while i < len(tokens):
        for source, target in _PHRASE_TABLE:
            if tuple(tokens[i : i + len(source)]) == source:
                out.extend(target)
                i += len(source)
                break
        else:
            out.append(tokens[i])
            i += 1
    return out


# ─────────────────────────────── Numbers ───────────────────────────────

_SMALL_NUMBERS: dict[str, Decimal] = _norm_map(
    {
        # English
        "zero": Decimal(0),
        "one": Decimal(1),
        "two": Decimal(2),
        "three": Decimal(3),
        "four": Decimal(4),
        "five": Decimal(5),
        "six": Decimal(6),
        "seven": Decimal(7),
        "eight": Decimal(8),
        "nine": Decimal(9),
        "ten": Decimal(10),
        "eleven": Decimal(11),
        "twelve": Decimal(12),
        "thirteen": Decimal(13),
        "fourteen": Decimal(14),
        "fifteen": Decimal(15),
        "sixteen": Decimal(16),
        "seventeen": Decimal(17),
        "eighteen": Decimal(18),
        "nineteen": Decimal(19),
        "twenty": Decimal(20),
        "thirty": Decimal(30),
        "forty": Decimal(40),
        "fourty": Decimal(40),
        "fifty": Decimal(50),
        "sixty": Decimal(60),
        "seventy": Decimal(70),
        "eighty": Decimal(80),
        "ninety": Decimal(90),
        # Hindi (Devanagari)
        "एक": Decimal(1),
        "दो": Decimal(2),
        "तीन": Decimal(3),
        "चार": Decimal(4),
        "पांच": Decimal(5),
        "पाँच": Decimal(5),
        "छह": Decimal(6),
        "छः": Decimal(6),
        "छे": Decimal(6),
        "सात": Decimal(7),
        "आठ": Decimal(8),
        "नौ": Decimal(9),
        "दस": Decimal(10),
        "ग्यारह": Decimal(11),
        "बारह": Decimal(12),
        "तेरह": Decimal(13),
        "चौदह": Decimal(14),
        "पंद्रह": Decimal(15),
        "पन्द्रह": Decimal(15),
        "सोलह": Decimal(16),
        "सत्रह": Decimal(17),
        "अठारह": Decimal(18),
        "उन्नीस": Decimal(19),
        "बीस": Decimal(20),
        "पच्चीस": Decimal(25),
        "तीस": Decimal(30),
        "पैंतीस": Decimal(35),
        "चालीस": Decimal(40),
        "पैंतालीस": Decimal(45),
        "पचास": Decimal(50),
        "साठ": Decimal(60),
        "सत्तर": Decimal(70),
        "पचहत्तर": Decimal(75),
        "अस्सी": Decimal(80),
        "नब्बे": Decimal(90),
        "डेढ़": Decimal("1.5"),
        "ढाई": Decimal("2.5"),
        # Hindi (romanised)
        "ek": Decimal(1),
        "teen": Decimal(3),
        "char": Decimal(4),
        "chaar": Decimal(4),
        "paanch": Decimal(5),
        "panch": Decimal(5),
        "chhe": Decimal(6),
        "saat": Decimal(7),
        "aath": Decimal(8),
        "nau": Decimal(9),
        "das": Decimal(10),
        "bees": Decimal(20),
        "pachas": Decimal(50),
        "pachaas": Decimal(50),
        "dedh": Decimal("1.5"),
        "dhai": Decimal("2.5"),
        # Telugu
        "ఒకటి": Decimal(1),
        "ఒక": Decimal(1),
        "ఒక్క": Decimal(1),
        "రెండు": Decimal(2),
        "మూడు": Decimal(3),
        "నాలుగు": Decimal(4),
        "ఐదు": Decimal(5),
        "అయిదు": Decimal(5),
        "ఆరు": Decimal(6),
        "ఏడు": Decimal(7),
        "ఎనిమిది": Decimal(8),
        "తొమ్మిది": Decimal(9),
        "పది": Decimal(10),
        "పదకొండు": Decimal(11),
        "పన్నెండు": Decimal(12),
        "పదిహేను": Decimal(15),
        "ఇరవై": Decimal(20),
        "పాతిక": Decimal(25),
        "ముప్పై": Decimal(30),
        "ముప్పయి": Decimal(30),
        "నలభై": Decimal(40),
        "నలబై": Decimal(40),
        "యాభై": Decimal(50),
        "యాబై": Decimal(50),
        "అరవై": Decimal(60),
        "డెబ్బై": Decimal(70),
        "డెబ్భై": Decimal(70),
        "ఎనభై": Decimal(80),
        "ఎనబై": Decimal(80),
        "తొంభై": Decimal(90),
        "తొంబై": Decimal(90),
        "నూట": Decimal(100),
        "ఒకటిన్నర": Decimal("1.5"),
        "రెండున్నర": Decimal("2.5"),
        "మూడున్నర": Decimal("3.5"),
        "నాలుగున్నర": Decimal("4.5"),
        "ఐదున్నర": Decimal("5.5"),
        "రెండొందల": Decimal(200),
        "రెండొందలు": Decimal(200),
        "మూడొందల": Decimal(300),
        "మూడొందలు": Decimal(300),
        "నాలుగొందల": Decimal(400),
        "నాలుగొందలు": Decimal(400),
        "ఐదొందల": Decimal(500),
        "ఐదొందలు": Decimal(500),
        "ఆరొందల": Decimal(600),
        "ఏడొందల": Decimal(700),
        "ఎనిమిదొందల": Decimal(800),
        "తొమ్మిదొందల": Decimal(900),
        # Kannada
        "ಒಂದು": Decimal(1),
        "ಎರಡು": Decimal(2),
        "ಮೂರು": Decimal(3),
        "ನಾಲ್ಕು": Decimal(4),
        "ಐದು": Decimal(5),
        "ಆರು": Decimal(6),
        "ಏಳು": Decimal(7),
        "ಎಂಟು": Decimal(8),
        "ಒಂಬತ್ತು": Decimal(9),
        "ಹತ್ತು": Decimal(10),
        "ಹನ್ನೊಂದು": Decimal(11),
        "ಹನ್ನೆರಡು": Decimal(12),
        "ಹದಿನೈದು": Decimal(15),
        "ಇಪ್ಪತ್ತು": Decimal(20),
        "ಇಪ್ಪತ್ತೈದು": Decimal(25),
        "ಮೂವತ್ತು": Decimal(30),
        "ನಲವತ್ತು": Decimal(40),
        "ನಲ್ವತ್ತು": Decimal(40),
        "ಐವತ್ತು": Decimal(50),
        "ಅರವತ್ತು": Decimal(60),
        "ಎಪ್ಪತ್ತು": Decimal(70),
        "ಎಂಬತ್ತು": Decimal(80),
        "ತೊಂಬತ್ತು": Decimal(90),
        "ಒಂದೂವರೆ": Decimal("1.5"),
        "ಎರಡೂವರೆ": Decimal("2.5"),
        "ಮೂರೂವರೆ": Decimal("3.5"),
        "ನಾಲ್ಕೂವರೆ": Decimal("4.5"),
        "ಐದೂವರೆ": Decimal("5.5"),
        "ಇನ್ನೂರು": Decimal(200),
        "ಮುನ್ನೂರು": Decimal(300),
        "ನಾನೂರು": Decimal(400),
        "ನಾನ್ನೂರು": Decimal(400),
        "ಐನೂರು": Decimal(500),
        "ಆರುನೂರು": Decimal(600),
        "ಏಳುನೂರು": Decimal(700),
        "ಎಂಟುನೂರು": Decimal(800),
        "ಒಂಬೈನೂರು": Decimal(900),
        "ಇನ್ನೂರ": Decimal(200),
        "ಮುನ್ನೂರ": Decimal(300),
        "ನಾನೂರ": Decimal(400),
        "ಐನೂರ": Decimal(500),
        "ಆರುನೂರ": Decimal(600),
        "ಏಳುನೂರ": Decimal(700),
        "ಎಂಟುನೂರ": Decimal(800),
        "ಒಂಬೈನೂರ": Decimal(900),
        # Urdu (اسی "80" is left out: it also means "this very")
        "ایک": Decimal(1),
        "دو": Decimal(2),
        "تین": Decimal(3),
        "چار": Decimal(4),
        "پانچ": Decimal(5),
        "چھ": Decimal(6),
        "چھے": Decimal(6),
        "سات": Decimal(7),
        "آٹھ": Decimal(8),
        "نو": Decimal(9),
        "دس": Decimal(10),
        "گیارہ": Decimal(11),
        "بارہ": Decimal(12),
        "تیرہ": Decimal(13),
        "چودہ": Decimal(14),
        "پندرہ": Decimal(15),
        "سولہ": Decimal(16),
        "سترہ": Decimal(17),
        "اٹھارہ": Decimal(18),
        "انیس": Decimal(19),
        "بیس": Decimal(20),
        "پچیس": Decimal(25),
        "تیس": Decimal(30),
        "پینتیس": Decimal(35),
        "چالیس": Decimal(40),
        "پینتالیس": Decimal(45),
        "پچاس": Decimal(50),
        "ساٹھ": Decimal(60),
        "ستر": Decimal(70),
        "پچھتر": Decimal(75),
        "نوے": Decimal(90),
        "ڈیڑھ": Decimal("1.5"),
        "ڈھائی": Decimal("2.5"),
    }
)
_MULTIPLIERS: dict[str, Decimal] = _norm_map(
    {
        "hundred": Decimal(100),
        "hundreds": Decimal(100),
        "thousand": Decimal(1000),
        "thousands": Decimal(1000),
        "lakh": Decimal(100_000),
        "lakhs": Decimal(100_000),
        "lac": Decimal(100_000),
        "सौ": Decimal(100),
        "हजार": Decimal(1000),
        "हज़ार": Decimal(1000),
        "लाख": Decimal(100_000),
        "sau": Decimal(100),
        "hazaar": Decimal(1000),
        "hazar": Decimal(1000),
        "hajar": Decimal(1000),
        "వంద": Decimal(100),
        "వందల": Decimal(100),
        "వందలు": Decimal(100),
        "నూరు": Decimal(100),
        "వెయ్యి": Decimal(1000),
        "వేయి": Decimal(1000),
        "వేల": Decimal(1000),
        "వేలు": Decimal(1000),
        "లక్ష": Decimal(100_000),
        "లక్షల": Decimal(100_000),
        "ನೂರು": Decimal(100),
        "ನೂರ": Decimal(100),
        "ಸಾವಿರ": Decimal(1000),
        "ಸಾವಿರದ": Decimal(1000),
        "ಲಕ್ಷ": Decimal(100_000),
        "سو": Decimal(100),
        "ہزار": Decimal(1000),
        "لاکھ": Decimal(100_000),
    }
)
_FRACTIONS: dict[str, Decimal] = _norm_map(
    {
        "half": Decimal("0.5"),
        "quarter": Decimal("0.25"),
        "आधा": Decimal("0.5"),
        "आधे": Decimal("0.5"),
        "aadha": Decimal("0.5"),
        "adha": Decimal("0.5"),
        "అర": Decimal("0.5"),
        "పావు": Decimal("0.25"),
        "ಅರ್ಧ": Decimal("0.5"),
        "آدھا": Decimal("0.5"),
        "آدھی": Decimal("0.5"),
        "آدھے": Decimal("0.5"),
    }
)
_MODIFIERS: dict[str, Decimal] = _norm_map(
    {
        "सवा": Decimal("0.25"),
        "साढ़े": Decimal("0.5"),
        "sava": Decimal("0.25"),
        "sade": Decimal("0.5"),
        "سوا": Decimal("0.25"),
        "ساڑھے": Decimal("0.5"),
    }
)
_NUMBER_CONNECTORS = _norm_set(["and", "और", "మరియు", "ಮತ್ತು", "اور"])
_ARTICLES = frozenset({"a", "an"})


# ──────────────────────────────── Units ────────────────────────────────

_UNIT_EXACT: dict[str, Decimal] = _norm_map(
    {
        "kg": Decimal(1),
        "kgs": Decimal(1),
        "kilo": Decimal(1),
        "kilos": Decimal(1),
        "kilogram": Decimal(1),
        "kilograms": Decimal(1),
        "kilogramme": Decimal(1),
        "kilogrammes": Decimal(1),
        "keji": Decimal(1),
        "quintal": Decimal(100),
        "quintals": Decimal(100),
        "quintel": Decimal(100),
        "quintels": Decimal(100),
        "qtl": Decimal(100),
        "qtls": Decimal(100),
        "kuintal": Decimal(100),
        "tonne": Decimal(1000),
        "tonnes": Decimal(1000),
        "ton": Decimal(1000),
        "tons": Decimal(1000),
        "टन": Decimal(1000),
        "केजी": Decimal(1),
        "కేజీ": Decimal(1),
        "కేజీలు": Decimal(1),
        "టన్": Decimal(1000),
        "ಕೆಜಿ": Decimal(1),
        "ٹن": Decimal(1000),
        "ٹنوں": Decimal(1000),
    }
)
_UNIT_PREFIXES: tuple[tuple[str, Decimal], ...] = tuple(
    (normalize(prefix), factor)
    for prefix, factor in (
        ("किलो", Decimal(1)),
        ("क्विंटल", Decimal(100)),
        ("कुंतल", Decimal(100)),
        ("कुन्तल", Decimal(100)),
        ("కిలో", Decimal(1)),
        ("కేజీ", Decimal(1)),
        ("క్వింటా", Decimal(100)),
        ("క్వింట", Decimal(100)),
        ("టన్ను", Decimal(1000)),
        ("ಕಿಲೋ", Decimal(1)),
        ("ಕೆಜಿ", Decimal(1)),
        ("ಕ್ವಿಂಟ", Decimal(100)),
        ("ಟನ್", Decimal(1000)),
        ("کلو", Decimal(1)),
        ("کوئنٹل", Decimal(100)),
        ("کوینٹل", Decimal(100)),
    )
)
_NOT_UNITS = tuple(
    normalize(word) for word in ("किलोमीटर", "కిలోమీట", "కిలోమీటర్", "ಕಿಲೋಮೀ", "کلومیٹر", "کلومیٹرز")
)
_DATIVE_UNIT_SUFFIXES = tuple(normalize(word) for word in ("కి", "కు", "ಗೆ"))
"""Telugu "కిలోకి" / "కిలోకు" and Kannada "ಕಿಲೋಗೆ" = "per kilo"."""


def unit_factor(token: str) -> Decimal | None:
    """kg per unit for a unit word (kg = 1, quintal = 100, tonne = 1000), else ``None``."""
    if token in _UNIT_EXACT:
        return _UNIT_EXACT[token]
    if any(token.startswith(word) for word in _NOT_UNITS):
        return None
    for prefix, factor in _UNIT_PREFIXES:
        if token.startswith(prefix):
            return factor
    return None


def _is_dative_unit(token: str) -> bool:
    return unit_factor(token) is not None and token.endswith(_DATIVE_UNIT_SUFFIXES)


_CURRENCY = _norm_set(
    [
        "₹",
        "rs",
        "rupee",
        "rupees",
        "rupay",
        "rupaye",
        "rupaiya",
        "rupya",
        "rupiya",
        "inr",
        "रुपये",
        "रुपए",
        "रुपया",
        "रूपये",
        "रूपए",
        "रुपयों",
        "रु",
        "రూపాయలు",
        "రూపాయల",
        "రూపాయి",
        "రూపాయిలు",
        "రూ",
        "ರೂಪಾಯಿ",
        "ರೂಪಾಯಿಗಳು",
        "ರೂಪಾಯಿಗೆ",
        "ರುಪಾಯಿ",
        "ರೂ",
        "روپے",
        "روپئے",
        "روپیے",
        "روپیہ",
        "روپیا",
        "روپوں",
    ]
)
_PER_WORDS = _norm_set(
    ["per", "a", "an", "each", "every", "/", "प्रति", "फी", "हर", "ప్రతి", "ಪ್ರತಿ", "فی", "ہر"]
)
_GENITIVE = _norm_set(["के", "का", "की", "ke", "ka", "ki", "کے", "کا", "کی"])
_EXPLICIT_PER = _norm_set(["per", "each", "every", "प्रति", "हर", "ప్రతి", "ಪ್ರತಿ", "فی", "ہر"])
_MIN_FILLERS = _norm_set(
    [
        "price",
        "rate",
        "of",
        "is",
        "का",
        "दाम",
        "भाव",
        "रेट",
        "ధర",
        "రేటు",
        "ಬೆಲೆ",
        "ದರ",
        "ರೇಟ್",
        "قیمت",
        "ریٹ",
        "بھاؤ",
        "دام",
        "کا",
        "the",
        "net",
    ]
)
_DAY_WORDS = _norm_set(
    ["day", "days", "din", "दिन", "दिनों", "రోజులు", "రోజుల్లో", "ದಿನ", "ದಿನಗಳು", "دن", "دنوں"]
)


# ─────────────────────────────── Crops ───────────────────────────────

_BUILTIN_CROP_ALIASES: tuple[tuple[tuple[str, ...], tuple[str, ...]], ...] = (
    (
        ("tomato",),
        (
            "tomato",
            "tamatar",
            "tamater",
            "tamaatar",
            "tamata",
            "tamatalu",
            "tomatolu",
            "टमाटर",
            "टमाटा",
            "టమాటా",
            "టమాట",
            "టమోటా",
            "టమాటో",
            "టొమాటో",
            "ಟೊಮೆಟೊ",
            "ಟೊಮೆಟೋ",
            "ಟೊಮ್ಯಾಟೊ",
            "ಟೊಮೇಟೊ",
            "ಟೊಮಾಟೊ",
            "ٹماٹر",
        ),
    ),
    (
        ("onion",),
        (
            "onion",
            "pyaz",
            "pyaaz",
            "piyaz",
            "piaz",
            "kanda",
            "ullipaya",
            "ullipayalu",
            "ullipaaya",
            "ulli",
            "प्याज",
            "कांदा",
            "ఉల్లిపాయ",
            "ఉల్లిపాయలు",
            "ఉల్లి",
            "eerulli",
            "irulli",
            "ullagaddi",
            "ಈರುಳ್ಳಿ",
            "ಉಳ್ಳಾಗಡ್ಡಿ",
            "پیاز",
        ),
    ),
    (
        ("chilli", "chili", "green chilli"),
        (
            "chilli",
            "chili",
            "chilly",
            "green chilli",
            "mirchi",
            "mirch",
            "hari mirch",
            "mirapakaya",
            "mirapakayalu",
            "pachimirchi",
            "मिर्च",
            "मिर्ची",
            "हरी मिर्च",
            "మిరపకాయ",
            "మిరపకాయలు",
            "మిర్చి",
            "పచ్చిమిర్చి",
            "పచ్చి మిర్చి",
            "menasinakayi",
            "menasinakai",
            "ಮೆಣಸಿನಕಾಯಿ",
            "ಹಸಿರು ಮೆಣಸಿನಕಾಯಿ",
            "ಹಸಿಮೆಣಸಿನಕಾಯಿ",
            "مرچ",
            "مرچی",
            "مرچیں",
            "ہری مرچ",
        ),
    ),
    (
        ("potato",),
        (
            "potato",
            "aloo",
            "alu",
            "aaloo",
            "bangaladumpa",
            "alugadda",
            "आलू",
            "బంగాళదుంప",
            "బంగాళాదుంప",
            "ఆలుగడ్డ",
            "aalugadde",
            "alugadde",
            "ಆಲೂಗಡ್ಡೆ",
            "ಆಲುಗಡ್ಡೆ",
            "آلو",
        ),
    ),
    (
        ("mango",),
        (
            "mango",
            "aam",
            "mamidi",
            "mamidikaya",
            "mamidipandu",
            "mamidipandlu",
            "आम",
            "మామిడి",
            "మామిడికాయ",
            "మామిడిపండ్లు",
            "maavu",
            "mavu",
            "mavinahannu",
            "ಮಾವು",
            "ಮಾವಿನಹಣ್ಣು",
            "ಮಾವಿನ ಹಣ್ಣು",
            "ಮಾವಿನಕಾಯಿ",
            "آم",
            "آموں",
        ),
    ),
    (
        ("brinjal", "eggplant"),
        (
            "brinjal",
            "eggplant",
            "baingan",
            "baigan",
            "vankaya",
            "vankayalu",
            "बैंगन",
            "వంకాయ",
            "badanekayi",
            "ಬದನೆಕಾಯಿ",
            "ಬದನೆ",
            "بینگن",
        ),
    ),
    (
        ("okra", "bhindi", "ladies finger", "lady finger"),
        (
            "okra",
            "bhindi",
            "ladies_finger",
            "bendakaya",
            "bendakayalu",
            "भिंडी",
            "బెండకాయ",
            "bendekayi",
            "ಬೆಂಡೆಕಾಯಿ",
            "ಬೆಂಡೆ",
            "بھنڈی",
        ),
    ),
    (
        ("cabbage",),
        (
            "cabbage",
            "patta gobhi",
            "पत्ता गोभी",
            "पत्तागोभी",
            "క్యాబేజీ",
            "elekosu",
            "ಎಲೆಕೋಸು",
            "ಕ್ಯಾಬೇಜ್",
            "بند گوبھی",
            "پتہ گوبھی",
        ),
    ),
    (
        ("cauliflower",),
        (
            "cauliflower",
            "phool gobhi",
            "gobhi",
            "फूलगोभी",
            "फूल गोभी",
            "గోబీ",
            "కాలీఫ్లవర్",
            "hookosu",
            "ಹೂಕೋಸು",
            "پھول گوبھی",
        ),
    ),
    (
        ("banana",),
        (
            "banana",
            "kela",
            "kele",
            "arati",
            "केला",
            "केले",
            "అరటి",
            "అరటిపండ్లు",
            "balehannu",
            "ಬಾಳೆಹಣ್ಣು",
            "ಬಾಳೆ",
            "کیلا",
            "کیلے",
        ),
    ),
    (
        ("groundnut", "peanut"),
        (
            "groundnut",
            "peanut",
            "moongphali",
            "mungfali",
            "verusenaga",
            "मूंगफली",
            "వేరుశనగ",
            "kadalekayi",
            "shenga",
            "ಕಡಲೆಕಾಯಿ",
            "ಶೇಂಗಾ",
            "مونگ پھلی",
            "مونگپھلی",
        ),
    ),
    (("paddy", "rice"), ("paddy", "dhaan", "dhan", "vari", "धान", "వరి", "వడ్లు", "ಭತ್ತ", "دھان")),
    (
        ("maize", "corn"),
        ("maize", "corn", "makka", "makkai", "मक्का", "మొక్కజొన్న", "ಮೆಕ್ಕೆಜೋಳ", "مکئی"),
    ),
    (("turmeric",), ("turmeric", "haldi", "pasupu", "हल्दी", "పసుపు", "ಅರಿಶಿನ", "ಅರಿಸಿನ", "ہلدی")),
    (
        ("red gram", "tur", "pigeon pea"),
        (
            "red gram",
            "redgram",
            "toor",
            "arhar",
            "kandi",
            "kandulu",
            "अरहर",
            "तूर",
            "కందులు",
            "ತೊಗರಿ",
            "ارہر",
            "تور",
        ),
    ),
    (("cotton",), ("cotton", "kapas", "कपास", "పత్తి", "کپاس")),
    (("carrot",), ("carrot", "gajar", "गाजर", "క్యారెట్", "ಕ್ಯಾರೆಟ್", "گاجر")),
    (
        ("cucumber",),
        ("cucumber", "kheera", "dosakaya", "खीरा", "దోసకాయ", "ಸೌತೆಕಾಯಿ", "کھیرا"),
    ),
    (
        ("garlic",),
        ("garlic", "lahsun", "vellulli", "लहसुन", "వెల్లుల్లి", "ಬೆಳ್ಳುಳ್ಳಿ", "لہسن"),
    ),
    (("ginger",), ("ginger", "adrak", "allam", "अदरक", "అల్లం", "ಶುಂಠಿ", "ادرک")),
    (("papaya",), ("papaya", "papita", "boppayi", "पपीता", "బొప్పాయి", "ಪಪ್ಪಾಯಿ", "پپیتا")),
)
"""Transliterations and local names, attached to the catalogue crop whose English name matches."""

_PREFIX_MIN_LENGTH = 4
"""Non-Latin crop words of at least this many characters also match inflected forms (టమాటాలు)."""


@dataclass(frozen=True)
class _Term:
    tokens: tuple[str, ...]
    prefix: bool


@dataclass
class CropLexicon:
    """Spoken names of each catalogue crop, compiled for token matching."""

    crops: list[CropLike]
    terms: dict[_Term, set[int]] = field(default_factory=dict)

    @classmethod
    def build(cls, crops: Sequence[CropLike]) -> CropLexicon:
        lexicon = cls(crops=list(crops))
        for index, crop in enumerate(lexicon.crops):
            names = [
                crop.name,
                crop.name_hi,
                crop.name_te,
                crop.name_kn,
                crop.name_ur,
                *list(crop.synonyms or []),
            ]
            names.extend(_builtin_aliases_for(crop, lexicon.crops))
            for name in names:
                lexicon._add(name, index)
        return lexicon

    def _add(self, name: str | None, index: int) -> None:
        if not name:
            return
        tokens = _phrase_tokens(name)
        if not tokens:
            return
        variants = {tokens}
        last = tokens[-1]
        latin = _LATIN_RE.fullmatch(last) is not None
        if latin:
            variants.add((*tokens[:-1], last + "s"))
            variants.add((*tokens[:-1], last + "es"))
            if last.endswith("y"):
                variants.add((*tokens[:-1], last[:-1] + "ies"))
        prefix = not latin and len(last) >= _PREFIX_MIN_LENGTH
        for variant in variants:
            self.terms.setdefault(_Term(variant, prefix), set()).add(index)

    def find(self, tokens: Sequence[str]) -> list[tuple[int, int, set[int]]]:
        """Non-overlapping matches ``(start, end, crop indices)`` in transcript order."""
        ordered = sorted(self.terms.items(), key=lambda item: -len(item[0].tokens))
        matches: list[tuple[int, int, set[int]]] = []
        i = 0
        while i < len(tokens):
            for term, indices in ordered:
                if _term_matches(term, tokens, i):
                    matches.append((i, i + len(term.tokens), set(indices)))
                    i += len(term.tokens)
                    break
            else:
                i += 1
        return matches


def _term_matches(term: _Term, tokens: Sequence[str], start: int) -> bool:
    size = len(term.tokens)
    window = tokens[start : start + size]
    if len(window) < size:
        return False
    if tuple(window[:-1]) != term.tokens[:-1]:
        return False
    last, expected = window[-1], term.tokens[-1]
    return last == expected or (term.prefix and last.startswith(expected))


def _english_name_tokens(name: str) -> tuple[str, ...]:
    return tuple(_LATIN_RE.findall(normalize(name)))


def _contains_sequence(haystack: tuple[str, ...], needle: tuple[str, ...]) -> bool:
    size = len(needle)
    return any(haystack[i : i + size] == needle for i in range(len(haystack) - size + 1))


def _builtin_aliases_for(crop: CropLike, catalogue: Sequence[CropLike]) -> list[str]:
    """Built-in aliases whose English names identify exactly this one catalogue crop."""
    aliases: list[str] = []
    for english_names, words in _BUILTIN_CROP_ALIASES:
        keys = [_english_name_tokens(name) for name in english_names]

        def identifies(candidate: CropLike, keys: list[tuple[str, ...]] = keys) -> bool:
            name_tokens = _english_name_tokens(candidate.name)
            return any(key and _contains_sequence(name_tokens, key) for key in keys)

        if identifies(crop) and sum(1 for other in catalogue if identifies(other)) == 1:
            aliases.extend(words)
    return aliases


def match_crop(text: str | None, crops: Sequence[CropLike]) -> CropLike | None:
    """The single catalogue crop named in ``text`` (any language), or ``None`` if none/several."""
    if not text or not crops:
        return None
    lexicon = CropLexicon.build(crops)
    tokens = _canonicalize(tokenize(text))
    found: list[int] = []
    for _, _, indices in lexicon.find(tokens):
        for index in sorted(indices):
            if index not in found:
                found.append(index)
    return lexicon.crops[found[0]] if len(found) == 1 else None


# ─────────────────────────────── Dates ───────────────────────────────

_MONTHS: dict[str, int] = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}
_ORDINAL_SUFFIXES = frozenset({"st", "nd", "rd", "th"})
_WEEKDAYS: dict[str, int] = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}

_FIXED_DATE_WORDS: dict[str, int] = _norm_map(
    {
        "today": 0,
        "tonight": 0,
        "tomorrow": 1,
        "tomorow": 1,
        "tommorow": 1,
        "tommorrow": 1,
        "tmrw": 1,
        "yesterday": -1,
        "dayaftertomorrow": 2,
        "dayafter": 2,
        "daybeforeyesterday": -2,
        "nextweek": 7,
        "आज": 0,
        "aaj": 0,
        "aj": 0,
        "कल": 1,
        "kal": 1,
        "परसों": 2,
        "parson": 2,
        "parso": 2,
        "parsoon": 2,
        "ఈరోజు": 0,
        "ఇవాళ": 0,
        "ఇవ్వాళ": 0,
        "ఈవేళ": 0,
        "నేడు": 0,
        "రేపు": 1,
        "రేపే": 1,
        "రేపటికి": 1,
        "రేపటి": 1,
        "repu": 1,
        "ఎల్లుండి": 2,
        "ఎల్లుండికి": 2,
        "ellundi": 2,
        "నిన్న": -1,
        "నిన్నే": -1,
        "నిన్నటి": -1,
        "మొన్న": -2,
        "వచ్చేవారం": 7,
        "వారంలోపు": 7,
        "వారంలో": 7,
        "ಇಂದು": 0,
        "ಇವತ್ತು": 0,
        "ಈವತ್ತು": 0,
        "ivattu": 0,
        "ನಾಳೆ": 1,
        "ನಾಳೆಯೇ": 1,
        "ನಾಳೆಗೆ": 1,
        "naale": 1,
        "nale": 1,
        "ನಾಡಿದ್ದು": 2,
        "ನಾಡಿದ್ದಿಗೆ": 2,
        "nadiddu": 2,
        "ನಿನ್ನೆ": -1,
        "ನಿನ್ನೆಯೇ": -1,
        "ninne": -1,
        "ಮೊನ್ನೆ": -2,
        "ವಾರದೊಳಗೆ": 7,
        "آج": 0,
        "کل": 1,
        "پرسوں": 2,
    }
)
_PAST_IN_HARVEST_CONTEXT = _norm_set(
    ["कल", "kal", "परसों", "parson", "parso", "parsoon", "کل", "پرسوں"]
)
"""Hindi / Urdu कल, کل / परसों, پرسوں mean yesterday / the day before when they date a harvest."""

_N_DAY_WORDS = _norm_set(
    [
        "day",
        "days",
        "din",
        "दिन",
        "दिनों",
        "రోజులు",
        "రోజుల్లో",
        "రోజులలో",
        "రోజుల",
        "రోజుల్లోపు",
        "ದಿನ",
        "ದಿನಗಳು",
        "ದಿನದಲ್ಲಿ",
        "ದಿನಗಳಲ್ಲಿ",
        "ದಿನದೊಳಗೆ",
        "ದಿನಗಳೊಳಗೆ",
        "دن",
        "دنوں",
    ]
)
_N_WEEK_WORDS = _norm_set(
    [
        "week",
        "weeks",
        "hafte",
        "हफ्ते",
        "हफ्ता",
        "हफ्तों",
        "सप्ताह",
        "వారం",
        "వారాల్లో",
        "వారంలో",
        "ವಾರ",
        "ವಾರದಲ್ಲಿ",
        "ವಾರಗಳಲ್ಲಿ",
        "ವಾರದೊಳಗೆ",
        "ہفتے",
        "ہفتہ",
        "ہفتوں",
    ]
)
_BEFORE_N_WITHIN = _norm_set(["within", "in", "after", "under"])
_LATER_WORDS = _norm_set(["later", "बाद", "తర్వాత", "ನಂತರ", "ಆಮೇಲೆ", "بعد"])
"""After "N days" these push a date forward without making it a deadline."""
_AFTER_N_WITHIN = (
    _norm_set(["में", "के", "अंदर", "भीतर", "లోపు", "లోగా", "ಒಳಗೆ", "ಒಳಗಾಗಿ", "میں", "کے", "اندر"])
    | _LATER_WORDS
)
_WITHIN_SUFFIXES = tuple(normalize(word) for word in ("లో", "లోపు", "ಲ್ಲಿ", "ಒಳಗೆ"))
"""Telugu "రోజుల్లో" / Kannada "ದಿನಗಳಲ್ಲಿ", "ದಿನಗಳೊಳಗೆ" = "within N days"."""

_HARVEST_STRONG = _norm_set(
    [
        "harvested",
        "harvest",
        "harvesting",
        "plucked",
        "picked",
        "cut",
        "dug",
        "तोड़ा",
        "तोड़ी",
        "तोड़े",
        "तोड़",
        "तोड़ेंगे",
        "तुड़ाई",
        "कटाई",
        "काटा",
        "काटी",
        "काटे",
        "निकाला",
        "निकाली",
        "निकाले",
        "खोदा",
        "కోశాను",
        "కోశాము",
        "కోశాం",
        "కోసాను",
        "కోసాము",
        "కోసాం",
        "కోత",
        "కోస్తాను",
        "కోస్తాము",
        "కోస్తాం",
        "తెంపాను",
        "తెంపాము",
        "తవ్వాము",
        "ಕೊಯ್ಲು",
        "ಕೊಯ್ಲಾಗಿದೆ",
        "ಕೊಯ್ದೆ",
        "ಕೊಯ್ದೆವು",
        "ಕೊಯ್ದಿದ್ದೇವೆ",
        "ಕೊಯ್ಯುತ್ತೇವೆ",
        "ಕಿತ್ತೆ",
        "ಕಿತ್ತೆವು",
        "ಕಿತ್ತಿದ್ದೇವೆ",
        "ಕೀಳುತ್ತೇವೆ",
        "ಕಟಾವು",
        "ಅಗೆದೆವು",
        "توڑا",
        "توڑی",
        "توڑے",
        "توڑ",
        "توڑیں",
        "تڑائی",
        "کٹائی",
        "کاٹا",
        "کاٹی",
        "کاٹے",
        "نکالا",
        "نکالی",
        "نکالے",
        "کھودا",
    ]
)
_SELL_STRONG = _norm_set(
    [
        "sellby",
        "deadline",
        "बेचना_है",
        "అమ్మాలి",
        "అమ్మేయాలి",
        "అమ్ముకోవాలి",
        "అమ్మేయాల్సి",
        "అమ్మాల్సి",
        "అమ్మాల్సిందే",
        "ಮಾರಬೇಕು",
        "ಮಾರಲೇಬೇಕು",
        "ಮಾರಬೇಕಾಗಿದೆ",
        "ಮಾರಿಬಿಡಬೇಕು",
        "بیچنا_ہے",
    ]
)
_SELL_WEAK = _norm_set(
    [
        "sell",
        "sold",
        "selling",
        "within",
        "before",
        "until",
        "till",
        "latest",
        "spoil",
        "तक",
        "पहले",
        "अंदर",
        "भीतर",
        "बेच",
        "बेचना",
        "बेचें",
        "లోపు",
        "లోగా",
        "వరకు",
        "ముందే",
        "ముందు",
        "ಒಳಗೆ",
        "ಒಳಗಾಗಿ",
        "ಮೊದಲು",
        "ಮುಂಚೆ",
        "ವರೆಗೆ",
        "ತನಕ",
        "ಮಾರಾಟ",
        "ಮಾರಲು",
        "تک",
        "پہلے",
        "اندر",
        "بیچ",
        "بیچنا",
        "بیچیں",
        "فروخت",
    ]
)
_AVAILABLE_STRONG = _norm_set(
    [
        "ready",
        "available",
        "pickup",
        "collect",
        "collection",
        "dispatch",
        "loading",
        "तैयार",
        "उपलब्ध",
        "पिकअप",
        "उठाना",
        "उठाने",
        "సిద్ధంగా",
        "సిద్ధం",
        "సిద్ధమవుతాయి",
        "రెడీ",
        "అందుబాటులో",
        "పికప్",
        "తీసుకెళ్లవచ్చు",
        "తీసుకెళ్ళవచ్చు",
        "ಸಿದ್ಧ",
        "ಸಿದ್ಧವಾಗಿದೆ",
        "ಸಿದ್ಧವಾಗಿವೆ",
        "ಸಿದ್ಧವಾಗುತ್ತದೆ",
        "ಸಿದ್ಧವಾಗುತ್ತವೆ",
        "ತಯಾರು",
        "ತಯಾರಾಗಿದೆ",
        "ತಯಾರಾಗಿವೆ",
        "ರೆಡಿ",
        "ಲಭ್ಯ",
        "ಲಭ್ಯವಿದೆ",
        "ಪಿಕಪ್",
        "تیار",
        "دستیاب",
        "اٹھانا",
        "اٹھانے",
    ]
)
_AVAILABLE_WEAK = _norm_set(["from", "onwards", "से", "నుండి", "నుంచి", "ಇಂದ", "ನಿಂದ", "سے"])
_CLAUSE_BREAKS = _norm_set(
    [
        ",",
        ".",
        ";",
        "!",
        "?",
        "।",
        "|",
        "،",
        "۔",
        "؛",
        "؟",
        "and",
        "but",
        "और",
        "लेकिन",
        "కానీ",
        "మరియు",
        "అయితే",
        "ಮತ್ತು",
        "ಆದರೆ",
        "اور",
        "لیکن",
        "مگر",
    ]
)

_HARVEST, _AVAILABLE, _SELL = "harvest_date", "available_from", "sell_by"
_VERB_FINAL_LANGUAGES = frozenset({"hi", "te", "kn", "ur"})
"""Languages whose keyword usually follows the date ("कल तैयार", "ನಾಳೆ ಸಿದ್ಧ")."""


@dataclass(frozen=True)
class _DateMention:
    start: int
    end: int
    value: date
    word: str
    hint: str | None = None


def _resolve_day_month(day: int, month: int, today: date, year: int | None = None) -> date | None:
    try:
        candidate = date(year or today.year, month, day)
    except ValueError:
        return None
    if year is None and candidate < today - timedelta(days=PAST_DAYS):
        try:
            candidate = date(today.year + 1, month, day)
        except ValueError:
            return None
    return candidate


def _int_token(token: str | None) -> int | None:
    if token is None or not token.isdigit():
        return None
    return int(token)


def _match_date(tokens: Sequence[str], i: int, today: date) -> _DateMention | None:
    token = tokens[i]

    def at(offset: int) -> str | None:
        index = i + offset
        return tokens[index] if 0 <= index < len(tokens) else None

    if token in _FIXED_DATE_WORDS:
        return _DateMention(i, i + 1, today + timedelta(days=_FIXED_DATE_WORDS[token]), token)

    # "within 3 days", "in 2 weeks", "after 4 days"
    if token in _BEFORE_N_WITHIN:
        count_token = at(1)
        count = 1 if count_token in _ARTICLES else _int_token(count_token)
        unit = at(2)
        if count is not None and unit is not None:
            hint = _SELL if token == "within" else None
            if unit in _N_DAY_WORDS:
                return _DateMention(i, i + 3, today + timedelta(days=count), token, hint)
            if unit in _N_WEEK_WORDS:
                return _DateMention(i, i + 3, today + timedelta(days=7 * count), token, hint)

    count = _int_token(token)
    if count is not None:
        unit = at(1)
        # "3 days later", "3 दिन में", "3 రోజుల్లో", "1 हफ्ते में"
        if unit in _N_DAY_WORDS or unit in _N_WEEK_WORDS:
            days = count if unit in _N_DAY_WORDS else 7 * count
            end = i + 2
            hint = None
            if at(2) in _AFTER_N_WITHIN:
                end = i + 3
                hint = _SELL if at(2) not in _LATER_WORDS else None
            if unit.endswith(_WITHIN_SUFFIXES):
                hint = _SELL
            return _DateMention(i, end, today + timedelta(days=days), token, hint)
        # "25 october", "25th of october"
        j = 1
        if at(j) in _ORDINAL_SUFFIXES:
            j += 1
        if at(j) == "of":
            j += 1
        month_token = at(j)
        if month_token in _MONTHS and 1 <= count <= 31:
            value = _resolve_day_month(count, _MONTHS[month_token], today)
            if value is not None:
                return _DateMention(i, i + j + 1, value, token)
        # "25/10" or "25/10/2026"
        if at(1) == "/" and _int_token(at(2)) is not None:
            day, month = count, _int_token(at(2)) or 0
            year: int | None = None
            end = i + 3
            if at(3) == "/" and _int_token(at(4)) is not None:
                year = _int_token(at(4))
                if year is not None and year < 100:
                    year += 2000
                end = i + 5
            if 1 <= month <= 12:
                value = _resolve_day_month(day, month, today, year)
                if value is not None:
                    return _DateMention(i, end, value, token)

    # "october 25", "oct 25th"
    if token in _MONTHS:
        day = _int_token(at(1))
        if day is not None and 1 <= day <= 31:
            end = i + 3 if at(2) in _ORDINAL_SUFFIXES else i + 2
            value = _resolve_day_month(day, _MONTHS[token], today)
            if value is not None:
                return _DateMention(i, end, value, token)

    # "friday", "next friday", "on friday"
    if token in _WEEKDAYS:
        ahead = (_WEEKDAYS[token] - today.weekday()) % 7 or 7
        start = i - 1 if at(-1) in {"next", "this", "on", "coming"} else i
        return _DateMention(start, i + 1, today + timedelta(days=ahead), token)
    return None


def _find_dates(tokens: Sequence[str], today: date) -> list[_DateMention]:
    mentions: list[_DateMention] = []
    i = 0
    while i < len(tokens):
        mention = _match_date(tokens, i, today)
        if mention is not None:
            if mentions and mention.start < mentions[-1].end:
                mention = _DateMention(
                    mentions[-1].end, mention.end, mention.value, mention.word, mention.hint
                )
            mentions.append(mention)
            i = mention.end
        else:
            i += 1
    return mentions


def _keyword_class(token: str) -> tuple[str, bool] | None:
    """``(field, strong)`` for a context keyword."""
    if token in _HARVEST_STRONG:
        return _HARVEST, True
    if token in _SELL_STRONG:
        return _SELL, True
    if token in _AVAILABLE_STRONG:
        return _AVAILABLE, True
    if token in _SELL_WEAK:
        return _SELL, False
    if token in _AVAILABLE_WEAK:
        return _AVAILABLE, False
    return None


def _classify_date(
    tokens: Sequence[str],
    mention: _DateMention,
    previous_end: int,
    next_start: int,
    language: schemas.Language,
    today: date,
) -> str:
    """Which draft field a date mention fills, from the nearest keyword around it."""
    candidates: list[tuple[int, int, int, str]] = []
    # (strength rank, distance, side rank, field) - smaller sorts first.
    prefer_after = language in _VERB_FINAL_LANGUAGES
    for direction in (-1, 1):
        index = mention.start - 1 if direction < 0 else mention.end
        distance = 1
        limit = previous_end if direction < 0 else next_start
        while distance <= CONTEXT_WINDOW:
            if (direction < 0 and index < limit) or (direction > 0 and index >= limit):
                break
            if index < 0 or index >= len(tokens):
                break
            token = tokens[index]
            if token in _CLAUSE_BREAKS:
                break
            found = _keyword_class(token)
            if found is not None:
                field_name, strong = found
                side_rank = 0 if (direction > 0) == prefer_after else 1
                candidates.append((0 if strong else 1, distance, side_rank, field_name))
            index += direction
            distance += 1
    if candidates:
        return min(candidates)[3]
    if mention.hint is not None:
        return mention.hint
    return _HARVEST if mention.value < today else _AVAILABLE


# ─────────────────────────────── Grades ───────────────────────────────

_GRADE_LETTERS: dict[str, str] = _norm_map(
    {
        "a": "A",
        "b": "B",
        "c": "C",
        "1": "A",
        "2": "B",
        "3": "C",
        "ए": "A",
        "बी": "B",
        "सी": "C",
        "ఏ": "A",
        "ఎ": "A",
        "బీ": "B",
        "బి": "B",
        "సీ": "C",
        "సి": "C",
        "ಎ": "A",
        "ಏ": "A",
        "ಬಿ": "B",
        "ಬೀ": "B",
        "ಸಿ": "C",
        "ಸೀ": "C",
        "اے": "A",
        "بی": "B",
        "سی": "C",
    }
)
_GRADE_WORDS = _norm_set(
    ["grade", "ग्रेड", "గ్రేడ్", "గ్రేడు", "క్వాలిటీ", "ಗ್ರೇಡ್", "ಗ್ರೇಡು", "ದರ್ಜೆ", "گریڈ", "درجہ", "درجے"]
)


def _boundary(pattern: str) -> re.Pattern[str]:
    return re.compile(rf"(?:^| )(?:{normalize(pattern)})(?= |$)")


_GRADE_PHRASES: tuple[tuple[re.Pattern[str], schemas.Grade], ...] = (
    (_boundary(r"(?:first|1st|top|best|premium|export|super) (?:quality|grade|class)"), "A"),
    (_boundary(r"best(?! (?:price|rate|deal|offer|buyer|time|way))"), "A"),
    (_boundary(r"(?:second|2nd|medium|average|mid) (?:quality|grade|class)"), "B"),
    (_boundary(r"medium(?! (?:size|sized|sizes))"), "B"),
    (_boundary(r"(?:third|3rd|low|lower|poor) (?:quality|grade|class)"), "C"),
    (_boundary(r"low(?! (?:price|prices|rate|rates|rejection|demand))"), "C"),
    (
        _boundary(
            r"(?:पहली|अव्वल|बढ़िया|बेहतरीन|फर्स्ट|सबसे अच्छी|सबसे अच्छा) (?:क्वालिटी|किस्म|दर्जे|दर्जा|माल)"
        ),
        "A",
    ),
    (_boundary(r"अव्वल|बढ़िया|बेहतरीन"), "A"),
    (_boundary(r"(?:दूसरी|सेकंड|मध्यम|औसत) (?:क्वालिटी|किस्म|दर्जे|दर्जा|माल)"), "B"),
    (_boundary(r"मध्यम|औसत"), "B"),
    (_boundary(r"(?:तीसरी|घटिया|हल्की|कमजोर) (?:क्वालिटी|किस्म|दर्जे|दर्जा|माल)"), "C"),
    (_boundary(r"घटिया"), "C"),
    (_boundary(r"(?:మొదటి|ఫస్ట్) (?:రకం|రకము|క్వాలిటీ)"), "A"),
    (_boundary(r"(?:రెండో|రెండవ|సెకండ్) (?:రకం|రకము|క్వాలిటీ)|మధ్యస్థ"), "B"),
    (_boundary(r"(?:మూడో|మూడవ|థర్డ్) (?:రకం|రకము|క్వాలిటీ)|తక్కువ నాణ్యత|నాసిరకం"), "C"),
    (
        _boundary(
            r"(?:ಮೊದಲ|ಮೊದಲನೇ|ಫಸ್ಟ್|ಉತ್ತಮ|ಅತ್ಯುತ್ತಮ) (?:ದರ್ಜೆ|ದರ್ಜೆಯ|ಗುಣಮಟ್ಟ|ಗುಣಮಟ್ಟದ|ಕ್ವಾಲಿಟಿ)"
            r"|ಅತ್ಯುತ್ತಮ(?! ಬೆಲೆ)"
        ),
        "A",
    ),
    (
        _boundary(r"(?:ಎರಡನೇ|ಸೆಕೆಂಡ್|ಮಧ್ಯಮ) (?:ದರ್ಜೆ|ದರ್ಜೆಯ|ಗುಣಮಟ್ಟ|ಗುಣಮಟ್ಟದ|ಕ್ವಾಲಿಟಿ)|ಮಧ್ಯಮ(?! ಗಾತ್ರ)"),
        "B",
    ),
    (
        _boundary(r"(?:ಮೂರನೇ|ಥರ್ಡ್|ಕಡಿಮೆ) (?:ದರ್ಜೆ|ದರ್ಜೆಯ|ಗುಣಮಟ್ಟ|ಗುಣಮಟ್ಟದ|ಕ್ವಾಲಿಟಿ)"),
        "C",
    ),
    (
        _boundary(
            r"(?:پہلی|پہلے|اول|اعلیٰ|بہترین|فرسٹ|سب سے اچھی|سب سے اچھا) (?:کوالٹی|قسم|درجے|درجہ|مال)"
        ),
        "A",
    ),
    (_boundary(r"اول|اعلیٰ|بہترین(?! (?:بھاؤ|قیمت|ریٹ))"), "A"),
    (_boundary(r"(?:دوسری|دوسرے|سیکنڈ|درمیانی|اوسط) (?:کوالٹی|قسم|درجے|درجہ|مال)"), "B"),
    (_boundary(r"درمیانی(?! سائز)|اوسط"), "B"),
    (_boundary(r"(?:تیسری|تیسرے|گھٹیا|ہلکی|کمزور) (?:کوالٹی|قسم|درجے|درجہ|مال)"), "C"),
    (_boundary(r"گھٹیا"), "C"),
)


# ──────────────────────────── Quality notes ────────────────────────────

_QUALITY_PHRASES: tuple[tuple[str, str], ...] = (
    ("fully_ripe", "fully ripe"),
    ("half_ripe", "half ripe"),
    ("slightly soft", "slightly soft"),
    ("a bit soft", "slightly soft"),
    ("little soft", "slightly soft"),
    ("bit soft", "slightly soft"),
    ("no cracks", "no cracks"),
    ("without cracks", "no cracks"),
    ("crack free", "no cracks"),
    ("no damage", "no damage"),
    ("undamaged", "no damage"),
    ("no spots", "no spots"),
    ("bright red", "bright red"),
    ("uniform size", "uniform size"),
    ("same size", "uniform size"),
    ("big size", "large size"),
    ("large size", "large size"),
    ("big sized", "large size"),
    ("medium size", "medium size"),
    ("medium sized", "medium size"),
    ("small size", "small size"),
    ("small sized", "small size"),
    ("unripe", "unripe"),
    ("ripened", "ripe"),
    ("ripe", "ripe"),
    ("firm", "firm"),
    ("fresh", "fresh"),
    ("freshly", "fresh"),
    ("red", "red"),
    ("green", "green"),
    ("organic", "organic"),
    ("sorted", "sorted"),
    ("cleaned", "cleaned"),
    ("washed", "cleaned"),
    ("dry", "dry"),
    ("shiny", "shiny"),
    ("glossy", "shiny"),
    ("थोड़ा नरम", "slightly soft"),
    ("थोड़े नरम", "slightly soft"),
    ("अधपका", "half ripe"),
    ("अधपके", "half ripe"),
    ("पका", "ripe"),
    ("पके", "ripe"),
    ("पकी", "ripe"),
    ("कच्चा", "unripe"),
    ("कच्चे", "unripe"),
    ("कच्ची", "unripe"),
    ("ताज़ा", "fresh"),
    ("ताज़े", "fresh"),
    ("ताज़ी", "fresh"),
    ("सख्त", "firm"),
    ("कड़क", "firm"),
    ("नरम", "soft"),
    ("लाल", "red"),
    ("जैविक", "organic"),
    ("కొంచెం మెత్తగా", "slightly soft"),
    ("పగుళ్లు లేవు", "no cracks"),
    ("పండిన", "ripe"),
    ("పండినవి", "ripe"),
    ("పండాయి", "ripe"),
    ("దోరగా", "half ripe"),
    ("దోర", "half ripe"),
    ("పచ్చిగా", "unripe"),
    ("తాజా", "fresh"),
    ("తాజాగా", "fresh"),
    ("గట్టిగా", "firm"),
    ("గట్టి", "firm"),
    ("మెత్తగా", "soft"),
    ("మెత్తని", "soft"),
    ("ఎర్రగా", "red"),
    ("ఎర్రటి", "red"),
    ("సేంద్రియ", "organic"),
    ("సేంద్రీయ", "organic"),
    ("ಸ್ವಲ್ಪ ಮೆತ್ತಗೆ", "slightly soft"),
    ("ಬಿರುಕು ಇಲ್ಲ", "no cracks"),
    ("ಬಿರುಕಿಲ್ಲ", "no cracks"),
    ("ಹಣ್ಣಾದ", "ripe"),
    ("ಹಣ್ಣಾಗಿವೆ", "ripe"),
    ("ಹಣ್ಣಾಗಿದೆ", "ripe"),
    ("ದೋರೆ", "half ripe"),
    ("ತಾಜಾ", "fresh"),
    ("ತಾಜಾವಾಗಿವೆ", "fresh"),
    ("ತಾಜಾವಾಗಿದೆ", "fresh"),
    ("ಗಟ್ಟಿ", "firm"),
    ("ಗಟ್ಟಿಯಾಗಿವೆ", "firm"),
    ("ಗಟ್ಟಿಯಾಗಿದೆ", "firm"),
    ("ಮೆತ್ತಗೆ", "soft"),
    ("ಮೆತ್ತಗಿವೆ", "soft"),
    ("ಕೆಂಪು", "red"),
    ("ಸಾವಯವ", "organic"),
    ("تھوڑا نرم", "slightly soft"),
    ("تھوڑے نرم", "slightly soft"),
    ("ادھ پکا", "half ripe"),
    ("ادھ پکے", "half ripe"),
    ("پکا", "ripe"),
    ("پکے", "ripe"),
    ("پکی", "ripe"),
    ("کچا", "unripe"),
    ("کچے", "unripe"),
    ("کچی", "unripe"),
    ("تازہ", "fresh"),
    ("تازے", "fresh"),
    ("تازی", "fresh"),
    ("سخت", "firm"),
    ("نرم", "soft"),
    ("لال", "red"),
    ("سرخ", "red"),
    ("نامیاتی", "organic"),
    ("soft", "soft"),
)
_QUALITY_TABLE: list[tuple[tuple[str, ...], str]] = sorted(
    ((_phrase_tokens(source), target) for source, target in _QUALITY_PHRASES),
    key=lambda entry: -len(entry[0]),
)

_VARIETY_STOPWORDS = frozenset(
    {
        "the",
        "a",
        "an",
        "of",
        "is",
        "my",
        "this",
        "that",
        "good",
        "nice",
        "which",
        "any",
        "some",
        "its",
        "it",
        "and",
        "with",
        "same",
        "one",
        "i",
        "have",
        "grow",
        "grown",
        "called",
        "named",
        "kg",
        "kilos",
    }
)


# ─────────────────────────────── Parsing ───────────────────────────────


@dataclass
class _Scan:
    tokens: list[str]
    consumed: set[int] = field(default_factory=set)
    ambiguities: int = 0

    def free(self, *indices: int) -> bool:
        return all(index not in self.consumed for index in indices)

    def take(self, start: int, end: int) -> None:
        self.consumed.update(range(start, end))


def _format_number(value: Decimal) -> str:
    text = f"{value.normalize():f}"
    return text


def _number_info(
    token: str, prev: str | None, nxt: str | None, after: str | None
) -> tuple[str, Decimal] | None:
    if _is_number(token):
        return "small", Decimal(token)
    if token in _SMALL_NUMBERS:
        return "small", _SMALL_NUMBERS[token]
    if token in _MULTIPLIERS:
        return "mult", _MULTIPLIERS[token]
    if token in _FRACTIONS:
        return "fraction", _FRACTIONS[token]
    if token in _MODIFIERS and nxt is not None and (nxt in _SMALL_NUMBERS or _is_number(nxt)):
        return "modifier", _MODIFIERS[token]
    if (
        token == "do"
        and nxt is not None
        and (nxt in _MULTIPLIERS or unit_factor(nxt) is not None or nxt in _DAY_WORDS)
    ):
        return "small", Decimal(2)
    if (
        token in _ARTICLES
        and nxt is not None
        and (nxt in _MULTIPLIERS or unit_factor(nxt) is not None)
        and not (prev is not None and (prev in _CURRENCY or _is_number(prev)))
    ):
        return "small", Decimal(1)
    return None


def _continues_number(nxt: str | None, after: str | None) -> bool:
    if nxt is None:
        return False
    if nxt in _ARTICLES:
        return after is not None and after in _FRACTIONS
    return (
        _is_number(nxt)
        or nxt in _SMALL_NUMBERS
        or nxt in _MULTIPLIERS
        or nxt in _FRACTIONS
        or nxt in _MODIFIERS
    )


def _read_number(tokens: Sequence[str], start: int) -> tuple[Decimal, int] | None:
    total = Decimal(0)
    current = Decimal(0)
    last_kind: str | None = None
    last_small = Decimal(0)
    last_mult = Decimal(0)
    modifier = Decimal(0)
    j = start
    n = len(tokens)
    while j < n:
        token = tokens[j]
        prev = tokens[j - 1] if j > 0 else None
        nxt = tokens[j + 1] if j + 1 < n else None
        after = tokens[j + 2] if j + 2 < n else None
        if last_kind is not None and (token in _NUMBER_CONNECTORS or token in _ARTICLES):
            if last_kind != "fraction" and _continues_number(nxt, after):
                j += 1
                continue
            break
        info = _number_info(token, prev, nxt, after)
        if info is None:
            break
        kind, value = info
        if kind == "small":
            value += modifier
            modifier = Decimal(0)
            if last_kind == "fraction":
                break
            if last_kind == "small":
                tens_then_unit = (
                    last_small % 10 == 0 and Decimal(20) <= last_small <= 90 and value < 10
                )
                hundreds_then_rest = last_small >= 100 and last_small % 100 == 0 and value < 100
                if not (tens_then_unit or hundreds_then_rest) or _is_number(token):
                    break
            if last_kind == "mult" and value >= last_mult:
                break
            current += value
            last_small = value
        elif kind == "mult":
            if last_kind == "fraction":
                break
            if current == 0:
                current = Decimal(1)
            if value == 100:
                current *= value
            else:
                total += current * value
                current = Decimal(0)
            last_mult = value
        elif kind == "fraction":
            if last_kind == "mult":
                break
            current += value
        else:  # modifier
            if last_kind is not None:
                break
            modifier = value
        last_kind = kind
        j += 1
    if last_kind is None or last_kind == "modifier":
        return None
    if last_kind == "fraction" and j < n and tokens[j] in _ARTICLES:
        j += 1  # "half a tonne"
    return total + current, j


def merge_number_words(tokens: Sequence[str]) -> list[str]:
    """Replace spoken numbers by digit tokens: ``["four", "hundred"]`` → ``["400"]``."""
    out: list[str] = []
    i = 0
    while i < len(tokens):
        result = _read_number(tokens, i)
        if result is None:
            out.append(tokens[i])
            i += 1
            continue
        value, end = result
        out.append(_format_number(value))
        i = end
    return out


def prepare_tokens(transcript: str) -> list[str]:
    """Normalised, canonicalised tokens with spoken numbers converted to digits."""
    return merge_number_words(_canonicalize(tokenize(transcript)))


def _extract_price(scan: _Scan) -> Decimal | None:
    """The farmer's asking (minimum) price per kg: "₹15 per kilo", "15 rupees a kg",
    "1500 per quintal", "minimum 12", "15 रुपये किलो", "కిలోకి 15 రూపాయలు"."""
    tokens = scan.tokens
    n = len(tokens)

    def tok(index: int) -> str:
        return tokens[index] if 0 <= index < n else ""

    for i, token in enumerate(tokens):
        if not _is_number(token) or not scan.free(i):
            continue
        prev = tok(i - 1)
        currency_before = prev in _CURRENCY
        start = i - 1
        if not currency_before and prev in {".", ":"} and tok(i - 2) in _CURRENCY:
            currency_before, start = True, i - 2
        if not currency_before:
            start = i
        if unit_factor(tok(i + 1)) is not None and not currency_before:
            continue  # "400 kg" is a quantity, not a price
        j = i + 1
        currency_after = tok(j) in _CURRENCY
        if currency_after:
            j += 1
        unit: Decimal | None = None
        if tok(j) in _PER_WORDS and unit_factor(tok(j + 1)) is not None:
            unit = unit_factor(tok(j + 1))  # "15 per kilo", "15 rupees a kg", "15/kg"
            j += 2
        elif (currency_before or currency_after) and unit_factor(tok(j)) is not None:
            unit = unit_factor(tok(j))  # "15 रुपये किलो"
            j += 1
        if unit is None:
            if _is_dative_unit(prev):
                unit, start = unit_factor(prev), i - 1  # "కిలోకి 15"
            elif prev in _GENITIVE and unit_factor(tok(i - 2)) is not None:
                unit, start = unit_factor(tok(i - 2)), i - 2  # "किलो के 15"
            elif unit_factor(prev) is not None and tok(i - 2) in _EXPLICIT_PER:
                unit, start = unit_factor(prev), i - 2  # "per kilo 15"
            elif currency_after and unit_factor(prev) is not None and not _is_number(tok(i - 2)):
                unit, start = unit_factor(prev), i - 1  # "కిలో 15 రూపాయలు"
        minimum_before = False
        for back in range(1, 4):
            word = tok(i - back)
            if word == "minimum":
                minimum_before, start = True, min(start, i - back)
                break
            if word not in _MIN_FILLERS:
                break
        if not (currency_before or currency_after or unit is not None or minimum_before):
            continue
        value = Decimal(token)
        if unit is None and value > MAX_UNITLESS_PRICE:
            continue  # "1500 rupees" without a unit could be per quintal: do not guess
        per_kg = value / unit if unit is not None else value
        if not 0 < per_kg <= MAX_PRICE_PER_KG:
            continue
        scan.take(start, j)
        return per_kg.quantize(_CENT, rounding=ROUND_HALF_UP)
    return None


def _extract_quantity(scan: _Scan) -> Decimal | None:
    tokens = scan.tokens
    found: list[Decimal] = []
    for i, token in enumerate(tokens[:-1]):
        if not _is_number(token) or not scan.free(i, i + 1):
            continue
        factor = unit_factor(tokens[i + 1])
        if factor is None or _is_dative_unit(tokens[i + 1]):
            continue
        scan.take(i, i + 2)
        found.append(Decimal(token) * factor)
    if not found:
        return None
    if len(set(found)) > 1:
        scan.ambiguities += 1
    return found[0]


def _extract_crop(scan: _Scan, lexicon: CropLexicon) -> CropLike | None:
    found: list[int] = []
    for start, end, indices in lexicon.find(scan.tokens):
        scan.take(start, end)
        for index in sorted(indices):
            if index not in found:
                found.append(index)
    if len(found) == 1:
        return lexicon.crops[found[0]]
    if len(found) > 1:
        scan.ambiguities += 1
    return None


def _extract_dates(scan: _Scan, language: schemas.Language, today: date) -> dict[str, date | None]:
    tokens = scan.tokens
    mentions = [
        mention
        for mention in _find_dates(tokens, today)
        if scan.free(*range(mention.start, mention.end))
    ]
    result: dict[str, date | None] = {_HARVEST: None, _AVAILABLE: None, _SELL: None}
    for index, mention in enumerate(mentions):
        previous_end = mentions[index - 1].end if index > 0 else 0
        next_start = mentions[index + 1].start if index + 1 < len(mentions) else len(tokens)
        field_name = _classify_date(tokens, mention, previous_end, next_start, language, today)
        value = mention.value
        if field_name == _HARVEST and mention.word in _PAST_IN_HARVEST_CONTEXT:
            value = today - (mention.value - today)
        scan.take(mention.start, mention.end)
        if result[field_name] is None:
            result[field_name] = value
        elif result[field_name] != value:
            scan.ambiguities += 1
    return result


def _extract_grade(scan: _Scan) -> schemas.Grade | None:
    tokens = scan.tokens
    grades: list[schemas.Grade] = []
    for i, token in enumerate(tokens):
        if token not in _GRADE_WORDS:
            continue
        for neighbour in (i + 1, i - 1):
            if 0 <= neighbour < len(tokens) and tokens[neighbour] in _GRADE_LETTERS:
                letter = tokens[neighbour]
                if neighbour == i - 1 and letter in {"1", "2", "3"}:
                    continue
                grades.append(_GRADE_LETTERS[letter])  # type: ignore[arg-type]
                scan.take(min(i, neighbour), max(i, neighbour) + 1)
                break
    if not grades:
        text = " ".join(token for index, token in enumerate(tokens) if scan.free(index))
        for pattern, grade in _GRADE_PHRASES:
            if pattern.search(text):
                grades.append(grade)
    distinct = list(dict.fromkeys(grades))
    if len(distinct) == 1:
        return distinct[0]
    if len(distinct) > 1:
        scan.ambiguities += 1
    return None


def _extract_quality_notes(scan: _Scan) -> str | None:
    tokens = scan.tokens
    notes: list[str] = []
    i = 0
    while i < len(tokens):
        for source, target in _QUALITY_TABLE:
            end = i + len(source)
            if tuple(tokens[i:end]) == source and scan.free(*range(i, end)):
                if target not in notes:
                    notes.append(target)
                scan.take(i, end)
                i = end
                break
        else:
            i += 1
    if not notes:
        return None
    text = ", ".join(notes)
    return (text[0].upper() + text[1:])[:MAX_NOTES_LENGTH]


def _extract_variety(scan: _Scan) -> str | None:
    """English "<name> variety" / "variety <name>" (e.g. "Arka Rakshak variety")."""
    tokens = scan.tokens

    def usable(index: int) -> bool:
        if not 0 <= index < len(tokens) or not scan.free(index):
            return False
        token = tokens[index]
        return _LATIN_RE.fullmatch(token) is not None and token not in _VARIETY_STOPWORDS

    for i, token in enumerate(tokens):
        if token not in {"variety", "varieties"}:
            continue
        before: list[str] = []
        index = i - 1
        while usable(index) and len(before) < 2:
            before.insert(0, tokens[index])
            index -= 1
        if before:
            return " ".join(before).title()[:MAX_VARIETY_LENGTH]
        after: list[str] = []
        index = i + 1
        while index < len(tokens) and tokens[index] in {"is", "called", "named", ":"}:
            index += 1
        while usable(index) and len(after) < 2:
            after.append(tokens[index])
            index += 1
        if after:
            return " ".join(after).title()[:MAX_VARIETY_LENGTH]
    return None


# ──────────────────────────── Validation ────────────────────────────


def _valid_quantity(value: Any) -> float | None:
    try:
        quantity = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None
    if not quantity.is_finite() or not MIN_QUANTITY_KG <= quantity <= MAX_QUANTITY_KG:
        return None
    return float(quantity.quantize(_CENT, rounding=ROUND_HALF_UP))


def _valid_price(value: Any) -> float | None:
    try:
        price = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None
    if not price.is_finite() or not 0 < price <= MAX_PRICE_PER_KG:
        return None
    return float(price.quantize(_CENT, rounding=ROUND_HALF_UP))


def _valid_date(value: Any, today: date, *, not_before_today: bool = False) -> date | None:
    if not isinstance(value, date):
        return None
    earliest = today if not_before_today else today - timedelta(days=PAST_DAYS)
    if not earliest <= value <= today + timedelta(days=FUTURE_DAYS):
        return None
    return value


def _valid_text(value: Any, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    text = " ".join(value.split())
    return text[:limit] if text else None


def validate_fields(fields: dict[str, Any], today: date) -> dict[str, Any]:
    """Every draft field checked on its own and against the others; invalid values become None.

    Quantity 1..1,000,000 kg, price 0..100,000 ₹/kg, dates within today−7..today+60 (sell-by
    not in the past), grade A/B/C, and ``harvest_date ≤ available_from ≤ sell_by``.
    """
    clean: dict[str, Any] = dict.fromkeys(DRAFT_FIELDS)
    crop_id = fields.get("crop_id")
    if isinstance(crop_id, uuid.UUID):
        clean["crop_id"] = crop_id
        clean["crop_name"] = _valid_text(fields.get("crop_name"), MAX_VARIETY_LENGTH)
    clean["variety"] = _valid_text(fields.get("variety"), MAX_VARIETY_LENGTH)
    clean["quality_notes"] = _valid_text(fields.get("quality_notes"), MAX_NOTES_LENGTH)
    clean["quantity_kg"] = (
        _valid_quantity(fields["quantity_kg"]) if fields.get("quantity_kg") is not None else None
    )
    clean["min_price_per_kg"] = (
        _valid_price(fields["min_price_per_kg"])
        if fields.get("min_price_per_kg") is not None
        else None
    )
    grade = fields.get("grade")
    clean["grade"] = grade if grade in ("A", "B", "C") else None
    clean["harvest_date"] = _valid_date(fields.get("harvest_date"), today)
    clean["available_from"] = _valid_date(fields.get("available_from"), today)
    clean["sell_by"] = _valid_date(fields.get("sell_by"), today, not_before_today=True)

    harvest_date, available_from = clean["harvest_date"], clean["available_from"]
    if harvest_date and available_from and available_from < harvest_date:
        clean["available_from"] = None
    sell_by = clean["sell_by"]
    if sell_by and any(
        other is not None and sell_by < other
        for other in (clean["available_from"], clean["harvest_date"])
    ):
        clean["sell_by"] = None
    return clean


def finalize(fields: dict[str, Any], today: date, ambiguities: int = 0) -> ParsedListing:
    """Validated draft, the required fields still missing, and the confidence (0..1)."""
    clean = validate_fields(fields, today)
    missing = [name for name in FOLLOW_UP_PRIORITY if clean.get(name) is None]
    filled = len(REQUIRED_FIELDS) - len(missing)
    confidence = filled / len(REQUIRED_FIELDS) - AMBIGUITY_PENALTY * ambiguities
    confidence = round(min(1.0, max(0.0, confidence)), 2)
    return ParsedListing(schemas.HarvestDraft(**clean), missing, confidence)


def extract_fields(
    transcript: str,
    language: schemas.Language,
    crops: Sequence[CropLike],
    today: date,
) -> tuple[dict[str, Any], int]:
    """Raw extracted fields (not yet validated) and the number of ambiguities met."""
    scan = _Scan(prepare_tokens(transcript))
    lexicon = CropLexicon.build(crops)
    fields: dict[str, Any] = dict.fromkeys(DRAFT_FIELDS)

    crop = _extract_crop(scan, lexicon)
    if crop is not None:
        fields["crop_id"] = crop.id
        fields["crop_name"] = crop.name
    price = _extract_price(scan)
    if price is not None:
        fields["min_price_per_kg"] = price
    quantity = _extract_quantity(scan)
    if quantity is not None:
        fields["quantity_kg"] = quantity
    fields.update(_extract_dates(scan, language, today))
    fields["grade"] = _extract_grade(scan)
    fields["quality_notes"] = _extract_quality_notes(scan)
    fields["variety"] = _extract_variety(scan)
    return fields, scan.ambiguities


def parse(
    transcript: str,
    language: schemas.Language,
    crops: Sequence[CropLike],
    today: date,
) -> ParsedListing:
    """``(draft, missing_fields, confidence)`` for a spoken listing. Never guesses."""
    fields, ambiguities = extract_fields(transcript, language, crops, today)
    return finalize(fields, today, ambiguities)


def merge(
    rules: dict[str, Any], extra: dict[str, Any], today: date
) -> tuple[dict[str, Any], set[str]]:
    """Fill fields the rules left empty with validated values from ``extra`` (the model).

    Rule values always win. An ``extra`` value is used only when it passes the same validation
    as rule values and does not invalidate any field already set. Returns the merged (validated)
    fields and the names ``extra`` contributed.
    """
    merged = validate_fields(rules, today)
    contributed: set[str] = set()
    for name in DRAFT_FIELDS:
        value = extra.get(name)
        if name == "crop_name" or value is None or merged.get(name) is not None:
            continue
        trial = {**merged, name: value}
        if name == "crop_id":
            trial["crop_name"] = extra.get("crop_name")
        checked = validate_fields(trial, today)
        kept = all(
            checked.get(key) == merged.get(key)
            for key in DRAFT_FIELDS
            if merged.get(key) is not None
        )
        if kept and checked.get(name) is not None:
            merged = checked
            contributed.add(name)
    return merged, contributed
