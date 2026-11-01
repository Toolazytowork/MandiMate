"""The demo scenario: the Madanapalle pilot cluster with every role and every journey step.

* 18 farmers of the "Madanapalle Tomato Growers FPO" across ten villages, 3 buyers, 3
  transporters (6 vehicles), the FPO coordinator and an admin.
* Six months of settled history (Ravi: 7 sales, Lakshmi: 4) whose payouts, baselines and
  uplifts are computed with the pricing engine.
* A live pipeline with a lot in every status, including the product brief's scene for Ravi:
  400 kg of tomatoes ready tomorrow with a ₹14/kg direct trader offer and a ₹16/kg pooled
  FreshBasket offer awaiting his consent.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING, Literal

from app.seed.builder import World
from app.seed.catalog import CROP_SPECS
from app.seed.helpers import (
    DISTRICT_ANNAMAYYA,
    DISTRICT_CHITTOOR,
    STATE_AP,
    STATE_KA,
    VILLAGES,
    Clock,
    Place,
    day_text,
    jitter,
    kg_text,
    per_kg,
    round_to_step,
    rupees,
    stable_rng,
)
from app.seed.markets import MADANAPALLE, modal_price
from app.services.pricing import round_money

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models import Crop, Lot, Offer, Settlement
    from app.models.enums import Grade, PickupTerms

QUARTER = Decimal("0.25")

POINTS: dict[str, Place] = {
    "madanapalle_yard": Place(
        "Madanapalle Market Yard", 13.5560, 78.5010, DISTRICT_ANNAMAYYA, STATE_AP
    ),
    "kurabalakota_shed": Place(
        "Kurabalakota Collection Shed", 13.6512, 78.4795, DISTRICT_ANNAMAYYA, STATE_AP
    ),
    "thamballapalle_shed": Place(
        "Thamballapalle Collection Shed", 13.7160, 78.3850, DISTRICT_ANNAMAYYA, STATE_AP
    ),
    "punganur_centre": Place(
        "Punganur FPO Collection Centre", 13.3665, 78.5745, DISTRICT_CHITTOOR, STATE_AP
    ),
    "ramasamudram_cross": Place(
        "Ramasamudram Cross Collection Point", 13.4010, 78.4225, DISTRICT_ANNAMAYYA, STATE_AP
    ),
}
DESTINATIONS: dict[str, Place] = {
    "fb_hoskote": Place(
        "FreshBasket Distribution Centre, Hoskote, Bengaluru",
        13.0707,
        77.7982,
        "Bengaluru Rural",
        STATE_KA,
    ),
    "fb_madanapalle": Place(
        "FreshBasket Collection Centre, CTM Road, Madanapalle",
        13.5652,
        78.5148,
        DISTRICT_ANNAMAYYA,
        STATE_AP,
    ),
    "annapurna_tirupati": Place(
        "Annapurna Central Kitchen, Renigunta Road, Tirupati",
        13.6355,
        79.4720,
        "Tirupati",
        STATE_AP,
    ),
    "venkateswara_yard": Place(
        "Sri Venkateswara Traders, Madanapalle Market Yard",
        13.5565,
        78.5005,
        DISTRICT_ANNAMAYYA,
        STATE_AP,
    ),
}
LOCAL_DESTINATIONS = frozenset({"fb_madanapalle", "venkateswara_yard"})

# key, full name, village, language, email (None = phone-only, registered by the coordinator), phone
FARMERS: tuple[tuple[str, str, str, str, str | None, str], ...] = (
    ("ravi", "Ravi Kumar Reddy", "Kurabalakota", "te", "ravi@mandimate.demo", "+919876500001"),
    ("lakshmi", "Lakshmi Devi", "Punganur", "en", "lakshmi@mandimate.demo", "+919876500002"),
    ("venkatesh", "Venkatesh Naidu", "Madanapalle", "te", None, "+919876500003"),
    ("sreenivasulu", "Sreenivasulu Gowd", "Thamballapalle", "te", None, "+919876500004"),
    ("padmavathi", "Padmavathi Yadav", "Nimmanapalle", "te", None, "+919876500005"),
    (
        "chandrasekhar",
        "Chandrasekhar Reddy",
        "B. Kothakota",
        "te",
        "chandrasekhar@mandimate.demo",
        "+919876500006",
    ),
    ("narasimhulu", "Narasimhulu Bandi", "Ramasamudram", "te", None, "+919876500007"),
    ("sujatha", "Sujatha Kammari", "Peddamandyam", "te", None, "+919876500008"),
    ("mahaboob", "Shaik Mahaboob Basha", "Mulakalacheruvu", "hi", None, "+919876500009"),
    ("govindamma", "Govindamma Pujari", "Kurabalakota", "te", None, "+919876500010"),
    ("anjaneyulu", "Anjaneyulu Boya", "Palamaner", "te", None, "+919876500011"),
    ("bhaskar", "Bhaskar Reddy Gajjala", "Punganur", "en", "bhaskar@mandimate.demo", "+919876500012"),
    ("rajeswari", "Rajeswari Chinthala", "Thamballapalle", "te", None, "+919876500013"),
    ("krishnaiah", "Krishnaiah Settipalli", "Nimmanapalle", "te", None, "+919876500014"),
    ("saraswathi", "Saraswathi Vemula", "Palamaner", "te", None, "+919876500015"),
    ("khaja", "Syed Khaja Mohiddin", "B. Kothakota", "hi", None, "+919876500016"),
    (
        "harikrishna",
        "Harikrishna Dasari",
        "Peddamandyam",
        "en",
        "harikrishna@mandimate.demo",
        "+919876500017",
    ),
    ("eswaramma", "Eswaramma Kuruva", "Ramasamudram", "te", None, "+919876500018"),
)

FPO_NAME = "Madanapalle Tomato Growers FPO"
BUYER_PAYMENT_DAYS = {"freshbasket": 7, "annapurna": 10, "trader": 1}

Stage = Literal["accepted", "quoted", "booked", "in_transit", "delivered", "settled"]
STAGES: tuple[Stage, ...] = ("accepted", "quoted", "booked", "in_transit", "delivered", "settled")


@dataclass(frozen=True)
class Deal:
    """A pooled (or solo) sale run through the full journey with standard timings.

    ``start`` is the day (relative to today) the coordinator builds the lot; harvests are listed
    two days before, the offer arrives the next day, transport is booked the day after and the
    pickup happens on ``start + 3`` unless ``pickup`` is given.
    """

    crop: str
    point: str
    buyer: str
    members: tuple[tuple[str, int], ...]
    start: int
    payment_days: int
    premium: float
    destination: str | None = None
    terms: PickupTerms = "mandimate_delivery"
    flow: Literal["direct", "counter", "counter_back"] = "direct"
    competitor: tuple[str, str, float] | None = None
    """(buyer key, destination key or "" for buyer pickup, price delta ₹/kg)."""
    transporter: str = "swift"
    runner_up: str | None = "rayalaseema"
    rejection: tuple[float, float] = (1.5, 5.0)
    late_days: int = 0
    split_payment: bool = False
    demand: str | None = None
    handling: Decimal = Decimal("0")
    pickup: int | None = None
    grade: Grade = "A"
    quality_spec: str | None = None
    quantity_dispute: bool = False
    outcome_overrides: dict[str, tuple[int, int, str | None]] = field(default_factory=dict)
    """farmer key → (shortage kg, rejected kg, reason) instead of random outcomes."""


def _offset(clock: Clock, day: date) -> int:
    return (day - clock.today).days


def buyer_pickup_place(point: Place) -> Place:
    return Place(
        f"Buyer collects at {point.name}",
        point.latitude,
        point.longitude,
        point.district,
        point.state,
    )


def _payment_reference(rng, prefix: str) -> str:
    return f"{prefix} {rng.randint(10**11, 10**12 - 1)}"


def _explanation(world: World, lot: Lot, point: Place) -> str:
    members = world.active_members(lot)
    crop = CROP_SPECS[world.crop_code_of(lot.crop_id)].name.lower()
    farthest = max((m.distance_km or Decimal(0)) for m in members) if members else Decimal(0)
    total = world.lot_total(lot)
    text = (
        f"{len(members)} grade {lot.grade} {crop} harvests within {farthest} km of {point.name}, "
        f"all fresh enough for pickup on {day_text(lot.pickup_date)}: {kg_text(total)} pooled"
    )
    demand = world.demand_by_id(lot.demand_id)
    if demand is not None:
        buyer = next(u for u in world.users.values() if u.id == demand.buyer_id)
        text += f" against {world.org(buyer)}'s {kg_text(demand.quantity_kg)} requirement"
    return text + ". Grades are never mixed and no farm is more than 40 km away."


# ─────────────────────────────── people ───────────────────────────────


def _people(world: World) -> None:
    clock = world.clock
    world.add_fpo(FPO_NAME, DISTRICT_ANNAMAYYA, STATE_AP, clock.at(-232, 11))
    madanapalle = VILLAGES["Madanapalle"]

    admin = world.add_user(
        "admin",
        "admin",
        "Arjun Mehta",
        email="admin@mandimate.demo",
        phone="+919876500200",
        organization="MandiMate",
        district="Bengaluru Urban",
        state=STATE_KA,
        created_at=clock.at(-240, 10),
        last_login_at=clock.ago(5),
    )
    world.audit(admin.created_at, admin, "auth.signup", "user", admin.id, "Platform admin created")
    coordinator = world.add_user(
        "coordinator",
        "coordinator",
        "Sravani Naidu",
        email="coordinator@madanapallefpo.demo",
        phone="+919876500100",
        organization=FPO_NAME,
        place=madanapalle,
        in_fpo=True,
        verification_note="FPO registration and board resolution checked",
        created_at=clock.at(-232, 11),
        last_login_at=clock.ago(1),
    )
    world.audit(
        coordinator.created_at,
        coordinator,
        "auth.signup",
        "user",
        coordinator.id,
        f"Coordinator signup; created FPO {FPO_NAME}",
    )

    buyers = (
        (
            "freshbasket",
            "Deepa Raghavan",
            "procurement@freshbasket.demo",
            "+919876500110",
            "FreshBasket Retail",
            Place("Hoskote", 13.0707, 77.7982, "Bengaluru Rural", STATE_KA),
            "verified",
            "GSTIN 29AACCF4417M1ZP and FSSAI central licence checked",
            -226,
        ),
        (
            "annapurna",
            "Ramesh Iyengar",
            "kitchen@annapurna.demo",
            "+919876500111",
            "Annapurna Institutional Kitchens",
            Place("Tirupati", 13.6355, 79.4720, "Tirupati", STATE_AP),
            "verified",
            "GSTIN and FSSAI licence checked; trade references from two hostels",
            -219,
        ),
        (
            "trader",
            "Gangadhar Setty",
            "trader@venkateswara.demo",
            "+919876500112",
            "Sri Venkateswara Traders",
            Place("Madanapalle", 13.5565, 78.5005, DISTRICT_ANNAMAYYA, STATE_AP),
            "unverified",
            None,
            -150,
        ),
    )
    for key, name, email, phone, org, place, status, note, joined in buyers:
        user = world.add_user(
            key,
            "buyer",
            name,
            email=email,
            phone=phone,
            organization=org,
            place=place,
            verification=status,
            verification_note=note,
            documents_note=note,
            created_at=clock.at(joined, 12),
            last_login_at=clock.ago(3 if key != "trader" else 20),
        )
        world.audit(user.created_at, user, "auth.signup", "user", user.id, f"Buyer signup: {org}")
        if status == "verified":
            world.audit(
                clock.at(joined + 2, 15),
                admin,
                "user.verify",
                "user",
                user.id,
                f"Verified {org}: {note}",
            )

    transporters = (
        (
            "swift",
            "Mohammed Imran",
            "dispatch@swiftagri.demo",
            "+919876500120",
            "Swift Agri Logistics",
            madanapalle,
            "verified",
            "RC books, permits and insurance for 3 vehicles checked",
            -222,
        ),
        (
            "rayalaseema",
            "Nagaraju Yadav",
            "bookings@rayalaseemaroadways.demo",
            "+919876500121",
            "Rayalaseema Roadways",
            VILLAGES["Punganur"],
            "verified",
            "RC books, goods-carriage permits and insurance for 2 vehicles checked",
            -201,
        ),
        (
            "kolar",
            "Prakash Gowda",
            "ops@kolarfreshmovers.demo",
            "+919876500122",
            "Kolar Fresh Movers",
            Place("Kolar", 13.1367, 78.1292, "Kolar", STATE_KA),
            "pending",
            None,
            -4,
        ),
    )
    for key, name, email, phone, org, place, status, note, joined in transporters:
        user = world.add_user(
            key,
            "transporter",
            name,
            email=email,
            phone=phone,
            organization=org,
            place=place,
            verification=status,
            verification_note=note,
            documents_note=(
                note
                if status == "verified"
                else "RC book KA08A4417, national goods permit and PAN uploaded"
            ),
            created_at=clock.at(joined, 9),
            last_login_at=clock.ago(2 if key == "swift" else 9),
        )
        world.audit(
            user.created_at, user, "auth.signup", "user", user.id, f"Transporter signup: {org}"
        )
        if status == "verified":
            world.audit(
                clock.at(joined + 1, 16),
                admin,
                "user.verify",
                "user",
                user.id,
                f"Verified {org}: {note}",
            )

    for index, (key, name, village, language, email, phone) in enumerate(FARMERS):
        place = VILLAGES[village]
        latitude, longitude = jitter(place.latitude, place.longitude, stable_rng("farm", key))
        self_signup = email is not None
        joined = -214 + index * 2
        user = world.add_user(
            key,
            "farmer",
            name,
            email=email,
            phone=phone,
            language=language,
            place=place,
            latitude=latitude,
            longitude=longitude,
            in_fpo=True,
            created_by=None if self_signup else coordinator,
            created_at=clock.at(joined, 10 + index % 7),
            last_login_at=clock.ago(1.5 + index) if self_signup else None,
        )
        if self_signup:
            world.audit(
                user.created_at, user, "auth.signup", "user", user.id, f"Farmer signup: {name}"
            )
        else:
            world.audit(
                user.created_at,
                coordinator,
                "farmer.register",
                "user",
                user.id,
                f"Registered {name} ({village}) by phone; temporary password handed over in person",
            )


def _vehicles(world: World) -> None:
    clock = world.clock
    for transporter, vehicle_type, registration, capacity, base, rate, joined in (
        ("swift", "mini_truck", "AP39TA4521", 750, "600", "18", -221),
        ("swift", "pickup", "AP39UB7788", 1500, "900", "24", -221),
        ("swift", "light_truck", "AP39TX3310", 3500, "1500", "32", -180),
        ("rayalaseema", "pickup", "AP03TE1122", 1500, "850", "23", -200),
        ("rayalaseema", "medium_truck", "AP03TF9090", 9000, "2400", "44", -200),
        ("kolar", "pickup", "KA08A4417", 1500, "950", "25", -4),
    ):
        world.add_vehicle(
            transporter,
            vehicle_type,
            registration,
            capacity,
            Decimal(base),
            Decimal(rate),
            clock.at(joined, 17),
        )


# ─────────────────────────────── demands ───────────────────────────────


def _demands(world: World) -> None:
    clock = world.clock
    hoskote = DESTINATIONS["fb_hoskote"]
    fb_local = DESTINATIONS["fb_madanapalle"]
    tirupati = DESTINATIONS["annapurna_tirupati"]
    yard = DESTINATIONS["venkateswara_yard"]
    tomato_spec = "Grade A: firm, uniformly red, 60–80 g, packed in 25 kg crates"
    specs = (
        # key, buyer, crop, kg, min, target ₹, destination, needed_by, days, created_at, spec, notes
        (
            "fb_tomato_hist",
            "freshbasket",
            "TOM",
            1850,
            1600,
            "16.5",
            hoskote,
            -66,
            7,
            clock.at(-71, 9),
            tomato_spec,
            None,
        ),
        (
            "vt_cabbage_hist",
            "trader",
            "CAB",
            1100,
            900,
            "9.5",
            yard,
            -26,
            1,
            clock.at(-31, 18),
            "Compact heads, 1 kg and above",
            None,
        ),
        (
            "an_tomato_hist",
            "annapurna",
            "TOM",
            1370,
            1200,
            "16",
            tirupati,
            -18,
            10,
            clock.at(-23, 10),
            tomato_spec,
            None,
        ),
        (
            "an_onion",
            "annapurna",
            "ONI",
            1550,
            1400,
            "28",
            tirupati,
            -8,
            10,
            clock.at(-13, 11),
            "Dark red, 50 mm and above, well cured",
            None,
        ),
        (
            "an_cabbage",
            "annapurna",
            "CAB",
            1000,
            800,
            "12",
            tirupati,
            -2,
            10,
            clock.at(-9, 10),
            "Compact heads, trimmed",
            None,
        ),
        (
            "fb_tomato_dispute",
            "freshbasket",
            "TOM",
            1150,
            1000,
            "16.5",
            hoskote,
            -5,
            7,
            clock.at(-10, 9),
            tomato_spec,
            None,
        ),
        (
            "an_brinjal",
            "annapurna",
            "BRN",
            700,
            600,
            "27",
            tirupati,
            2,
            10,
            clock.at(-5, 12),
            "Shiny purple, 150–200 g, no borer damage",
            None,
        ),
        (
            "fb_tomato_blr",
            "freshbasket",
            "TOM",
            1400,
            1200,
            "16.5",
            hoskote,
            1,
            7,
            clock.at(-6, 9),
            tomato_spec,
            "Dock open 6 am – 2 pm",
        ),
        (
            "fb_onion_blr",
            "freshbasket",
            "ONI",
            2600,
            2000,
            "29",
            hoskote,
            3,
            7,
            clock.at(-4, 10),
            "Dark red, 50–65 mm, cured, 50 kg mesh bags",
            "Dock open 6 am – 2 pm",
        ),
        (
            "an_tomato",
            "annapurna",
            "TOM",
            2000,
            1500,
            "16",
            tirupati,
            5,
            10,
            clock.at(-4, 15),
            tomato_spec,
            "Delivery before 11 am for the lunch shift",
        ),
        (
            "fb_tomato_local",
            "freshbasket",
            "TOM",
            1200,
            1000,
            "16",
            fb_local,
            2,
            7,
            clock.ago(40),
            tomato_spec,
            "Cross-docked to our Bengaluru stores the same night",
        ),
        (
            "fb_chilli_local",
            "freshbasket",
            "CHI",
            450,
            400,
            "37",
            fb_local,
            4,
            7,
            clock.ago(30),
            "Glossy green, 8–10 cm, stalks on",
            None,
        ),
        (
            "an_banana",
            "annapurna",
            "BAN",
            500,
            400,
            "28",
            tirupati,
            6,
            10,
            clock.ago(50),
            "Grand Naine, 75% maturity",
            None,
        ),
        (
            "fb_okra_blr",
            "freshbasket",
            "OKR",
            300,
            240,
            "33",
            hoskote,
            3,
            7,
            clock.ago(20),
            "Tender 8–12 cm pods, harvested the day before dispatch",
            None,
        ),
        (
            "vt_tomato_b",
            "trader",
            "TOM",
            1500,
            1000,
            "12.5",
            yard,
            3,
            1,
            clock.ago(14),
            "Grade B accepted, sorted at the yard",
            "We collect from the yard; payment next day",
        ),
    )
    for (
        key,
        buyer,
        crop,
        quantity,
        minimum,
        target,
        destination,
        needed,
        days,
        at,
        spec,
        notes,
    ) in specs:
        world.add_demand(
            key,
            buyer,
            crop,
            quantity,
            min_quantity=minimum,
            target_price=Decimal(target),
            destination=destination,
            needed_by=clock.day(needed),
            payment_days=days,
            at=at,
            grade="B" if key == "vt_tomato_b" else "A",
            quality_spec=spec,
            notes=notes,
        )


# ─────────────────────────────── deals ───────────────────────────────


def _deal_price(world: World, deal: Deal) -> Decimal:
    clock = world.clock
    market = modal_price(deal.crop, MADANAPALLE, clock.day(deal.start + 1), clock.today)
    return round_to_step(market * Decimal(str(deal.premium)), QUARTER)


async def run_deal(
    world: World,
    deal: Deal,
    *,
    until: Stage = "settled",
    picks: list[datetime] | None = None,
    pickup_date: date | None = None,
) -> tuple[Lot, Offer]:
    """Run ``deal`` through the journey up to ``until`` with realistic timings."""
    clock = world.clock
    coordinator = world.coordinator
    buyer = world.users[deal.buyer]
    rng = stable_rng("deal", deal.crop, deal.start, deal.buyer)
    d0 = deal.start
    pickup = pickup_date or clock.day(deal.pickup if deal.pickup is not None else d0 + 3)
    point = POINTS[deal.point]
    demand = world.demands.get(deal.demand) if deal.demand else None
    price = _deal_price(world, deal)

    harvest_date = pickup - timedelta(days=1)
    harvests = []
    for index, (farmer_key, quantity) in enumerate(deal.members):
        farmer = world.users[farmer_key]
        harvests.append(
            world.add_harvest(
                farmer_key,
                deal.crop,
                quantity,
                harvest_date=harvest_date,
                grade=deal.grade,
                quality="inspected",
                created_at=clock.at(d0 - 2, 8 + (index * 3) % 11, rng.randint(0, 59)),
                min_price=(
                    round_to_step(price * Decimal("0.7"), QUARTER)
                    if farmer.email and rng.random() < 0.6
                    else None
                ),
            )
        )

    lot = await world.create_lot(
        deal.crop,
        deal.grade,
        point,
        pickup,
        clock.at(d0, 10, 30),
        demand=demand,
        target_kg=int(demand.quantity_kg) if demand else None,
    )
    for harvest, (_, quantity) in zip(harvests, deal.members, strict=True):
        world.add_member(lot, harvest, quantity, consent="pending", at=lot.created_at)
    lot.match_explanation = _explanation(world, lot, point)
    world.invite_members(lot, lot.created_at)
    for index, member in enumerate(list(lot.members)):
        farmer = world.farmer_of(member)
        world.lot_consent(
            lot,
            member,
            "accepted",
            clock.at(d0, 12 + index, rng.randint(0, 59)),
            assisted=farmer.email is None and rng.random() < 0.5,
        )

    if deal.terms == "mandimate_delivery":
        assert deal.destination is not None
        destination = DESTINATIONS[deal.destination]
    else:
        destination = buyer_pickup_place(point)
    opening = {"direct": Decimal(0), "counter": Decimal("0.50"), "counter_back": Decimal("1.00")}
    offer = await world.make_offer(
        deal.buyer,
        lot=lot,
        at=clock.at(d0 + 1, 9, 30),
        price=price - opening[deal.flow],
        terms=deal.terms,
        destination=destination,
        payment_days=deal.payment_days,
        handling=deal.handling,
        demand=demand,
        quality_spec=deal.quality_spec or (demand.quality_spec if demand else None),
        message=f"For {destination.name.split(',')[0]}; payment in {deal.payment_days} days.",
    )
    if deal.competitor is not None:
        rival_key, rival_destination, delta = deal.competitor
        await world.make_offer(
            rival_key,
            lot=lot,
            at=clock.at(d0 + 1, 11, 0),
            price=price + Decimal(str(delta)),
            terms="mandimate_delivery" if rival_destination else "buyer_pickup",
            destination=DESTINATIONS[rival_destination]
            if rival_destination
            else buyer_pickup_place(point),
            payment_days=BUYER_PAYMENT_DAYS[rival_key],
            handling=Decimal("0.50") if not rival_destination else Decimal("0"),
        )
    if deal.flow == "direct":
        world.accept(offer, coordinator, clock.at(d0 + 1, 16, 0), message="Good price for the pool")
    elif deal.flow == "counter":
        world.counter(
            offer,
            coordinator,
            price,
            clock.at(d0 + 1, 13, 0),
            message="Inspected grade A from one shed; please meet us here.",
        )
        world.accept(offer, buyer, clock.at(d0 + 1, 17, 0), message="Agreed")
    else:
        world.counter(
            offer,
            coordinator,
            price + Decimal("0.50"),
            clock.at(d0 + 1, 12, 0),
            message="Mandi modal is up this week and the lot is inspected.",
        )
        world.counter(
            offer, buyer, price, clock.at(d0 + 1, 15, 0), message="Meet you in the middle."
        )
        world.accept(
            offer, coordinator, clock.at(d0 + 1, 17, 0), message="Done, sending to farmers"
        )

    consent_start = clock.at(d0 + 1, 18, 0)
    for index, member in enumerate(world.active_members(lot)):
        farmer = world.farmer_of(member)
        world.offer_consent(
            offer,
            member,
            "accepted",
            consent_start + timedelta(minutes=35 * index + rng.randint(0, 20)),
            assisted=farmer.email is None and rng.random() < 0.5,
        )
    if until == "accepted":
        return lot, offer

    far = deal.destination is not None and deal.destination not in LOCAL_DESTINATIONS
    if deal.terms == "mandimate_delivery":
        request = world.create_transport_request(
            lot, clock.at(d0 + 2, 9, 0), notes="Crates at every farm; first pickup at 6 am"
        )
        winner = world.quote(
            request,
            deal.transporter,
            world.suggested_price(request, rng.uniform(0.9, 0.99)),
            clock.at(d0 + 2, 11, rng.randint(0, 59)),
            notes="Driver knows the cluster; tarpaulin and crates on board",
        )
        if deal.runner_up:
            world.quote(
                request,
                deal.runner_up,
                world.suggested_price(request, rng.uniform(1.03, 1.12)),
                clock.at(d0 + 2, 12, 40),
            )
        if until == "quoted":
            return lot, offer
        world.book(request, winner, clock.at(d0 + 2, 16, 0))
        if until == "booked":
            return lot, offer
        times = picks or [
            clock.on(pickup, 6, 0) + timedelta(minutes=50 * index)
            for index in range(len(request.stops))
        ]
        for stop, picked_at in zip(request.stops, times, strict=False):
            world.pickup(request, stop, int(stop.quantity_kg) - rng.randint(0, 3), picked_at)
        if until == "in_transit":
            return lot, offer
        arrival = clock.on(pickup, 13 if far else 10, 30)
        world.complete_trip(request, arrival, "Delivered and unloaded at the buyer's dock")
        delivered_at = arrival + timedelta(minutes=90)
    else:
        delivered_at = clock.on(pickup, 9, 30)

    outcomes = {}
    for member in world.active_members(lot):
        key = next(k for k, u in world.users.items() if u.id == member.farmer_id)
        if key in deal.outcome_overrides:
            shortage, rejected, reason = deal.outcome_overrides[key]
            dispatched = int(member.dispatched_kg or member.quantity_kg)
            outcomes[member.id] = (dispatched - shortage, dispatched - shortage - rejected, reason)
        else:
            outcomes[member.id] = world.outcome(
                member,
                rng,
                rejection_pct=deal.rejection,
                max_shortage=4 if far else (0 if deal.terms == "buyer_pickup" else 1),
            )
    recorder = buyer if deal.terms == "mandimate_delivery" else coordinator
    inspector = {
        "freshbasket": "Mallikarjun S. (FreshBasket QC)",
        "annapurna": "Kavitha R. (stores in-charge)",
        "trader": "Gangadhar Setty",
    }[deal.buyer]
    world.record_delivery(
        lot,
        delivered_at,
        recorded_by=recorder,
        outcomes=outcomes,
        inspector=inspector,
        notes="Weighed on the dock scale; rejects returned to the pool's account"
        if far
        else "Weighed and sorted on arrival",
    )
    settlement = await world.create_settlement(lot, delivered_at)
    if deal.quantity_dispute:
        await _quantity_dispute(world, lot, settlement, delivered_at)
    if until == "delivered":
        return lot, offer
    _pay_and_close(world, deal, settlement, rng)
    return lot, offer


def _pay_and_close(world: World, deal: Deal, settlement: Settlement, rng) -> None:
    clock = world.clock
    buyer = world.users[deal.buyer]
    pay_day = settlement.due_date + timedelta(days=deal.late_days)
    if deal.late_days == 0 and deal.payment_days > 2:
        pay_day -= timedelta(days=rng.randint(0, 1))
    final_at = clock.on(pay_day, 11, 15)
    prefix = "UPI" if deal.buyer == "trader" else "NEFT"
    if deal.split_payment:
        first = round_money(settlement.gross_amount / 2)
        world.record_payment(
            settlement,
            first,
            final_at - timedelta(days=3),
            by=buyer,
            reference=_payment_reference(rng, prefix),
        )
        world.record_payment(
            settlement,
            settlement.gross_amount - first,
            final_at,
            by=buyer,
            reference=_payment_reference(rng, prefix),
        )
    else:
        world.record_payment(
            settlement,
            settlement.gross_amount,
            final_at,
            by=buyer,
            reference=_payment_reference(rng, prefix),
        )
    payout_start = clock.on(pay_day + timedelta(days=1), 10, 0)
    for index, payout in enumerate(settlement.payouts):
        world.mark_payout_paid(
            settlement,
            payout,
            payout_start + timedelta(minutes=12 * index),
            _payment_reference(rng, "UPI"),
        )


async def _quantity_dispute(world: World, lot: Lot, settlement: Settlement, delivered_at) -> None:
    """The resolved dispute: a weighbridge shortage that the terms already cover."""
    members = world.active_members(lot)
    dispatched = sum((m.dispatched_kg for m in members), Decimal(0))
    delivered = sum((m.delivered_kg for m in members), Decimal(0))
    buyer = world.buyer_of(lot.accepted_offer)
    dispute = await world.raise_dispute(
        lot,
        buyer,
        "quantity",
        f"Our Hoskote weighbridge shows {kg_text(delivered)} against {kg_text(dispatched)} "
        "dispatched. Please confirm we are billed on accepted weight and not on dispatch weight.",
        delivered_at + timedelta(hours=18),
    )
    world.update_dispute(dispute, "under_review", delivered_at + timedelta(hours=22))
    world.update_dispute(
        dispute,
        "resolved",
        delivered_at + timedelta(days=2, hours=3),
        resolution=(
            f"Confirmed: billing is on the {kg_text(settlement.total_accepted_kg)} accepted at "
            f"delivery, as per the offer terms. The {kg_text(dispatched - delivered)} transit "
            "loss is within the 2% tolerance and is borne by the pool. No change to the settlement."
        ),
    )


HISTORY: tuple[Deal, ...] = (
    Deal("TOM", "kurabalakota_shed", "freshbasket", (("ravi", 450), ("venkatesh", 380), ("govindamma", 300), ("krishnaiah", 320)), -168, 7, 1.16, "fb_hoskote", transporter="swift", runner_up="rayalaseema"),
    Deal("CHI", "kurabalakota_shed", "freshbasket", (("ravi", 260), ("padmavathi", 220), ("sujatha", 200)), -152, 7, 1.09, "fb_madanapalle", transporter="swift", runner_up=None, rejection=(3, 6)),
    Deal("TOM", "madanapalle_yard", "freshbasket", (("ravi", 480), ("lakshmi", 330), ("bhaskar", 380), ("venkatesh", 290)), -126, 7, 1.15, "fb_hoskote", flow="counter", competitor=("annapurna", "annapurna_tirupati", -0.75), transporter="rayalaseema", runner_up="swift"),
    Deal("ONI", "thamballapalle_shed", "annapurna", (("mahaboob", 900), ("khaja", 700), ("sujatha", 600), ("harikrishna", 800)), -112, 10, 1.12, "annapurna_tirupati", flow="counter", transporter="swift", runner_up="rayalaseema", rejection=(1, 3)),
    Deal("TOM", "kurabalakota_shed", "annapurna", (("ravi", 420), ("govindamma", 350), ("krishnaiah", 330), ("sujatha", 300)), -98, 10, 1.13, "annapurna_tirupati", competitor=("freshbasket", "fb_hoskote", -0.5), transporter="rayalaseema", runner_up="swift", late_days=3),
    Deal("BRN", "punganur_centre", "freshbasket", (("lakshmi", 320), ("bhaskar", 300), ("saraswathi", 260)), -84, 7, 1.09, "fb_madanapalle", transporter="rayalaseema", runner_up=None, rejection=(3, 6)),
    Deal("TOM", "thamballapalle_shed", "freshbasket", (("sreenivasulu", 420), ("rajeswari", 350), ("chandrasekhar", 400), ("khaja", 300), ("ravi", 380)), -70, 7, 1.17, "fb_hoskote", flow="counter_back", transporter="swift", runner_up="rayalaseema", demand="fb_tomato_hist", split_payment=True),
    Deal("OKR", "kurabalakota_shed", "freshbasket", (("krishnaiah", 280), ("padmavathi", 240), ("govindamma", 220)), -56, 7, 1.08, "fb_madanapalle", transporter="swift", runner_up=None, rejection=(3, 7)),
    Deal("TOM", "madanapalle_yard", "freshbasket", (("ravi", 460), ("lakshmi", 300), ("venkatesh", 380), ("bhaskar", 350)), -42, 7, 1.15, "fb_hoskote", competitor=("trader", "", -1.5), transporter="swift", runner_up="rayalaseema", quantity_dispute=True),
    Deal("CAB", "thamballapalle_shed", "trader", (("harikrishna", 600), ("sujatha", 500)), -30, 1, 1.0, terms="buyer_pickup", handling=Decimal("0.50"), demand="vt_cabbage_hist", rejection=(1.5, 4)),
    Deal("TOM", "kurabalakota_shed", "annapurna", (("ravi", 400), ("govindamma", 330), ("krishnaiah", 360), ("venkatesh", 280)), -22, 10, 1.13, "annapurna_tirupati", flow="counter", transporter="rayalaseema", runner_up="swift", demand="an_tomato_hist"),
)  # fmt: skip


async def _solo_history(world: World) -> None:
    """Lakshmi accepted a direct trader offer: a solo lot, buyer pickup, paid the next day."""
    clock = world.clock
    d0 = -140
    rng = stable_rng("solo", d0)
    harvest = world.add_harvest(
        "lakshmi",
        "TOM",
        300,
        harvest_date=clock.day(d0 + 1),
        quality="self_reported",
        created_at=clock.at(d0, 8, 40),
        min_price=Decimal("11"),
    )
    price = round_to_step(
        modal_price("TOM", MADANAPALLE, clock.day(d0), clock.today) * Decimal("1.01"), QUARTER
    )
    farm = Place(
        "Buyer collects at the farm gate, Punganur",
        harvest.latitude,
        harvest.longitude,
        harvest.district or DISTRICT_CHITTOOR,
        STATE_AP,
    )
    offer = await world.make_offer(
        "trader",
        harvest=harvest,
        at=clock.at(d0, 13, 10),
        price=price,
        terms="buyer_pickup",
        destination=farm,
        payment_days=1,
        handling=Decimal("0.50"),
        message="We collect tomorrow 7 am; hamali ₹0.50/kg; UPI the next day.",
    )
    lot = await world.accept_direct(
        offer, clock.at(d0, 18, 5), pickup_date=clock.day(d0 + 1), message="OK, ready by 7 am"
    )
    member = lot.members[0]
    delivered, accepted, reason = world.outcome(member, rng, rejection_pct=(2, 4), max_shortage=0)
    world.record_delivery(
        lot,
        clock.at(d0 + 1, 8, 10),
        recorded_by=world.users["trader"],
        outcomes={member.id: (delivered, accepted, reason)},
        inspector="Gangadhar Setty",
        notes="Sorted and weighed at the farm gate",
    )
    settlement = await world.create_settlement(lot, clock.at(d0 + 1, 8, 10))
    world.record_payment(
        settlement,
        settlement.gross_amount,
        clock.at(d0 + 2, 10, 30),
        by=world.users["trader"],
        reference=_payment_reference(rng, "UPI"),
    )
    world.mark_payout_paid(
        settlement,
        settlement.payouts[0],
        clock.at(d0 + 2, 15, 0),
        _payment_reference(rng, "UPI"),
    )


async def _expired_offer(world: World) -> None:
    """A trader's lowball direct offer that lapsed unanswered; the listing then expired."""
    clock = world.clock
    harvest = world.add_harvest(
        "rajeswari",
        "TOM",
        250,
        harvest_date=clock.day(-62),
        quality="self_reported",
        created_at=clock.at(-64, 9, 15),
    )
    offer = await world.make_offer(
        "trader",
        harvest=harvest,
        at=clock.at(-64, 16, 0),
        price=Decimal("12.50"),
        terms="buyer_pickup",
        destination=Place(
            "Buyer collects at the farm gate, Thamballapalle",
            harvest.latitude,
            harvest.longitude,
            DISTRICT_ANNAMAYYA,
            STATE_AP,
        ),
        payment_days=1,
        handling=Decimal("0.50"),
        valid_until=clock.at(-63, 18, 0),
    )
    world.expire(offer)


