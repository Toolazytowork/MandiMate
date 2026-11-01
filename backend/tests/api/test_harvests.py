"""/harvests: listing, visibility & masking, assisted listing, edits, cancel, verify, photos."""

from datetime import timedelta
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.time import today_ist, utcnow
from app.models import AuditLog, Crop, Harvest, HarvestPhoto, Notification, Offer, User
from app.services import harvest_service
from tests import factories
from tests.conftest import AuthClientFactory, MakeUser

HARVESTS = "/api/v1/harvests"


def harvest_url(harvest: Harvest | str) -> str:
    harvest_id = harvest if isinstance(harvest, str) else harvest.id
    return f"{HARVESTS}/{harvest_id}"


def create_body(crop: Crop, **overrides: Any) -> dict[str, Any]:
    today = today_ist()
    body: dict[str, Any] = {
        "crop_id": str(crop.id),
        "variety": "Arka Rakshak",
        "quantity_kg": 400,
        "grade": "A",
        "harvest_date": today.isoformat(),
        "available_from": (today + timedelta(days=1)).isoformat(),
        "sell_by": (today + timedelta(days=5)).isoformat(),
        "min_price_per_kg": 12.5,
    }
    return body | overrides


def png_bytes(size: tuple[int, int] = (64, 48), colour: tuple[int, ...] = (200, 30, 30)) -> bytes:
    buffer = BytesIO()
    mode = "RGBA" if len(colour) == 4 else "RGB"
    Image.new(mode, size, colour).save(buffer, "PNG")
    return buffer.getvalue()


def stored_photos(root: Path) -> list[Path]:
    return list(root.rglob("*.webp"))


@pytest.fixture
def media_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(settings, "MEDIA_DIR", tmp_path)
    return tmp_path


@pytest.fixture
async def crop(db: AsyncSession) -> Crop:
    return await factories.create_crop(db)


@pytest.fixture
async def ravi(make_user: MakeUser) -> User:
    farmer, _ = await make_user("farmer", full_name="Ravi Kumar")
    return farmer


# ─────────────────────────────── Create ────────────────────────────────


async def test_farmer_lists_a_harvest_at_their_profile_location(
    auth_client: AuthClientFactory, ravi: User, crop: Crop, db: AsyncSession
) -> None:
    response = await auth_client(ravi).post(HARVESTS, json=create_body(crop))

    assert response.status_code == 201
    body = response.json()
    assert body["farmer_id"] == str(ravi.id)
    assert body["farmer_name"] == "Ravi Kumar"
    assert body["crop_name"] == "Tomato"
    assert body["quantity_kg"] == 400
    assert body["available_kg"] == 400
    assert body["status"] == "listed"
    assert body["source"] == "manual"
    assert body["quality_status"] == "self_reported"
    assert body["min_price_per_kg"] == 12.5
    assert (body["village"], body["district"], body["state"]) == (
        ravi.village,
        ravi.district,
        ravi.state,
    )
    assert (body["latitude"], body["longitude"]) == (ravi.latitude, ravi.longitude)
    assert body["photos"] == [] and body["lot_ids"] == []
    assert body["open_offers_count"] == 0 and body["best_offer_price_per_kg"] is None
    assert body["created_by_id"] == str(ravi.id)
    assert body["verified_by_name"] is None and body["verified_at"] is None
    entry = await db.scalar(select(AuditLog).where(AuditLog.action == "harvest.create"))
    assert entry is not None and entry.entity_id == body["id"]


