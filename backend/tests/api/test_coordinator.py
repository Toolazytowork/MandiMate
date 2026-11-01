"""/coordinator/farmers: FPO-scoped farmer summaries and assisted farmer registration."""

import re
from decimal import Decimal
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import check_password_policy, verify_password
from app.models import AuditLog, Fpo, Notification, User
from tests import factories
from tests.api.test_public import create_settlement
from tests.conftest import AuthClientFactory, MakeUser

FARMERS = "/api/v1/coordinator/farmers"
LOGIN = "/api/v1/auth/login"


def _register_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "full_name": "Venkatesh Naidu",
        "phone": "94401 23456",
        "village": "Nimmanapalle",
        "district": "Annamayya",
        "state": "Andhra Pradesh",
        "preferred_language": "te",
        "latitude": 13.5925,
        "longitude": 78.4583,
    }
    return body | overrides


async def _fpo(db: AsyncSession, name: str = "Madanapalle Tomato Growers FPO") -> Fpo:
    return await factories.create_fpo(db, name=name)


# ─────────────────────────────── Register ───────────────────────────────


async def test_coordinator_registers_a_farmer_who_can_sign_in(
    auth_client: AuthClientFactory, make_user: MakeUser, db: AsyncSession, client: AsyncClient
) -> None:
    fpo = await _fpo(db)
    coordinator, _ = await make_user("coordinator", fpo_id=fpo.id)

    response = await auth_client(coordinator).post(FARMERS, json=_register_body())

    assert response.status_code == 201
    body = response.json()
    temporary = body["temporary_password"]
    assert re.fullmatch(r"Lot-[A-Z2-9]{4}-[A-Z2-9]{4}", temporary)
    assert check_password_policy(temporary) is None
    user = body["user"]
    assert user["role"] == "farmer"
    assert user["phone"] == "+919440123456"
    assert user["verification_status"] == "verified"
    assert user["fpo_id"] == str(fpo.id)
    assert user["fpo_name"] == fpo.name
    assert user["preferred_language"] == "te"

    stored = await db.get(User, user["id"])
    assert stored is not None
    assert stored.created_by_id == coordinator.id
    assert verify_password(temporary, stored.password_hash)
    entry = await db.scalar(select(AuditLog).where(AuditLog.action == "farmer.register"))
    assert entry is not None and entry.actor_id == coordinator.id
    assert temporary not in str(entry.payload) and temporary not in entry.summary
    welcome = await db.scalar(select(Notification).where(Notification.user_id == stored.id))
    assert welcome is not None

    login = await client.post(LOGIN, json={"identifier": "9440123456", "password": temporary})
    assert login.status_code == 200


async def test_temporary_passwords_differ(
    auth_client: AuthClientFactory, make_user: MakeUser
) -> None:
    coordinator, _ = await make_user("coordinator")
    client = auth_client(coordinator)

    first = await client.post(FARMERS, json=_register_body(phone="9440100001"))
    second = await client.post(FARMERS, json=_register_body(phone="9440100002"))

    assert first.json()["temporary_password"] != second.json()["temporary_password"]


async def test_register_rejects_duplicate_phone_or_email(
    auth_client: AuthClientFactory, make_user: MakeUser
) -> None:
    coordinator, _ = await make_user("coordinator")
    await make_user("farmer", phone="+919440123456", email="ravi@example.com")
    client = auth_client(coordinator)

    phone = await client.post(FARMERS, json=_register_body(phone="+91 94401-23456"))
    email = await client.post(
        FARMERS, json=_register_body(phone="9440199999", email="RAVI@example.com")
    )

    assert phone.status_code == 409
    assert phone.json()["detail"] == "An account with this phone number already exists"
    assert email.status_code == 409


@pytest.mark.parametrize(
    "overrides",
    [{"phone": None}, {"phone": "12345"}, {"village": ""}, {"preferred_language": "fr"}],
)
async def test_register_validation_is_422(
    auth_client: AuthClientFactory, make_user: MakeUser, overrides: dict[str, Any]
) -> None:
    coordinator, _ = await make_user("coordinator")

    response = await auth_client(coordinator).post(FARMERS, json=_register_body(**overrides))

    assert response.status_code == 422


