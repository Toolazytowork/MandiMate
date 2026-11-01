"""AI service in mock mode: deterministic rules texts (en / hi / te) over engine numbers,
counter-offer numbers from the pricing rules, telemetry, and no model ever constructed."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import schemas
from app.ai import interactions, llm, service, templates
from app.core.config import settings
from app.core.errors import DomainError
from app.core.time import today_ist, utcnow
from app.models import AiInteraction, Crop, Harvest, User
from app.services import pricing, selling_options
from tests import factories

# ─────────────────────────────── Option builders ───────────────────────────────


def make_option(
    option_id: str,
    source: schemas.SellingOptionSource,
    *,
    price: float,
    transport: float,
    quantity: float = 400,
    days: int = 7,
    buyer: str | None = "FreshBasket",
    verified: bool = True,
    status: schemas.OfferStatus | None = "pending",
    awaiting: schemas.Awaiting | None = "seller",
    unresolved: Sequence[str] = (),
    transport_certainty: schemas.Certainty = "estimated",
    min_price: float | None = None,
) -> schemas.SellingOption:
    net = pricing.compute_net_proceeds(
        label=f"Option {option_id}",
        quantity_kg=quantity,
        price_per_kg=price,
        transport_cost=transport,
        transport_certainty=transport_certainty,
        rejection_pct=5,
        rejection_certainty="estimated",
        handling_per_kg=pricing.LOADING_PER_KG,
        commission_pct=0,
        commission_certainty="confirmed",
        payment_terms_days=days,
        unresolved=unresolved,
    )
    return schemas.SellingOption(
        **net.model_dump(),
        option_id=option_id,
        source=source,
        title=f"Offer from {buyer}",
        buyer_name=buyer,
        buyer_verified=verified,
        offer_status=status,
        awaiting=awaiting,
        lot_id=None,
        valid_until=None,
        meets_min_price=None if min_price is None else net.net_per_kg >= min_price,
        is_best=False,
    )


def baseline_option(quantity: float = 400, market: float = 14) -> schemas.SellingOption:
    net = pricing.baseline_net_proceeds(
        quantity_kg=quantity, market_price_per_kg=market, default_rejection_pct=5
    )
    assert net is not None
    return schemas.SellingOption(
        **net.model_dump(),
        option_id="baseline",
        source="baseline",
        title=pricing.BASELINE_LABEL,
        buyer_name=None,
        buyer_verified=None,
        offer_status=None,
        awaiting=None,
        lot_id=None,
        valid_until=None,
        meets_min_price=None,
        is_best=False,
    )


def selling(
    harvest_id: uuid.UUID,
    options: list[schemas.SellingOption],
    min_price: float | None = None,
) -> schemas.SellingOptions:
    options = sorted(options, key=lambda o: -o.net_amount)
    offers = [o for o in options if o.source != "baseline"]
    best = max(offers, key=lambda o: o.net_amount, default=None)
    baseline = next((o for o in options if o.source == "baseline"), None)
    if best is not None:
        best.is_best = True
    uplift = (
        float(
            pricing.round_money(Decimal(str(best.net_per_kg)) - Decimal(str(baseline.net_per_kg)))
        )
        if best is not None and baseline is not None
        else None
    )
    return schemas.SellingOptions(
        harvest_id=harvest_id,
        crop_name="Tomato",
        quantity_kg=400,
        min_price_per_kg=min_price,
        options=options,
        best_option_id=best.option_id if best is not None else None,
        uplift_vs_baseline_per_kg=uplift,
        generated_at=utcnow(),
    )


# Offer B pays ₹2.00/kg more than offer A, but its transport + handling costs ₹1.50/kg more.
OFFER_A = "11111111-1111-1111-1111-111111111111"
OFFER_B = "22222222-2222-2222-2222-222222222222"


def two_offers_and_baseline(harvest_id: uuid.UUID, **kwargs: Any) -> schemas.SellingOptions:
    return selling(
        harvest_id,
        [
            make_option(OFFER_A, "direct_offer", price=16, transport=400, buyer="Kisan Mart"),
            make_option(
                OFFER_B,
                "pooled_offer",
                price=18,
                transport=1000,
                buyer="FreshBasket",
                unresolved=(pricing.UNRESOLVED_TRANSPORT_QUOTE,),
            ),
            baseline_option(),
        ],
        **kwargs,
    )


@pytest.fixture
async def tomato(db: AsyncSession) -> Crop:
    return await factories.create_crop(db)


async def farmer_and_harvest(
    db: AsyncSession, crop: Crop, language: str = "en", **harvest_overrides: Any
) -> tuple[User, Harvest]:
    farmer = await factories.create_user(db, "farmer", preferred_language=language)
    harvest = await factories.create_harvest(db, farmer, crop, **harvest_overrides)
    return farmer, harvest


def use_options(monkeypatch: pytest.MonkeyPatch, options: schemas.SellingOptions) -> None:
    async def fake(db: AsyncSession, harvest: Harvest, viewer: User) -> schemas.SellingOptions:
        return options

    monkeypatch.setattr(selling_options, "build_selling_options", fake)


async def interactions_of(db: AsyncSession) -> list[AiInteraction]:
    return list((await db.scalars(select(AiInteraction).order_by(AiInteraction.created_at))).all())


# ─────────────────────────────── Status ───────────────────────────────


def test_status_in_mock_mode() -> None:
    status = service.ai_status()
    assert status.mode == "mock"
    assert status.provider == "deepseek"
    assert status.model == "rules"
    assert status.features == [
        "voice_listing",
        "deal_advice",
        "counter_suggestion",
        "match_explanation",
        "insights_summary",
    ]


def test_status_auto_without_key_is_mock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "AI_MODE", "auto")
    assert service.ai_status().mode == "mock"
    monkeypatch.setattr(settings, "DEEPSEEK_API_KEY", "sk-test")
    status = service.ai_status()
    assert status.mode == "live"
    assert status.model == settings.DEEPSEEK_MODEL


# ─────────────────────────────── Deal advice ───────────────────────────────


async def test_deal_advice_english_compares_best_runner_up_and_baseline(
    db: AsyncSession, tomato: Crop, monkeypatch: pytest.MonkeyPatch
) -> None:
    farmer, harvest = await farmer_and_harvest(db, tomato)
    options = two_offers_and_baseline(harvest.id)
    use_options(monkeypatch, options)

    advice = await service.advise_deal(db, harvest, farmer)

    best = next(o for o in options.options if o.option_id == OFFER_B)
    baseline = next(o for o in options.options if o.source == "baseline")
    text = advice.explanation.text
    assert advice.recommended_option_id == OFFER_B
    assert advice.options == options.options
    assert advice.counteroffer is None  # the scripted offers are not in the database
    assert advice.explanation.source == "rules"
    assert advice.explanation.model is None
    assert advice.explanation.disclaimer == templates.disclaimer("en", "rules")
    assert text.startswith(
        "The pooled offer from FreshBasket is your best option: after all deductions you keep "
        f"{pricing.format_rupees(best.net_per_kg)}/kg, "
        f"{pricing.format_rupees(best.net_amount)} in total for 400 kg."
    )
    assert (
        "Compared with the direct offer from Kisan Mart, it pays ₹2.00 more per kg, but "
        "transport and handling cost ₹1.50 more per kg, so you keep"
    ) in text
    uplift = pricing.round_money(Decimal(str(best.net_per_kg)) - Decimal(str(baseline.net_per_kg)))
    assert (
        f"That is {pricing.format_rupees(uplift)} more per kg than selling alone at the local "
        f"mandi ({pricing.format_rupees(baseline.net_per_kg)}/kg)."
    ) in text
    assert "Payment comes in 7 days." in text
    assert "Some amounts, such as transport, expected rejection and handling, are estimates" in text
    assert "Still open: transport quote pending." in text
    assert text.endswith("The final decision is yours.")


async def test_deal_advice_net_difference_matches_engine(
    db: AsyncSession, tomato: Crop, monkeypatch: pytest.MonkeyPatch
) -> None:
    farmer, harvest = await farmer_and_harvest(db, tomato)
    options = two_offers_and_baseline(harvest.id)
    use_options(monkeypatch, options)
    by_id = {o.option_id: o for o in options.options}
    net_diff = pricing.round_money(
        Decimal(str(by_id[OFFER_B].net_per_kg)) - Decimal(str(by_id[OFFER_A].net_per_kg))
    )

    advice = await service.advise_deal(db, harvest, farmer)

    assert f"so you keep {pricing.format_rupees(net_diff)} more per kg." in advice.explanation.text


async def test_deal_advice_hindi(
    db: AsyncSession, tomato: Crop, monkeypatch: pytest.MonkeyPatch
) -> None:
    farmer, harvest = await farmer_and_harvest(db, tomato, language="hi")
    use_options(monkeypatch, two_offers_and_baseline(harvest.id))

    advice = await service.advise_deal(db, harvest, farmer)

    text = advice.explanation.text
    assert text.startswith("FreshBasket का लॉट (सामूहिक) ऑफ़र आपके लिए सबसे अच्छा विकल्प है")
    assert "Kisan Mart का सीधा ऑफ़र की तुलना में यह प्रति किलो ₹2.00 ज़्यादा भाव देता है" in text
    assert "लेकिन ढुलाई और हैंडलिंग का खर्च प्रति किलो ₹1.50 ज़्यादा है" in text
    assert "भुगतान 7 दिन में मिलेगा।" in text
    assert "अभी तय होना बाकी: ढुलाई का कोटेशन बाकी है।" in text
    assert text.endswith("अंतिम फ़ैसला आपका है।")
    assert advice.explanation.disclaimer == templates.disclaimer("hi", "rules")


async def test_deal_advice_telugu(
    db: AsyncSession, tomato: Crop, monkeypatch: pytest.MonkeyPatch
) -> None:
    farmer, harvest = await farmer_and_harvest(db, tomato, language="te")
    use_options(monkeypatch, two_offers_and_baseline(harvest.id))

    advice = await service.advise_deal(db, harvest, farmer)

    text = advice.explanation.text
    assert text.startswith("FreshBasket నుండి వచ్చిన లాట్ (సమూహ) ఆఫర్ మీకు ఉత్తమ ఎంపిక")
    assert "ఇది కిలోకు ₹2.00 ఎక్కువ ధర ఇస్తుంది, కానీ రవాణా, హ్యాండ్లింగ్ ఖర్చు కిలోకు ₹1.50 ఎక్కువ" in text
    assert "చెల్లింపు 7 రోజుల్లో వస్తుంది." in text
    assert "ఇంకా తేలాల్సినవి: రవాణా కొటేషన్ ఇంకా రాలేదు." in text
    assert text.endswith("తుది నిర్ణయం మీదే.")
    assert advice.explanation.disclaimer == templates.disclaimer("te", "rules")


async def test_deal_advice_kannada(
    db: AsyncSession, tomato: Crop, monkeypatch: pytest.MonkeyPatch
) -> None:
    farmer, harvest = await farmer_and_harvest(db, tomato, language="kn")
    use_options(monkeypatch, two_offers_and_baseline(harvest.id))

    advice = await service.advise_deal(db, harvest, farmer)

    text = advice.explanation.text
    assert text.startswith("FreshBasket ನೀಡಿದ ಲಾಟ್ (ಗುಂಪು) ಆಫರ್ ನಿಮಗೆ ಉತ್ತಮ ಆಯ್ಕೆ")
    assert "ಇದು ಕಿಲೋಗೆ ₹2.00 ಹೆಚ್ಚು ಬೆಲೆ ಕೊಡುತ್ತದೆ, ಆದರೆ ಸಾಗಣೆ ಮತ್ತು ಹ್ಯಾಂಡ್ಲಿಂಗ್ ಖರ್ಚು ಕಿಲೋಗೆ ₹1.50 ಹೆಚ್ಚು" in text
    assert "ಹಣ 7 ದಿನಗಳಲ್ಲಿ ಬರುತ್ತದೆ." in text
    assert "ಇನ್ನೂ ತೀರ್ಮಾನವಾಗಬೇಕಿರುವುದು: ಸಾಗಣೆ ಕೊಟೇಶನ್ ಇನ್ನೂ ಬಂದಿಲ್ಲ." in text
    assert text.endswith("ಅಂತಿಮ ನಿರ್ಧಾರ ನಿಮ್ಮದು.")
    assert advice.explanation.disclaimer == templates.disclaimer("kn", "rules")


async def test_deal_advice_urdu(
    db: AsyncSession, tomato: Crop, monkeypatch: pytest.MonkeyPatch
) -> None:
    farmer, harvest = await farmer_and_harvest(db, tomato, language="ur")
    use_options(monkeypatch, two_offers_and_baseline(harvest.id))

    advice = await service.advise_deal(db, harvest, farmer)

    text = advice.explanation.text
    assert text.startswith("FreshBasket کی لاٹ (اجتماعی) آفر آپ کے لیے سب سے اچھا راستہ ہے")
    assert "Kisan Mart کی سیدھی آفر کے مقابلے میں اس میں فی کلو ₹2.00 زیادہ بھاؤ ملتا ہے" in text
    assert "لیکن ڈھلائی اور ہینڈلنگ کا خرچ فی کلو ₹1.50 زیادہ ہے" in text
    assert "ادائیگی 7 دن میں ملے گی۔" in text
    # Urdu lists use the Arabic comma.
    assert "جیسے ڈھلائی، ممکنہ ریجیکشن اور ہینڈلنگ،" in text
    assert "ابھی طے ہونا باقی: ڈھلائی کا کوٹیشن ابھی باقی ہے۔" in text
    assert text.endswith("آخری فیصلہ آپ کا ہے۔")
    assert advice.explanation.disclaimer == templates.disclaimer("ur", "rules")


async def test_deal_advice_is_deterministic(
    db: AsyncSession, tomato: Crop, monkeypatch: pytest.MonkeyPatch
) -> None:
    farmer, harvest = await farmer_and_harvest(db, tomato)
    use_options(monkeypatch, two_offers_and_baseline(harvest.id))
    first = await service.advise_deal(db, harvest, farmer)
    second = await service.advise_deal(db, harvest, farmer)
    assert first.explanation.text == second.explanation.text


async def test_deal_advice_below_baseline_and_minimum(
    db: AsyncSession, tomato: Crop, monkeypatch: pytest.MonkeyPatch
) -> None:
    farmer, harvest = await farmer_and_harvest(db, tomato)
    low = make_option(OFFER_A, "direct_offer", price=12, transport=1200, min_price=12)
    use_options(monkeypatch, selling(harvest.id, [low, baseline_option()], min_price=12))

    advice = await service.advise_deal(db, harvest, farmer)

    text = advice.explanation.text
    assert "less per kg than selling alone at the local mandi" in text
    assert "waiting for a better offer or countering may pay" in text
    assert "It is below your minimum of ₹12.00/kg." in text


async def test_deal_advice_baseline_only(
    db: AsyncSession, tomato: Crop, monkeypatch: pytest.MonkeyPatch
) -> None:
    farmer, harvest = await farmer_and_harvest(db, tomato)
    baseline = baseline_option()
    use_options(monkeypatch, selling(harvest.id, [baseline]))

    advice = await service.advise_deal(db, harvest, farmer)

    assert advice.recommended_option_id is None
    assert advice.explanation.text == (
        "There are no buyer offers for your tomato yet. Selling 400 kg alone at the local mandi "
        f"would leave you about {pricing.format_rupees(baseline.net_per_kg)}/kg "
        f"({pricing.format_rupees(baseline.net_amount)} in total) after transport, handling, "
        "commission and expected rejection. These are estimates. The final decision is yours."
    )


async def test_deal_advice_without_any_option(
    db: AsyncSession, tomato: Crop, monkeypatch: pytest.MonkeyPatch
) -> None:
    farmer, harvest = await farmer_and_harvest(db, tomato, language="te")
    use_options(monkeypatch, selling(harvest.id, []))

    advice = await service.advise_deal(db, harvest, farmer)

    assert advice.options == []
    assert advice.explanation.text.startswith("మీ టమాటా పంటకు ఇంకా ఏ కొనుగోలుదారు నుండి ఆఫర్ రాలేదు")


async def test_deal_advice_with_engines_includes_counteroffer(
    db: AsyncSession, tomato: Crop
) -> None:
    """End to end over the real selling-options engine and counter-offer rules."""
    await factories.create_market_price(db, tomato)
    farmer, harvest = await farmer_and_harvest(db, tomato, min_price_per_kg=Decimal("12"))
    buyer = await factories.create_user(db, "buyer")
    offer = await factories.create_offer(
        db, buyer, harvest=harvest, price_per_kg=Decimal("12"), pickup_terms="buyer_pickup"
    )

    advice = await service.advise_deal(db, harvest, farmer)

    assert advice.recommended_option_id == str(offer.id)
    assert {o.source for o in advice.options} == {"direct_offer", "baseline"}
    assert advice.counteroffer is not None
    assert advice.counteroffer.offer_id == offer.id
    assert advice.counteroffer.current_price_per_kg == 12.0
    assert advice.counteroffer.market_reference_per_kg == 14.0
    assert advice.counteroffer.source == "rules"
    assert advice.counteroffer.suggested_price_per_kg > 12.0
    text = advice.explanation.text
    assert "The direct offer from FreshBasket Retail Pvt Ltd is your best option" in text
    suggested = pricing.format_rupees(advice.counteroffer.suggested_price_per_kg)
    assert f"a counter-offer of {suggested}/kg is reasonable" in text
    rows = await interactions_of(db)
    assert [(r.feature, r.source, r.success, r.model) for r in rows] == [
        ("deal_advice", "rules", True, None)
    ]


# ─────────────────────────────── Counter-offer ───────────────────────────────


def expected_floor(min_price: str, rejection_pct: str = "5", quantity: str = "400") -> Decimal:
    """The floor with the inputs the selling-options engine uses for a buyer-pickup offer."""
    return pricing.floor_price_for_min_net(
        min_net_per_kg=Decimal(min_price),
        quantity_kg=Decimal(quantity),
        transport_cost=Decimal(0),
        handling_per_kg=pricing.LOADING_PER_KG,
        commission_pct=Decimal(0),
        rejection_pct=Decimal(rejection_pct),
        payment_terms_days=7,
    )


async def test_counter_suggestion_below_floor(db: AsyncSession, tomato: Crop) -> None:
    await factories.create_market_price(db, tomato)
    farmer, harvest = await farmer_and_harvest(db, tomato, min_price_per_kg=Decimal("12"))
    buyer = await factories.create_user(db, "buyer")
    offer = await factories.create_offer(
        db, buyer, harvest=harvest, price_per_kg=Decimal("10"), pickup_terms="buyer_pickup"
    )

    suggestion = await service.suggest_counteroffer(db, offer, farmer)

    floor = expected_floor("12")
    suggested, accept = pricing.suggest_counter_price(
        current_price=Decimal("10"), floor_price=floor, market_reference=Decimal("14")
    )
    assert not accept
    assert suggestion.offer_id == offer.id
    assert suggestion.current_price_per_kg == 10.0
    assert suggestion.floor_price_per_kg == float(floor)
    assert suggestion.market_reference_per_kg == 14.0
    assert suggestion.suggested_price_per_kg == float(suggested) == 13.0
    assert suggestion.source == "rules"
    assert suggestion.rationale == (
        "The buyer offers ₹10.00/kg. To keep your minimum net price, you need at least "
        f"{pricing.format_rupees(floor)}/kg from this offer. The mandi reference is ₹14.00/kg. "
        "A counter-offer of ₹13.00/kg protects your minimum. The decision is yours."
    )


async def test_counter_floor_really_nets_the_minimum(db: AsyncSession, tomato: Crop) -> None:
    """At the floor the engine's own breakdown meets the minimum; just below it does not."""
    await factories.create_market_price(db, tomato)
    farmer, harvest = await farmer_and_harvest(db, tomato, min_price_per_kg=Decimal("12"))
    buyer = await factories.create_user(db, "buyer")
    offer = await factories.create_offer(db, buyer, harvest=harvest, price_per_kg=Decimal("10"))

    suggestion = await service.suggest_counteroffer(db, offer, farmer)
    assert suggestion.floor_price_per_kg is not None

    offer.price_per_kg = Decimal(str(suggestion.floor_price_per_kg))
    at_floor = await selling_options.offer_breakdown(db, offer, farmer, harvest.id)
    offer.price_per_kg = Decimal(str(suggestion.floor_price_per_kg)) - Decimal("0.05")
    below = await selling_options.offer_breakdown(db, offer, farmer, harvest.id)
    assert at_floor.net_per_kg >= 12.0
    assert below.net_per_kg < 12.0
    await db.rollback()


