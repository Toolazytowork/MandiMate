"""Delivery and quality-check records."""

import uuid

from fastapi import APIRouter, status

from app import schemas
from app.core.deps import CurrentUser, DbSession
from app.services import settlement_service

router = APIRouter(tags=["deliveries"])


@router.get("/lots/{lot_id}/delivery", response_model=schemas.DeliveryRecord)
async def get_delivery(
    lot_id: uuid.UUID, db: DbSession, user: CurrentUser
) -> schemas.DeliveryRecord:
    """The lot's delivery record (participants; 404 until it is recorded)."""
    return await settlement_service.get_delivery_for_viewer(db, lot_id, user)


@router.post(
    "/lots/{lot_id}/delivery",
    response_model=schemas.DeliveryRecord,
    status_code=status.HTTP_201_CREATED,
)
async def record_delivery(
    lot_id: uuid.UUID, body: schemas.DeliveryRecordRequest, db: DbSession, user: CurrentUser
) -> schemas.DeliveryRecord:
    """Weights and quality check at the buyer (buyer of the accepted offer or a coordinator).

    Moves the lot to ``delivered`` and creates its settlement.
    """
    lot, delivery = await settlement_service.record_delivery(db, user, lot_id, body)
    return await settlement_service.delivery_out(db, lot, delivery, user)
