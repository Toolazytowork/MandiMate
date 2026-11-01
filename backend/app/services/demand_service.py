"""Buyer requirements (demands): visibility, presentation, lifecycle and lazy expiry.

Visibility (API_CONTRACT "Demands"): the owner buyer, coordinators and admins see a demand;
farmers see ``open`` demands read-only; everyone else gets 404. ``open`` demands whose
``needed_by`` date has passed become ``expired`` lazily (on list / get).
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Sequence
from datetime import date

from fastapi.exceptions import RequestValidationError
from sqlalchemy import inspect, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import schemas
from app.core.errors import conflict, forbidden, not_found
from app.core.time import today_ist, utcnow
from app.models import Crop, Demand, Lot, User
from app.services.audit import audit
from app.services.notify import notify
from app.services.presenters import FULL_NAME_ROLES
from app.services.pricing import format_number, round_money

EDITABLE_STATUSES = frozenset({"open"})
CANCELLABLE_STATUSES = frozenset({"open"})


def field_error(field_name: str, message: str, error_type: str = "value_error") -> Exception:
    """A 422 shaped like FastAPI's own validation errors, pointing at one body field."""
    return RequestValidationError(
        [{"loc": ("body", field_name), "msg": message, "type": error_type}]
    )


def buyer_display_name(buyer: User) -> str:
    """Buyers are businesses: their organisation name, else their own name."""
    return buyer.organization_name or buyer.full_name


def is_owner(demand: Demand, viewer: User) -> bool:
    return demand.buyer_id == viewer.id


def can_view_demand(demand: Demand, viewer: User) -> bool:
    if is_owner(demand, viewer) or viewer.role in FULL_NAME_ROLES:
        return True
    return viewer.role == "farmer" and demand.status == "open"


# ───────────────────────────── Presentation ─────────────────────────────


async def _lot_ids_by_demand(
    db: AsyncSession, demand_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID]]:
    if not demand_ids:
        return {}
    rows = (
        await db.execute(
            select(Lot.demand_id, Lot.id)
            .where(Lot.demand_id.in_(demand_ids), Lot.status != "cancelled")
            .order_by(Lot.created_at, Lot.id)
        )
    ).all()
    result: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for demand_id, lot_id in rows:
        result[demand_id].append(lot_id)
    return result


def _present(demand: Demand, lot_ids: list[uuid.UUID]) -> schemas.Demand:
    return schemas.Demand(
        id=demand.id,
        buyer_id=demand.buyer_id,
        buyer_name=buyer_display_name(demand.buyer),
        buyer_verified=demand.buyer.verification_status == "verified",
        crop_id=demand.crop_id,
        crop_name=demand.crop.name,
        grade_required=demand.grade_required,
        quantity_kg=float(demand.quantity_kg),
        min_quantity_kg=float(demand.min_quantity_kg),
        target_price_per_kg=(
            float(demand.target_price_per_kg) if demand.target_price_per_kg is not None else None
        ),
        delivery_location=demand.delivery_location,
        delivery_district=demand.delivery_district,
        delivery_state=demand.delivery_state,
        delivery_latitude=demand.delivery_latitude,
        delivery_longitude=demand.delivery_longitude,
        needed_by=demand.needed_by,
        payment_terms_days=demand.payment_terms_days,
        max_rejection_pct=float(demand.max_rejection_pct),
        quality_spec=demand.quality_spec,
        notes=demand.notes,
        status=demand.status,
        lot_ids=lot_ids,
        created_at=demand.created_at,
    )


async def demands_out(db: AsyncSession, demands: Sequence[Demand]) -> list[schemas.Demand]:
    """API ``Demand`` objects for many demands (one extra query for the linked lots)."""
    demands = list(demands)
    for demand in demands:
        missing = [name for name in ("buyer", "crop") if name in inspect(demand).unloaded]
        if missing:
            await db.refresh(demand, attribute_names=missing)
    lot_ids = await _lot_ids_by_demand(db, [demand.id for demand in demands])
    return [_present(demand, lot_ids.get(demand.id, [])) for demand in demands]


