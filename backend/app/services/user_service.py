"""Profiles, passwords, verification, user administration and coordinator farmer onboarding."""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import func, or_, select

from app import schemas
from app.core.errors import conflict, forbidden, not_found
from app.core.security import (
    generate_temporary_password,
    hash_password,
    normalize_email,
    verify_password,
)
from app.models import AuditLog, FarmerPayout, Harvest, LotMember, User
from app.services.audit import audit
from app.services.auth_service import (
    ClientInfo,
    ensure_contact_available,
    field_error,
    normalized_phone_or_422,
    revoke_all_sessions,
    start_session,
)
from app.services.notify import coordinator_ids_for, notify
from app.services.presenters import user_out
from app.services.pricing import round_money

if TYPE_CHECKING:
    from datetime import datetime

    from fastapi import Response
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models.enums import Role, VerificationStatus

ORGANIZATION_ROLES = frozenset({"buyer", "transporter", "coordinator"})
VERIFICATION_REQUEST_ROLES = frozenset({"buyer", "transporter"})
COORDINATOR_VERIFIABLE_ROLES = frozenset({"farmer", "buyer", "transporter"})

ACTIVE_HARVEST_STATUSES = ("listed", "pooled", "committed", "picked_up", "delivered")
LISTED_HARVEST_STATUSES = ("listed", "pooled")

VERIFICATIONS_LINK = "/app/coordinator/verifications"


# ─────────────────────────────── Profile ────────────────────────────────


async def update_profile(db: AsyncSession, user: User, req: schemas.UpdateProfileRequest) -> User:
    """Apply the fields that were sent; email/phone changes must stay unique."""
    changes: dict[str, Any] = req.model_dump(exclude_unset=True)

    if "email" in changes and changes["email"] is not None:
        changes["email"] = normalize_email(str(changes["email"]))
    if "phone" in changes and changes["phone"] is not None:
        changes["phone"] = normalized_phone_or_422(changes["phone"])

    email = changes.get("email", user.email)
    phone = changes.get("phone", user.phone)
    if email is None and phone is None:
        field = "email" if "email" in changes else "phone"
        raise field_error(field, "Keep an email address or a phone number on your account")
    if (
        user.role in ORGANIZATION_ROLES
        and "organization_name" in changes
        and changes["organization_name"] is None
    ):
        raise field_error(
            "organization_name",
            "Organization name is required for buyers, transporters and coordinators",
        )
    await ensure_contact_available(
        db,
        email=email if email != user.email else None,
        phone=phone if phone != user.phone else None,
        exclude_user_id=user.id,
    )

    changed = sorted(field for field, value in changes.items() if getattr(user, field) != value)
    for field in changed:
        setattr(user, field, changes[field])
    if changed:
        await db.flush()
        await audit(
            db,
            user,
            "user.update_profile",
            "user",
            user.id,
            f"{user.full_name} updated their profile ({', '.join(changed)})",
            {"fields": changed},
        )
    return user


async def change_password(
    db: AsyncSession,
    user: User,
    req: schemas.ChangePasswordRequest,
    response: Response,
    client: ClientInfo,
) -> None:
    """Verify the current password, store the new one and sign out every other session.

    The caller's own session continues with freshly issued cookies.
    """
    if not verify_password(req.current_password, user.password_hash):
        raise field_error("current_password", "Current password is incorrect", "password_incorrect")
    user.password_hash = hash_password(req.new_password)
    await revoke_all_sessions(db, user.id)
    await audit(
        db,
        user,
        "user.change_password",
        "user",
        user.id,
        f"{user.full_name} changed their password",
        ip=client.ip,
    )
    await start_session(db, response, user, client)


async def request_verification(
    db: AsyncSession, user: User, req: schemas.VerificationRequest
) -> User:
    """Buyers and transporters submit documents; status → ``pending`` and reviewers are told."""
    if user.role not in VERIFICATION_REQUEST_ROLES:
        raise forbidden("Only buyers and transporters request verification")
    if user.verification_status == "verified":
        raise conflict("Your account is already verified")

    user.verification_status = "pending"
    user.verification_documents_note = req.documents_note
    user.verification_note = None
    await db.flush()

    await audit(
        db,
        user,
        "user.verification_request",
        "user",
        user.id,
        f"{user.full_name} ({user.role}) requested verification",
        {"documents_note": req.documents_note},
    )
    admin_ids = (
        await db.scalars(select(User.id).where(User.role == "admin", User.is_active.is_(True)))
    ).all()
    reviewers = [*admin_ids, *await coordinator_ids_for(db, [])]
    organization = f" ({user.organization_name})" if user.organization_name else ""
    await notify(
        db,
        reviewers,
        "verification",
        "Verification requested",
        f"{user.full_name}{organization}, {user.role}, submitted documents for verification: "
        f"{_excerpt(req.documents_note)}",
        link=VERIFICATIONS_LINK,
    )
    return user


