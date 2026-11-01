"""Lot matching, pooling, consent and opening for offers."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app import schemas
from app.core.deps import CurrentUser, DbSession, require_roles
from app.models import User
from app.services import lot_service, match_service

router = APIRouter(prefix="/lots", tags=["lots"])

Coordinator = Annotated[User, Depends(require_roles("coordinator"))]
Farmer = Annotated[User, Depends(require_roles("farmer"))]


@router.post("/match-preview", response_model=schemas.MatchProposal, summary="Preview a lot match")
async def match_preview(
    req: schemas.MatchPreviewRequest, db: DbSession, user: Coordinator
) -> schemas.MatchProposal:
    """Compatible harvests for a crop and grade near a collection point, best score first."""
    return await match_service.match_preview(db, req, user)


@router.get("", response_model=list[schemas.Lot], summary="List lots")
async def list_lots(
    db: DbSession,
    user: CurrentUser,
    status: schemas.LotStatus | None = None,
    crop_id: uuid.UUID | None = None,
    mine: bool = False,
    limit: Annotated[int, Query(ge=1, le=lot_service.MAX_LIST_LIMIT)] = (
        lot_service.DEFAULT_LIST_LIMIT
    ),
) -> list[schemas.Lot]:
    """Lots visible to the caller, newest first.

    Farmers: lots with their harvests plus joinable lots for crops they list. Buyers: lots open
    for offers plus lots they made offers on. Transporters: lots they quoted for.
    """
    lots = await lot_service.list_lots(
        db, user, status=status, crop_id=crop_id, mine=mine, limit=limit
    )
    return await lot_service.lots_out(db, lots, user)


@router.post(
    "",
    response_model=schemas.Lot,
    status_code=status.HTTP_201_CREATED,
    summary="Create a lot",
)
async def create_lot(
    req: schemas.LotCreateRequest, db: DbSession, user: Coordinator
) -> schemas.Lot:
    """Pool harvests into a lot; members are asked for consent (no members: ``forming``)."""
    lot = await lot_service.create_lot(db, req, user)
    return await lot_service.lot_out(db, lot, user)


@router.get("/{lot_id}", response_model=schemas.Lot, summary="Get a lot")
async def get_lot(lot_id: uuid.UUID, db: DbSession, user: CurrentUser) -> schemas.Lot:
    """Participants; buyers while the lot is open for offers."""
    lot = await lot_service.get_lot_for_viewer(db, lot_id, user)
    return await lot_service.lot_out(db, lot, user)


@router.post("/{lot_id}/join", response_model=schemas.Lot, summary="Join a lot")
async def join_lot(
    lot_id: uuid.UUID, req: schemas.JoinLotRequest, db: DbSession, user: Farmer
) -> schemas.Lot:
    """A farmer adds one of their harvests to a forming lot (consent recorded as accepted)."""
    lot = await lot_service.get_lot_for_viewer(db, lot_id, user)
    lot = await lot_service.join_lot(db, lot, req, user)
    return await lot_service.lot_out(db, lot, user)


@router.post(
    "/{lot_id}/members/{member_id}/consent",
    response_model=schemas.Lot,
    summary="Consent to pooling",
)
async def member_consent(
    lot_id: uuid.UUID,
    member_id: uuid.UUID,
    req: schemas.ConsentRequest,
    db: DbSession,
    user: CurrentUser,
) -> schemas.Lot:
    """The member's farmer decides; a coordinator may record it for them (assisted consent)."""
    lot = await lot_service.get_lot_for_viewer(db, lot_id, user)
    lot = await lot_service.record_member_consent(db, lot, member_id, req, user)
    return await lot_service.lot_out(db, lot, user)


@router.post("/{lot_id}/open", response_model=schemas.Lot, summary="Open a lot for offers")
async def open_lot(lot_id: uuid.UUID, db: DbSession, user: Coordinator) -> schemas.Lot:
    """Members who did not respond are declined; needs at least one consenting farmer."""
    lot = await lot_service.get_lot_for_viewer(db, lot_id, user)
    lot = await lot_service.open_lot(db, lot, user)
    return await lot_service.lot_out(db, lot, user)


@router.post("/{lot_id}/cancel", response_model=schemas.Lot, summary="Cancel a lot")
async def cancel_lot(lot_id: uuid.UUID, db: DbSession, user: Coordinator) -> schemas.Lot:
    """Open offers are rejected and the member harvests become available again."""
    lot = await lot_service.get_lot_for_viewer(db, lot_id, user)
    lot = await lot_service.cancel_lot(db, lot, user)
    return await lot_service.lot_out(db, lot, user)