async def test_counter_suggestion_advises_accepting(db: AsyncSession, tomato: Crop) -> None:
    await factories.create_market_price(db, tomato)
    farmer, harvest = await farmer_and_harvest(db, tomato)
    buyer = await factories.create_user(db, "buyer")
    offer = await factories.create_offer(
        db, buyer, harvest=harvest, price_per_kg=Decimal("16"), pickup_terms="buyer_pickup"
    )

    suggestion = await service.suggest_counteroffer(db, offer, farmer)

    assert suggestion.suggested_price_per_kg == suggestion.current_price_per_kg == 16.0
    assert suggestion.floor_price_per_kg is None
    assert suggestion.rationale == (
        "The buyer offers ₹16.00/kg. The mandi reference is ₹14.00/kg. The offer is already at "
        "least 5% above the mandi reference, so accepting is reasonable. The decision is yours."
    )


async def test_counter_suggestion_without_market_or_minimum(db: AsyncSession, tomato: Crop) -> None:
    farmer, harvest = await farmer_and_harvest(db, tomato, language="te")
    buyer = await factories.create_user(db, "buyer")
    offer = await factories.create_offer(db, buyer, harvest=harvest, price_per_kg=Decimal("11"))

    suggestion = await service.suggest_counteroffer(db, offer, farmer)

    assert suggestion.market_reference_per_kg is None
    assert suggestion.suggested_price_per_kg == 11.0
    assert suggestion.rationale.startswith("కొనుగోలుదారు కిలోకు ₹11.00 ఇస్తున్నారు.")
    assert suggestion.rationale.endswith("నిర్ణయం మీదే.")


