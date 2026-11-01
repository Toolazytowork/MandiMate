"""Public net-proceeds calculator."""

from fastapi import APIRouter, status

from app import schemas
from app.core.errors import DomainError
from app.services import pricing

router = APIRouter(prefix="/calculator", tags=["calculator"])


@router.post("/net-proceeds", response_model=schemas.NetProceeds, summary="Estimate net proceeds")
async def net_proceeds(req: schemas.NetProceedsCalcRequest) -> schemas.NetProceeds:
    """What a farmer keeps after transport, handling, commission, rejection and payment delay."""
    try:
        return pricing.calculate(req)
    except ValueError as exc:
        raise DomainError(
            status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc), "invalid_calculation"
        ) from exc