async def test_explicit_location_and_draft_status_are_kept(
    auth_client: AuthClientFactory, ravi: User, crop: Crop
) -> None:
    response = await auth_client(ravi).post(
        HARVESTS,
        json=create_body(
            crop,
            status="draft",
            source="voice",
            village="Angallu",
            latitude=13.62,
            longitude=78.53,
        ),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "draft"
    assert body["source"] == "voice"
    assert body["village"] == "Angallu"
    assert body["district"] == ravi.district
    assert (body["latitude"], body["longitude"]) == (13.62, 78.53)


async def test_coordinator_assisted_listing_for_a_farmer(
    auth_client: AuthClientFactory, make_user: MakeUser, ravi: User, crop: Crop
) -> None:
    coordinator, _ = await make_user("coordinator")

    response = await auth_client(coordinator).post(
        HARVESTS, json=create_body(crop, farmer_id=str(ravi.id), source="manual")
    )

    assert response.status_code == 201
    body = response.json()
    assert body["farmer_id"] == str(ravi.id)
    assert body["source"] == "assisted"
    assert body["created_by_id"] == str(coordinator.id)
    assert body["latitude"] == ravi.latitude


async def test_assisted_listing_requires_a_farmer(
    auth_client: AuthClientFactory, make_user: MakeUser, crop: Crop
) -> None:
    coordinator, _ = await make_user("coordinator")
    buyer, _ = await make_user("buyer")
    client = auth_client(coordinator)

    missing = await client.post(HARVESTS, json=create_body(crop))
    not_a_farmer = await client.post(HARVESTS, json=create_body(crop, farmer_id=str(buyer.id)))

    assert missing.status_code == 422
    assert missing.json()["detail"][0]["loc"] == ["body", "farmer_id"]
    assert not_a_farmer.status_code == 422


async def test_create_permissions_and_validation(
    auth_client: AuthClientFactory, make_user: MakeUser, ravi: User, crop: Crop, client: AsyncClient
) -> None:
    buyer, _ = await make_user("buyer")
    other, _ = await make_user("farmer")
    farmer_client = auth_client(ravi)
    today = today_ist()

    assert (await client.post(HARVESTS, json=create_body(crop))).status_code == 401
    assert (await auth_client(buyer).post(HARVESTS, json=create_body(crop))).status_code == 403
    for_someone_else = await farmer_client.post(
        HARVESTS, json=create_body(crop, farmer_id=str(other.id))
    )
    assert for_someone_else.status_code == 403
    unknown_crop = create_body(crop, crop_id="00000000-0000-0000-0000-000000000001")
    assert (await farmer_client.post(HARVESTS, json=unknown_crop)).status_code == 422
    assert (
        await farmer_client.post(HARVESTS, json=create_body(crop, grade="X"))
    ).status_code == 422
    assert (
        await farmer_client.post(HARVESTS, json=create_body(crop, quantity_kg=0))
    ).status_code == 422
    past = create_body(
        crop,
        harvest_date=(today - timedelta(days=5)).isoformat(),
        available_from=(today - timedelta(days=4)).isoformat(),
        sell_by=(today - timedelta(days=1)).isoformat(),
    )
    response = await farmer_client.post(HARVESTS, json=past)
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "sell_by"]
    lonely_latitude = await farmer_client.post(HARVESTS, json=create_body(crop, latitude=13.6))
    assert lonely_latitude.status_code == 422


async def test_grade_must_be_one_the_crop_is_traded_in(
    auth_client: AuthClientFactory, ravi: User, db: AsyncSession
) -> None:
    onion = await factories.create_crop(
        db, code="ONI", name="Onion", name_hi="प्याज", name_te="ఉల్లి", grades=["A", "B"]
    )

    response = await auth_client(ravi).post(HARVESTS, json=create_body(onion, grade="C"))

    assert response.status_code == 422
    assert "grades A, B" in response.json()["detail"][0]["msg"]


# ─────────────────────────── Visibility & masking ───────────────────────────


async def test_buyer_sees_masked_name_and_no_minimum_price(
    auth_client: AuthClientFactory, make_user: MakeUser, ravi: User, crop: Crop, db: AsyncSession
) -> None:
    harvest = await factories.create_harvest(db, ravi, crop, min_price_per_kg=Decimal("12"))
    buyer, _ = await make_user("buyer")
    coordinator, _ = await make_user("coordinator")

    as_buyer = (await auth_client(buyer).get(harvest_url(harvest))).json()
    as_owner = (await auth_client(ravi).get(harvest_url(harvest))).json()
    as_coordinator = (await auth_client(coordinator).get(harvest_url(harvest))).json()

    assert as_buyer["farmer_name"] == "Ravi K."
    assert as_buyer["min_price_per_kg"] is None
    assert as_owner["farmer_name"] == "Ravi Kumar"
    assert as_owner["min_price_per_kg"] == 12
    assert as_coordinator["farmer_name"] == "Ravi Kumar"
    assert as_coordinator["min_price_per_kg"] == 12