# ─────────────────────────────── pipeline ───────────────────────────────


async def _pipeline(world: World) -> None:
    clock = world.clock

    # delivered · partially paid: onions at Annapurna's Tirupati kitchen
    lot, _ = await run_deal(
        world,
        Deal(
            "ONI",
            "ramasamudram_cross",
            "annapurna",
            (("narasimhulu", 900), ("eswaramma", 650)),
            -12,
            10,
            1.12,
            "annapurna_tirupati",
            transporter="swift",
            runner_up="rayalaseema",
            demand="an_onion",
            rejection=(1, 3),
        ),
        until="delivered",
    )
    settlement = world.settlements[lot.id]
    world.record_payment(
        settlement,
        round_money(settlement.gross_amount * Decimal("0.6")),
        clock.at(-3, 12, 20),
        by=world.users["annapurna"],
        reference="NEFT 412233908871",
    )
    world.notify(
        clock.ago(3),
        [world.users["annapurna"]],
        "payment",
        f"Payment due tomorrow: {settlement.code}",
        f"{rupees(settlement.gross_amount - settlement.amount_paid)} outstanding for {lot.code} "
        f"(onions delivered on {day_text(world.clock.ist_date(lot.delivered_at))}).",
        "/app/buyer/payments",
    )

    # delivered · open quality dispute → settlement disputed
    lot, _ = await run_deal(
        world,
        Deal(
            "TOM",
            "thamballapalle_shed",
            "freshbasket",
            (("chandrasekhar", 420), ("rajeswari", 380), ("sreenivasulu", 350)),
            -9,
            7,
            1.16,
            "fb_hoskote",
            transporter="swift",
            runner_up="rayalaseema",
            demand="fb_tomato_dispute",
            outcome_overrides={"chandrasekhar": (2, 54, "Cracked or soft fruit")},
        ),
        until="delivered",
    )
    chandrasekhar = world.users["chandrasekhar"]
    member = next(m for m in lot.members if m.farmer_id == chandrasekhar.id)
    await world.raise_dispute(
        lot,
        chandrasekhar,
        "quality",
        f"{kg_text(member.rejected_kg)} of my {kg_text(member.delivered_kg)} were rejected for "
        "cracking. The fruit was firm and graded A at the Thamballapalle shed (Sravani inspected "
        "it) and the truck waited 6 hours at the Hoskote dock. Please review the QC photos before "
        "the rejection is deducted.",
        clock.at(-5, 9, 40),
    )

    await _cancelled_cabbage(world)

    # delivered · payment pending: local FreshBasket collection centre
    await run_deal(
        world,
        Deal(
            "TOM",
            "madanapalle_yard",
            "freshbasket",
            (("venkatesh", 280), ("narasimhulu", 300), ("eswaramma", 260)),
            -5,
            7,
            1.09,
            "fb_madanapalle",
            transporter="swift",
            runner_up=None,
            rejection=(1, 4),
        ),
        until="delivered",
    )

    # in transit: two of four stops picked this morning, bound for Hoskote
    first_pick = clock.ago(3)
    pickup_day = clock.ist_date(first_pick)
    in_transit, _ = await run_deal(
        world,
        Deal(
            "TOM",
            "punganur_centre",
            "freshbasket",
            (("lakshmi", 320), ("bhaskar", 400), ("anjaneyulu", 380), ("saraswathi", 300)),
            -5,
            7,
            1.16,
            "fb_hoskote",
            transporter="swift",
            runner_up="rayalaseema",
            demand="fb_tomato_blr",
            pickup=_offset(clock, pickup_day),
        ),
        until="in_transit",
        picks=[first_pick, clock.ago(2.2)],
    )
    request = world.requests[in_transit.id]
    picked = sum(1 for stop in request.stops if stop.status == "picked_up")
    for stop in request.stops:
        if stop.status == "pending":
            world.notify(
                clock.ago(2),
                [world.farmer_of(stop.member)],
                "pickup",
                "The truck is on its way",
                f"{picked} of {len(request.stops)} stops picked for {in_transit.code}. Swift Agri "
                f"Logistics reaches you next (stop {stop.sequence}); keep "
                f"{kg_text(stop.quantity_kg)} ready in crates.",
                f"/app/farmer/lots/{in_transit.id}",
            )

    # transport booked: brinjal for Annapurna, pickup tomorrow
    await run_deal(
        world,
        Deal(
            "BRN",
            "madanapalle_yard",
            "annapurna",
            (("padmavathi", 250), ("krishnaiah", 200), ("govindamma", 230)),
            -4,
            10,
            1.12,
            "annapurna_tirupati",
            transporter="rayalaseema",
            runner_up="swift",
            demand="an_brinjal",
            pickup=1,
        ),
        until="booked",
    )

    # offer accepted · transport request with two quotes to review
    await run_deal(
        world,
        Deal(
            "ONI",
            "thamballapalle_shed",
            "freshbasket",
            (("mahaboob", 900), ("khaja", 700), ("sujatha", 600), ("harikrishna", 400)),
            -3,
            7,
            1.13,
            "fb_hoskote",
            flow="counter",
            transporter="swift",
            runner_up="rayalaseema",
            demand="fb_onion_blr",
            pickup=1,
        ),
        until="quoted",
    )

    await _open_tomato_lot(world)
    await _forming_open_pool(world)
    await _ravis_scene(world)
    await _chilli_awaiting_consent(world)
    await _forming_trader_pool(world)