async def demand_out(db: AsyncSession, demand: Demand) -> schemas.Demand:
    return (await demands_out(db, [demand]))[0]


# ───────────────────────────── Queries ─────────────────────────────


async def expire_overdue_demands(db: AsyncSession) -> int:
    """``open`` demands whose ``needed_by`` date has passed become ``expired``."""
    result = await db.execute(
        update(Demand)
        .where(Demand.status == "open", Demand.needed_by < today_ist())
        .values(status="expired", updated_at=utcnow())
        .execution_options(synchronize_session="fetch")
    )
    return int(getattr(result, "rowcount", 0) or 0)


async def list_demands(
    db: AsyncSession,
    viewer: User,
    *,
    status: str | None = None,
    crop_id: uuid.UUID | None = None,
    limit: int = 100,
) -> list[Demand]:
    """Demands newest first, scoped to what ``viewer`` may see.

    Buyers: their own. Farmers: ``open`` demands only. Coordinators/admins: all.
    """
    await expire_overdue_demands(db)
    statement = select(Demand).order_by(Demand.created_at.desc(), Demand.id.desc()).limit(limit)
    if viewer.role == "buyer":
        statement = statement.where(Demand.buyer_id == viewer.id)
    elif viewer.role == "farmer":
        if status is not None and status != "open":
            return []
        statement = statement.where(Demand.status == "open")
    elif viewer.role not in FULL_NAME_ROLES:
        raise forbidden()
    if status is not None:
        statement = statement.where(Demand.status == status)
    if crop_id is not None:
        statement = statement.where(Demand.crop_id == crop_id)
    return list((await db.scalars(statement)).all())


async def get_demand_for_viewer(db: AsyncSession, demand_id: uuid.UUID, viewer: User) -> Demand:
    """Load a demand the viewer may see (404 when missing or not visible)."""
    demand = await db.get(Demand, demand_id)
    if demand is None:
        raise not_found("Demand")
    if demand.status == "open" and demand.needed_by < today_ist():
        demand.status = "expired"
        demand.updated_at = utcnow()
        await db.flush()
    if not can_view_demand(demand, viewer):
        raise not_found("Demand")
    return demand


# ───────────────────────────── Lifecycle ─────────────────────────────


async def _get_crop(db: AsyncSession, crop_id: uuid.UUID) -> Crop:
    crop = await db.get(Crop, crop_id)
    if crop is None:
        raise field_error("crop_id", "Choose a crop from the catalogue")
    return crop


def _check_grade(crop: Crop, grade: str) -> None:
    if grade not in [*crop.grades, "ungraded"]:
        raise field_error(
            "grade_required", f"{crop.name} is traded in grades {', '.join(crop.grades)}"
        )


def _check_needed_by(needed_by: date) -> None:
    if needed_by < today_ist():
        raise field_error("needed_by", "The needed-by date cannot be in the past")


def _summary(demand: Demand, crop: Crop) -> str:
    return (
        f"{format_number(demand.quantity_kg)} kg of grade {demand.grade_required} {crop.name} "
        f"by {demand.needed_by:%d %b}"
    )


