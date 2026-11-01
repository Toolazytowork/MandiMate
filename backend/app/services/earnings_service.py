"""Farmer earnings history (``GET /earnings``).

* ``sales`` — one row per payout, newest settlement first.
* ``by_month`` — the last 12 months (oldest first, months without sales included as zeros), by the
  settlement's (delivery) month in India. ``baseline_net_amount`` is what selling alone at the
  mandi would have netted: ``baseline_net_per_kg × dispatched kg``; a payout without a baseline
  (no market price) counts at its own net, so it adds no uplift.
* ``totals`` — all time. ``avg_net_per_kg`` is per dispatched kg (as each payout's
  ``net_per_kg``), ``avg_uplift_per_kg`` is weighted by dispatched kg over payouts with a
  baseline, ``pending_amount`` is the net of payouts not yet paid.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import select

from app import schemas
from app.core.time import IST, today_ist
from app.models import FarmerPayout, Settlement
from app.services.metrics import ratio
from app.services.transport_service import money, opt_money, org_or_name

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models import User

MONTHS = 12
_ZERO = Decimal(0)


def last_months(today: date, count: int = MONTHS) -> list[str]:
    """``['2025-11', …, '2026-10']``: the ``count`` months ending with ``today``'s month."""
    months = []
    year, month = today.year, today.month
    for _ in range(count):
        months.append(f"{year:04d}-{month:02d}")
        month -= 1
        if month == 0:
            year, month = year - 1, 12
    return months[::-1]


async def farmer_earnings(db: AsyncSession, farmer: User) -> schemas.FarmerEarnings:
    payouts = list(
        await db.scalars(
            select(FarmerPayout)
            .join(Settlement, Settlement.id == FarmerPayout.settlement_id)
            .where(FarmerPayout.farmer_id == farmer.id)
            .order_by(Settlement.created_at.desc(), FarmerPayout.created_at.desc())
        )
    )
    settlements = (
        {
            s.id: s
            for s in await db.scalars(
                select(Settlement).where(Settlement.id.in_({p.settlement_id for p in payouts}))
            )
        }
        if payouts
        else {}
    )

    sales: list[schemas.FarmerSale] = []
    months = last_months(today_ist())
    by_month: dict[str, dict[str, Decimal]] = defaultdict(
        lambda: {"gross": _ZERO, "net": _ZERO, "baseline": _ZERO, "kg": _ZERO}
    )
    gross = deductions = net = kg_sold = dispatched = _ZERO
    uplift_sum = uplift_kg = pending = _ZERO
    for payout in payouts:
        s = settlements[payout.settlement_id]
        lot = s.lot
        sales.append(
            schemas.FarmerSale(
                payout_id=payout.id,
                settlement_id=s.id,
                lot_id=lot.id,
                lot_code=lot.code,
                crop_name=lot.crop.name,
                buyer_name=org_or_name(s.buyer),
                accepted_kg=money(payout.accepted_kg),
                rejected_kg=money(payout.rejected_kg),
                price_per_kg=money(s.price_per_kg),
                gross_amount=money(payout.gross_amount),
                transport_share=money(payout.transport_share),
                handling_share=money(payout.handling_share),
                commission_share=money(payout.commission_share),
                net_amount=money(payout.net_amount),
                net_per_kg=money(payout.net_per_kg),
                baseline_net_per_kg=opt_money(payout.baseline_net_per_kg),
                uplift_per_kg=opt_money(payout.uplift_per_kg),
                status=payout.status,
                settled_at=lot.settled_at,
            )
        )
        gross += payout.gross_amount
        deductions += payout.transport_share + payout.handling_share + payout.commission_share
        net += payout.net_amount
        kg_sold += payout.accepted_kg
        dispatched += payout.dispatched_kg
        if payout.uplift_per_kg is not None:
            uplift_sum += payout.uplift_per_kg * payout.dispatched_kg
            uplift_kg += payout.dispatched_kg
        if payout.status != "paid":
            pending += payout.net_amount

        month = s.created_at.astimezone(IST).strftime("%Y-%m")
        if month in months:
            bucket = by_month[month]
            bucket["gross"] += payout.gross_amount
            bucket["net"] += payout.net_amount
            bucket["kg"] += payout.accepted_kg
            bucket["baseline"] += (
                payout.baseline_net_per_kg * payout.dispatched_kg
                if payout.baseline_net_per_kg is not None
                else payout.net_amount
            )

    return schemas.FarmerEarnings(
        totals=schemas.FarmerEarningsTotals(
            gross_amount=money(gross),
            total_deductions=money(deductions),
            net_amount=money(net),
            kg_sold=money(kg_sold),
            avg_net_per_kg=ratio(net, dispatched),
            avg_uplift_per_kg=ratio(uplift_sum, uplift_kg),
            sales_count=len(payouts),
            pending_amount=money(pending),
        ),
        by_month=[
            schemas.MonthlyEarnings(
                month=month,
                gross_amount=money(by_month[month]["gross"]),
                net_amount=money(by_month[month]["net"]),
                baseline_net_amount=money(by_month[month]["baseline"]),
                kg_sold=money(by_month[month]["kg"]),
            )
            for month in months
        ],
        sales=sales,
    )