@pytest.mark.parametrize("status", ["draft", "committed", "cancelled"])
async def test_buyers_only_see_listed_or_pooled_harvests(
    auth_client: AuthClientFactory,
    make_user: MakeUser,
    ravi: User,
    crop: Crop,
    db: AsyncSession,
    status: str,
) -> None:
    harvest = await factories.create_harvest(db, ravi, crop, status=status)
    buyer, _ = await make_user("buyer")

    response = await auth_client(buyer).get(harvest_url(harvest))

    assert response.status_code == 404


async def test_other_farmers_and_transporters_cannot_see_a_harvest(
    auth_client: AuthClientFactory, make_user: MakeUser, ravi: User, crop: Crop, db: AsyncSession
) -> None:
    harvest = await factories.create_harvest(db, ravi, crop)
    other, _ = await make_user("farmer")
    transporter, _ = await make_user("transporter")

    assert (await auth_client(other).get(harvest_url(harvest))).status_code == 404
    assert (await auth_client(transporter).get(harvest_url(harvest))).status_code == 404
    missing = await auth_client(ravi).get(harvest_url("00000000-0000-0000-0000-000000000001"))
    assert missing.status_code == 404


async def test_list_scopes_and_filters(
    auth_client: AuthClientFactory, make_user: MakeUser, ravi: User, crop: Crop, db: AsyncSession
) -> None:
    onion = await factories.create_crop(db, code="ONI", name="Onion", name_hi="प्याज", name_te="ఉల్లి")
    other, _ = await make_user("farmer")
    coordinator, _ = await make_user("coordinator")
    buyer, _ = await make_user("buyer")
    mine_tomato = await factories.create_harvest(db, ravi, crop)
    mine_onion = await factories.create_harvest(db, ravi, onion, status="draft")
    theirs = await factories.create_harvest(db, other, crop)

    own = (await auth_client(ravi).get(HARVESTS)).json()
    sneaky = (await auth_client(ravi).get(HARVESTS, params={"farmer_id": str(other.id)})).json()
    everything = (await auth_client(coordinator).get(HARVESTS)).json()
    by_farmer = (
        await auth_client(coordinator).get(HARVESTS, params={"farmer_id": str(other.id)})
    ).json()
    drafts = (await auth_client(coordinator).get(HARVESTS, params={"status": "draft"})).json()
    tomatoes = (
        await auth_client(coordinator).get(HARVESTS, params={"crop_id": str(crop.id), "limit": 1})
    ).json()

    assert [item["id"] for item in own] == [str(mine_onion.id), str(mine_tomato.id)]
    assert sneaky == []
    assert {item["id"] for item in everything} == {
        str(mine_tomato.id),
        str(mine_onion.id),
        str(theirs.id),
    }
    assert [item["id"] for item in by_farmer] == [str(theirs.id)]
    assert [item["id"] for item in drafts] == [str(mine_onion.id)]
    assert [item["id"] for item in tomatoes] == [str(theirs.id)]
    assert (await auth_client(buyer).get(HARVESTS)).status_code == 403
    assert (await auth_client(ravi).get(HARVESTS, params={"status": "sold"})).status_code == 422
    assert (await auth_client(ravi).get(HARVESTS, params={"limit": 501})).status_code == 422


async def test_overdue_listings_expire_lazily(
    auth_client: AuthClientFactory, make_user: MakeUser, ravi: User, crop: Crop, db: AsyncSession
) -> None:
    today = today_ist()
    overdue = await factories.create_harvest(
        db,
        ravi,
        crop,
        harvest_date=today - timedelta(days=6),
        available_from=today - timedelta(days=5),
        sell_by=today - timedelta(days=1),
    )
    buyer, _ = await make_user("buyer")

    assert (await auth_client(buyer).get(harvest_url(overdue))).status_code == 404
    listed = (await auth_client(ravi).get(HARVESTS)).json()

    assert listed[0]["status"] == "expired"


# ──────────────────────── Availability, lots & offers ────────────────────────