def _excerpt(text: str, limit: int = 160) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


# ────────────────────────────── Administration ──────────────────────────


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def list_users(
    db: AsyncSession,
    viewer: User,
    *,
    role: Role | None = None,
    verification_status: VerificationStatus | None = None,
    q: str | None = None,
    limit: int = 100,
) -> list[User]:
    """Users newest first. Admins see everyone; coordinators (read-only) see non-admins."""
    query = select(User)
    if viewer.role != "admin":
        query = query.where(User.role != "admin")
    if role is not None:
        query = query.where(User.role == role)
    if verification_status is not None:
        query = query.where(User.verification_status == verification_status)
    text = (q or "").strip()
    if text:
        pattern = f"%{_escape_like(text)}%"
        query = query.where(
            or_(
                User.full_name.ilike(pattern, escape="\\"),
                User.email.ilike(pattern, escape="\\"),
                User.phone.ilike(pattern, escape="\\"),
                User.organization_name.ilike(pattern, escape="\\"),
            )
        )
    query = query.order_by(User.created_at.desc(), User.id).limit(limit)
    return list((await db.scalars(query)).all())


async def decide_verification(
    db: AsyncSession, actor: User, user_id: uuid.UUID, req: schemas.VerifyUserRequest
) -> User:
    """Verify or reject a user and tell them. Coordinators decide on farmers, buyers and
    transporters only; admins on anyone except themselves."""
    target = await db.get(User, user_id)
    if target is None or (actor.role != "admin" and target.role == "admin"):
        raise not_found("User")
    if actor.role != "admin" and target.role not in COORDINATOR_VERIFIABLE_ROLES:
        raise forbidden("Only an admin can verify coordinator accounts")
    if target.id == actor.id:
        raise forbidden("You cannot decide on your own verification")

    previous = target.verification_status
    target.verification_status = req.status
    target.verification_note = req.note
    await db.flush()

    verb = "verified" if req.status == "verified" else "rejected the verification of"
    await audit(
        db,
        actor,
        "user.verification",
        "user",
        target.id,
        f"{actor.full_name} {verb} {target.full_name} ({target.role})",
        {"status": req.status, "previous_status": previous, "note": req.note},
    )
    if req.status == "verified":
        title = "Your account is verified"
        body = "MandiMate has verified your account. Buyers and farmers now see you as verified."
    else:
        title = "Verification not approved"
        body = "Your verification request was not approved."
    if req.note:
        body += f" Note: {req.note}"
    link = "/app/verification" if target.role in VERIFICATION_REQUEST_ROLES else "/app/settings"
    await notify(db, [target.id], "verification", title, body, link=link)
    return target


async def list_audit_log(db: AsyncSession, *, limit: int = 100) -> list[schemas.AuditEntry]:
    """Newest entries first, with the actor's name (``None`` for system/anonymous actions)."""
    entries = (
        await db.scalars(
            select(AuditLog).order_by(AuditLog.created_at.desc(), AuditLog.id).limit(limit)
        )
    ).all()
    return [
        schemas.AuditEntry(
            id=entry.id,
            actor_name=entry.actor.full_name if entry.actor is not None else None,
            action=entry.action,
            entity_type=entry.entity_type,
            entity_id=entry.entity_id,
            summary=entry.summary,
            created_at=entry.created_at,
        )
        for entry in entries
    ]


# ─────────────────────────── Coordinator: farmers ───────────────────────


