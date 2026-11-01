"""User administration, verification and the audit log."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app import schemas
from app.core.deps import DbSession, require_roles
from app.models import User
from app.services import user_service
from app.services.presenters import user_out

router = APIRouter(prefix="/admin", tags=["admin"])

Operator = Annotated[User, Depends(require_roles("coordinator"))]
Admin = Annotated[User, Depends(require_roles("admin"))]


@router.get("/users", response_model=list[schemas.User], summary="List and search users")
async def list_users(
    user: Operator,
    db: DbSession,
    role: schemas.Role | None = None,
    verification_status: schemas.VerificationStatus | None = None,
    q: Annotated[str | None, Query(max_length=120)] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[schemas.User]:
    users = await user_service.list_users(
        db, user, role=role, verification_status=verification_status, q=q, limit=limit
    )
    return [user_out(item) for item in users]


@router.post(
    "/users/{user_id}/verification",
    response_model=schemas.User,
    summary="Verify or reject a user",
)
async def decide_verification(
    user_id: uuid.UUID, body: schemas.VerifyUserRequest, user: Operator, db: DbSession
) -> schemas.User:
    return user_out(await user_service.decide_verification(db, user, user_id, body))


@router.get("/audit-log", response_model=list[schemas.AuditEntry], summary="Audit trail")
async def audit_log(
    user: Admin, db: DbSession, limit: Annotated[int, Query(ge=1, le=500)] = 100
) -> list[schemas.AuditEntry]:
    return await user_service.list_audit_log(db, limit=limit)