async def test_counter_suggestion_hindi(db: AsyncSession, tomato: Crop) -> None:
    await factories.create_market_price(db, tomato)
    farmer, harvest = await farmer_and_harvest(db, tomato, language="hi")
    buyer = await factories.create_user(db, "buyer")
    offer = await factories.create_offer(
        db, buyer, harvest=harvest, price_per_kg=Decimal("10"), pickup_terms="buyer_pickup"
    )

    suggestion = await service.suggest_counteroffer(db, offer, farmer)

    # No minimum: the market reference drives the counter (10 + (14 - 10) / 2 = 12).
    assert suggestion.suggested_price_per_kg == 12.0
    assert suggestion.rationale == (
        "खरीदार ₹10.00 प्रति किलो दे रहा है। मंडी का संदर्भ भाव ₹14.00 प्रति किलो है। "
        "₹12.00 प्रति किलो का जवाबी ऑफ़र भाव को मंडी भाव की ओर ले जाता है, और उससे 5% से "
        "ज़्यादा नहीं मांगता। फ़ैसला आपका है।"
    )


@pytest.mark.parametrize(
    ("language", "rationale"),
    [
        (
            "kn",
            "ಖರೀದಿದಾರರು ಕಿಲೋಗೆ ₹10.00 ಕೊಡುತ್ತಿದ್ದಾರೆ. ಮಂಡಿಯ ಉಲ್ಲೇಖ ಬೆಲೆ ಕಿಲೋಗೆ ₹14.00. "
            "ಕಿಲೋಗೆ ₹12.00 ಬೆಲೆಗೆ ಪ್ರತಿ ಆಫರ್ ಕೊಟ್ಟರೆ ಬೆಲೆ ಮಂಡಿ ಬೆಲೆಯ ಕಡೆಗೆ ಹೋಗುತ್ತದೆ, ಅದಕ್ಕಿಂತ 5% "
            "ಮೀರಿ ಕೇಳುವುದಿಲ್ಲ. ನಿರ್ಧಾರ ನಿಮ್ಮದು.",
        ),
        (
            "ur",
            "خریدار ₹10.00 فی کلو دے رہا ہے۔ منڈی کا حوالہ بھاؤ ₹14.00 فی کلو ہے۔ "
            "₹12.00 فی کلو کی جوابی آفر بھاؤ کو منڈی بھاؤ کی طرف لے جاتی ہے، اور اس سے 5% سے "
            "زیادہ نہیں مانگتی۔ فیصلہ آپ کا ہے۔",
        ),
    ],
)
async def test_counter_suggestion_kannada_and_urdu(
    db: AsyncSession, tomato: Crop, language: str, rationale: str
) -> None:
    await factories.create_market_price(db, tomato)
    farmer, harvest = await farmer_and_harvest(db, tomato, language=language)
    buyer = await factories.create_user(db, "buyer")
    offer = await factories.create_offer(
        db, buyer, harvest=harvest, price_per_kg=Decimal("10"), pickup_terms="buyer_pickup"
    )

    suggestion = await service.suggest_counteroffer(db, offer, farmer)

    assert suggestion.suggested_price_per_kg == 12.0
    assert suggestion.rationale == rationale