async def _cancelled_cabbage(world: World) -> None:
    clock = world.clock
    demand = world.demands["an_cabbage"]
    harvests = [
        world.add_harvest(
            key,
            "CAB",
            quantity,
            harvest_date=clock.day(-4),
            created_at=clock.at(-9, 9 + index, 10),
        )
        for index, (key, quantity) in enumerate((("harikrishna", 500), ("sujatha", 400)))
    ]
    point = POINTS["thamballapalle_shed"]
    lot = await world.create_lot(
        "CAB", "A", point, clock.day(-3), clock.at(-8, 10, 0), demand=demand, target_kg=1000
    )
    for harvest in harvests:
        world.add_member(lot, harvest, harvest.quantity_kg, consent="pending", at=lot.created_at)
    lot.match_explanation = _explanation(world, lot, point)
    world.invite_members(lot, lot.created_at)
    world.lot_consent(lot, lot.members[0], "accepted", clock.at(-8, 12, 5))
    world.lot_consent(lot, lot.members[1], "accepted", clock.at(-8, 15, 30), assisted=True)
    offer = await world.make_offer(
        "annapurna",
        lot=lot,
        at=clock.at(-7, 10, 0),
        price=Decimal("12.00"),
        terms="mandimate_delivery",
        destination=DESTINATIONS["annapurna_tirupati"],
        payment_days=10,
        demand=demand,
    )
    world.withdraw(
        offer, clock.at(-4, 11, 0), "Menu change at our kitchens; cabbage not needed this week"
    )
    world.set_demand_status(demand, "cancelled", clock.at(-4, 11, 5))
    world.cancel_lot(
        lot,
        clock.at(-4, 15, 0),
        "Annapurna Kitchens cancelled the cabbage requirement after a menu change; "
        "no other buyer offered in time.",
    )