@pytest.mark.parametrize("role", ["farmer", "buyer", "transporter"])
async def test_register_is_for_coordinators(
    auth_client: AuthClientFactory, make_user: MakeUser, role: str
) -> None:
    user, _ = await make_user(role)

    assert (await auth_client(user).post(FARMERS, json=_register_body())).status_code == 403
    assert (await auth_client(user).get(FARMERS)).status_code == 403


async def test_admin_registers_unaffiliated_farmers(
    auth_client: AuthClientFactory, make_user: MakeUser
) -> None:
    admin, _ = await make_user("admin")

    response = await auth_client(admin).post(FARMERS, json=_register_body())

    assert response.status_code == 201
    assert response.json()["user"]["fpo_id"] is None


# ─────────────────────────────── Summaries ──────────────────────────────


async def test_farmer_summaries_are_scoped_to_own_fpo_and_unaffiliated(
    auth_client: AuthClientFactory, make_user: MakeUser, db: AsyncSession
) -> None:
    own_fpo = await _fpo(db)
    other_fpo = await _fpo(db, name="Punganur Mango FPO")
    coordinator, _ = await make_user("coordinator", fpo_id=own_fpo.id)
    admin, _ = await make_user("admin")
    member, _ = await make_user("farmer", fpo_id=own_fpo.id)
    unaffiliated, _ = await make_user("farmer", fpo_id=None)
    outsider, _ = await make_user("farmer", fpo_id=other_fpo.id)
    await make_user("buyer")

    scoped = await auth_client(coordinator).get(FARMERS)
    everyone = await auth_client(admin).get(FARMERS)

    assert scoped.status_code == 200
    assert [item["user"]["id"] for item in scoped.json()] == [
        str(unaffiliated.id),
        str(member.id),
    ]
    assert {item["user"]["id"] for item in everyone.json()} == {
        str(member.id),
        str(unaffiliated.id),
        str(outsider.id),
    }


async def test_coordinator_without_fpo_sees_unaffiliated_farmers(
    auth_client: AuthClientFactory, make_user: MakeUser, db: AsyncSession
) -> None:
    fpo = await _fpo(db)
    coordinator, _ = await make_user("coordinator", fpo_id=None)
    unaffiliated, _ = await make_user("farmer", fpo_id=None)
    await make_user("farmer", fpo_id=fpo.id)

    response = await auth_client(coordinator).get(FARMERS)

    assert [item["user"]["id"] for item in response.json()] == [str(unaffiliated.id)]


async def test_farmer_summary_totals(
    auth_client: AuthClientFactory, make_user: MakeUser, db: AsyncSession
) -> None:
    fpo = await _fpo(db)
    coordinator, _ = await make_user("coordinator", fpo_id=fpo.id)
    buyer, _ = await make_user("buyer")
    farmer, _ = await make_user("farmer", fpo_id=fpo.id, last_login_at=None)
    idle, _ = await make_user("farmer", fpo_id=fpo.id, last_login_at=None)
    crop = await factories.create_crop(db)
    await factories.create_harvest(db, farmer, crop, quantity_kg=Decimal("400"))
    await factories.create_harvest(db, farmer, crop, quantity_kg=Decimal("120.5"), status="pooled")
    await factories.create_harvest(db, farmer, crop, quantity_kg=Decimal("90"), status="committed")
    await factories.create_harvest(db, farmer, crop, quantity_kg=Decimal("70"), status="draft")
    await factories.create_harvest(db, farmer, crop, quantity_kg=Decimal("60"), status="cancelled")
    sold = await factories.create_harvest(db, farmer, crop, quantity_kg=Decimal("200"))
    await create_settlement(db, buyer, [sold], net_per_kg=Decimal("13.25"))

    response = await auth_client(coordinator).get(FARMERS)

    by_id = {item["user"]["id"]: item for item in response.json()}
    summary = by_id[str(farmer.id)]
    # listed 400 + pooled 120.5 + committed 90 (the settled harvest is no longer active)
    assert summary["active_harvests"] == 3
    assert summary["listed_kg"] == 520.5
    assert summary["lifetime_net"] == 2650.0
    assert summary["last_activity_at"] is not None
    assert by_id[str(idle.id)] == {
        "user": by_id[str(idle.id)]["user"],
        "active_harvests": 0,
        "listed_kg": 0.0,
        "lifetime_net": 0.0,
        "last_activity_at": None,
    }


async def test_farmer_summaries_require_authentication(client: AsyncClient) -> None:
    assert (await client.get(FARMERS)).status_code == 401