async def test_counter_suggestion_for_a_lot(db: AsyncSession, tomato: Crop) -> None:
    await factories.create_market_price(db, tomato)
    coordinator = await factories.create_user(db, "coordinator")
    _farmer_a, harvest_a = await farmer_and_harvest(db, tomato, min_price_per_kg=Decimal("15"))
    farmer_b, harvest_b = await farmer_and_harvest(db, tomato)
    lot = await factories.create_lot(db, tomato, [harvest_a, harvest_b], coordinator=coordinator)
    buyer = await factories.create_user(db, "buyer")
    offer = await factories.create_offer(
        db, buyer, lot=lot, price_per_kg=Decimal("12"), pickup_terms="buyer_pickup"
    )

    whole_lot = await service.suggest_counteroffer(db, offer, coordinator)
    farmer_view = await service.suggest_counteroffer(db, offer, farmer_b)
    member_view = await service.suggest_counteroffer(db, offer, coordinator, harvest_b.id)

    assert whole_lot.floor_price_per_kg == float(expected_floor("15"))
    assert whole_lot.suggested_price_per_kg >= whole_lot.floor_price_per_kg
    assert farmer_view.floor_price_per_kg is None
    assert member_view.floor_price_per_kg is None
    with pytest.raises(DomainError) as error:
        await service.suggest_counteroffer(db, offer, farmer_b, harvest_a.id)
    assert error.value.status_code == 404