async def create_demand(db: AsyncSession, req: schemas.DemandCreateRequest, buyer: User) -> Demand:
    """Post a requirement. ``min_quantity_kg`` defaults to ``quantity_kg`` and
    ``max_rejection_pct`` to the crop's default rejection %."""
    crop = await _get_crop(db, req.crop_id)
    _check_grade(crop, req.grade_required)
    _check_needed_by(req.needed_by)
    quantity = round_money(req.quantity_kg)
    min_quantity = round_money(req.min_quantity_kg) if req.min_quantity_kg is not None else quantity
    demand = Demand(
        buyer=buyer,
        crop=crop,
        grade_required=req.grade_required,
        quantity_kg=quantity,
        min_quantity_kg=min_quantity,
        target_price_per_kg=(
            round_money(req.target_price_per_kg) if req.target_price_per_kg is not None else None
        ),
        delivery_location=req.delivery_location,
        delivery_district=req.delivery_district,
        delivery_state=req.delivery_state,
        delivery_latitude=req.delivery_latitude,
        delivery_longitude=req.delivery_longitude,
        needed_by=req.needed_by,
        payment_terms_days=req.payment_terms_days,
        max_rejection_pct=(
            round_money(req.max_rejection_pct)
            if req.max_rejection_pct is not None
            else crop.default_rejection_pct
        ),
        quality_spec=req.quality_spec,
        notes=req.notes,
        status="open",
    )
    db.add(demand)
    await db.flush()
    await audit(
        db,
        buyer,
        "demand.create",
        "demand",
        demand.id,
        f"{buyer_display_name(buyer)} posted a requirement for {_summary(demand, crop)}",
        {
            "crop_id": crop.id,
            "grade_required": demand.grade_required,
            "quantity_kg": demand.quantity_kg,
            "min_quantity_kg": demand.min_quantity_kg,
            "needed_by": demand.needed_by,
        },
    )
    return demand


async def update_demand(
    db: AsyncSession, demand: Demand, req: schemas.DemandUpdateRequest, actor: User
) -> Demand:
    """Edit an ``open`` demand (owner buyer only; 409 once matched, cancelled or expired)."""
    if not is_owner(demand, actor):
        raise forbidden("Only the buyer who posted this requirement can edit it")
    if demand.status not in EDITABLE_STATUSES:
        raise conflict("Only open requirements can be edited")
    changes = req.model_dump(exclude_unset=True)
    if not changes:
        return demand

    crop = demand.crop
    if "crop_id" in changes and changes["crop_id"] != demand.crop_id:
        crop = await _get_crop(db, changes["crop_id"])
    if "grade_required" in changes or crop is not demand.crop:
        _check_grade(crop, changes.get("grade_required", demand.grade_required))
    if "needed_by" in changes:
        _check_needed_by(changes["needed_by"])

    for name in ("quantity_kg", "min_quantity_kg", "target_price_per_kg", "max_rejection_pct"):
        if name in changes and changes[name] is not None:
            changes[name] = round_money(changes[name])
    quantity = changes.get("quantity_kg", demand.quantity_kg)
    min_quantity = changes.get("min_quantity_kg", demand.min_quantity_kg)
    if min_quantity > quantity:
        raise field_error(
            "min_quantity_kg", "Minimum quantity cannot be more than the total quantity"
        )

    for name, value in changes.items():
        if name == "crop_id":
            continue
        setattr(demand, name, value)
    if crop is not demand.crop:
        demand.crop = crop
    demand.updated_at = utcnow()
    await db.flush()
    await audit(
        db,
        actor,
        "demand.update",
        "demand",
        demand.id,
        f"{buyer_display_name(actor)} updated the requirement for {_summary(demand, crop)}",
        {"fields": sorted(changes)},
    )
    return demand


async def cancel_demand(db: AsyncSession, demand: Demand, actor: User) -> Demand:
    """Withdraw an ``open`` demand (owner buyer or coordinator/admin)."""
    if not (is_owner(demand, actor) or actor.role in FULL_NAME_ROLES):
        raise forbidden("Only the buyer or a coordinator can cancel this requirement")
    if demand.status == "matched":
        raise conflict("This requirement is already matched to a deal and cannot be cancelled")
    if demand.status not in CANCELLABLE_STATUSES:
        raise conflict(f"This requirement is already {demand.status}")
    demand.status = "cancelled"
    demand.updated_at = utcnow()
    await db.flush()
    await audit(
        db,
        actor,
        "demand.cancel",
        "demand",
        demand.id,
        f"{actor.full_name} cancelled the requirement for {_summary(demand, demand.crop)}",
    )
    if not is_owner(demand, actor):
        await notify(
            db,
            [demand.buyer_id],
            "system",
            "Your requirement was cancelled",
            f"{actor.full_name} cancelled your requirement for {_summary(demand, demand.crop)}.",
            link=f"/app/buyer/demands/{demand.id}",
        )
    return demand