async def _open_tomato_lot(world: World) -> None:
    """Open for offers: three buyers, one offer countered by the coordinator."""
    clock = world.clock
    coordinator = world.coordinator
    demand = world.demands["an_tomato"]
    point = POINTS["thamballapalle_shed"]
    plan = (
        ("sreenivasulu", 380, "inspected"),
        ("rajeswari", 400, "inspected"),
        ("chandrasekhar", 350, "inspected"),
        ("khaja", 320, "pending_inspection"),
        ("harikrishna", 450, "inspected"),
        ("mahaboob", 300, "inspected"),
    )
    harvests = [
        world.add_harvest(
            key,
            "TOM",
            quantity,
            harvest_date=clock.day(1),
            quality=quality,
            created_at=clock.ago(100 - 2 * index),
            min_price=Decimal("12.5") if key == "harikrishna" else None,
        )
        for index, (key, quantity, quality) in enumerate(plan)
    ]
    lot = await world.create_lot(
        "TOM", "A", point, clock.day(2), clock.ago(75), demand=demand, target_kg=2000
    )
    for harvest in harvests:
        world.add_member(lot, harvest, harvest.quantity_kg, consent="pending", at=lot.created_at)
    lot.match_explanation = _explanation(world, lot, point)
    world.invite_members(lot, lot.created_at)
    for index, member in enumerate(lot.members[:5]):
        farmer = world.farmer_of(member)
        world.lot_consent(
            lot, member, "accepted", clock.ago(70 - 4 * index), assisted=farmer.email is None
        )
    world.open_lot(lot, clock.ago(48), by=coordinator)
    world.notify(
        clock.ago(47),
        [world.users["annapurna"], world.users["freshbasket"]],
        "lot",
        "New supply matching your requirement",
        f"{lot.code}: {kg_text(world.lot_total(lot))} of inspected grade A tomatoes at "
        f"{point.name}, pickup {day_text(lot.pickup_date)}. Open for offers.",
        "/app/buyer/supply",
    )

    await world.make_offer(
        "trader",
        lot=lot,
        at=clock.ago(40),
        price=Decimal("14.50"),
        terms="buyer_pickup",
        destination=buyer_pickup_place(point),
        payment_days=1,
        handling=Decimal("0.50"),
        valid_until=clock.ahead(54),
        message="We pick up from the shed; cash or UPI the next day.",
    )
    freshbasket = await world.make_offer(
        "freshbasket",
        lot=lot,
        at=clock.ago(30),
        price=Decimal("16.00"),
        terms="mandimate_delivery",
        destination=DESTINATIONS["fb_hoskote"],
        payment_days=7,
        valid_until=clock.ahead(66),
        quality_spec="Grade A: firm, uniformly red, 60–80 g",
        message="Delivered to Hoskote by Thursday 2 pm.",
    )
    world.counter(
        freshbasket,
        coordinator,
        Decimal("17.00"),
        clock.ago(10),
        message="Inspected grade A from Thamballapalle; ₹17.00 delivered to Hoskote covers the "
        "longer haul for the pool.",
    )
    await world.make_offer(
        "annapurna",
        lot=lot,
        at=clock.ago(6),
        price=Decimal("15.50"),
        terms="mandimate_delivery",
        destination=DESTINATIONS["annapurna_tirupati"],
        payment_days=10,
        demand=demand,
        valid_until=clock.ahead(90),
        message="For our Tirupati kitchens; delivery before 11 am.",
    )