async def test_counter_suggestion_requires_an_open_offer(db: AsyncSession, tomato: Crop) -> None:
    farmer, harvest = await farmer_and_harvest(db, tomato)
    buyer = await factories.create_user(db, "buyer")
    offer = await factories.create_offer(db, buyer, harvest=harvest, status="withdrawn")

    with pytest.raises(DomainError) as error:
        await service.suggest_counteroffer(db, offer, farmer)
    assert error.value.status_code == 409


# ─────────────────────────────── Match explanation ───────────────────────────────


def proposal(crop: Crop, *, feasible: bool = False) -> schemas.MatchProposal:
    today = today_ist()
    return schemas.MatchProposal(
        crop_id=crop.id,
        crop_name=crop.name,
        grade="A",
        target_quantity_kg=1000,
        selected_total_kg=1000 if feasible else 700,
        shortfall_kg=0 if feasible else 300,
        feasible=feasible,
        candidates=[
            schemas.MatchCandidate(
                harvest_id=uuid.uuid4(),
                farmer_id=uuid.uuid4(),
                farmer_name="Ravi Kumar Reddy",
                village="Kurabalakota",
                grade="A",
                quality_status="inspected",
                available_kg=400,
                proposed_kg=400,
                distance_km=12.5,
                sell_by=today + timedelta(days=2),
                score=82.4,
                reasons=["Inspected"],
            ),
            schemas.MatchCandidate(
                harvest_id=uuid.uuid4(),
                farmer_id=uuid.uuid4(),
                farmer_name="Lakshmi Devi",
                village=None,
                grade="A",
                quality_status="self_reported",
                available_kg=600 if feasible else 300,
                proposed_kg=600 if feasible else 300,
                distance_km=20,
                sell_by=today + timedelta(days=4),
                score=61,
                reasons=[],
            ),
        ],
        excluded=[
            schemas.MatchExclusion(
                harvest_id=uuid.uuid4(),
                farmer_name="Venkatesh Naidu",
                reason="Grade B does not match grade A",
            )
        ],
        rules_applied=["Same crop"],
        explanation="2 harvests selected.",
        collection_latitude=13.55,
        collection_longitude=78.50,
        pickup_date=today + timedelta(days=1),
        demand_id=None,
    )


