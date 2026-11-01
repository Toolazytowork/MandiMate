"""/public: headline statistics and the contact form."""

from collections.abc import Sequence
from datetime import timedelta
from decimal import Decimal

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import today_ist, utcnow
from app.models import AuditLog, ContactMessage, FarmerPayout, Harvest, Lot, Settlement, User
from app.services.codes import next_code
from tests import factories
from tests.conftest import MakeUser

STATS = "/api/v1/public/stats"
CONTACT = "/api/v1/public/contact"


async def create_settlement(
    db: AsyncSession,
    buyer: User,
    harvests: Sequence[Harvest],
    *,
    net_per_kg: Decimal = Decimal("13.50"),
    uplifts: Sequence[Decimal | None] | None = None,
    lot_status: str = "settled",
) -> Settlement:
    """A delivered lot of ``harvests`` sold at ₹16/kg with one payout per member.

    Every member dispatches and gets accepted its whole quantity; payout ``i`` has
    ``uplift_per_kg = uplifts[i]``.
    """
    crop = harvests[0].crop
    lot = await factories.create_lot(db, crop, list(harvests), status=lot_status)
    offer = await factories.create_offer(db, buyer, lot=lot, status="accepted", awaiting=None)
    total = sum((harvest.quantity_kg for harvest in harvests), Decimal("0"))
    settlement = Settlement(
        code=await next_code(db, "settlement"),
        lot_id=lot.id,
        offer_id=offer.id,
        buyer_id=buyer.id,
        price_per_kg=Decimal("16"),
        total_accepted_kg=total,
        gross_amount=total * 16,
        transport_cost=Decimal("0"),
        handling_cost=Decimal("0"),
        commission_amount=Decimal("0"),
        net_to_farmers=total * net_per_kg,
        amount_paid=total * 16,
        payment_status="paid",
        due_date=today_ist() + timedelta(days=7),
        paid_at=utcnow(),
    )
    for index, member in enumerate(lot.members):
        uplift = uplifts[index] if uplifts is not None else Decimal("1.50")
        settlement.payouts.append(
            FarmerPayout(
                member_id=member.id,
                farmer_id=member.farmer_id,
                dispatched_kg=member.quantity_kg,
                accepted_kg=member.quantity_kg,
                rejected_kg=Decimal("0"),
                gross_amount=member.quantity_kg * 16,
                transport_share=Decimal("0"),
                handling_share=Decimal("0"),
                commission_share=Decimal("0"),
                net_amount=member.quantity_kg * net_per_kg,
                net_per_kg=net_per_kg,
                baseline_net_per_kg=net_per_kg - uplift if uplift is not None else None,
                uplift_per_kg=uplift,
                status="paid",
                paid_at=utcnow(),
            )
        )
    db.add(settlement)
    await db.commit()
    await db.refresh(settlement)
    return settlement


# ──────────────────────────────── Stats ─────────────────────────────────


async def test_stats_on_an_empty_platform(client: AsyncClient) -> None:
    response = await client.get(STATS)

    assert response.status_code == 200
    assert response.json() == {
        "farmers": 0,
        "buyers": 0,
        "transporters": 0,
        "kg_traded": 0.0,
        "lots_completed": 0,
        "avg_uplift_per_kg": None,
        "is_demo_data": False,
    }


async def test_stats_count_roles_kg_lots_and_weighted_uplift(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    crop = await factories.create_crop(db)
    farmers = [(await make_user("farmer"))[0] for _ in range(3)]
    buyer, _ = await make_user("buyer")
    await make_user("transporter")
    await make_user("coordinator")
    await make_user("admin")
    big = await factories.create_harvest(db, farmers[0], crop, quantity_kg=Decimal("300"))
    small = await factories.create_harvest(db, farmers[1], crop, quantity_kg=Decimal("100"))
    await create_settlement(db, buyer, [big, small], uplifts=[Decimal("2.00"), Decimal("1.00")])
    # A delivered-but-unsettled lot counts toward kg traded but not lots completed;
    # a payout without a baseline does not affect the uplift average.
    other = await factories.create_harvest(db, farmers[2], crop, quantity_kg=Decimal("250.5"))
    await create_settlement(db, buyer, [other], uplifts=[None], lot_status="delivered")

    response = await client.get(STATS)

    assert response.json() == {
        "farmers": 3,
        "buyers": 1,
        "transporters": 1,
        "kg_traded": 650.5,
        "lots_completed": 1,
        # (2.00 × 300 + 1.00 × 100) / 400
        "avg_uplift_per_kg": 1.75,
        "is_demo_data": False,
    }


async def test_stats_flag_demo_data(client: AsyncClient, make_user: MakeUser) -> None:
    await make_user("farmer", email="ravi@mandimate.demo")

    response = await client.get(STATS)

    assert response.json()["is_demo_data"] is True


# ─────────────────────────────── Contact ────────────────────────────────


async def test_contact_message_is_stored_and_audited(client: AsyncClient, db: AsyncSession) -> None:
    response = await client.post(
        CONTACT,
        json={
            "name": "Asha Rao",
            "email": "Asha@Example.org",
            "organization": "Kolar Farmers FPO",
            "role": "fpo",
            "message": "We would like to pilot MandiMate for 200 tomato farmers.",
        },
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    stored = await db.scalar(select(ContactMessage))
    assert stored is not None
    assert stored.email == "asha@example.org"
    assert stored.organization == "Kolar Farmers FPO"
    assert stored.ip is not None
    entry = await db.scalar(select(AuditLog).where(AuditLog.action == "contact.submit"))
    assert entry is not None and entry.actor_id is None and entry.entity_id == str(stored.id)


async def test_contact_validation_is_422(client: AsyncClient) -> None:
    missing_message = await client.post(
        CONTACT, json={"name": "Asha", "email": "asha@example.org", "message": "  "}
    )
    bad_email = await client.post(
        CONTACT, json={"name": "Asha", "email": "not-an-email", "message": "Hello"}
    )

    assert missing_message.status_code == 422
    assert bad_email.status_code == 422


async def test_contact_is_limited_to_five_messages_per_ip_per_hour(
    client: AsyncClient, db: AsyncSession
) -> None:
    body = {"name": "Asha", "email": "asha@example.org", "message": "Hello"}

    for _ in range(5):
        assert (await client.post(CONTACT, json=body)).status_code == 200
    blocked = await client.post(CONTACT, json=body)

    assert blocked.status_code == 429
    assert blocked.json()["code"] == "rate_limited"
    # Older messages fall out of the window.
    for message in (await db.scalars(select(ContactMessage))).all():
        message.created_at = utcnow() - timedelta(hours=2)
    await db.commit()
    assert (await client.post(CONTACT, json=body)).status_code == 200


async def test_lot_helper_marks_lots(db: AsyncSession, make_user: MakeUser) -> None:
    """Sanity check for ``create_settlement`` used by other API tests."""
    crop = await factories.create_crop(db)
    farmer, _ = await make_user("farmer")
    buyer, _ = await make_user("buyer")
    harvest = await factories.create_harvest(db, farmer, crop)

    settlement = await create_settlement(db, buyer, [harvest])

    lot = await db.get(Lot, settlement.lot_id)
    assert lot is not None and lot.status == "settled"
    assert [payout.farmer_id for payout in settlement.payouts] == [farmer.id]
