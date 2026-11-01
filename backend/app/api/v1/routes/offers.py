"""Offers, negotiation, farmer consent and net-proceeds breakdowns."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app import schemas
from app.core.deps import CurrentUser, DbSession, require_roles
from app.models import User
from app.services import offer_service, selling_options

router = APIRouter(prefix="/offers", tags=["offers"])

Buyer = Annotated[User, Depends(require_roles("buyer"))]


@router.get("", response_model=list[schemas.Offer], summary="List offers")
async def list_offers(
    db: DbSession,
    user: CurrentUser,
    status: schemas.OfferStatus | None = None,
    lot_id: uuid.UUID | None = None,
    harvest_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = offer_service.DEFAULT_LIST_LIMIT,
) -> list[schemas.Offer]:
    """Buyers: their own offers. Farmers: offers on their harvests and lots. Newest first."""
    offers = await offer_service.list_offers(
        db, user, status=status, lot_id=lot_id, harvest_id=harvest_id, limit=limit
    )
    return await offer_service.offers_out(db, offers, user)


@router.post(
    "",
    response_model=schemas.Offer,
    status_code=status.HTTP_201_CREATED,
    summary="Make an offer",
)
async def create_offer(
    req: schemas.OfferCreateRequest, db: DbSession, user: Buyer
) -> schemas.Offer:
    """An offer on a lot open for offers or directly on a listed harvest."""
    offer = await offer_service.create_offer(db, req, user)
    return await offer_service.offer_out(db, offer, user)


@router.get("/{offer_id}", response_model=schemas.Offer, summary="Get an offer")
async def get_offer(offer_id: uuid.UUID, db: DbSession, user: CurrentUser) -> schemas.Offer:
    """The buyer, the seller side (and the lot's farmers), coordinators and admins."""
    offer = await offer_service.get_offer_for_viewer(db, offer_id, user)
    return await offer_service.offer_out(db, offer, user)


@router.post("/{offer_id}/counter", response_model=schemas.Offer, summary="Counter an offer")
async def counter_offer(
    offer_id: uuid.UUID, req: schemas.CounterRequest, db: DbSession, user: CurrentUser
) -> schemas.Offer:
    """New terms from the side the offer is waiting for."""
    offer = await offer_service.get_offer_for_viewer(db, offer_id, user)
    offer = await offer_service.counter_offer(db, offer, req, user)
    return await offer_service.offer_out(db, offer, user)


@router.post("/{offer_id}/accept", response_model=schemas.Offer, summary="Accept an offer")
async def accept_offer(
    offer_id: uuid.UUID, req: schemas.OfferActionRequest, db: DbSession, user: CurrentUser
) -> schemas.Offer:
    """Direct offers are agreed at once; lot offers go to the member farmers for consent."""
    offer = await offer_service.get_offer_for_viewer(db, offer_id, user)
    offer = await offer_service.accept_offer(db, offer, req, user)
    return await offer_service.offer_out(db, offer, user)


@router.post("/{offer_id}/reject", response_model=schemas.Offer, summary="Reject an offer")
async def reject_offer(
    offer_id: uuid.UUID, req: schemas.OfferActionRequest, db: DbSession, user: CurrentUser
) -> schemas.Offer:
    """The side the offer is waiting for ends the negotiation."""
    offer = await offer_service.get_offer_for_viewer(db, offer_id, user)
    offer = await offer_service.reject_offer(db, offer, req, user)
    return await offer_service.offer_out(db, offer, user)


@router.post("/{offer_id}/withdraw", response_model=schemas.Offer, summary="Withdraw an offer")
async def withdraw_offer(
    offer_id: uuid.UUID, req: schemas.OfferActionRequest, db: DbSession, user: CurrentUser
) -> schemas.Offer:
    """The buyer withdraws the offer before it is accepted."""
    offer = await offer_service.get_offer_for_viewer(db, offer_id, user)
    offer = await offer_service.withdraw_offer(db, offer, req, user)
    return await offer_service.offer_out(db, offer, user)


@router.post("/{offer_id}/consent", response_model=schemas.Offer, summary="Consent to a deal")
async def consent_offer(
    offer_id: uuid.UUID,
    req: schemas.ConsentRequest,
    db: DbSession,
    user: CurrentUser,
    member_id: uuid.UUID | None = None,
) -> schemas.Offer:
    """A member farmer accepts or declines a proposed lot deal; a coordinator may record the
    decision for a member (``member_id``, assisted consent)."""
    offer = await offer_service.get_offer_for_viewer(db, offer_id, user)
    offer = await offer_service.record_offer_consent(db, offer, req, user, member_id=member_id)
    return await offer_service.offer_out(db, offer, user)


@router.get(
    "/{offer_id}/breakdown", response_model=schemas.NetProceeds, summary="Net earnings breakdown"
)
async def offer_breakdown(
    offer_id: uuid.UUID,
    db: DbSession,
    user: CurrentUser,
    harvest_id: uuid.UUID | None = None,
) -> schemas.NetProceeds:
    """What the farmer keeps under this offer (coordinators: the whole lot or one member)."""
    offer = await offer_service.get_offer_for_viewer(db, offer_id, user)
    return await selling_options.offer_breakdown(db, offer, user, harvest_id=harvest_id)