async def test_match_explanation_english(db: AsyncSession, tomato: Crop) -> None:
    coordinator = await factories.create_user(db, "coordinator")

    text = await service.explain_match(db, proposal(tomato), coordinator)

    assert text.source == "rules"
    assert text.model is None
    assert text.disclaimer == templates.disclaimer("en", "rules")
    assert text.text == (
        "2 compatible harvests can supply 700 kg of grade A tomato against a target of 1,000 kg. "
        "It is 300 kg short, so the lot is not feasible yet. Selected: Ravi Kumar Reddy "
        "(Kurabalakota, 12.5 km, score 82.4, 400 kg); Lakshmi Devi (20 km, score 61, 300 kg). "
        "1 of the selected harvests are not inspected yet; inspect them before pickup. "
        "1 harvests were left out, mainly because: Grade B does not match grade A. "
        "The match follows fixed rules: same crop and exact grade, ready on the pickup date, "
        "within the radius and fresh enough; no farmer is asked for more than they have."
    )
    rows = await interactions_of(db)
    assert [(r.feature, r.source, r.success) for r in rows] == [
        ("match_explanation", "rules", True)
    ]


@pytest.mark.parametrize(
    ("language", "start"),
    [
        (
            "hi",
            "2 मेल खाती फसलें ग्रेड A टमाटर की 1,000 किलो की ज़रूरत के मुकाबले 1,000 किलो दे सकती हैं। यह लॉट संभव है।",
        ),
        ("te", "2 సరిపోయే పంటలు గ్రేడ్ A టమాటా 1,000 కిలోలు అవసరానికి గాను 1,000 కిలోలు ఇవ్వగలవు. ఈ లాట్ సాధ్యమే."),
        ("kn", "2 ಹೊಂದುವ ಬೆಳೆಗಳು ಗ್ರೇಡ್ A ಟೊಮೆಟೊ 1,000 ಕಿಲೋ ಬೇಡಿಕೆಗೆ 1,000 ಕಿಲೋ ಕೊಡಬಲ್ಲವು. ಈ ಲಾಟ್ ಸಾಧ್ಯ."),
        (
            "ur",
            "2 موزوں فصلیں گریڈ A ٹماٹر کی 1,000 کلو کی ضرورت کے مقابلے میں 1,000 کلو دے سکتی ہیں۔ یہ لاٹ ممکن ہے۔",
        ),
    ],
)
async def test_match_explanation_in_indian_languages(
    db: AsyncSession, tomato: Crop, language: str, start: str
) -> None:
    coordinator = await factories.create_user(db, "coordinator", preferred_language=language)
    text = await service.explain_match(db, proposal(tomato, feasible=True), coordinator)
    assert text.text.startswith(start)
    assert text.disclaimer == templates.disclaimer(language, "rules")