async def _ravis_scene(world: World) -> None:
    """The brief: 400 kg ready tomorrow, a ₹14 direct trader offer and a ₹16 pooled deal."""
    clock = world.clock
    coordinator = world.coordinator
    ravi_harvest = world.add_harvest(
        "ravi",
        "TOM",
        400,
        harvest_date=clock.day(1),
        sell_by=clock.day(5),
        quality="pending_inspection",
        source="voice",
        min_price=Decimal("12"),
        variety="Arka Rakshak",
        notes="Firm and red, picking tomorrow morning. Inspection requested at the collection shed",
        created_at=clock.ago(50),
    )
    ravi_farm = Place(
        "Buyer collects at the farm gate, Kurabalakota",
        ravi_harvest.latitude,
        ravi_harvest.longitude,
        DISTRICT_ANNAMAYYA,
        STATE_AP,
    )
    await world.make_offer(
        "trader",
        harvest=ravi_harvest,
        at=clock.ago(44),
        price=Decimal("14.00"),
        quantity=400,
        terms="buyer_pickup",
        destination=ravi_farm,
        payment_days=1,
        max_rejection=Decimal("10"),
        handling=Decimal("0.50"),
        valid_until=clock.ahead(60),
        quality_spec="Red and firm; we sort at the farm",
        message="We collect from your farm tomorrow morning. Hamali ₹0.50/kg; UPI the next day.",
    )

    demand = world.demands["fb_tomato_local"]
    neighbours = (
        ("venkatesh", 350, "inspected", 60),
        ("govindamma", 280, "inspected", 56),
        ("krishnaiah", 220, "self_reported", 58),
    )
    harvests = [ravi_harvest] + [
        world.add_harvest(
            key,
            "TOM",
            quantity,
            harvest_date=clock.day(1),
            quality=quality,
            created_at=clock.ago(hours),
        )
        for key, quantity, quality, hours in neighbours
    ]
    point = POINTS["kurabalakota_shed"]
    lot = await world.create_lot(
        "TOM", "A", point, clock.day(1), clock.ago(30), demand=demand, target_kg=1200
    )
    for harvest in harvests:
        world.add_member(lot, harvest, harvest.quantity_kg, consent="pending", at=lot.created_at)
    lot.match_explanation = _explanation(world, lot, point)
    world.invite_members(lot, lot.created_at)
    ravi_member, venkatesh_member, govindamma_member, krishnaiah_member = lot.members
    world.lot_consent(lot, ravi_member, "accepted", clock.ago(26))
    world.lot_consent(lot, venkatesh_member, "accepted", clock.ago(24), assisted=True)
    world.lot_consent(lot, govindamma_member, "accepted", clock.ago(22), assisted=True)
    world.lot_consent(lot, krishnaiah_member, "accepted", clock.ago(20), assisted=True)

    freshbasket = world.users["freshbasket"]
    offer = await world.make_offer(
        "freshbasket",
        lot=lot,
        at=clock.ago(18),
        price=Decimal("15.00"),
        terms="mandimate_delivery",
        destination=DESTINATIONS["fb_madanapalle"],
        payment_days=7,
        max_rejection=Decimal("5"),
        demand=demand,
        valid_until=clock.ahead(72),
        quality_spec="Grade A: firm, uniformly red, 60–80 g, 25 kg crates",
        message="We can take the whole pool at our Madanapalle collection centre.",
    )
    world.counter(
        offer,
        coordinator,
        Decimal("16.50"),
        clock.ago(8),
        message="Mandi modal is ₹14 today and this pool saves you four separate pickups.",
    )
    world.counter(
        offer,
        freshbasket,
        Decimal("16.00"),
        clock.ago(5),
        message="₹16.00 is our best this week, paid in 7 days.",
    )
    world.accept(
        offer, coordinator, clock.ago(4), message="Accepted for the pool, subject to consent"
    )
    world.offer_consent(offer, venkatesh_member, "accepted", clock.ago(3), assisted=True)
    world.offer_consent(offer, govindamma_member, "accepted", clock.ago(2.5), assisted=True)
    world.offer_consent(offer, krishnaiah_member, "accepted", clock.ago(1.5), assisted=True)


