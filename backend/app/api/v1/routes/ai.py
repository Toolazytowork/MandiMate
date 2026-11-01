"""AI assistants (DeepSeek in live mode, deterministic rules otherwise).

Numbers in every response come from the calculation engines; the model only words them.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends

from app import schemas
from app.ai import service as ai_service
from app.core.deps import CurrentUser, DbSession, require_roles
from app.core.errors import not_found
from app.models import User
from app.services import harvest_service, offer_service

router = APIRouter(prefix="/ai", tags=["ai"])

FarmerOrCoordinator = Annotated[User, Depends(require_roles("farmer", "coordinator"))]
Coordinator = Annotated[User, Depends(require_roles("coordinator"))]


@router.get("/status", response_model=schemas.AiStatus, summary="AI mode and features")
async def ai_status(user: CurrentUser) -> schemas.AiStatus:
    """Effective mode (``live`` or ``mock``), provider, model and enabled features."""
    return ai_service.ai_status()


@router.post(
    "/voice-listing", response_model=schemas.VoiceDraft, summary="Draft a listing from speech"
)
async def voice_listing(
    body: schemas.VoiceListingRequest, db: DbSession, user: FarmerOrCoordinator
) -> schemas.VoiceDraft:
    """Turn a transcript (en / hi / te) into a harvest draft; unknown fields are listed, never
    guessed. The farmer confirms the draft before anything is listed."""
    return await ai_service.parse_voice_listing(db, body, user)


@router.post("/deal-advice", response_model=schemas.DealAdvice, summary="Explain selling options")
async def deal_advice(
    body: schemas.DealAdviceRequest, db: DbSession, user: FarmerOrCoordinator
) -> schemas.DealAdvice:
    """Selling options with the recommended one, a counter-offer suggestion and a plain-language
    explanation in the viewer's language. Farmers: own harvests only."""
    harvest = await harvest_service.get_harvest_for_viewer(db, body.harvest_id, user)
    if user.role == "farmer" and harvest.farmer_id != user.id:
        raise not_found("Harvest")
    return await ai_service.advise_deal(db, harvest, user)


@router.post(
    "/offers/{offer_id}/counter-suggestion",
    response_model=schemas.CounterSuggestion,
    summary="Suggest a counter-offer price",
)
async def counter_suggestion(
    offer_id: uuid.UUID,
    db: DbSession,
    user: FarmerOrCoordinator,
    harvest_id: uuid.UUID | None = None,
) -> schemas.CounterSuggestion:
    """Seller side: the harvest owner for direct offers, coordinators for lot offers; lot
    member farmers get their own share's perspective (``harvest_id`` picks one member)."""
    offer = await offer_service.get_offer_for_viewer(db, offer_id, user)
    return await ai_service.suggest_counteroffer(db, offer, user, harvest_id=harvest_id)


@router.post("/match-explanation", response_model=schemas.AiText, summary="Explain a lot match")
async def match_explanation(
    body: schemas.MatchExplanationRequest, db: DbSession, user: Coordinator
) -> schemas.AiText:
    """Why a proposed group of harvests is (or is not) a promising lot; never changes it."""
    return await ai_service.explain_match(db, body.proposal, user)
