"""Harvest listings, photos and verification.

Selling options and the harvest timeline live in ``timeline.py``.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, UploadFile, status

from app import schemas
from app.core.deps import CurrentUser, DbSession, require_roles
from app.models import User
from app.services import harvest_service

router = APIRouter(prefix="/harvests", tags=["harvests"])

FarmerOrCoordinator = Annotated[User, Depends(require_roles("farmer", "coordinator"))]
Coordinator = Annotated[User, Depends(require_roles("coordinator"))]


@router.get("", response_model=list[schemas.Harvest], summary="List harvests")
async def list_harvests(
    db: DbSession,
    user: FarmerOrCoordinator,
    status: schemas.HarvestStatus | None = None,
    crop_id: uuid.UUID | None = None,
    farmer_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[schemas.Harvest]:
    """A farmer's own harvests; every harvest for coordinators and admins. Newest first."""
    harvests = await harvest_service.list_harvests(
        db, user, status=status, crop_id=crop_id, farmer_id=farmer_id, limit=limit
    )
    return await harvest_service.harvests_out(db, harvests, user)


@router.post(
    "",
    response_model=schemas.Harvest,
    status_code=status.HTTP_201_CREATED,
    summary="List a harvest",
)
async def create_harvest(
    req: schemas.HarvestCreateRequest, db: DbSession, user: FarmerOrCoordinator
) -> schemas.Harvest:
    """A farmer lists their own harvest; a coordinator lists one for a farmer (`farmer_id`)."""
    harvest = await harvest_service.create_harvest(db, req, user)
    return await harvest_service.harvest_out(db, harvest, user)


@router.get("/{harvest_id}", response_model=schemas.Harvest, summary="Get a harvest")
async def get_harvest(harvest_id: uuid.UUID, db: DbSession, user: CurrentUser) -> schemas.Harvest:
    """Owner, coordinators and admins; buyers while the harvest is listed or pooled."""
    harvest = await harvest_service.get_harvest_for_viewer(db, harvest_id, user)
    return await harvest_service.harvest_out(db, harvest, user)


@router.patch("/{harvest_id}", response_model=schemas.Harvest, summary="Edit a harvest")
async def update_harvest(
    harvest_id: uuid.UUID, req: schemas.HarvestUpdateRequest, db: DbSession, user: CurrentUser
) -> schemas.Harvest:
    """Owner or coordinator, while the harvest is a draft or listed."""
    harvest = await harvest_service.get_harvest_for_viewer(db, harvest_id, user)
    harvest = await harvest_service.update_harvest(db, harvest, req, user)
    return await harvest_service.harvest_out(db, harvest, user)


@router.post("/{harvest_id}/cancel", response_model=schemas.Harvest, summary="Cancel a harvest")
async def cancel_harvest(
    harvest_id: uuid.UUID, db: DbSession, user: CurrentUser
) -> schemas.Harvest:
    """Withdraw a draft or listed harvest (409 once pooled or committed)."""
    harvest = await harvest_service.get_harvest_for_viewer(db, harvest_id, user)
    harvest = await harvest_service.cancel_harvest(db, harvest, user)
    return await harvest_service.harvest_out(db, harvest, user)


@router.post("/{harvest_id}/verify", response_model=schemas.Harvest, summary="Record inspection")
async def verify_harvest(
    harvest_id: uuid.UUID, req: schemas.HarvestVerifyRequest, db: DbSession, user: Coordinator
) -> schemas.Harvest:
    """Coordinator inspection: grade and notes; `quality_status` becomes `inspected`."""
    harvest = await harvest_service.get_harvest_for_viewer(db, harvest_id, user)
    harvest = await harvest_service.verify_harvest(db, harvest, req, user)
    return await harvest_service.harvest_out(db, harvest, user)


@router.post(
    "/{harvest_id}/photos",
    response_model=schemas.HarvestPhoto,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a photo",
)
async def upload_photo(
    harvest_id: uuid.UUID,
    db: DbSession,
    user: CurrentUser,
    file: Annotated[UploadFile, File(description="JPEG, PNG or WebP image")],
) -> schemas.HarvestPhoto:
    """Owner or coordinator. Re-encoded to WebP (max 1600 px) with preliminary visual notes."""
    harvest = await harvest_service.get_harvest_for_viewer(db, harvest_id, user)
    photo = await harvest_service.add_photo(db, harvest, file, user)
    return harvest_service.photo_out(photo)


@router.delete(
    "/{harvest_id}/photos/{photo_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a photo",
)
async def delete_photo(
    harvest_id: uuid.UUID, photo_id: uuid.UUID, db: DbSession, user: CurrentUser
) -> None:
    """Owner or coordinator; removes the stored file too."""
    harvest = await harvest_service.get_harvest_for_viewer(db, harvest_id, user)
    await harvest_service.delete_photo(db, harvest, photo_id, user)