async def list_farmer_summaries(
    db: AsyncSession, viewer: User, *, limit: int = 500
) -> list[schemas.FarmerSummary]:
    """Farmers with activity totals, newest first.

    Coordinators see the farmers of their own FPO plus unaffiliated farmers; admins see all.
    """
    query = select(User).where(User.role == "farmer")
    if viewer.role != "admin":
        scope = User.fpo_id.is_(None)
        if viewer.fpo_id is not None:
            scope = or_(scope, User.fpo_id == viewer.fpo_id)
        query = query.where(scope)
    farmers = list(
        (await db.scalars(query.order_by(User.created_at.desc(), User.id).limit(limit))).all()
    )
    if not farmers:
        return []
    ids = [farmer.id for farmer in farmers]

    harvest_rows = (
        await db.execute(
            select(
                Harvest.farmer_id,
                func.count(Harvest.id).filter(Harvest.status.in_(ACTIVE_HARVEST_STATUSES)),
                func.coalesce(
                    func.sum(Harvest.quantity_kg).filter(
                        Harvest.status.in_(LISTED_HARVEST_STATUSES)
                    ),
                    0,
                ),
                func.max(Harvest.updated_at),
            )
            .where(Harvest.farmer_id.in_(ids))
            .group_by(Harvest.farmer_id)
        )
    ).all()
    payout_rows = (
        await db.execute(
            select(
                FarmerPayout.farmer_id,
                func.coalesce(func.sum(FarmerPayout.net_amount), 0),
                func.max(FarmerPayout.updated_at),
            )
            .where(FarmerPayout.farmer_id.in_(ids))
            .group_by(FarmerPayout.farmer_id)
        )
    ).all()
    member_rows = (
        await db.execute(
            select(LotMember.farmer_id, func.max(LotMember.updated_at))
            .where(LotMember.farmer_id.in_(ids))
            .group_by(LotMember.farmer_id)
        )
    ).all()

    harvest_stats = {row[0]: (row[1], row[2], row[3]) for row in harvest_rows}
    payout_stats = {row[0]: (row[1], row[2]) for row in payout_rows}
    member_activity = {row[0]: row[1] for row in member_rows}

    summaries: list[schemas.FarmerSummary] = []
    for farmer in farmers:
        active, listed_kg, harvest_at = harvest_stats.get(farmer.id, (0, Decimal("0"), None))
        lifetime_net, payout_at = payout_stats.get(farmer.id, (Decimal("0"), None))
        moments: list[datetime] = [
            moment
            for moment in (
                farmer.last_login_at,
                harvest_at,
                payout_at,
                member_activity.get(farmer.id),
            )
            if moment is not None
        ]
        summaries.append(
            schemas.FarmerSummary(
                user=user_out(farmer),
                active_harvests=int(active),
                listed_kg=float(round_money(listed_kg)),
                lifetime_net=float(round_money(lifetime_net)),
                last_activity_at=max(moments) if moments else None,
            )
        )
    return summaries


async def register_farmer(
    db: AsyncSession, coordinator: User, req: schemas.RegisterFarmerRequest
) -> schemas.RegisteredFarmer:
    """Assisted registration: a verified farmer in the coordinator's FPO with a one-time
    temporary password (returned once, never stored in clear or logged)."""
    phone = normalized_phone_or_422(req.phone)
    email = normalize_email(str(req.email)) if req.email is not None else None
    await ensure_contact_available(db, email=email, phone=phone)

    temporary_password = generate_temporary_password()
    farmer = User(
        email=email,
        phone=phone,
        password_hash=hash_password(temporary_password),
        full_name=req.full_name,
        role="farmer",
        preferred_language=req.preferred_language,
        organization_name=None,
        village=req.village,
        district=req.district,
        state=req.state,
        latitude=req.latitude,
        longitude=req.longitude,
        verification_status="verified",
        verification_note=f"Registered in person by {coordinator.full_name}",
        is_active=True,
        created_by_id=coordinator.id,
        fpo=coordinator.fpo,
    )
    db.add(farmer)
    await db.flush()

    await audit(
        db,
        coordinator,
        "farmer.register",
        "user",
        farmer.id,
        f"{coordinator.full_name} registered farmer {farmer.full_name} ({farmer.village})",
        {"phone": phone, "fpo_id": farmer.fpo_id},
    )
    await notify(
        db,
        [farmer.id],
        "system",
        "Welcome to MandiMate",
        f"{coordinator.full_name} registered you on MandiMate. Change your temporary password "
        "from Settings after you sign in.",
        link="/app/settings",
    )
    return schemas.RegisteredFarmer(user=user_out(farmer), temporary_password=temporary_password)
