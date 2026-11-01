"""Public statistics and the contact form."""

from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app import schemas
from app.core.deps import DbSession, get_client_ip
from app.services import public_service

router = APIRouter(prefix="/public", tags=["public"])


class ContactAck(BaseModel):
    """``{ "ok": true }`` from the contract."""

    ok: Literal[True] = True


@router.get("/stats", response_model=schemas.PublicStats, summary="Headline pilot numbers")
async def stats(db: DbSession) -> schemas.PublicStats:
    return await public_service.public_stats(db)


@router.post("/contact", response_model=ContactAck, summary="Send a message to the MandiMate team")
async def contact(body: schemas.ContactRequest, request: Request, db: DbSession) -> ContactAck:
    await public_service.submit_contact(db, body, ip=get_client_ip(request))
    return ContactAck()
