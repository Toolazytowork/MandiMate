"""Disputes about lots and settlements (DOMAIN_RULES §2 "Dispute", §8).

``open → under_review → resolved | rejected``. While a dispute on a lot is open or under review
the lot's settlement is ``disputed`` (payouts are frozen); resolving or rejecting it restores the
settlement's normal status.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import or_, select

from app import schemas
from app.core.errors import conflict, forbidden, not_found
from app.core.time import utcnow
from app.models import Dispute, Settlement, User
from app.services import settlement_service
from app.services.audit import audit
from app.services.codes import next_code
from app.services.notify import coordinator_ids_for, notify
from app.services.presenters import farmer_display_name
from app.services.transport_service import (
    active_members,
    invalid_input,
    is_staff,
    load_lot_for_participant,
    participant_lot_ids_query,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    "open": frozenset({"under_review", "resolved", "rejected"}),
    "under_review": frozenset({"resolved", "rejected"}),
    "resolved": frozenset(),
    "rejected": frozenset(),
}
STATUS_WORDS = {
    "open": "open",
    "under_review": "under review",
    "resolved": "resolved",
    "rejected": "rejected",
}


def dispute_out(dispute: Dispute, viewer: User) -> schemas.Dispute:
    raiser = dispute.raised_by
    raiser_name = (
        farmer_display_name(raiser, viewer) if raiser.role == "farmer" else raiser.full_name
    )
    return schemas.Dispute(
        id=dispute.id,
        code=dispute.code,
        lot_id=dispute.lot_id,
        lot_code=dispute.lot.code,
        settlement_id=dispute.settlement_id,
        raised_by_id=dispute.raised_by_id,
        raised_by_name=raiser_name,
        raised_by_role=dispute.raised_by_role,
        category=dispute.category,
        description=dispute.description,
        status=dispute.status,
        resolution=dispute.resolution,
        resolved_by_name=dispute.resolved_by.full_name if dispute.resolved_by else None,
        created_at=dispute.created_at,
        resolved_at=dispute.resolved_at,
    )


async def list_disputes(
    db: AsyncSession,
    viewer: User,
    *,
    status: schemas.DisputeStatus | None = None,
    limit: int = 100,
) -> list[Dispute]:
    """Coordinators and admins see all; others the disputes they raised or on their lots."""
    query = select(Dispute)
    if not is_staff(viewer):
        query = query.where(
            or_(
                Dispute.raised_by_id == viewer.id,
                Dispute.lot_id.in_(participant_lot_ids_query(viewer)),
            )
        )
    if status is not None:
        query = query.where(Dispute.status == status)
    query = query.order_by(Dispute.created_at.desc(), Dispute.id.desc()).limit(limit)
    return list(await db.scalars(query))


async def create_dispute(
    db: AsyncSession, user: User, body: schemas.DisputeCreateRequest
) -> Dispute:
    """A lot participant raises a dispute; the lot's settlement becomes ``disputed``."""
    lot, access = await load_lot_for_participant(db, body.lot_id, user)
    if not access.active:
        raise forbidden("Only participants in this deal can raise a dispute")
    settlement = await db.scalar(select(Settlement).where(Settlement.lot_id == lot.id))
    if body.settlement_id is not None and (
        settlement is None or settlement.id != body.settlement_id
    ):
        raise invalid_input(
            ("body", "settlement_id"),
            "The settlement does not belong to this lot",
            str(body.settlement_id),
        )
    dispute = Dispute(
        code=await next_code(db, "dispute"),
        lot=lot,
        settlement_id=settlement.id if settlement is not None else None,
        raised_by_id=user.id,
        raised_by=user,
        raised_by_role=user.role,
        category=body.category,
        description=body.description,
        status="open",
    )
    db.add(dispute)
    await db.flush()
    if settlement is not None:
        await settlement_service.refresh_settlement_status(db, settlement)

    await notify(
        db,
        await coordinator_ids_for(db, [member.farmer_id for member in active_members(lot)]),
        "dispute",
        f"Dispute {dispute.code} raised on lot {lot.code}",
        f"{user.full_name} ({user.role}) raised a {body.category} dispute: "
        f"{_excerpt(body.description)}",
        "/app/coordinator/disputes",
    )
    await audit(
        db,
        user,
        "dispute.create",
        "dispute",
        dispute.id,
        f"Raised {body.category} dispute {dispute.code} on lot {lot.code}",
        {"lot_id": lot.id, "settlement_id": dispute.settlement_id, "category": body.category},
    )
    return dispute


async def update_dispute(
    db: AsyncSession, coordinator: User, dispute_id: uuid.UUID, body: schemas.DisputeUpdateRequest
) -> Dispute:
    """Coordinator review: ``under_review``, ``resolved`` or ``rejected`` (with a resolution)."""
    dispute = await db.get(Dispute, dispute_id)
    if dispute is None:
        raise not_found("Dispute")
    if body.status not in ALLOWED_TRANSITIONS[dispute.status]:
        raise conflict(
            f"A dispute that is {STATUS_WORDS[dispute.status]} cannot be moved to "
            f"{STATUS_WORDS[body.status]}"
        )
    dispute.status = body.status
    if body.resolution is not None:
        dispute.resolution = body.resolution
    if body.status in ("resolved", "rejected"):
        dispute.resolved_by_id = coordinator.id
        dispute.resolved_by = coordinator
        dispute.resolved_at = utcnow()
    await db.flush()
    settlement = await db.scalar(select(Settlement).where(Settlement.lot_id == dispute.lot_id))
    if settlement is not None:
        await settlement_service.refresh_settlement_status(db, settlement)

    raiser = dispute.raised_by
    link = (
        "/app/coordinator/disputes" if raiser.role in ("coordinator", "admin") else "/app/disputes"
    )
    message = f"Dispute {dispute.code} on lot {dispute.lot.code} is {STATUS_WORDS[body.status]}."
    if dispute.resolution:
        message += f" {_excerpt(dispute.resolution)}"
    await notify(
        db,
        [dispute.raised_by_id],
        "dispute",
        f"Dispute {dispute.code} {STATUS_WORDS[body.status]}",
        message,
        link,
    )
    await audit(
        db,
        coordinator,
        "dispute.update",
        "dispute",
        dispute.id,
        f"Dispute {dispute.code} → {STATUS_WORDS[body.status]}",
        {"status": body.status, "resolution": body.resolution},
    )
    return dispute


def _excerpt(text: str, limit: int = 160) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"
