"""Crop catalogue."""

from fastapi import APIRouter
from sqlalchemy import select

from app import schemas
from app.core.deps import DbSession
from app.models import Crop

router = APIRouter(prefix="/crops", tags=["crops"])


@router.get("", response_model=list[schemas.Crop], summary="List crops")
async def list_crops(db: DbSession) -> list[schemas.Crop]:
    """Every tradeable crop, by name (public)."""
    crops = (await db.scalars(select(Crop).order_by(Crop.name, Crop.code))).all()
    return [schemas.Crop.model_validate(crop) for crop in crops]