async def test_available_kg_lot_ids_and_open_offers(
    auth_client: AuthClientFactory, make_user: MakeUser, ravi: User, crop: Crop, db: AsyncSession
) -> None:
    harvest = await factories.create_harvest(db, ravi, crop)
    neighbour, _ = await make_user("farmer")
    other_harvest = await factories.create_harvest(db, neighbour, crop)
    lot = await factories.create_lot(db, crop, [(harvest, 150), other_harvest])
    declined_lot = await factories.create_lot(
        db, crop, [(harvest, 100)], consent_status="declined", status="awaiting_consent"
    )
    cancelled_lot = await factories.create_lot(db, crop, [(harvest, 50)], status="cancelled")
    buyer_a, _ = await make_user("buyer")
    buyer_b, _ = await make_user("buyer")
    buyer_c, _ = await make_user("buyer")
    await factories.create_offer(db, buyer_a, lot=lot, price_per_kg=Decimal("16"))
    await factories.create_offer(
        db, buyer_b, lot=lot, price_per_kg=Decimal("17.5"), status="proposed"
    )
    await factories.create_offer(
        db, buyer_c, lot=lot, price_per_kg=Decimal("19"), status="rejected"
    )
    await factories.create_offer(
        db,
        buyer_c,
        lot=lot,
        price_per_kg=Decimal("21"),
        valid_until=utcnow() - timedelta(hours=1),
    )
    await factories.create_offer(db, buyer_a, lot=cancelled_lot, price_per_kg=Decimal("30"))

    body = (await auth_client(ravi).get(harvest_url(harvest))).json()

    assert body["status"] == "listed"  # the last factory call mirrored the cancelled lot
    assert body["available_kg"] == 250
    assert body["lot_ids"] == [str(lot.id)]
    assert str(declined_lot.id) not in body["lot_ids"]
    assert body["open_offers_count"] == 2
    assert body["best_offer_price_per_kg"] == 17.5
    assert await harvest_service.get_available_kg(db, harvest.id) == Decimal("250")
    available = await harvest_service.available_kg_map(db, [harvest.id, other_harvest.id])
    assert available == {harvest.id: Decimal("250"), other_harvest.id: Decimal("0")}


async def test_direct_offers_are_counted(
    auth_client: AuthClientFactory, make_user: MakeUser, ravi: User, crop: Crop, db: AsyncSession
) -> None:
    harvest = await factories.create_harvest(db, ravi, crop)
    buyer_a, _ = await make_user("buyer")
    buyer_b, _ = await make_user("buyer")
    await factories.create_offer(db, buyer_a, harvest=harvest, price_per_kg=Decimal("15"))
    await factories.create_offer(
        db, buyer_b, harvest=harvest, price_per_kg=Decimal("15.75"), status="countered"
    )

    listed = (await auth_client(ravi).get(HARVESTS)).json()

    assert listed[0]["open_offers_count"] == 2
    assert listed[0]["best_offer_price_per_kg"] == 15.75


# ─────────────────────────────── Edit ────────────────────────────────