async def _chilli_awaiting_consent(world: World) -> None:
    clock = world.clock
    demand = world.demands["fb_chilli_local"]
    plan = (
        ("ravi", 180, "self_reported", 70),
        ("sujatha", 150, "inspected", 80),
        ("padmavathi", 120, "self_reported", 66),
    )
    harvests = [
        world.add_harvest(
            key,
            "CHI",
            quantity,
            harvest_date=clock.day(2),
            quality=quality,
            created_at=clock.ago(hours),
            min_price=Decimal("30") if key == "ravi" else None,
        )
        for key, quantity, quality, hours in plan
    ]
    point = POINTS["kurabalakota_shed"]
    lot = await world.create_lot(
        "CHI", "A", point, clock.day(3), clock.ago(20), demand=demand, target_kg=450
    )
    for harvest in harvests:
        world.add_member(lot, harvest, harvest.quantity_kg, consent="pending", at=lot.created_at)
    lot.match_explanation = _explanation(world, lot, point)
    world.invite_members(lot, lot.created_at)
    world.lot_consent(lot, lot.members[1], "accepted", clock.ago(16), assisted=True)


async def _forming_open_pool(world: World) -> None:
    clock = world.clock
    await world.create_lot(
        "TOM",
        "A",
        POINTS["punganur_centre"],
        clock.day(3),
        clock.ago(30),
        target_kg=1500,
        explanation="Open pool for grade A tomatoes near Punganur, ready by "
        f"{day_text(clock.day(3))}. Join with any quantity; the coordinator looks for a buyer "
        "once 1,000 kg are pooled.",
    )


