"""Settlements, payments and farmer payouts."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Body, Depends, Query

from app import schemas
from app.core.deps import DbSession, require_roles
from app.models import User
from app.services import settlement_service

router = APIRouter(prefix="/settlements", tags=["settlements"])

SettlementViewer = Annotated[User, Depends(require_roles("buyer", "farmer", "coordinator"))]
PaymentRecorder = Annotated[User, Depends(require_roles("buyer", "coordinator"))]
Coordinator = Annotated[User, Depends(require_roles("coordinator"))]


@router.get("", response_model=list[schemas.Settlement])
async def list_settlements(
    db: DbSession,
    user: SettlementViewer,
    payment_status: schemas.PaymentStatus | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[schemas.Settlement]:
    """Buyers see their own, farmers those with their payout, coordinators and admins all."""
    items = await settlement_service.list_settlements(
        db, user, payment_status=payment_status, limit=limit
    )
    return settlement_service.settlements_out(items, user)


@router.get("/{settlement_id}", response_model=schemas.Settlement)
async def get_settlement(
    settlement_id: uuid.UUID, db: DbSession, user: SettlementViewer
) -> schemas.Settlement:
    s = await settlement_service.get_settlement_for_viewer(db, settlement_id, user)
    return await settlement_service.settlement_out(db, s, user)


@router.post("/{settlement_id}/payments", response_model=schemas.Settlement)
async def record_payment(
    settlement_id: uuid.UUID,
    body: schemas.RecordPaymentRequest,
    db: DbSession,
    user: PaymentRecorder,
) -> schemas.Settlement:
    """Money received from the buyer: ``0 < amount ≤ outstanding + ₹0.01``."""
    s = await settlement_service.record_payment(db, user, settlement_id, body)
    return await settlement_service.settlement_out(db, s, user)


@router.post("/{settlement_id}/payouts/{payout_id}/mark-paid", response_model=schemas.Settlement)
async def mark_payout_paid(
    settlement_id: uuid.UUID,
    payout_id: uuid.UUID,
    db: DbSession,
    user: Coordinator,
    body: Annotated[schemas.MarkPayoutPaidRequest | None, Body()] = None,
) -> schemas.Settlement:
    """Record a farmer's payout as paid (only once the settlement is paid in full)."""
    s = await settlement_service.mark_payout_paid(
        db, user, settlement_id, payout_id, body or schemas.MarkPayoutPaidRequest()
    )
    return await settlement_service.settlement_out(db, s, user)
