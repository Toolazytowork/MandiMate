"""/admin: user listing and search, verification decisions and the audit log."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, Notification
from app.services.audit import audit
from tests.conftest import AuthClientFactory, MakeUser

USERS = "/api/v1/admin/users"
AUDIT = "/api/v1/admin/audit-log"


def _verify_url(user_id: uuid.UUID | str) -> str:
    return f"{USERS}/{user_id}/verification"


# ──────────────────────────────── Users ─────────────────────────────────


async def test_admin_lists_users_newest_first_with_filters(
    auth_client: AuthClientFactory, make_user: MakeUser
) -> None:
    admin, _ = await make_user("admin")
    farmer, _ = await make_user("farmer", full_name="Lakshmi Devi")
    pending_buyer, _ = await make_user(
        "buyer",
        verification_status="pending",
        organization_name="FreshBasket Retail Pvt Ltd",
        email="procurement@freshbasket.in",
    )
    transporter, _ = await make_user("transporter", verification_status="unverified")
    client = auth_client(admin)

    everyone = await client.get(USERS)
    buyers = await client.get(USERS, params={"role": "buyer"})
    pending = await client.get(USERS, params={"verification_status": "pending"})
    by_org = await client.get(USERS, params={"q": "freshbasket"})
    by_name = await client.get(USERS, params={"q": "lakshmi"})
    by_phone = await client.get(USERS, params={"q": transporter.phone[-5:]})
    wildcard = await client.get(USERS, params={"q": "%"})
    limited = await client.get(USERS, params={"limit": 2})

    assert everyone.status_code == 200
    assert [user["id"] for user in everyone.json()] == [
        str(transporter.id),
        str(pending_buyer.id),
        str(farmer.id),
        str(admin.id),
    ]
    assert [user["id"] for user in buyers.json()] == [str(pending_buyer.id)]
    assert [user["id"] for user in pending.json()] == [str(pending_buyer.id)]
    assert [user["id"] for user in by_org.json()] == [str(pending_buyer.id)]
    assert [user["id"] for user in by_name.json()] == [str(farmer.id)]
    assert [user["id"] for user in by_phone.json()] == [str(transporter.id)]
    assert wildcard.json() == []
    assert len(limited.json()) == 2


async def test_coordinator_lists_users_read_only_without_admins(
    auth_client: AuthClientFactory, make_user: MakeUser
) -> None:
    admin, _ = await make_user("admin")
    coordinator, _ = await make_user("coordinator")
    buyer, _ = await make_user("buyer")

    response = await auth_client(coordinator).get(USERS)

    assert response.status_code == 200
    ids = {user["id"] for user in response.json()}
    assert ids == {str(coordinator.id), str(buyer.id)}
    assert str(admin.id) not in ids


@pytest.mark.parametrize("role", ["farmer", "buyer", "transporter"])
async def test_user_list_is_forbidden_for_other_roles(
    auth_client: AuthClientFactory, make_user: MakeUser, role: str
) -> None:
    user, _ = await make_user(role)

    assert (await auth_client(user).get(USERS)).status_code == 403


async def test_user_list_validation(auth_client: AuthClientFactory, make_user: MakeUser) -> None:
    admin, _ = await make_user("admin")
    client = auth_client(admin)

    assert (await client.get(USERS, params={"role": "wizard"})).status_code == 422
    assert (await client.get(USERS, params={"limit": 0})).status_code == 422
    assert (await client.get(USERS, params={"limit": 501})).status_code == 422


# ───────────────────────────── Verification ─────────────────────────────


async def test_verification_flow_request_then_coordinator_verifies(
    auth_client: AuthClientFactory, make_user: MakeUser, db: AsyncSession
) -> None:
    buyer, _ = await make_user("buyer", verification_status="unverified")
    coordinator, _ = await make_user("coordinator")
    buyer_client = auth_client(buyer)

    requested = await buyer_client.post(
        "/api/v1/users/me/verification-request", json={"documents_note": "GSTIN 37ABCDE1234F1Z5"}
    )
    assert requested.json()["verification_status"] == "pending"
    queue = await auth_client(coordinator).get(USERS, params={"verification_status": "pending"})
    assert [user["id"] for user in queue.json()] == [str(buyer.id)]

    decided = await auth_client(coordinator).post(
        _verify_url(buyer.id), json={"status": "verified", "note": "GSTIN checked"}
    )

    assert decided.status_code == 200
    assert decided.json()["verification_status"] == "verified"
    assert decided.json()["verification_note"] == "GSTIN checked"
    assert (await buyer_client.get("/api/v1/auth/me")).json()["verification_status"] == "verified"
    told = await db.scalar(
        select(Notification).where(
            Notification.user_id == buyer.id, Notification.type == "verification"
        )
    )
    assert told is not None and told.title == "Your account is verified"
    assert "GSTIN checked" in told.body
    entry = await db.scalar(select(AuditLog).where(AuditLog.action == "user.verification"))
    assert entry is not None and entry.actor_id == coordinator.id


async def test_admin_can_reject_and_verify_coordinators(
    auth_client: AuthClientFactory, make_user: MakeUser, db: AsyncSession
) -> None:
    admin, _ = await make_user("admin")
    coordinator, _ = await make_user("coordinator", verification_status="pending")

    rejected = await auth_client(admin).post(
        _verify_url(coordinator.id), json={"status": "rejected", "note": "FPO not registered"}
    )
    verified = await auth_client(admin).post(
        _verify_url(coordinator.id), json={"status": "verified"}
    )

    assert rejected.status_code == 200
    assert rejected.json()["verification_status"] == "rejected"
    assert verified.json()["verification_status"] == "verified"
    assert verified.json()["verification_note"] is None
    titles = (
        await db.scalars(
            select(Notification.title)
            .where(Notification.user_id == coordinator.id)
            .order_by(Notification.created_at)
        )
    ).all()
    assert list(titles) == ["Verification not approved", "Your account is verified"]


async def test_verification_permissions(
    auth_client: AuthClientFactory, make_user: MakeUser
) -> None:
    admin, _ = await make_user("admin")
    coordinator, _ = await make_user("coordinator")
    other_coordinator, _ = await make_user("coordinator", verification_status="pending")
    farmer, _ = await make_user("farmer", verification_status="unverified")
    buyer, _ = await make_user("buyer")
    body = {"status": "verified"}

    coordinator_on_coordinator = await auth_client(coordinator).post(
        _verify_url(other_coordinator.id), json=body
    )
    coordinator_on_admin = await auth_client(coordinator).post(_verify_url(admin.id), json=body)
    coordinator_on_farmer = await auth_client(coordinator).post(_verify_url(farmer.id), json=body)
    buyer_on_farmer = await auth_client(buyer).post(_verify_url(farmer.id), json=body)
    admin_on_self = await auth_client(admin).post(_verify_url(admin.id), json=body)
    missing = await auth_client(admin).post(_verify_url(uuid.uuid4()), json=body)
    invalid = await auth_client(admin).post(_verify_url(farmer.id), json={"status": "pending"})

    assert coordinator_on_coordinator.status_code == 403
    assert coordinator_on_admin.status_code == 404
    assert coordinator_on_farmer.status_code == 200
    assert buyer_on_farmer.status_code == 403
    assert admin_on_self.status_code == 403
    assert missing.status_code == 404
    assert invalid.status_code == 422


# ─────────────────────────────── Audit log ──────────────────────────────


async def test_audit_log_is_admin_only_newest_first_with_actor_names(
    auth_client: AuthClientFactory, make_user: MakeUser, db: AsyncSession, client: AsyncClient
) -> None:
    admin, _ = await make_user("admin", full_name="Priya Menon")
    coordinator, _ = await make_user("coordinator", full_name="Suresh Chowdary")
    await audit(db, coordinator, "lot.create", "lot", uuid.uuid4(), "Created lot MM-TOM-0001")
    await audit(db, None, "contact.submit", "contact_message", None, "Contact message from Asha")
    await db.commit()

    response = await auth_client(admin).get(AUDIT)
    limited = await auth_client(admin).get(AUDIT, params={"limit": 1})

    assert response.status_code == 200
    entries = response.json()
    assert [entry["action"] for entry in entries] == ["contact.submit", "lot.create"]
    assert entries[0]["actor_name"] is None
    assert entries[1]["actor_name"] == "Suresh Chowdary"
    assert entries[1]["entity_type"] == "lot"
    assert len(limited.json()) == 1
    assert (await auth_client(coordinator).get(AUDIT)).status_code == 403
    assert (await client.get(AUDIT)).status_code == 401