async def _forming_trader_pool(world: World) -> None:
    clock = world.clock
    await world.create_lot(
        "TOM",
        "B",
        POINTS["madanapalle_yard"],
        clock.day(3),
        clock.ago(12),
        demand=world.demands["vt_tomato_b"],
        target_kg=1500,
        explanation="Open pool for grade B tomatoes for Sri Venkateswara Traders' 1,500 kg "
        "requirement at the Madanapalle yard.",
    )


# ─────────────────────────────── listings ───────────────────────────────


def _listings(world: World) -> None:
    """Harvests still on the market, plus a draft, a cancelled and an expired listing."""
    clock = world.clock
    entries = (
        # farmer, crop, kg, grade, quality, harvest day, hours ago, extras
        ("lakshmi", "TOM", 250, "A", "self_reported", 1, 20, {"min_price": Decimal("11.5")}),
        ("eswaramma", "TOM", 320, "A", "inspected", 1, 36, {}),
        ("padmavathi", "TOM", 260, "A", "pending_inspection", 2, 28, {}),
        ("narasimhulu", "TOM", 350, "B", "inspected", 1, 26, {}),
        ("anjaneyulu", "TOM", 400, "B", "pending_inspection", 1, 30, {}),
        ("saraswathi", "TOM", 280, "ungraded", "self_reported", 1, 12, {}),
        ("chandrasekhar", "BAN", 600, "A", "inspected", 1, 40, {"min_price": Decimal("22")}),
        ("padmavathi", "OKR", 120, "A", "inspected", 1, 22, {}),
        ("govindamma", "OKR", 140, "A", "self_reported", 1, 18, {}),
        ("bhaskar", "GNT", 1200, "A", "inspected", -3, 96, {"min_price": Decimal("58")}),
        ("sreenivasulu", "GNT", 900, "A", "inspected", -6, 160, {}),
        ("eswaramma", "POT", 500, "B", "self_reported", -2, 70, {}),
        ("lakshmi", "BRN", 180, "A", "self_reported", 4, 5, {"status": "draft"}),
        (
            "anjaneyulu",
            "CHI",
            200,
            "A",
            "self_reported",
            -3,
            150,
            {"status": "cancelled", "notes": "Leaf curl after the rains; listing withdrawn"},
        ),
        ("saraswathi", "TOM", 250, "A", "self_reported", -8, 220, {}),
    )
    for farmer, crop, quantity, grade, quality, day, hours, extras in entries:
        world.add_harvest(
            farmer,
            crop,
            quantity,
            harvest_date=clock.day(day),
            grade=grade,
            quality=quality,
            created_at=clock.ago(hours),
            **extras,
        )