async def test_owner_edits_a_listed_harvest(
    auth_client: AuthClientFactory, ravi: User, crop: Crop, db: AsyncSession
) -> None:
    harvest = await factories.create_harvest(db, ravi, crop)

    response = await auth_client(ravi).patch(
        harvest_url(harvest),
        json={"quantity_kg": 350, "min_price_per_kg": 13, "quality_notes": "Firm, red"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["quantity_kg"] == 350
    assert body["available_kg"] == 350
    assert body["min_price_per_kg"] == 13
    assert body["quality_notes"] == "Firm, red"
    assert body["variety"] == "Arka Rakshak"
    cleared = await auth_client(ravi).patch(harvest_url(harvest), json={"min_price_per_kg": None})
    assert cleared.json()["min_price_per_kg"] is None


async def test_edit_conflicts_and_validation(
    auth_client: AuthClientFactory, make_user: MakeUser, ravi: User, crop: Crop, db: AsyncSession
) -> None:
    pooled = await factories.create_harvest(db, ravi, crop)
    await factories.create_lot(db, crop, [pooled])
    listed = await factories.create_harvest(db, ravi, crop)
    buyer, _ = await make_user("buyer")
    other, _ = await make_user("farmer")
    client = auth_client(ravi)

    assert (await client.patch(harvest_url(pooled), json={"quantity_kg": 500})).status_code == 409
    assert (await client.patch(harvest_url(listed), json={"quantity_kg": None})).status_code == 422
    too_late = (listed.available_from - timedelta(days=1)).isoformat()
    response = await client.patch(harvest_url(listed), json={"sell_by": too_late})
    assert response.status_code == 422
    assert (
        await auth_client(buyer).patch(harvest_url(listed), json={"variety": "Local"})
    ).status_code == 403
    assert (
        await auth_client(other).patch(harvest_url(listed), json={"variety": "Local"})
    ).status_code == 404


async def test_quantity_cannot_drop_below_committed_kg(
    auth_client: AuthClientFactory, ravi: User, crop: Crop, db: AsyncSession
) -> None:
    harvest = await factories.create_harvest(db, ravi, crop)
    await factories.create_lot(
        db, crop, [(harvest, 300)], consent_status="pending", status="awaiting_consent"
    )
    harvest.status = "listed"  # e.g. relisted remainder while consent is pending
    await db.commit()
    client = auth_client(ravi)

    too_small = await client.patch(harvest_url(harvest), json={"quantity_kg": 250})
    just_enough = await client.patch(harvest_url(harvest), json={"quantity_kg": 300})

    assert too_small.status_code == 409
    assert "300 kg already committed" in too_small.json()["detail"]
    assert just_enough.status_code == 200
    assert just_enough.json()["available_kg"] == 0


async def test_farmer_regrading_an_inspected_harvest_resets_inspection(
    auth_client: AuthClientFactory, make_user: MakeUser, ravi: User, crop: Crop, db: AsyncSession
) -> None:
    coordinator, _ = await make_user("coordinator")
    harvest = await factories.create_harvest(
        db,
        ravi,
        crop,
        grade="B",
        quality_status="inspected",
        verified_by_id=coordinator.id,
        verified_at=utcnow(),
    )

    response = await auth_client(ravi).patch(harvest_url(harvest), json={"grade": "A"})

    body = response.json()
    assert body["grade"] == "A"
    assert body["quality_status"] == "self_reported"
    assert body["verified_by_name"] is None


# ─────────────────────────────── Cancel ────────────────────────────────


async def test_cancel_a_listing_closes_direct_offers(
    auth_client: AuthClientFactory, make_user: MakeUser, ravi: User, crop: Crop, db: AsyncSession
) -> None:
    harvest = await factories.create_harvest(db, ravi, crop)
    buyer, _ = await make_user("buyer")
    offer = await factories.create_offer(db, buyer, harvest=harvest)

    response = await auth_client(ravi).post(f"{harvest_url(harvest)}/cancel")

    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"
    await db.refresh(offer)
    assert offer.status == "rejected"
    entries = (await db.scalars(select(Offer).where(Offer.id == offer.id))).one().negotiation
    assert entries[-1].author_role == "system" and entries[-1].action == "reject"
    notice = await db.scalar(select(Notification).where(Notification.user_id == buyer.id))
    assert notice is not None and notice.type == "offer"
    assert (await auth_client(ravi).post(f"{harvest_url(harvest)}/cancel")).status_code == 409


async def test_cancel_conflicts(
    auth_client: AuthClientFactory, make_user: MakeUser, ravi: User, crop: Crop, db: AsyncSession
) -> None:
    pooled = await factories.create_harvest(db, ravi, crop)
    await factories.create_lot(db, crop, [pooled])
    committed = await factories.create_harvest(db, ravi, crop, status="committed")
    buyer, _ = await make_user("buyer")
    listed = await factories.create_harvest(db, ravi, crop)
    client = auth_client(ravi)

    # A pooled harvest whose lot has no accepted offer is withdrawn from the pool and cancelled.
    pooled_response = await client.post(f"{harvest_url(pooled)}/cancel")
    assert pooled_response.status_code == 200
    assert pooled_response.json()["status"] == "cancelled"
    assert pooled_response.json()["lot_ids"] == []
    assert (await client.post(f"{harvest_url(committed)}/cancel")).status_code == 409
    assert (await auth_client(buyer).post(f"{harvest_url(listed)}/cancel")).status_code == 403


async def test_coordinator_cancel_notifies_the_farmer(
    auth_client: AuthClientFactory, make_user: MakeUser, ravi: User, crop: Crop, db: AsyncSession
) -> None:
    harvest = await factories.create_harvest(db, ravi, crop, status="draft")
    coordinator, _ = await make_user("coordinator")

    response = await auth_client(coordinator).post(f"{harvest_url(harvest)}/cancel")

    assert response.status_code == 200
    notice = await db.scalar(select(Notification).where(Notification.user_id == ravi.id))
    assert notice is not None


# ─────────────────────────────── Verify ────────────────────────────────


async def test_coordinator_records_an_inspection(
    auth_client: AuthClientFactory, make_user: MakeUser, ravi: User, crop: Crop, db: AsyncSession
) -> None:
    harvest = await factories.create_harvest(db, ravi, crop, grade="ungraded")
    coordinator, _ = await make_user("coordinator", full_name="Suresh Chowdary")

    response = await auth_client(coordinator).post(
        f"{harvest_url(harvest)}/verify", json={"grade": "B", "quality_notes": "Some cracking"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["grade"] == "B"
    assert body["quality_status"] == "inspected"
    assert body["quality_notes"] == "Some cracking"
    assert body["verified_by_name"] == "Suresh Chowdary"
    assert body["verified_at"] is not None
    notice = await db.scalar(select(Notification).where(Notification.user_id == ravi.id))
    assert notice is not None and notice.type == "verification"
    entry = await db.scalar(select(AuditLog).where(AuditLog.action == "harvest.verify"))
    assert entry is not None and entry.actor_id == coordinator.id


async def test_verify_permissions_and_conflicts(
    auth_client: AuthClientFactory, make_user: MakeUser, ravi: User, crop: Crop, db: AsyncSession
) -> None:
    coordinator, _ = await make_user("coordinator")
    listed = await factories.create_harvest(db, ravi, crop)
    pooled = await factories.create_harvest(db, ravi, crop, grade="A")
    await factories.create_lot(db, crop, [pooled])
    cancelled = await factories.create_harvest(db, ravi, crop, status="cancelled")
    client = auth_client(coordinator)

    assert (
        await auth_client(ravi).post(f"{harvest_url(listed)}/verify", json={"grade": "A"})
    ).status_code == 403
    assert (
        await client.post(f"{harvest_url(listed)}/verify", json={"grade": "ungraded"})
    ).status_code == 422
    assert (
        await client.post(f"{harvest_url(pooled)}/verify", json={"grade": "B"})
    ).status_code == 409
    assert (
        await client.post(f"{harvest_url(pooled)}/verify", json={"grade": "A"})
    ).status_code == 200
    assert (
        await client.post(f"{harvest_url(cancelled)}/verify", json={"grade": "A"})
    ).status_code == 409


# ─────────────────────────────── Photos ────────────────────────────────


async def test_photo_upload_is_reencoded_and_analysed(
    auth_client: AuthClientFactory,
    make_user: MakeUser,
    ravi: User,
    crop: Crop,
    db: AsyncSession,
    media_dir: Path,
) -> None:
    harvest = await factories.create_harvest(db, ravi, crop)
    client = auth_client(ravi)

    response = await client.post(
        f"{harvest_url(harvest)}/photos",
        files={"file": ("tomatoes.png", png_bytes((2400, 1200)), "image/png")},
    )

    assert response.status_code == 201
    photo = response.json()
    assert photo["url"].startswith(f"/media/harvests/{harvest.id}/")
    assert photo["url"].endswith(".webp")
    analysis = photo["analysis"]
    assert analysis["red_ratio"] == 1.0
    assert "Predominantly deep red — consistent with ripe tomatoes" in analysis["observations"]
    assert analysis["disclaimer"].startswith("Preliminary visual notes only.")
    stored = media_dir / photo["url"].removeprefix("/media/")
    with Image.open(stored) as image:
        assert image.format == "WEBP"
        assert image.size == (1600, 800)
    row = await db.scalar(select(HarvestPhoto).where(HarvestPhoto.harvest_id == harvest.id))
    assert row is not None and row.file_path == photo["url"].removeprefix("/media/")
    detail = (await client.get(harvest_url(harvest))).json()
    assert [item["id"] for item in detail["photos"]] == [photo["id"]]
    buyer, _ = await make_user("buyer")
    assert (await auth_client(buyer).get(harvest_url(harvest))).json()["photos"][0]["url"] == photo[
        "url"
    ]


async def test_coordinator_can_upload_and_transparent_images_are_flattened(
    auth_client: AuthClientFactory,
    make_user: MakeUser,
    ravi: User,
    crop: Crop,
    db: AsyncSession,
    media_dir: Path,
) -> None:
    harvest = await factories.create_harvest(db, ravi, crop)
    coordinator, _ = await make_user("coordinator")

    response = await auth_client(coordinator).post(
        f"{harvest_url(harvest)}/photos",
        files={"file": ("crate.png", png_bytes(colour=(30, 160, 40, 128)), "image/png")},
    )

    assert response.status_code == 201
    stored = media_dir / response.json()["url"].removeprefix("/media/")
    with Image.open(stored) as image:
        assert image.mode == "RGB"


async def test_photo_upload_rejections(
    auth_client: AuthClientFactory,
    make_user: MakeUser,
    ravi: User,
    crop: Crop,
    db: AsyncSession,
    media_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    harvest = await factories.create_harvest(db, ravi, crop)
    cancelled = await factories.create_harvest(db, ravi, crop, status="cancelled")
    buyer, _ = await make_user("buyer")
    client = auth_client(ravi)
    url = f"{harvest_url(harvest)}/photos"

    not_an_image = await client.post(url, files={"file": ("x.png", b"not an image", "image/png")})
    gif = BytesIO()
    Image.new("RGB", (8, 8), (200, 0, 0)).save(gif, "GIF")
    gif_response = await client.post(url, files={"file": ("x.gif", gif.getvalue(), "image/gif")})
    empty = await client.post(url, files={"file": ("x.png", b"", "image/png")})
    by_buyer = await auth_client(buyer).post(
        url, files={"file": ("x.png", png_bytes(), "image/png")}
    )
    on_cancelled = await client.post(
        f"{harvest_url(cancelled)}/photos", files={"file": ("x.png", png_bytes(), "image/png")}
    )
    no_file = await client.post(url)
    monkeypatch.setattr(settings, "MAX_UPLOAD_MB", 0)
    too_large = await client.post(url, files={"file": ("x.png", png_bytes(), "image/png")})

    assert not_an_image.status_code == 415
    assert gif_response.status_code == 415
    assert empty.status_code == 415
    assert by_buyer.status_code == 403
    assert on_cancelled.status_code == 409
    assert no_file.status_code == 422
    assert too_large.status_code == 413
    assert stored_photos(media_dir) == []


async def test_at_most_six_photos_and_delete_removes_the_file(
    auth_client: AuthClientFactory, ravi: User, crop: Crop, db: AsyncSession, media_dir: Path
) -> None:
    harvest = await factories.create_harvest(db, ravi, crop)
    client = auth_client(ravi)
    url = f"{harvest_url(harvest)}/photos"
    photos = []
    for _ in range(6):
        response = await client.post(url, files={"file": ("x.png", png_bytes(), "image/png")})
        assert response.status_code == 201
        photos.append(response.json())

    seventh = await client.post(url, files={"file": ("x.png", png_bytes(), "image/png")})
    assert seventh.status_code == 409

    first = photos[0]
    stored = media_dir / first["url"].removeprefix("/media/")
    assert stored.exists()
    deleted = await client.delete(f"{url}/{first['id']}")
    assert deleted.status_code == 204
    assert not stored.exists()
    assert len((await client.get(harvest_url(harvest))).json()["photos"]) == 5
    again = await client.delete(f"{url}/{first['id']}")
    assert again.status_code == 404
    assert (
        await client.post(url, files={"file": ("x.png", png_bytes(), "image/png")})
    ).status_code == 201


async def test_photos_are_kept_once_a_deal_is_agreed(
    auth_client: AuthClientFactory, ravi: User, crop: Crop, db: AsyncSession, media_dir: Path
) -> None:
    harvest = await factories.create_harvest(db, ravi, crop)
    client = auth_client(ravi)
    photo = (
        await client.post(
            f"{harvest_url(harvest)}/photos", files={"file": ("x.png", png_bytes(), "image/png")}
        )
    ).json()
    harvest.status = "committed"
    await db.commit()

    response = await client.delete(f"{harvest_url(harvest)}/photos/{photo['id']}")

    assert response.status_code == 409


async def test_moving_a_listing_back_to_draft_closes_direct_offers(
    auth_client: AuthClientFactory, make_user: MakeUser, ravi: User, crop: Crop, db: AsyncSession
) -> None:
    harvest = await factories.create_harvest(db, ravi, crop)
    buyer, _ = await make_user("buyer")
    offer = await factories.create_offer(db, buyer, harvest=harvest)

    response = await auth_client(ravi).patch(harvest_url(harvest), json={"status": "draft"})

    assert response.status_code == 200
    assert response.json()["status"] == "draft"
    assert response.json()["open_offers_count"] == 0
    await db.refresh(offer)
    assert offer.status == "rejected"
    relisted = await auth_client(ravi).patch(harvest_url(harvest), json={"status": "listed"})
    assert relisted.json()["status"] == "listed"
