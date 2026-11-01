"""Public statistics and the contact form."""

from __future__ import annotations

from datetime import timedelta
from typing import TYPE_CHECKING

from fastapi import status
from sqlalchemy import func, select

from app import schemas
from app.core.errors import DomainError
from app.core.security import normalize_email
from app.core.time import utcnow
from app.models import ContactMessage, FarmerPayout, Lot, Settlement, User
from app.services.audit import audit
from app.services.pricing import round_money

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

DEMO_EMAIL_SUFFIX = ".demo"
"""Seeded demo accounts use ``@….demo`` addresses; their presence marks the data as a demo."""

CONTACT_MAX_PER_HOUR = 5
CONTACT_WINDOW = timedelta(hours=1)
CONTACT_THROTTLED = "Too many messages from your network. Please try again in an hour."


async def public_stats(db: AsyncSession) -> schemas.PublicStats:
    """Headline numbers for the marketing site (no personal data)."""
    role_counts = dict(
        (
            await db.execute(
                select(User.role, func.count(User.id))
                .where(User.role.in_(("farmer", "buyer", "transporter")))
                .group_by(User.role)
            )
        ).all()
    )
    kg_traded = await db.scalar(select(func.coalesce(func.sum(Settlement.total_accepted_kg), 0)))
    lots_completed = await db.scalar(select(func.count(Lot.id)).where(Lot.status == "settled"))
    uplift_row = (
        await db.execute(
            select(
                func.sum(FarmerPayout.uplift_per_kg * FarmerPayout.dispatched_kg),
                func.sum(FarmerPayout.dispatched_kg),
            ).where(FarmerPayout.uplift_per_kg.is_not(None), FarmerPayout.dispatched_kg > 0)
        )
    ).one()
    weighted_uplift, weight = uplift_row
    avg_uplift = (
        float(round_money(weighted_uplift / weight))
        if weight and weighted_uplift is not None
        else None
    )
    is_demo = await db.scalar(
        select(select(User.id).where(func.lower(User.email).like(f"%{DEMO_EMAIL_SUFFIX}")).exists())
    )
    return schemas.PublicStats(
        farmers=int(role_counts.get("farmer", 0)),
        buyers=int(role_counts.get("buyer", 0)),
        transporters=int(role_counts.get("transporter", 0)),
        kg_traded=float(round_money(kg_traded or 0)),
        lots_completed=int(lots_completed or 0),
        avg_uplift_per_kg=avg_uplift,
        is_demo_data=bool(is_demo),
    )


async def submit_contact(
    db: AsyncSession, req: schemas.ContactRequest, *, ip: str | None
) -> ContactMessage:
    """Store a contact message (at most five per client IP per hour) and audit it."""
    since = utcnow() - CONTACT_WINDOW
    ip_filter = ContactMessage.ip.is_(None) if ip is None else ContactMessage.ip == ip
    recent = await db.scalar(
        select(func.count(ContactMessage.id)).where(ip_filter, ContactMessage.created_at > since)
    )
    if (recent or 0) >= CONTACT_MAX_PER_HOUR:
        raise DomainError(
            status.HTTP_429_TOO_MANY_REQUESTS,
            CONTACT_THROTTLED,
            "rate_limited",
            headers={"Retry-After": str(int(CONTACT_WINDOW.total_seconds()))},
        )

    message = ContactMessage(
        name=req.name,
        email=normalize_email(str(req.email)),
        organization=req.organization,
        role=req.role,
        message=req.message,
        ip=ip,
    )
    db.add(message)
    await db.flush()
    organization = f" ({req.organization})" if req.organization else ""
    await audit(
        db,
        None,
        "contact.submit",
        "contact_message",
        message.id,
        f"Contact message from {req.name}{organization}",
        {"role": req.role},
        ip=ip,
    )
    return message