# ─────────────────────────────── extras ───────────────────────────────


def _extras(world: World) -> None:
    """Verification queue, platform notices and recent sign-ins."""
    clock = world.clock
    admin = world.users["admin"]
    kolar = world.users["kolar"]
    world.audit(
        clock.ago(26),
        kolar,
        "user.verification_request",
        "user",
        kolar.id,
        "Kolar Fresh Movers requested verification (RC book, permit, PAN)",
    )
    world.notify(
        clock.ago(26),
        [*world.coordinators, admin],
        "verification",
        "Verification requested: Kolar Fresh Movers",
        "New transporter with one pickup (1,500 kg). Documents: RC book KA08A4417, national "
        "goods permit and PAN.",
        "/app/coordinator/verifications",
        read=False,
    )
    world.notify(
        clock.ago(4),
        [kolar],
        "verification",
        "Documents received",
        "Thanks for registering. A coordinator will verify your documents within one working day; "
        "you can already quote on open requests.",
        "/app/verification",
    )
    uplifts = [
        payout.uplift_per_kg
        for settlement in world.settlements.values()
        for payout in settlement.payouts
        if payout.status == "paid" and payout.uplift_per_kg is not None
    ]
    active = sum(1 for lot in world.lots if lot.status not in ("settled", "cancelled"))
    open_disputes = sum(1 for d in world.disputes if d.status in ("open", "under_review"))
    average = round_money(sum(uplifts, Decimal(0)) / len(uplifts)) if uplifts else Decimal(0)
    world.notify(
        clock.at(-1, 9, 0),
        [admin],
        "system",
        "Weekly pilot summary",
        f"{active} lots in the pipeline, {per_kg(average)} average net uplift for farmers on paid "
        f"sales, {open_disputes} open dispute{'s' if open_disputes != 1 else ''}.",
        "/app/admin",
        read=False,
    )
    world.notify(
        clock.at(-5, 10, 0),
        [admin],
        "dispute",
        "Dispute raised on a delivered lot",
        "A farmer disputed a quality rejection at the Hoskote DC; the settlement is on hold.",
        "/app/coordinator/disputes",
    )
    world.notify(
        clock.ago(30),
        [world.users["trader"]],
        "verification",
        "Get verified to win more deals",
        "Farmers see an 'unverified buyer' flag on your offers. Submit your GSTIN or trade "
        "licence to get verified.",
        "/app/verification",
        read=False,
    )


# ─────────────────────────────── entry ───────────────────────────────


async def build_demo(db: AsyncSession, clock: Clock, crops: dict[str, Crop]) -> World:
    """Create every demo account and the whole demo world (flushed, not committed)."""
    world = World(db, clock, crops)
    _people(world)
    await db.flush()
    _vehicles(world)
    _demands(world)
    await db.flush()

    for deal in HISTORY[:2]:
        await run_deal(world, deal)
    await _solo_history(world)
    for deal in HISTORY[2:7]:
        await run_deal(world, deal)
    await _expired_offer(world)
    for deal in HISTORY[7:]:
        await run_deal(world, deal)
    await _pipeline(world)
    _listings(world)
    _extras(world)

    world.finalise_targets()
    world.sync_harvest_statuses()
    await db.flush()
    return world