# ─────────────────────────────── Insights ───────────────────────────────


def balances(crop: Crop) -> list[schemas.CropBalance]:
    onion_id = uuid.uuid4()
    return [
        schemas.CropBalance(
            crop_id=onion_id,
            crop_name="Onion",
            listed_kg=2000,
            demanded_kg=800,
            gap_kg=-1200,
            avg_offer_price_per_kg=None,
            market_modal_price_per_kg=20,
            signal="surplus",
        ),
        schemas.CropBalance(
            crop_id=crop.id,
            crop_name=crop.name,
            listed_kg=2400,
            demanded_kg=3000,
            gap_kg=600,
            avg_offer_price_per_kg=16,
            market_modal_price_per_kg=14,
            signal="shortage",
        ),
    ]


async def test_insights_summary_english(db: AsyncSession, tomato: Crop) -> None:
    coordinator = await factories.create_user(db, "coordinator")

    summary = await service.summarize_insights(db, balances(tomato), coordinator)

    assert summary.source == "rules"
    assert summary.text == (
        "Onion: 2,000 kg is listed against 800 kg of demand, a surplus of 1,200 kg. The mandi "
        "price is ₹20.00/kg. Tomato: buyers want 3,000 kg but only 2,400 kg is listed, a "
        "shortage of 600 kg. Offers average ₹16.00/kg against a mandi price of ₹14.00/kg. "
        "Prioritise pooling tomato to meet demand. Look for more buyers for onion."
    )


async def test_insights_summary_uses_catalogue_names_in_hindi(
    db: AsyncSession, tomato: Crop
) -> None:
    coordinator = await factories.create_user(db, "coordinator", preferred_language="hi")
    summary = await service.summarize_insights(db, balances(tomato)[1:], coordinator)
    assert summary.text.startswith(
        "टमाटर: खरीदारों को 3,000 किलो चाहिए लेकिन केवल 2,400 किलो सूचीबद्ध है, यानी 600 किलो की कमी।"
    )


@pytest.mark.parametrize(
    ("language", "start"),
    [
        (
            "kn",
            "ಟೊಮೆಟೊ: ಖರೀದಿದಾರರಿಗೆ 3,000 ಕಿಲೋ ಬೇಕು ಆದರೆ 2,400 ಕಿಲೋ ಮಾತ್ರ ಪಟ್ಟಿಯಲ್ಲಿದೆ, ಅಂದರೆ 600 ಕಿಲೋ ಕೊರತೆ.",
        ),
        (
            "ur",
            "ٹماٹر: خریداروں کو 3,000 کلو چاہیے لیکن صرف 2,400 کلو فہرست میں ہے، یعنی 600 کلو کی کمی۔",
        ),
    ],
)
async def test_insights_summary_uses_catalogue_names_in_kannada_and_urdu(
    db: AsyncSession, tomato: Crop, language: str, start: str
) -> None:
    coordinator = await factories.create_user(db, "coordinator", preferred_language=language)
    summary = await service.summarize_insights(db, balances(tomato)[1:], coordinator)
    assert summary.text.startswith(start)
    assert summary.disclaimer == templates.disclaimer(language, "rules")


