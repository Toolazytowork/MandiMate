"""/users/me: profile updates, password change and verification requests."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import REFRESH_COOKIE, verify_password
from app.models import AuditLog, Notification, RefreshToken, User
from tests.conftest import AuthClientFactory, MakeUser

ME = "/api/v1/users/me"
PASSWORD = "/api/v1/users/me/password"
VERIFICATION = "/api/v1/users/me/verification-request"
LOGIN = "/api/v1/auth/login"
REFRESH = "/api/v1/auth/refresh"


# ─────────────────────────────── Profile ────────────────────────────────


async def test_update_profile_applies_only_sent_fields(
    auth_client: AuthClientFactory, make_user: MakeUser, db: AsyncSession
) -> None:
    farmer, _ = await make_user("farmer", village="Angallu", organization_name=None)

    response = await auth_client(farmer).patch(
        ME,
        json={
            "full_name": "  Ravi Kumar Reddy ",
            "phone": "+91 99887 76655",
            "email": "Ravi.New@Example.com",
            "preferred_language": "hi",
            "latitude": 13.6,
            "longitude": 78.5,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["full_name"] == "Ravi Kumar Reddy"
    assert body["phone"] == "+919988776655"
    assert body["email"] == "ravi.new@example.com"
    assert body["preferred_language"] == "hi"
    assert body["village"] == "Angallu"
    assert (body["latitude"], body["longitude"]) == (13.6, 78.5)
    entry = await db.scalar(select(AuditLog).where(AuditLog.action == "user.update_profile"))
    assert entry is not None and entry.actor_id == farmer.id


@pytest.mark.parametrize("language", ["kn", "ur"])
async def test_update_profile_accepts_kannada_and_urdu(
    auth_client: AuthClientFactory, make_user: MakeUser, db: AsyncSession, language: str
) -> None:
    farmer, _ = await make_user("farmer")

    response = await auth_client(farmer).patch(ME, json={"preferred_language": language})

    assert response.status_code == 200
    assert response.json()["preferred_language"] == language
    await db.refresh(farmer)
    assert farmer.preferred_language == language


async def test_update_profile_rejects_contacts_used_by_someone_else(
    auth_client: AuthClientFactory, make_user: MakeUser
) -> None:
    other, _ = await make_user("buyer", email="taken@example.com", phone="+919000000009")
    me, _ = await make_user("farmer", email="me@example.com")
    client = auth_client(me)

    email = await client.patch(ME, json={"email": "TAKEN@example.com"})
    phone = await client.patch(ME, json={"phone": "9000000009"})
    own = await client.patch(ME, json={"email": "me@example.com"})

    assert email.status_code == 409
    assert email.json()["detail"] == "An account with this email already exists"
    assert phone.status_code == 409
    assert phone.json()["detail"] == "An account with this phone number already exists"
    assert own.status_code == 200
    assert other.email == "taken@example.com"


async def test_update_profile_keeps_one_contact_and_required_fields(
    auth_client: AuthClientFactory, make_user: MakeUser
) -> None:
    farmer, _ = await make_user("farmer", email=None, phone="+919000000001")
    buyer, _ = await make_user("buyer")

    no_contact = await auth_client(farmer).patch(ME, json={"phone": None})
    no_org = await auth_client(buyer).patch(ME, json={"organization_name": None})
    null_name = await auth_client(farmer).patch(ME, json={"full_name": None})
    half_coordinates = await auth_client(farmer).patch(ME, json={"latitude": 13.6})
    bad_phone = await auth_client(farmer).patch(ME, json={"phone": "0123456789"})

    for response in (no_contact, no_org, null_name, half_coordinates, bad_phone):
        assert response.status_code == 422
    assert no_contact.json()["detail"][0]["loc"] == ["body", "phone"]
    assert no_org.json()["detail"][0]["loc"] == ["body", "organization_name"]


async def test_profile_endpoints_require_authentication(client: AsyncClient) -> None:
    assert (await client.patch(ME, json={"full_name": "X"})).status_code == 401
    assert (
        await client.post(PASSWORD, json={"current_password": "a", "new_password": "Mango2027"})
    ).status_code == 401
    assert (await client.post(VERIFICATION, json={"documents_note": "x"})).status_code == 401


# ─────────────────────────────── Password ───────────────────────────────


async def test_change_password_verifies_current_and_signs_out_other_sessions(
    auth_client: AuthClientFactory, make_user: MakeUser, db: AsyncSession
) -> None:
    farmer, password = await make_user("farmer", email="ravi@example.com")
    other_device = auth_client(farmer)
    await other_device.post(LOGIN, json={"identifier": "ravi@example.com", "password": password})
    this_device = auth_client(farmer)

    wrong = await this_device.post(
        PASSWORD, json={"current_password": "Wrong2026", "new_password": "Mango2027"}
    )
    weak = await this_device.post(
        PASSWORD, json={"current_password": password, "new_password": "mangoes"}
    )
    same = await this_device.post(
        PASSWORD, json={"current_password": password, "new_password": password}
    )
    changed = await this_device.post(
        PASSWORD, json={"current_password": password, "new_password": "Mango2027"}
    )

    assert wrong.status_code == 422
    assert wrong.json()["detail"][0]["loc"] == ["body", "current_password"]
    assert wrong.json()["detail"][0]["msg"] == "Current password is incorrect"
    assert weak.status_code == 422
    assert same.status_code == 422
    assert changed.status_code == 204
    assert REFRESH_COOKIE in this_device.cookies

    farmer_id = farmer.id
    db.expire_all()
    stored = await db.get(User, farmer_id)
    assert stored is not None and verify_password("Mango2027", stored.password_hash)
    assert (await other_device.post(REFRESH)).status_code == 401
    assert (await this_device.post(REFRESH)).status_code == 200
    active = (
        await db.scalars(
            select(RefreshToken).where(
                RefreshToken.user_id == farmer_id, RefreshToken.revoked_at.is_(None)
            )
        )
    ).all()
    assert len(active) == 1


# ───────────────────────────── Verification ─────────────────────────────


@pytest.mark.parametrize("role", ["buyer", "transporter"])
async def test_verification_request_sets_pending_and_notifies_reviewers(
    auth_client: AuthClientFactory, make_user: MakeUser, db: AsyncSession, role: str
) -> None:
    requester, _ = await make_user(role, verification_status="unverified")
    admin, _ = await make_user("admin")
    coordinator, _ = await make_user("coordinator")
    farmer, _ = await make_user("farmer")

    response = await auth_client(requester).post(
        VERIFICATION, json={"documents_note": "GSTIN 37ABCDE1234F1Z5, FSSAI licence attached"}
    )

    assert response.status_code == 200
    assert response.json()["verification_status"] == "pending"
    recipients = set(
        (
            await db.scalars(
                select(Notification.user_id).where(Notification.type == "verification")
            )
        ).all()
    )
    assert recipients == {admin.id, coordinator.id}
    assert farmer.id not in recipients
    stored = await db.get(User, requester.id)
    await db.refresh(stored)
    assert stored is not None
    assert stored.verification_documents_note == "GSTIN 37ABCDE1234F1Z5, FSSAI licence attached"
    entry = await db.scalar(select(AuditLog).where(AuditLog.action == "user.verification_request"))
    assert entry is not None


@pytest.mark.parametrize("role", ["farmer", "coordinator", "admin"])
async def test_verification_request_is_for_buyers_and_transporters(
    auth_client: AuthClientFactory, make_user: MakeUser, role: str
) -> None:
    user, _ = await make_user(role)

    response = await auth_client(user).post(VERIFICATION, json={"documents_note": "Aadhaar"})

    assert response.status_code == 403


async def test_verification_request_validation_and_state(
    auth_client: AuthClientFactory, make_user: MakeUser
) -> None:
    verified, _ = await make_user("buyer", verification_status="verified")
    unverified, _ = await make_user("transporter", verification_status="unverified")

    already = await auth_client(verified).post(VERIFICATION, json={"documents_note": "GSTIN"})
    empty = await auth_client(unverified).post(VERIFICATION, json={"documents_note": "   "})

    assert already.status_code == 409
    assert empty.status_code == 422
