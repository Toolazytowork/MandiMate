"""The crop catalogue: ten crops grown around Madanapalle, with Hindi, Telugu, Kannada and Urdu
names.

``synonyms`` are lower-case spellings in every script (English, Hindi, Telugu, Kannada, Urdu and
common transliterations) used by the voice-listing parser to recognise a crop in free speech.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import select

from app.models import Crop

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models.enums import CropCategory


@dataclass(frozen=True)
class CropSpec:
    code: str
    name: str
    name_hi: str
    name_te: str
    name_kn: str
    name_ur: str
    category: CropCategory
    perishability_days: int
    default_rejection_pct: Decimal
    synonyms: tuple[str, ...]
    varieties: tuple[str, ...]
    """Varieties commonly grown in the cluster (used for demo harvests)."""
    grades: tuple[str, ...] = ("A", "B", "C")
    requires_refrigeration: bool = False


CROPS: tuple[CropSpec, ...] = (
    CropSpec(
        code="TOM",
        name="Tomato",
        name_hi="टमाटर",
        name_te="టమాటా",
        name_kn="ಟೊಮೆಟೊ",
        name_ur="ٹماٹر",
        category="vegetable",
        perishability_days=7,
        default_rejection_pct=Decimal("5"),
        synonyms=(
            "tomato",
            "tomatoes",
            "tamatar",
            "tamaatar",
            "tamata",
            "tomoto",
            "टमाटर",
            "टमाटा",
            "టమాటా",
            "టమాటాలు",
            "టమోటా",
            "టమాట",
            "ಟೊಮೆಟೊ",
            "ಟೊಮ್ಯಾಟೊ",
            "ಟೊಮೇಟೊ",
            "ಟೊಮಾಟೊ",
            "ٹماٹر",
        ),
        varieties=("Arka Rakshak", "Saaho", "Abhinav", "Sivam", "US-440"),
    ),
    CropSpec(
        code="ONI",
        name="Onion",
        name_hi="प्याज़",
        name_te="ఉల్లిపాయ",
        name_kn="ಈರುಳ್ಳಿ",
        name_ur="پیاز",
        category="vegetable",
        perishability_days=30,
        default_rejection_pct=Decimal("3"),
        synonyms=(
            "onion",
            "onions",
            "pyaz",
            "pyaaz",
            "piyaz",
            "kanda",
            "ulli",
            "ullipaya",
            "ullipayalu",
            "प्याज़",
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
        varieties=("Agrifound Dark Red", "Bellary Red", "Arka Kalyan"),
    ),
    CropSpec(
        code="CHI",
        name="Green Chilli",
        name_hi="हरी मिर्च",
        name_te="పచ్చి మిరపకాయ",
        name_kn="ಹಸಿರು ಮೆಣಸಿನಕಾಯಿ",
        name_ur="ہری مرچ",
        category="vegetable",
        perishability_days=6,
        default_rejection_pct=Decimal("6"),
        synonyms=(
            "green chilli",
            "green chillies",
            "green chili",
            "chilli",
            "chillies",
            "chili",
            "chilies",
            "mirchi",
            "hari mirch",
            "mirapakaya",
            "mirapakayalu",
            "pachi mirchi",
            "हरी मिर्च",
            "मिर्च",
            "मिर्ची",
            "పచ్చి మిరపకాయ",
            "మిరపకాయ",
            "మిరపకాయలు",
            "పచ్చిమిర్చి",
            "పచ్చి మిర్చి",
            "menasinakayi",
            "menasinakai",
            "hasiru menasinakayi",
            "ಹಸಿರು ಮೆಣಸಿನಕಾಯಿ",
            "ಹಸಿಮೆಣಸಿನಕಾಯಿ",
            "ಮೆಣಸಿನಕಾಯಿ",
            "ہری مرچ",
            "مرچ",
            "مرچی",
            "مرچیں",
        ),
        varieties=("Pusa Jwala", "Indam-5", "Teja (green)"),
    ),
    CropSpec(
        code="POT",
        name="Potato",
        name_hi="आलू",
        name_te="బంగాళాదుంప",
        name_kn="ಆಲೂಗಡ್ಡೆ",
        name_ur="آلو",
        category="vegetable",
        perishability_days=45,
        default_rejection_pct=Decimal("3"),
        synonyms=(
            "potato",
            "potatoes",
            "aloo",
            "alu",
            "alugadda",
            "bangaladumpa",
            "आलू",
            "బంగాళాదుంప",
            "బంగాళదుంప",
            "బంగాళాదుంపలు",
            "ఆలుగడ్డ",
            "aalugadde",
            "alugadde",
            "ಆಲೂಗಡ್ಡೆ",
            "ಆಲುಗಡ್ಡೆ",
            "آلو",
        ),
        varieties=("Kufri Jyoti", "Kufri Chandramukhi"),
    ),
    CropSpec(
        code="MNG",
        name="Mango",
        name_hi="आम",
        name_te="మామిడి",
        name_kn="ಮಾವಿನಹಣ್ಣು",
        name_ur="آم",
        category="fruit",
        perishability_days=8,
        default_rejection_pct=Decimal("6"),
        synonyms=(
            "mango",
            "mangoes",
            "mangos",
            "aam",
            "mamidi",
            "mamidi pandu",
            "mamidi pandlu",
            "आम",
            "మామిడి",
            "మామిడి పండు",
            "మామిడిపండు",
            "మామిడి పండ్లు",
            "maavu",
            "mavu",
            "mavinahannu",
            "maavinahannu",
            "ಮಾವಿನಹಣ್ಣು",
            "ಮಾವಿನ ಹಣ್ಣು",
            "ಮಾವು",
            "ಮಾವಿನಕಾಯಿ",
            "آم",
            "آموں",
        ),
        varieties=("Banganapalli", "Totapuri", "Neelam"),
    ),
    CropSpec(
        code="GNT",
        name="Groundnut",
        name_hi="मूंगफली",
        name_te="వేరుశనగ",
        name_kn="ಕಡಲೆಕಾಯಿ",
        name_ur="مونگ پھلی",
        category="oilseed",
        perishability_days=120,
        default_rejection_pct=Decimal("2"),
        synonyms=(
            "groundnut",
            "groundnuts",
            "peanut",
            "peanuts",
            "moongphali",
            "mungfali",
            "verusenaga",
            "verusanaga",
            "palli",
            "pallilu",
            "मूंगफली",
            "వేరుశనగ",
            "వేరుశెనగ",
            "పల్లీలు",
            "పల్లి",
            "kadalekayi",
            "kadalekai",
            "shenga",
            "ಕಡಲೆಕಾಯಿ",
            "ಶೇಂಗಾ",
            "مونگ پھلی",
            "مونگپھلی",
        ),
        varieties=("Kadiri-6", "Dharani", "Kadiri Lepakshi"),
    ),
    CropSpec(
        code="OKR",
        name="Okra",
        name_hi="भिंडी",
        name_te="బెండకాయ",
        name_kn="ಬೆಂಡೆಕಾಯಿ",
        name_ur="بھنڈی",
        category="vegetable",
        perishability_days=4,
        default_rejection_pct=Decimal("7"),
        synonyms=(
            "okra",
            "lady finger",
            "ladies finger",
            "lady's finger",
            "ladyfinger",
            "bhindi",
            "bendakaya",
            "bendakayalu",
            "भिंडी",
            "బెండకాయ",
            "బెండకాయలు",
            "బెండ",
            "bendekayi",
            "bendekai",
            "ಬೆಂಡೆಕಾಯಿ",
            "ಬೆಂಡೆ",
            "بھنڈی",
        ),
        varieties=("Arka Anamika", "Pusa Sawani"),
    ),
    CropSpec(
        code="BRN",
        name="Brinjal",
        name_hi="बैंगन",
        name_te="వంకాయ",
        name_kn="ಬದನೆಕಾಯಿ",
        name_ur="بینگن",
        category="vegetable",
        perishability_days=6,
        default_rejection_pct=Decimal("6"),
        synonyms=(
            "brinjal",
            "brinjals",
            "eggplant",
            "aubergine",
            "baingan",
            "baigan",
            "vankaya",
            "vankayalu",
            "बैंगन",
            "वांगी",
            "వంకాయ",
            "వంకాయలు",
            "badanekayi",
            "badanekai",
            "ಬದನೆಕಾಯಿ",
            "ಬದನೆ",
            "بینگن",
        ),
        varieties=("Bhagyamati", "Arka Nidhi", "Gulabi"),
    ),
    CropSpec(
        code="CAB",
        name="Cabbage",
        name_hi="पत्ता गोभी",
        name_te="క్యాబేజీ",
        name_kn="ಎಲೆಕೋಸು",
        name_ur="بند گوبھی",
        category="vegetable",
        perishability_days=10,
        default_rejection_pct=Decimal("4"),
        synonyms=(
            "cabbage",
            "cabbages",
            "patta gobhi",
            "pattagobhi",
            "band gobhi",
            "kosu",
            "पत्ता गोभी",
            "पत्तागोभी",
            "बंद गोभी",
            "క్యాబేజీ",
            "క్యాబేజి",
            "elekosu",
            "ಎಲೆಕೋಸು",
            "ಕ್ಯಾಬೇಜ್",
            "بند گوبھی",
            "پتہ گوبھی",
        ),
        varieties=("Golden Acre", "Pride of India"),
    ),
    CropSpec(
        code="BAN",
        name="Banana",
        name_hi="केला",
        name_te="అరటి",
        name_kn="ಬಾಳೆಹಣ್ಣು",
        name_ur="کیلا",
        category="fruit",
        perishability_days=7,
        default_rejection_pct=Decimal("5"),
        synonyms=(
            "banana",
            "bananas",
            "kela",
            "kele",
            "arati",
            "aratipandu",
            "arati pandu",
            "केला",
            "केले",
            "అరటి",
            "అరటిపండు",
            "అరటి పండు",
            "అరటి పండ్లు",
            "balehannu",
            "baalehannu",
            "ಬಾಳೆಹಣ್ಣು",
            "ಬಾಳೆ ಹಣ್ಣು",
            "ಬಾಳೆ",
            "کیلا",
            "کیلے",
        ),
        varieties=("Grand Naine", "Karpura Chakkerakeli", "Robusta"),
    ),
)

CROP_SPECS: dict[str, CropSpec] = {spec.code: spec for spec in CROPS}


def _synonyms(spec: CropSpec) -> list[str]:
    names = (spec.name, spec.name_hi, spec.name_te, spec.name_kn, spec.name_ur, *spec.synonyms)
    return list(dict.fromkeys(name.strip().lower() for name in names if name.strip()))


async def seed_crops(db: AsyncSession) -> dict[str, Crop]:
    """Insert the crops that are missing (matched by code) and return every crop by code.

    Existing crops are left untouched, so the catalogue can be loaded into a live database.
    """
    existing = {crop.code: crop for crop in (await db.scalars(select(Crop))).all()}
    for spec in CROPS:
        if spec.code in existing:
            continue
        crop = Crop(
            code=spec.code,
            name=spec.name,
            name_hi=spec.name_hi,
            name_te=spec.name_te,
            name_kn=spec.name_kn,
            name_ur=spec.name_ur,
            category=spec.category,
            perishability_days=spec.perishability_days,
            grades=list(spec.grades),
            default_rejection_pct=spec.default_rejection_pct,
            requires_refrigeration=spec.requires_refrigeration,
            synonyms=_synonyms(spec),
        )
        db.add(crop)
        existing[spec.code] = crop
    await db.flush()
    return existing