async def test_insights_summary_empty(db: AsyncSession) -> None:
    coordinator = await factories.create_user(db, "coordinator", preferred_language="te")
    summary = await service.summarize_insights(db, [], coordinator)
    assert summary.text == "పోల్చడానికి ఇంకా జాబితాలో సరుకు గానీ తెరిచి ఉన్న డిమాండ్ గానీ లేదు."


# ─────────────────────────────── Voice listing & telemetry ───────────────────────────────


async def test_voice_listing_uses_the_catalogue_and_logs_sizes_only(
    db: AsyncSession, tomato: Crop
) -> None:
    farmer = await factories.create_user(db, "farmer")
    transcript = "I have 400 kilos of tomatoes ready for pickup tomorrow morning"
    req = schemas.VoiceListingRequest(transcript=transcript, language="en")

    draft = await service.parse_voice_listing(db, req, farmer)

    assert draft.source == "rules"
    assert draft.draft.crop_id == tomato.id
    assert draft.draft.available_from == today_ist() + timedelta(days=1)
    assert draft.missing_fields == ["sell_by", "grade", "harvest_date"]
    assert draft.follow_up_question == "By which day must it be sold?"
    assert draft.confidence == 0.5
    (row,) = await interactions_of(db)
    assert row.user_id == farmer.id
    assert row.feature == interactions.FEATURE_VOICE_LISTING
    assert (row.source, row.model, row.success, row.error) == ("rules", None, True, None)
    assert row.input_chars == len(transcript)
    assert row.output_chars == len(draft.draft.model_dump_json())
    assert row.latency_ms >= 0


async def test_voice_listing_follow_up_in_telugu(db: AsyncSession, tomato: Crop) -> None:
    farmer = await factories.create_user(db, "farmer")
    req = schemas.VoiceListingRequest(transcript="నా దగ్గర టమాటాలు ఉన్నాయి", language="te")
    draft = await service.parse_voice_listing(db, req, farmer)
    assert draft.draft.crop_id == tomato.id
    assert draft.missing_fields[0] == "quantity_kg"
    assert draft.follow_up_question == "మీ దగ్గర అమ్మడానికి ఎన్ని కిలోలు ఉన్నాయి?"


@pytest.mark.parametrize(
    ("transcript", "language", "question"),
    [
        ("ನನ್ನ ಬಳಿ ಟೊಮೆಟೊ ಇದೆ", "kn", "ನಿಮ್ಮ ಬಳಿ ಮಾರಲು ಎಷ್ಟು ಕಿಲೋ ಇದೆ?"),
        ("میرے پاس ٹماٹر ہیں", "ur", "آپ کے پاس بیچنے کے لیے کتنے کلو ہیں؟"),
    ],
)
async def test_voice_listing_follow_up_in_kannada_and_urdu(
    db: AsyncSession, tomato: Crop, transcript: str, language: str, question: str
) -> None:
    farmer = await factories.create_user(db, "farmer")
    req = schemas.VoiceListingRequest(transcript=transcript, language=language)
    draft = await service.parse_voice_listing(db, req, farmer)
    assert draft.draft.crop_id == tomato.id
    assert draft.missing_fields[0] == "quantity_kg"
    assert draft.follow_up_question == question


# ─────────────────────────────── No model in mock mode ───────────────────────────────


async def test_mock_mode_never_constructs_chat_deepseek(
    db: AsyncSession, tomato: Crop, monkeypatch: pytest.MonkeyPatch
) -> None:
    constructed: list[dict[str, Any]] = []

    class Spy:
        def __init__(self, **kwargs: Any) -> None:
            constructed.append(kwargs)

    monkeypatch.setattr(llm, "ChatDeepSeek", Spy)
    monkeypatch.setattr(settings, "DEEPSEEK_API_KEY", "sk-should-not-be-used")  # mode stays mock
    farmer, harvest = await farmer_and_harvest(db, tomato)
    coordinator = await factories.create_user(db, "coordinator")
    buyer = await factories.create_user(db, "buyer")
    offer = await factories.create_offer(db, buyer, harvest=harvest)

    assert llm.get_chat_model() is None
    voice = await service.parse_voice_listing(
        db, schemas.VoiceListingRequest(transcript="400 kg tomatoes", language="en"), farmer
    )
    advice = await service.advise_deal(db, harvest, farmer)
    counter = await service.suggest_counteroffer(db, offer, farmer)
    match = await service.explain_match(db, proposal(tomato), coordinator)
    summary = await service.summarize_insights(db, balances(tomato), coordinator)

    assert constructed == []
    assert {voice.source, advice.explanation.source, counter.source, match.source} == {"rules"}
    assert summary.source == "rules"
    rows = await interactions_of(db)
    assert len(rows) == 5
    assert all(row.source == "rules" and row.success and row.model is None for row in rows)


def test_today_helper_is_a_date() -> None:
    assert isinstance(today_ist(), date)
