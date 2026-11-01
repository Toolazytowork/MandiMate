"""Journey timelines of harvests and lots, and a harvest's selling options."""

import uuid

from fastapi import APIRouter

from app import schemas
from app.core.deps import CurrentUser, DbSession
from app.core.errors import forbidden
from app.services import harvest_service, journey, lot_service, selling_options

router = APIRouter(tags=["timeline"])


@router.get(
    "/harvests/{harvest_id}/options",
    response_model=schemas.SellingOptions,
    summary="Selling options",
)
async def harvest_options(
    harvest_id: uuid.UUID, db: DbSession, user: CurrentUser
) -> schemas.SellingOptions:
    """Every way to sell the harvest compared by the farmer's net earnings (owner, coordinator)."""
    harvest = await harvest_service.get_harvest_for_viewer(db, harvest_id, user)
    if not (lot_service.is_privileged(user) or harvest.farmer_id == user.id):
        raise forbidden("Only the farmer or a coordinator can compare selling options")
    return await selling_options.build_selling_options(db, harvest, user)


@router.get(
    "/harvests/{harvest_id}/timeline",
    response_model=list[schemas.JourneyStep],
    summary="Harvest journey",
)
async def harvest_timeline(
    harvest_id: uuid.UUID, db: DbSession, user: CurrentUser
) -> list[schemas.JourneyStep]:
    """The eight-step journey of a harvest, following its most advanced lot (owner, coordinator)."""
    harvest = await harvest_service.get_harvest_for_viewer(db, harvest_id, user)
    if not (lot_service.is_privileged(user) or harvest.farmer_id == user.id):
        raise forbidden("Only the farmer or a coordinator can see this journey")
    return await journey.harvest_timeline(db, harvest)


@router.get(
    "/lots/{lot_id}/timeline",
    response_model=list[schemas.JourneyStep],
    summary="Lot journey",
)
async def lot_timeline(
    lot_id: uuid.UUID, db: DbSession, user: CurrentUser
) -> list[schemas.JourneyStep]:
    """The eight-step journey of a lot (participants)."""
    lot = await lot_service.get_lot_for_viewer(db, lot_id, user)
    return await journey.lot_timeline(db, lot)
