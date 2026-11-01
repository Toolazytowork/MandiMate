"""The demo-world builder: creates domain objects step by step, the way the API would.

Every step applies the state machines of DOMAIN_RULES §2 (lot, offer, transport, settlement,
dispute) and writes the audit entries and notifications of §8, with timestamps chosen by the
caller. Rules that the API enforces (same crop and grade, availability, matching radius and
dates, delivery tolerances) are asserted here, so an inconsistent scenario fails loudly instead
of producing a demo that contradicts the rules. Money comes from ``app.services.pricing``.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from fastapi.encoders import jsonable_encoder

from app.core.security import hash_password
from app.models import (
    AuditLog,
    Crop,
    Delivery,
    Demand,
    Dispute,
    FarmerPayout,
    Fpo,
    Harvest,
    Lot,
    LotMember,
    NegotiationEntry,
    Notification,
    Offer,
    OfferConsent,
    Payment,
    Settlement,
    TransportQuote,
    TransportRequest,
    TransportStop,
    User,
    Vehicle,
)
from app.seed.catalog import CROP_SPECS
from app.seed.helpers import (
    DEMO_PASSWORD,
    Clock,
    Place,
    day_text,
    kg,
    kg_text,
    payout_figures,
    per_kg,
    round_to_step,
    rupees,
    stable_rng,
)
from app.seed.markets import modal_price, nearest_market
from app.services.codes import next_code
from app.services.pricing import (
    DEFAULT_RADIUS_KM,
    baseline_net_proceeds,
    estimate_transport_cost,
    road_km,
    round_money,
)
from app.services.routing import RouteStop, plan_route

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models.enums import (
        ConsentDecision,
        DemandStatus,
        DisputeCategory,
        Grade,
        HarvestStatus,
        LotStatus,
        NegotiationAction,
        NotificationType,
        PickupTerms,
        QualityStatus,
        Role,
    )

LOT_RANK: dict[str, int] = {
    "forming": 0,
    "awaiting_consent": 1,
    "open_for_offers": 2,
    "offer_accepted": 3,
    "transport_booked": 4,
    "in_transit": 5,
    "delivered": 6,
    "settled": 7,
}
HARVEST_STATUS_FOR_LOT: dict[str, HarvestStatus] = {
    "forming": "pooled",
    "awaiting_consent": "pooled",
    "open_for_offers": "pooled",
    "offer_accepted": "committed",
    "transport_booked": "committed",
    "in_transit": "picked_up",
    "delivered": "delivered",
    "settled": "settled",
}
"""Harvest status mirroring the most advanced active lot (DOMAIN_RULES §2)."""

NOTIFY_WINDOW = timedelta(days=24)
"""Only events this recent produce notifications (an inbox, not an archive)."""
UNREAD_DAYS = 1
"""Notifications from yesterday (IST) onwards stay unread; older ones are marked read."""
DELIVERY_TOLERANCE = Decimal("1.02")
SYSTEM_STEP = timedelta(seconds=1)
"""System entries follow the human action that triggered them, so threads sort stably."""
SELLER_TERMS: dict[str, str] = {
    "buyer_pickup": "buyer collects from the farm / collection point",
    "mandimate_delivery": "MandiMate delivers",
}

QUALITY_NOTES: dict[tuple[str, str], str] = {
    ("TOM", "A"): "Firm, uniformly red, 60–80 g; under 3% blemishes",
    ("TOM", "B"): "Mixed 45–70 g fruit, a few shoulder cracks",
    ("TOM", "ungraded"): "Mixed sizes, picked at breaker to pink stage",
    ("ONI", "A"): "Dark red 50–65 mm bulbs, well cured, dry skin",
    ("ONI", "B"): "40–55 mm bulbs, some doubles",
    ("CHI", "A"): "Glossy green 8–10 cm pods, stalks intact",
    ("POT", "A"): "Medium 50–80 g tubers, cured, no greening",
    ("POT", "B"): "Mixed sizes, minor skin scuffing",
    ("MNG", "A"): "Banganapalli, 300–350 g, mature green",
    ("GNT", "A"): "Dry pods, bold kernels, moisture under 9%",
    ("OKR", "A"): "Tender 8–12 cm pods, picked the same morning",
    ("BRN", "A"): "Shiny purple 150–200 g fruit, no borer holes",
    ("CAB", "A"): "Compact 1–1.5 kg heads, outer leaves trimmed",
    ("BAN", "A"): "Hands at 75% maturity, no scarring",
}
REJECTION_REASONS: dict[str, tuple[str, ...]] = {
    "TOM": ("Cracked or soft fruit", "Undersized (below 55 g)", "Over-ripe, bruised in transit"),
    "ONI": ("Sprouting or doubles", "Soft neck / not fully cured"),
    "CHI": ("Shrivelled or broken pods", "Mixed colour pods"),
    "POT": ("Greening and cuts",),
    "MNG": ("Sap burn and spots",),
    "GNT": ("Immature and broken pods",),
    "OKR": ("Over-mature, fibrous pods", "Bent and scarred pods"),
    "BRN": ("Borer holes", "Dull, over-mature fruit"),
    "CAB": ("Loose or split heads",),
    "BAN": ("Bruised fingers",),
}


def _new_id() -> uuid.UUID:
    return uuid.uuid4()


@dataclass
class SeedStats:
    """What the seed created, for the summary table."""

    counts: dict[str, int] = field(default_factory=lambda: defaultdict(int))

    def add(self, name: str, amount: int = 1) -> None:
        self.counts[name] += amount


class World:
    """Builds the demo world inside one session (flushes; the caller commits)."""

    def __init__(self, db: AsyncSession, clock: Clock, crops: dict[str, Crop]) -> None:
        self.db = db
        self.clock = clock
        self.crops = crops
        self.crop_codes: dict[uuid.UUID, str] = {crop.id: code for code, crop in crops.items()}
        self.rng = stable_rng("mandimate-demo")
        self.unread_from = clock.at(-UNREAD_DAYS, 0)
        self.stats = SeedStats()
        self.password_hash_cache: str | None = None

        self.fpo: Fpo | None = None
        self.users: dict[str, User] = {}
        self.vehicles: dict[str, Vehicle] = {}
        self.demands: dict[str, Demand] = {}
        self.harvests: list[Harvest] = []
        self.lots: list[Lot] = []
        self.offers: list[Offer] = []
        self.members_by_harvest: dict[uuid.UUID, list[LotMember]] = defaultdict(list)
        self.lot_of_member: dict[uuid.UUID, Lot] = {}
        self.requests: dict[uuid.UUID, TransportRequest] = {}
        self.settlements: dict[uuid.UUID, Settlement] = {}
        self.disputes: list[Dispute] = []
        self.deliveries: dict[uuid.UUID, Delivery] = {}

    # ───────────────────────────── people ─────────────────────────────

    @property
    def coordinator(self) -> User:
        return self.users["coordinator"]

    @property
    def coordinators(self) -> list[User]:
        return [user for user in self.users.values() if user.role == "coordinator"]

    @property
    def transporters(self) -> list[User]:
        return [user for user in self.users.values() if user.role == "transporter"]

    def org(self, user: User) -> str:
        return user.organization_name or user.full_name

    def add_fpo(self, name: str, district: str, state: str, at: datetime) -> Fpo:
        self.fpo = Fpo(id=_new_id(), name=name, district=district, state=state)
        self.fpo.created_at = at
        self.fpo.updated_at = at
        self.db.add(self.fpo)
        self.stats.add("FPOs")
        return self.fpo

    def add_user(
        self,
        key: str,
        role: Role,
        full_name: str,
        *,
        phone: str,
        created_at: datetime,
        email: str | None = None,
        language: str = "en",
        organization: str | None = None,
        place: Place | None = None,
        latitude: float | None = None,
        longitude: float | None = None,
        district: str | None = None,
        state: str | None = None,
        verification: str = "verified",
        verification_note: str | None = None,
        documents_note: str | None = None,
        in_fpo: bool = False,
        created_by: User | None = None,
        last_login_at: datetime | None = None,
    ) -> User:
        """A user whose password is ``DEMO_PASSWORD`` (hashed individually, Argon2id)."""
        user = User(
            id=_new_id(),
            email=email.lower() if email else None,
            phone=phone,
            password_hash=hash_password(DEMO_PASSWORD),
            full_name=full_name,
            role=role,
            preferred_language=language,
            organization_name=organization,
            village=place.name if place else None,
            district=district or (place.district if place else None),
            state=state or (place.state if place else None),
            latitude=latitude if latitude is not None else (place.latitude if place else None),
            longitude=longitude if longitude is not None else (place.longitude if place else None),
            verification_status=verification,
            verification_note=verification_note,
            verification_documents_note=documents_note,
            fpo_id=self.fpo.id if in_fpo and self.fpo else None,
            is_active=True,
            created_by_id=created_by.id if created_by else None,
            last_login_at=last_login_at,
            created_at=created_at,
            updated_at=created_at,
        )
        self.db.add(user)
        self.users[key] = user
        self.stats.add(f"users:{role}")
        return user

    def add_vehicle(
        self,
        transporter_key: str,
        vehicle_type: str,
        registration: str,
        capacity_kg: int,
        base_charge: Decimal,
        per_km_rate: Decimal,
        at: datetime,
    ) -> Vehicle:
        vehicle = Vehicle(
            id=_new_id(),
            transporter_id=self.users[transporter_key].id,
            vehicle_type=vehicle_type,
            registration_number=registration,
            capacity_kg=kg(capacity_kg),
            has_refrigeration=vehicle_type == "reefer_truck",
            base_charge=base_charge,
            per_km_rate=per_km_rate,
            is_active=True,
            created_at=at,
            updated_at=at,
        )
        self.db.add(vehicle)
        self.vehicles[registration] = vehicle
        self.stats.add("vehicles")
        return vehicle

    def vehicles_of(self, transporter_key: str) -> list[Vehicle]:
        owner = self.users[transporter_key].id
        return sorted(
            (v for v in self.vehicles.values() if v.transporter_id == owner),
            key=lambda v: v.capacity_kg,
        )

    # ───────────────────────────── events ─────────────────────────────

    def audit(
        self,
        at: datetime,
        actor: User | None,
        action: str,
        entity_type: str,
        entity_id: uuid.UUID | str | None,
        summary: str,
        payload: dict[str, Any] | None = None,
    ) -> None:
        self.db.add(
            AuditLog(
                id=_new_id(),
                actor_id=actor.id if actor else None,
                action=action,
                entity_type=entity_type,
                entity_id=str(entity_id) if entity_id is not None else None,
                summary=summary,
                payload=jsonable_encoder(payload) if payload is not None else None,
                ip=None,
                created_at=at,
            )
        )
        self.stats.add("audit entries")

    def notify(
        self,
        at: datetime,
        recipients: list[User],
        type: NotificationType,
        title: str,
        body: str,
        link: str | None = None,
        *,
        read: bool | None = None,
        always: bool = False,
    ) -> None:
        """One notification per distinct recipient, read unless from yesterday or today (IST)."""
        if not always and at < self.clock.now - NOTIFY_WINDOW:
            return
        seen: set[uuid.UUID] = set()
        for user in recipients:
            if user.id in seen:
                continue
            seen.add(user.id)
            is_read = (at < self.unread_from) if read is None else read
            read_at = None
            if is_read:
                delay = timedelta(minutes=self.rng.randint(12, 300))
                read_at = min(at + delay, self.clock.now - timedelta(minutes=2))
            self.db.add(
                Notification(
                    id=_new_id(),
                    user_id=user.id,
                    type=type,
                    title=title[:200],
                    body=body,
                    link=self._link_for(user, link),
                    read_at=read_at,
                    dedupe_key=None,
                    created_at=at,
                )
            )
            self.stats.add("notifications")

    @staticmethod
    def _link_for(user: User, link: str | None) -> str | None:
        """Links are written as ``{role}/...`` and resolved per recipient role."""
        if link is None:
            return None
        if "{role}" not in link:
            return link
        role = "coordinator" if user.role == "admin" else user.role
        return link.replace("{role}", role)

    # ─────────────────────────── harvests ───────────────────────────

    def add_harvest(
        self,
        farmer_key: str,
        crop_code: str,
        quantity: int,
        *,
        harvest_date: date,
        created_at: datetime,
        available_from: date | None = None,
        sell_by: date | None = None,
        grade: Grade = "A",
        quality: QualityStatus = "inspected",
        status: HarvestStatus = "listed",
        source: str | None = None,
        min_price: Decimal | None = None,
        variety: str | None = None,
        notes: str | None = None,
        verified_at: datetime | None = None,
    ) -> Harvest:
        farmer = self.users[farmer_key]
        spec = CROP_SPECS[crop_code]
        rng = stable_rng("harvest", farmer_key, crop_code, harvest_date.isoformat(), quantity)
        available_from = available_from or harvest_date
        sell_by = sell_by or harvest_date + timedelta(days=spec.perishability_days - 1)
        if source is None:
            source = "assisted" if farmer.email is None else "manual"
        created_by = self.coordinator if source == "assisted" else farmer
        if quality == "inspected":
            verified_at = verified_at or min(
                created_at + timedelta(hours=rng.randint(14, 30)), self.clock.ago(0.5)
            )
        else:
            verified_at = None
        if notes is None:
            notes = QUALITY_NOTES.get((crop_code, grade))
            if quality == "pending_inspection":
                notes = (
                    notes + ". " if notes else ""
                ) + "Inspection requested at the collection shed"
        harvest = Harvest(
            id=_new_id(),
            farmer_id=farmer.id,
            crop_id=self.crops[crop_code].id,
            variety=variety or rng.choice(spec.varieties),
            quantity_kg=kg(quantity),
            grade=grade,
            quality_notes=notes,
            quality_status=quality,
            harvest_date=harvest_date,
            available_from=available_from,
            sell_by=sell_by,
            village=farmer.village,
            district=farmer.district,
            state=farmer.state,
            latitude=farmer.latitude,
            longitude=farmer.longitude,
            min_price_per_kg=min_price,
            status=status,
            source=source,
            created_by_id=created_by.id,
            verified_by_id=self.coordinator.id if verified_at else None,
            verified_at=verified_at,
            created_at=created_at,
            updated_at=verified_at or created_at,
            photos=[],
        )
        self.db.add(harvest)
        self.harvests.append(harvest)
        self.stats.add("harvests")
        crop_name = spec.name
        by = (
            "voice listing"
            if source == "voice"
            else ("assisted listing" if source == "assisted" else "listing")
        )
        self.audit(
            created_at,
            created_by,
            "harvest.create",
            "harvest",
            harvest.id,
            f"{farmer.full_name}: {kg_text(quantity)} {crop_name} ({by})",
            {"crop": crop_code, "quantity_kg": quantity, "grade": grade, "status": status},
        )
        if verified_at:
            self.audit(
                verified_at,
                self.coordinator,
                "harvest.verify",
                "harvest",
                harvest.id,
                f"Inspected {farmer.full_name}'s {crop_name}: grade {grade}",
                {"grade": grade},
            )
        return harvest

    def available_kg(self, harvest: Harvest) -> Decimal:
        committed = sum(
            (
                member.quantity_kg
                for member in self.members_by_harvest[harvest.id]
                if member.consent_status != "declined"
                and self.lot_of_member[member.id].status != "cancelled"
            ),
            Decimal(0),
        )
        return harvest.quantity_kg - committed

    # ───────────────────────────── lots ─────────────────────────────

    def crop_code_of(self, crop_id: uuid.UUID) -> str:
        return self.crop_codes[crop_id]

    def active_members(self, lot: Lot) -> list[LotMember]:
        return [member for member in lot.members if member.consent_status != "declined"]

    def lot_total(self, lot: Lot) -> Decimal:
        return sum((member.quantity_kg for member in self.active_members(lot)), Decimal(0))

    def member_farmers(self, lot: Lot) -> list[User]:
        by_id = {user.id: user for user in self.users.values()}
        return [by_id[member.farmer_id] for member in self.active_members(lot)]

    def farmer_of(self, member: LotMember) -> User:
        return next(user for user in self.users.values() if user.id == member.farmer_id)

    def demand_by_id(self, demand_id: uuid.UUID | None) -> Demand | None:
        return next((d for d in self.demands.values() if d.id == demand_id), None)

    def set_lot_status(self, lot: Lot, status: LotStatus, at: datetime) -> None:
        lot.status = status
        lot.updated_at = at

    async def create_lot(
        self,
        crop_code: str,
        grade: Grade,
        point: Place,
        pickup_date: date,
        at: datetime,
        *,
        demand: Demand | None = None,
        target_kg: int | None = None,
        explanation: str | None = None,
        solo: bool = False,
        created_by: User | None = None,
    ) -> Lot:
        lot = Lot(
            id=_new_id(),
            code=await next_code(self.db, "lot", crop_code),
            crop_id=self.crops[crop_code].id,
            grade=grade,
            demand_id=demand.id if demand else None,
            target_quantity_kg=kg(target_kg or 0),
            collection_point_name=point.name,
            collection_latitude=point.latitude,
            collection_longitude=point.longitude,
            district=point.district,
            state=point.state,
            pickup_date=pickup_date,
            status="forming",
            is_solo=solo,
            coordinator_id=self.coordinator.id,
            created_by_id=(created_by or self.coordinator).id,
            pickup_terms=None,
            match_explanation=explanation,
            cancelled_reason=None,
            delivered_at=None,
            settled_at=None,
            created_at=at,
            updated_at=at,
            members=[],
        )
        self.db.add(lot)
        self.lots.append(lot)
        self.stats.add("lots")
        if not solo:
            self.audit(
                at,
                created_by or self.coordinator,
                "lot.create",
                "lot",
                lot.id,
                f"Created lot {lot.code}: {CROP_SPECS[crop_code].name} grade {grade}, "
                f"pickup {day_text(pickup_date)} at {point.name}",
                {"code": lot.code, "demand_id": demand.id if demand else None},
            )
        return lot

    def add_member(
        self,
        lot: Lot,
        harvest: Harvest,
        quantity: int | Decimal,
        *,
        consent: ConsentDecision,
        at: datetime,
        consented_at: datetime | None = None,
        note: str | None = None,
        recorded_by: User | None = None,
    ) -> LotMember:
        """Add a harvest to a lot after checking the matching rules (DOMAIN_RULES §4)."""
        quantity = kg(quantity)
        code = lot.code
        if harvest.crop_id != lot.crop_id:
            raise AssertionError(f"{code}: crop mismatch")
        if not lot.is_solo and harvest.grade != lot.grade:
            raise AssertionError(f"{code}: grade {harvest.grade} != {lot.grade}")
        if quantity <= 0 or quantity > self.available_kg(harvest):
            raise AssertionError(f"{code}: {quantity} kg exceeds availability")
        if not harvest.available_from <= lot.pickup_date <= harvest.sell_by:
            raise AssertionError(f"{code}: pickup {lot.pickup_date} outside the harvest window")
        perishability = CROP_SPECS[self.crop_code_of(lot.crop_id)].perishability_days
        if (lot.pickup_date - harvest.harvest_date).days > perishability:
            raise AssertionError(f"{code}: produce too old at pickup")
        distance = road_km(
            harvest.latitude, harvest.longitude, lot.collection_latitude, lot.collection_longitude
        )
        if not lot.is_solo and distance > DEFAULT_RADIUS_KM:
            raise AssertionError(f"{code}: {distance} km is outside the matching radius")
        member = LotMember(
            id=_new_id(),
            harvest_id=harvest.id,
            farmer_id=harvest.farmer_id,
            quantity_kg=quantity,
            distance_km=distance,
            consent_status=consent,
            consented_at=consented_at if consent != "pending" else None,
            consent_note=note,
            consent_recorded_by_id=recorded_by.id if recorded_by else None,
            dispatched_kg=None,
            delivered_kg=None,
            accepted_kg=None,
            rejected_kg=None,
            rejection_reason=None,
            created_at=at + timedelta(microseconds=len(lot.members)),
            updated_at=consented_at or at,
        )
        member.harvest = harvest
        lot.members.append(member)
        self.members_by_harvest[harvest.id].append(member)
        self.lot_of_member[member.id] = lot
        if lot.target_quantity_kg < self.lot_total(lot) and lot.demand_id is None:
            lot.target_quantity_kg = self.lot_total(lot)
        return member

    def invite_members(self, lot: Lot, at: datetime) -> None:
        """Lot created with members: ask each farmer to consent to pooling."""
        self.set_lot_status(lot, "awaiting_consent", at)
        crop = CROP_SPECS[self.crop_code_of(lot.crop_id)].name
        for member in lot.members:
            others = len(lot.members) - 1
            self.notify(
                at,
                [self.farmer_of(member)],
                "consent",
                "Consent to join pooled sale",
                f"{lot.code}: pool your {kg_text(member.quantity_kg)} of {crop} with {others} "
                f"neighbouring farmer{'s' if others != 1 else ''} for pickup on "
                f"{day_text(lot.pickup_date)} at {lot.collection_point_name}.",
                f"/app/farmer/lots/{lot.id}",
            )

    def lot_consent(
        self,
        lot: Lot,
        member: LotMember,
        decision: ConsentDecision,
        at: datetime,
        *,
        note: str | None = None,
        assisted: bool = False,
    ) -> None:
        farmer = self.farmer_of(member)
        member.consent_status = decision
        member.consented_at = at
        member.consent_note = note
        member.updated_at = at
        if assisted:
            member.consent_recorded_by_id = self.coordinator.id
        actor = self.coordinator if assisted else farmer
        self.audit(
            at,
            actor,
            "lot.consent",
            "lot",
            lot.id,
            f"{farmer.full_name} {decision} pooling {kg_text(member.quantity_kg)} in {lot.code}"
            + (" (assisted consent)" if assisted else ""),
            {"member_id": member.id, "decision": decision, "assisted": assisted},
        )
        if not any(m.consent_status == "pending" for m in lot.members) and any(
            m.consent_status == "accepted" for m in lot.members
        ):
            self.open_lot(lot, at, by=None)

    def open_lot(self, lot: Lot, at: datetime, *, by: User | None) -> None:
        """``forming``/``awaiting_consent`` → ``open_for_offers`` (manual open declines no-shows)."""
        for member in lot.members:
            if member.consent_status == "pending":
                member.consent_status = "declined"
                member.consent_note = "Did not respond"
                member.consented_at = at
                member.updated_at = at
        self.set_lot_status(lot, "open_for_offers", at)
        total = self.lot_total(lot)
        self.audit(
            at,
            by,
            "lot.open",
            "lot",
            lot.id,
            f"{lot.code} opened for offers with {kg_text(total)} from "
            f"{len(self.active_members(lot))} farmers"
            + (" (opened by coordinator)" if by else " (all consents received)"),
            {"total_kg": total},
        )
        self.notify(
            at,
            self.member_farmers(lot),
            "lot",
            "Your pooled lot is open for offers",
            f"{lot.code} ({kg_text(total)}) is now visible to buyers. You will be asked before "
            "any deal is confirmed.",
            f"/app/farmer/lots/{lot.id}",
        )

    def cancel_lot(self, lot: Lot, at: datetime, reason: str) -> None:
        if lot.status not in ("forming", "awaiting_consent", "open_for_offers", "offer_accepted"):
            raise AssertionError(f"{lot.code}: cannot cancel from {lot.status}")
        for offer in self.offers:
            if offer.lot_id == lot.id and offer.status in ("pending", "countered", "proposed"):
                self.reject(offer, at, message="Lot cancelled by the coordinator")
        self.set_lot_status(lot, "cancelled", at)
        lot.cancelled_reason = reason
        self.audit(
            at, self.coordinator, "lot.cancel", "lot", lot.id, f"Cancelled {lot.code}: {reason}"
        )
        self.notify(
            at,
            self.member_farmers(lot),
            "lot",
            f"Lot {lot.code} cancelled",
            f"{reason} Your harvest is available to sell again.",
            f"/app/farmer/lots/{lot.id}",
        )

    # ──────────────────────────── demands ────────────────────────────

    def add_demand(
        self,
        key: str,
        buyer_key: str,
        crop_code: str,
        quantity: int,
        *,
        at: datetime,
        destination: Place,
        needed_by: date,
        payment_days: int,
        grade: Grade = "A",
        min_quantity: int | None = None,
        target_price: Decimal | None = None,
        max_rejection: Decimal | None = None,
        quality_spec: str | None = None,
        notes: str | None = None,
        status: DemandStatus = "open",
    ) -> Demand:
        buyer = self.users[buyer_key]
        crop = self.crops[crop_code]
        demand = Demand(
            id=_new_id(),
            buyer_id=buyer.id,
            crop_id=crop.id,
            grade_required=grade,
            quantity_kg=kg(quantity),
            min_quantity_kg=kg(min_quantity if min_quantity is not None else quantity),
            target_price_per_kg=target_price,
            delivery_location=destination.name,
            delivery_district=destination.district,
            delivery_state=destination.state,
            delivery_latitude=destination.latitude,
            delivery_longitude=destination.longitude,
            needed_by=needed_by,
            payment_terms_days=payment_days,
            max_rejection_pct=(
                max_rejection if max_rejection is not None else crop.default_rejection_pct
            ),
            quality_spec=quality_spec,
            notes=notes,
            status=status,
            created_at=at,
            updated_at=at,
        )
        self.db.add(demand)
        self.demands[key] = demand
        self.stats.add("demands")
        self.audit(
            at,
            buyer,
            "demand.create",
            "demand",
            demand.id,
            f"{self.org(buyer)} needs {kg_text(quantity)} {CROP_SPECS[crop_code].name} grade "
            f"{grade} by {day_text(needed_by)}",
            {"crop": crop_code, "quantity_kg": quantity},
        )
        return demand

    def set_demand_status(self, demand: Demand | None, status: DemandStatus, at: datetime) -> None:
        if demand is None:
            return
        demand.status = status
        demand.updated_at = at

    # ──────────────────────────── offers ────────────────────────────

    def _entry(
        self,
        offer: Offer,
        author: User | None,
        action: NegotiationAction,
        at: datetime,
        *,
        price: Decimal | None = None,
        quantity: Decimal | None = None,
        days: int | None = None,
        message: str | None = None,
    ) -> None:
        offer.negotiation.append(
            NegotiationEntry(
                id=_new_id(),
                author_id=author.id if author else None,
                author_role=author.role if author else "system",
                action=action,
                price_per_kg=price,
                quantity_kg=quantity,
                payment_terms_days=days,
                message=message,
                created_at=at,
            )
        )
        offer.updated_at = at
        self.stats.add("negotiation entries")

    def seller_side(self, offer: Offer) -> list[User]:
        if offer.target_type == "harvest":
            assert offer.harvest is not None
            return [next(u for u in self.users.values() if u.id == offer.harvest.farmer_id)]
        return self.coordinators

    def buyer_of(self, offer: Offer) -> User:
        return next(u for u in self.users.values() if u.id == offer.buyer_id)

    def offer_link(self, offer: Offer) -> str:
        return f"/app/{{role}}/offers/{offer.id}"

    def target_code(self, offer: Offer) -> str:
        if offer.lot is not None and not offer.lot.is_solo:
            return offer.lot.code
        crop = CROP_SPECS[self.crop_code_of(offer.crop_id)].name
        return f"your {crop}"

    async def make_offer(
        self,
        buyer_key: str,
        *,
        at: datetime,
        price: Decimal,
        terms: PickupTerms,
        destination: Place,
        payment_days: int,
        lot: Lot | None = None,
        harvest: Harvest | None = None,
        quantity: int | Decimal | None = None,
        max_rejection: Decimal | None = None,
        handling: Decimal = Decimal("0"),
        valid_until: datetime | None = None,
        demand: Demand | None = None,
        quality_spec: str | None = None,
        notes: str | None = None,
        message: str | None = None,
    ) -> Offer:
        buyer = self.users[buyer_key]
        if (lot is None) == (harvest is None):
            raise AssertionError("an offer targets exactly one lot or harvest")
        if lot is not None and lot.status != "open_for_offers":
            raise AssertionError(f"{lot.code}: offers need an open lot, not {lot.status}")
        if harvest is not None and harvest.status != "listed":
            raise AssertionError("direct offers need a listed harvest")
        for other in self.offers:
            same_target = (lot is not None and other.lot_id == lot.id) or (
                harvest is not None and other.harvest_id == harvest.id
            )
            if (
                same_target
                and other.buyer_id == buyer.id
                and other.status in ("pending", "countered", "proposed")
            ):
                raise AssertionError("one open offer per buyer per target")
        crop_id = lot.crop_id if lot else harvest.crop_id  # type: ignore[union-attr]
        crop = CROP_SPECS[self.crop_code_of(crop_id)]
        if quantity is None:
            quantity = self.lot_total(lot) if lot else self.available_kg(harvest)  # type: ignore[arg-type]
        offer = Offer(
            id=_new_id(),
            code=await next_code(self.db, "offer"),
            buyer_id=buyer.id,
            target_type="lot" if lot else "harvest",
            lot_id=lot.id if lot else None,
            harvest_id=harvest.id if harvest else None,
            demand_id=demand.id if demand else self._own_lot_demand(lot, buyer),
            crop_id=crop_id,
            grade=lot.grade if lot else harvest.grade,  # type: ignore[union-attr]
            price_per_kg=price,
            quantity_kg=kg(quantity),
            pickup_terms=terms,
            delivery_location=destination.name,
            delivery_latitude=destination.latitude,
            delivery_longitude=destination.longitude,
            payment_terms_days=payment_days,
            max_rejection_pct=max_rejection
            if max_rejection is not None
            else crop.default_rejection_pct,
            quality_spec=quality_spec,
            handling_charge_per_kg=handling,
            commission_pct=Decimal("0"),
            valid_until=valid_until or at + timedelta(days=3),
            status="pending",
            awaiting="seller",
            notes=notes,
            accepted_at=None,
            created_at=at,
            updated_at=at,
            negotiation=[],
            consents=[],
        )
        if lot is not None:
            offer.lot = lot
        else:
            offer.harvest = harvest
        self.db.add(offer)
        self.offers.append(offer)
        self.stats.add("offers")
        self._entry(
            offer,
            buyer,
            "offer",
            at,
            price=price,
            quantity=offer.quantity_kg,
            days=payment_days,
            message=message,
        )
        target = lot.code if lot else f"{crop.name} harvest"
        terms_text = "buyer pickup" if terms == "buyer_pickup" else "MandiMate delivery"
        recipients = (
            self.member_farmers(lot) + self.coordinators if lot else self.seller_side(offer)
        )
        self.notify(
            at,
            recipients,
            "offer",
            f"New offer on {self.target_code(offer)}",
            f"{self.org(buyer)} offers {per_kg(price)} for {kg_text(offer.quantity_kg)} "
            f"({terms_text}, paid in {payment_days} day{'s' if payment_days != 1 else ''})."
            + ("" if buyer.verification_status == "verified" else " Buyer not yet verified."),
            self.offer_link(offer),
        )
        self.audit(
            at,
            buyer,
            "offer.create",
            "offer",
            offer.id,
            f"{offer.code}: {self.org(buyer)} offered {per_kg(price)} for "
            f"{kg_text(offer.quantity_kg)} on {target}",
            {"code": offer.code, "price_per_kg": price, "quantity_kg": offer.quantity_kg},
        )
        return offer

    def _own_lot_demand(self, lot: Lot | None, buyer: User) -> uuid.UUID | None:
        """An offer answers the lot's demand only when that demand is the buyer's own."""
        demand = self.demand_by_id(lot.demand_id) if lot is not None else None
        return demand.id if demand is not None and demand.buyer_id == buyer.id else None

    def counter(
        self,
        offer: Offer,
        by: User,
        price: Decimal,
        at: datetime,
        *,
        message: str | None = None,
        days: int | None = None,
    ) -> None:
        if by.role == "buyer":
            if offer.status != "countered":
                raise AssertionError("buyer counters only a countered offer")
            offer.status, offer.awaiting = "pending", "seller"
            recipients = self.seller_side(offer)
        else:
            if offer.status != "pending":
                raise AssertionError("seller counters only a pending offer")
            offer.status, offer.awaiting = "countered", "buyer"
            recipients = [self.buyer_of(offer)]
        offer.price_per_kg = price
        if days is not None:
            offer.payment_terms_days = days
        self._entry(
            offer,
            by,
            "counter",
            at,
            price=price,
            quantity=offer.quantity_kg,
            days=offer.payment_terms_days,
            message=message,
        )
        self.notify(
            at,
            recipients,
            "offer",
            f"Counter-offer on {offer.code}",
            f"{self.org(by) if by.role == 'buyer' else by.full_name} proposes {per_kg(price)} "
            f"for {kg_text(offer.quantity_kg)}.",
            self.offer_link(offer),
        )
        self.audit(
            at,
            by,
            "offer.counter",
            "offer",
            offer.id,
            f"{offer.code}: counter at {per_kg(price)}",
            {"price_per_kg": price},
        )

    def accept(self, offer: Offer, by: User, at: datetime, *, message: str | None = None) -> None:
        """The awaiting side accepts: harvest offers close, lot offers go to the farmers."""
        expected = "buyer" if by.role == "buyer" else "seller"
        if offer.awaiting != expected:
            raise AssertionError(f"{offer.code}: {expected} cannot accept now")
        self._entry(offer, by, "accept", at, price=offer.price_per_kg, message=message)
        self.audit(
            at,
            by,
            "offer.accept",
            "offer",
            offer.id,
            f"{offer.code}: {by.full_name} accepted {per_kg(offer.price_per_kg)}",
        )
        if offer.target_type == "lot":
            self._propose(offer, at + SYSTEM_STEP)
        else:
            self._close_accepted(offer, at + SYSTEM_STEP)

    def _propose(self, offer: Offer, at: datetime) -> None:
        lot = offer.lot
        assert lot is not None
        offer.status, offer.awaiting = "proposed", "farmers"
        members = self.active_members(lot)
        for index, member in enumerate(members):
            offer.consents.append(
                OfferConsent(
                    id=_new_id(),
                    member_id=member.id,
                    farmer_id=member.farmer_id,
                    quantity_kg=member.quantity_kg,
                    decision="pending",
                    decided_at=None,
                    note=None,
                    recorded_by_id=None,
                    created_at=at + timedelta(microseconds=index),
                    updated_at=at,
                    member=member,
                )
            )
        self._entry(
            offer,
            None,
            "propose",
            at,
            price=offer.price_per_kg,
            quantity=offer.quantity_kg,
            message=f"Sent to {len(members)} farmers for consent",
        )
        buyer = self.buyer_of(offer)
        for member in members:
            self.notify(
                at,
                [self.farmer_of(member)],
                "consent",
                "Review the deal and consent",
                f"{self.org(buyer)} · {per_kg(offer.price_per_kg)} for "
                f"{kg_text(offer.quantity_kg)} pooled in {lot.code}. Your share: "
                f"{kg_text(member.quantity_kg)}.",
                f"/app/farmer/offers/{offer.id}",
            )
        self.audit(
            at,
            None,
            "offer.propose",
            "offer",
            offer.id,
            f"{offer.code} sent to {len(members)} farmers of {lot.code} for consent",
        )

    def offer_consent(
        self,
        offer: Offer,
        member: LotMember,
        decision: ConsentDecision,
        at: datetime,
        *,
        assisted: bool = False,
        note: str | None = None,
    ) -> None:
        if offer.status != "proposed":
            raise AssertionError(f"{offer.code}: consent only while proposed")
        consent = next(c for c in offer.consents if c.member_id == member.id)
        farmer = self.farmer_of(member)
        consent.decision = decision
        consent.decided_at = at
        consent.note = note
        consent.updated_at = at
        if assisted:
            consent.recorded_by_id = self.coordinator.id
        actor = self.coordinator if assisted else farmer
        self._entry(
            offer,
            actor,
            "consent",
            at,
            quantity=member.quantity_kg,
            message=f"{farmer.full_name} {decision}"
            + (" (assisted consent)" if assisted else "")
            + (f": {note}" if note else ""),
        )
        self.audit(
            at,
            actor,
            "offer.consent",
            "offer",
            offer.id,
            f"{offer.code}: {farmer.full_name} {decision} the deal"
            + (" (assisted consent)" if assisted else ""),
            {"member_id": member.id, "decision": decision},
        )
        if decision == "declined":
            member.consent_status = "declined"
            member.consent_note = note or "Declined the deal"
            member.updated_at = at
        self.notify(
            at,
            self.coordinators,
            "consent",
            f"{farmer.full_name} {decision} {offer.code}",
            f"{kg_text(member.quantity_kg)} in {offer.lot.code if offer.lot else ''}.",
            f"/app/coordinator/offers/{offer.id}",
        )
        if not any(c.decision == "pending" for c in offer.consents):
            if any(c.decision == "accepted" for c in offer.consents):
                self._close_accepted(offer, at + SYSTEM_STEP)
            else:
                self.reject(offer, at + SYSTEM_STEP, message="Every farmer declined")

    def _close_accepted(self, offer: Offer, at: datetime) -> None:
        offer.status, offer.awaiting = "accepted", None
        offer.accepted_at = at
        offer.updated_at = at
        lot = offer.lot
        if lot is not None:
            total = self.lot_total(lot)
            if offer.quantity_kg > total:
                offer.quantity_kg = total
            lot.accepted_offer = offer
            lot.pickup_terms = offer.pickup_terms
            self.set_lot_status(lot, "offer_accepted", at)
        if offer.target_type == "lot":
            self._entry(offer, None, "accept", at, message="All farmers consented; deal confirmed")
        for other in self.offers:
            if other is offer or other.status not in ("pending", "countered", "proposed"):
                continue
            same_lot = offer.lot_id is not None and other.lot_id == offer.lot_id
            same_harvest = offer.harvest_id is not None and other.harvest_id == offer.harvest_id
            if same_lot or same_harvest:
                self.reject(other, at, message="Another offer was accepted")
        self.set_demand_status(self.demand_by_id(offer.demand_id), "matched", at)
        buyer = self.buyer_of(offer)
        farmers = self.member_farmers(lot) if lot is not None else self.seller_side(offer)
        self.notify(
            at,
            [buyer, *farmers],
            "offer",
            f"Deal confirmed: {offer.code}",
            f"{per_kg(offer.price_per_kg)} for {kg_text(offer.quantity_kg)} with "
            f"{self.org(buyer)}; payment in {offer.payment_terms_days} days.",
            self.offer_link(offer),
        )

    def reject(
        self, offer: Offer, at: datetime, *, by: User | None = None, message: str | None = None
    ) -> None:
        offer.status, offer.awaiting = "rejected", None
        self._entry(offer, by, "reject", at, message=message)
        if by is None or by.role != "buyer":
            self.notify(
                at,
                [self.buyer_of(offer)],
                "offer",
                f"Offer {offer.code} not accepted",
                message or "The seller declined your offer.",
                self.offer_link(offer),
            )
        self.audit(at, by, "offer.reject", "offer", offer.id, f"{offer.code} rejected: {message}")

    def withdraw(self, offer: Offer, at: datetime, message: str) -> None:
        buyer = self.buyer_of(offer)
        offer.status, offer.awaiting = "withdrawn", None
        self._entry(offer, buyer, "withdraw", at, message=message)
        self.notify(
            at,
            self.seller_side(offer),
            "offer",
            f"Offer {offer.code} withdrawn",
            f"{self.org(buyer)}: {message}",
            self.offer_link(offer),
        )
        self.audit(at, buyer, "offer.withdraw", "offer", offer.id, f"{offer.code} withdrawn")

    def expire(self, offer: Offer) -> None:
        if offer.valid_until >= self.clock.now:
            raise AssertionError("only past-validity offers expire")
        offer.status, offer.awaiting = "expired", None
        self._entry(
            offer, None, "note", offer.valid_until, message="Offer expired without a response"
        )

    async def accept_direct(
        self,
        offer: Offer,
        at: datetime,
        *,
        pickup_date: date,
        message: str | None = None,
    ) -> Lot:
        """The farmer accepts a direct offer: a solo lot carries the deal through delivery."""
        harvest = offer.harvest
        assert harvest is not None
        farmer = self.seller_side(offer)[0]
        self.accept(offer, farmer, at, message=message)
        farm = Place(
            f"{farmer.full_name}'s farm, {harvest.village}",
            harvest.latitude,
            harvest.longitude,
            harvest.district or "",
            harvest.state or "",
        )
        lot = await self.create_lot(
            self.crop_code_of(harvest.crop_id),
            harvest.grade,
            farm,
            pickup_date,
            at,
            solo=True,
            created_by=farmer,
            target_kg=int(offer.quantity_kg),
        )
        self.add_member(lot, harvest, offer.quantity_kg, consent="accepted", at=at, consented_at=at)
        offer.lot = lot
        lot.accepted_offer = offer
        lot.pickup_terms = offer.pickup_terms
        self.set_lot_status(lot, "offer_accepted", at)
        self._entry(
            offer,
            None,
            "note",
            at + 2 * SYSTEM_STEP,
            message=f"Solo lot {lot.code} created for delivery",
        )
        self.audit(at, farmer, "lot.create", "lot", lot.id, f"Solo lot {lot.code} for {offer.code}")
        return lot

    # ─────────────────────────── transport ───────────────────────────

    def create_transport_request(
        self, lot: Lot, at: datetime, *, notes: str | None = None
    ) -> TransportRequest:
        offer = lot.accepted_offer
        assert offer is not None and offer.pickup_terms == "mandimate_delivery"
        if lot.status != "offer_accepted":
            raise AssertionError(f"{lot.code}: transport needs offer_accepted")
        members = {member.id: member for member in self.active_members(lot)}
        crop = self.crops[self.crop_code_of(lot.crop_id)]
        stops = [
            RouteStop(
                id=member.id,
                latitude=member.harvest.latitude,
                longitude=member.harvest.longitude,
                quantity_kg=member.quantity_kg,
                label=member.harvest.village or "",
            )
            for member in members.values()
        ]
        destination = (offer.delivery_latitude, offer.delivery_longitude)
        plan = plan_route(stops, destination)  # type: ignore[arg-type]
        total = self.lot_total(lot)
        estimate = estimate_transport_cost(
            total, plan.total_distance_km, crop.requires_refrigeration
        )
        request = TransportRequest(
            id=_new_id(),
            requested_by_id=self.coordinator.id,
            total_quantity_kg=total,
            pickup_date=lot.pickup_date,
            requires_refrigeration=crop.requires_refrigeration,
            destination_name=offer.delivery_location,
            destination_latitude=offer.delivery_latitude,
            destination_longitude=offer.delivery_longitude,
            estimated_distance_km=plan.total_distance_km,
            suggested_vehicle_type=estimate.vehicle_type,
            estimated_cost=estimate.cost_total,
            status="open",
            notes=notes,
            completion_note=None,
            started_at=None,
            completed_at=None,
            created_at=at,
            updated_at=at,
            stops=[],
            quotes=[],
        )
        request.lot = lot
        for sequence, stop in enumerate(plan.ordered_stops, start=1):
            member = members[stop.id]  # type: ignore[index]
            transport_stop = TransportStop(
                id=_new_id(),
                sequence=sequence,
                village=member.harvest.village,
                latitude=stop.latitude,
                longitude=stop.longitude,
                quantity_kg=member.quantity_kg,
                status="pending",
                picked_kg=None,
                picked_up_at=None,
                note=None,
                created_at=at,
                updated_at=at,
            )
            transport_stop.member = member
            request.stops.append(transport_stop)
        self.db.add(request)
        self.requests[lot.id] = request
        self.stats.add("transport requests")
        self.audit(
            at,
            self.coordinator,
            "transport.request",
            "transport_request",
            request.id,
            f"Transport requested for {lot.code}: {kg_text(total)}, {len(stops)} stops, "
            f"{plan.total_distance_km} km to {offer.delivery_location}",
            {"estimated_cost": estimate.cost_total, "vehicle": estimate.vehicle_type},
        )
        self.notify(
            at,
            self.transporters,
            "pickup",
            f"New transport request: {lot.code}",
            f"{kg_text(total)} {crop.name}, {len(stops)} pickups on {day_text(lot.pickup_date)} "
            f"to {offer.delivery_location} (~{plan.total_distance_km} km).",
            f"/app/transporter/requests/{request.id}",
        )
        return request

    def suggested_price(self, request: TransportRequest, factor: float) -> Decimal:
        """A quote around the estimate, rounded to ₹50."""
        return round_to_step(request.estimated_cost * Decimal(str(factor)), Decimal("50"))

    def quote(
        self,
        request: TransportRequest,
        transporter_key: str,
        price_total: Decimal,
        at: datetime,
        *,
        vehicle: Vehicle | None = None,
        notes: str | None = None,
    ) -> TransportQuote:
        transporter = self.users[transporter_key]
        if vehicle is None:
            vehicle = next(
                (
                    v
                    for v in self.vehicles_of(transporter_key)
                    if v.capacity_kg >= request.total_quantity_kg
                ),
                self.vehicles_of(transporter_key)[-1],
            )
        eta = round(float(request.estimated_distance_km) / 32 + 0.5 * len(request.stops), 1)
        quote = TransportQuote(
            id=_new_id(),
            transporter_id=transporter.id,
            vehicle_id=vehicle.id,
            vehicle_type=vehicle.vehicle_type,
            capacity_kg=vehicle.capacity_kg,
            price_total=price_total,
            price_per_kg=round_money(price_total / request.total_quantity_kg),
            eta_hours=Decimal(str(eta)),
            notes=notes,
            status="submitted",
            created_at=at,
            updated_at=at,
        )
        request.quotes.append(quote)
        if request.status == "open":
            request.status = "quoted"
        request.updated_at = at
        self.stats.add("transport quotes")
        lot = request.lot
        self.audit(
            at,
            transporter,
            "transport.quote",
            "transport_request",
            request.id,
            f"{self.org(transporter)} quoted {rupees(price_total)} for {lot.code} "
            f"({vehicle.vehicle_type.replace('_', ' ')})",
            {"price_total": price_total, "vehicle_id": vehicle.id},
        )
        self.notify(
            at,
            self.coordinators,
            "pickup",
            f"New quote for {lot.code}",
            f"{self.org(transporter)}: {rupees(price_total)} "
            f"({per_kg(quote.price_per_kg)}), {vehicle.vehicle_type.replace('_', ' ')}, "
            f"ETA {eta} h.",
            "/app/coordinator/transport",
        )
        return quote

    def book(self, request: TransportRequest, quote: TransportQuote, at: datetime) -> None:
        lot = request.lot
        quote.status = "accepted"
        quote.updated_at = at
        for other in request.quotes:
            if other is not quote and other.status == "submitted":
                other.status = "rejected"
                other.updated_at = at
        request.booked_quote = quote
        request.status = "booked"
        request.updated_at = at
        self.set_lot_status(lot, "transport_booked", at)
        transporter = next(u for u in self.users.values() if u.id == quote.transporter_id)
        self.audit(
            at,
            self.coordinator,
            "transport.book",
            "transport_request",
            request.id,
            f"Booked {self.org(transporter)} for {lot.code} at {rupees(quote.price_total)}",
            {"quote_id": quote.id},
        )
        self.notify(
            at,
            [transporter],
            "pickup",
            f"Quote accepted: {lot.code}",
            f"Your {rupees(quote.price_total)} quote was accepted. Pickups on "
            f"{day_text(lot.pickup_date)}, {len(request.stops)} stops.",
            f"/app/transporter/trips/{request.id}",
        )
        for stop in request.stops:
            self.notify(
                at,
                [self.farmer_of(stop.member)],
                "pickup",
                f"Pickup on {day_text(lot.pickup_date)}",
                f"{self.org(transporter)} will collect {kg_text(stop.quantity_kg)} for {lot.code} "
                f"(stop {stop.sequence} of {len(request.stops)}). Keep the crates ready by 6 am.",
                f"/app/farmer/lots/{lot.id}",
            )

    def pickup(
        self, request: TransportRequest, stop: TransportStop, picked_kg: int, at: datetime
    ) -> None:
        lot = request.lot
        member = stop.member
        stop.status = "picked_up"
        stop.picked_kg = kg(picked_kg)
        stop.picked_up_at = at
        stop.updated_at = at
        member.dispatched_kg = kg(picked_kg)
        member.updated_at = at
        if request.status == "booked":
            request.status = "in_progress"
            request.started_at = at
            self.set_lot_status(lot, "in_transit", at)
        request.updated_at = at
        farmer = self.farmer_of(member)
        transporter = next(
            u for u in self.users.values() if u.id == request.booked_quote.transporter_id
        )
        self.audit(
            at,
            transporter,
            "transport.pickup",
            "transport_request",
            request.id,
            f"Picked {kg_text(picked_kg)} from {farmer.full_name} ({lot.code}, stop {stop.sequence})",
            {"stop_id": stop.id, "picked_kg": picked_kg},
        )
        self.notify(
            at,
            [farmer],
            "pickup",
            f"Pickup confirmed: {kg_text(picked_kg)}",
            f"{self.org(transporter)} collected {kg_text(picked_kg)} for {lot.code}.",
            f"/app/farmer/lots/{lot.id}",
        )

    def complete_trip(self, request: TransportRequest, at: datetime, note: str) -> None:
        if any(stop.status == "pending" for stop in request.stops):
            raise AssertionError("complete only after every pickup")
        request.status = "completed"
        request.completed_at = at
        request.completion_note = note
        request.updated_at = at
        transporter = next(
            u for u in self.users.values() if u.id == request.booked_quote.transporter_id
        )
        self.audit(
            at,
            transporter,
            "transport.complete",
            "transport_request",
            request.id,
            f"Trip for {request.lot.code} completed",
        )

    # ─────────────────────── delivery & settlement ───────────────────────

    def outcome(
        self,
        member: LotMember,
        rng: Any,
        *,
        rejection_pct: tuple[float, float],
        max_shortage: int = 3,
    ) -> tuple[int, int, str | None]:
        """A realistic ``(delivered_kg, accepted_kg, reason)`` for a member."""
        dispatched = int(member.dispatched_kg or member.quantity_kg)
        delivered = dispatched - rng.randint(0, max_shortage)
        rejected = round(delivered * rng.uniform(*rejection_pct) / 100)
        code = self.crop_code_of(member.harvest.crop_id)
        reason = rng.choice(REJECTION_REASONS[code]) if rejected else None
        return delivered, delivered - rejected, reason

    def record_delivery(
        self,
        lot: Lot,
        at: datetime,
        *,
        recorded_by: User,
        outcomes: dict[uuid.UUID, tuple[int, int, str | None]],
        inspector: str | None = None,
        notes: str | None = None,
    ) -> Delivery:
        allowed = ("offer_accepted", "transport_booked", "in_transit")
        if lot.pickup_terms == "mandimate_delivery":
            allowed = ("in_transit",)
        if lot.status not in allowed:
            raise AssertionError(f"{lot.code}: cannot record delivery from {lot.status}")
        for member in self.active_members(lot):
            delivered, accepted, reason = outcomes[member.id]
            dispatched = member.dispatched_kg or member.quantity_kg
            if not 0 <= accepted <= delivered <= dispatched * DELIVERY_TOLERANCE:
                raise AssertionError(f"{lot.code}: inconsistent delivery weights")
            member.dispatched_kg = dispatched
            member.delivered_kg = kg(delivered)
            member.accepted_kg = kg(accepted)
            member.rejected_kg = kg(delivered - accepted)
            member.rejection_reason = reason
            member.updated_at = at
        delivery = Delivery(
            id=_new_id(),
            recorded_by_id=recorded_by.id,
            inspector_name=inspector,
            notes=notes,
            recorded_at=at,
            created_at=at,
            updated_at=at,
        )
        delivery.lot = lot
        self.db.add(delivery)
        self.deliveries[lot.id] = delivery
        self.stats.add("deliveries")
        self.set_lot_status(lot, "delivered", at)
        lot.delivered_at = at
        accepted_total = sum((m.accepted_kg or 0 for m in self.active_members(lot)), Decimal(0))
        self.audit(
            at,
            recorded_by,
            "delivery.record",
            "lot",
            lot.id,
            f"Delivery of {lot.code} recorded: {kg_text(accepted_total)} accepted",
            {"accepted_kg": accepted_total},
        )
        buyer = self.buyer_of(lot.accepted_offer)
        for member in self.active_members(lot):
            self.notify(
                at,
                [self.farmer_of(member)],
                "delivery",
                f"Delivered: {lot.code}",
                f"{kg_text(member.accepted_kg)} of your {kg_text(member.dispatched_kg)} accepted"
                + (
                    f" ({kg_text(member.rejected_kg)} rejected: {member.rejection_reason})."
                    if member.rejected_kg
                    else "."
                ),
                f"/app/farmer/lots/{lot.id}",
            )
        summary = f"{kg_text(accepted_total)} accepted at {lot.accepted_offer.delivery_location}."
        self.notify(
            at,
            self.coordinators,
            "delivery",
            f"Delivery recorded: {lot.code}",
            summary,
            f"/app/coordinator/lots/{lot.id}",
        )
        if recorded_by.id != buyer.id:
            self.notify(
                at,
                [buyer],
                "delivery",
                f"Delivery recorded: {lot.code}",
                summary,
                f"/app/buyer/orders/{lot.id}",
            )
        return delivery

    def transport_total(self, lot: Lot) -> Decimal:
        if lot.pickup_terms != "mandimate_delivery":
            return Decimal("0")
        request = self.requests[lot.id]
        assert request.booked_quote is not None
        return request.booked_quote.price_total

    async def create_settlement(self, lot: Lot, at: datetime) -> Settlement:
        offer = lot.accepted_offer
        assert offer is not None
        code = self.crop_code_of(lot.crop_id)
        crop = self.crops[code]
        members = self.active_members(lot)
        transport_total = self.transport_total(lot)
        total_dispatched = sum((m.dispatched_kg for m in members), Decimal(0))
        delivered_on = self.clock.ist_date(at)
        payouts: list[FarmerPayout] = []
        for index, member in enumerate(members):
            figures = payout_figures(
                price_per_kg=offer.price_per_kg,
                accepted_kg=member.accepted_kg,
                dispatched_kg=member.dispatched_kg,
                total_dispatched_kg=total_dispatched,
                transport_total=transport_total,
                handling_charge_per_kg=offer.handling_charge_per_kg,
                commission_pct=offer.commission_pct,
            )
            baseline_per_kg = baseline_net_per_kg(
                code, crop, member.harvest, member.dispatched_kg, delivered_on, self.clock.today
            )
            payouts.append(
                FarmerPayout(
                    id=_new_id(),
                    farmer_id=member.farmer_id,
                    dispatched_kg=member.dispatched_kg,
                    accepted_kg=member.accepted_kg,
                    rejected_kg=member.rejected_kg,
                    gross_amount=figures.gross,
                    transport_share=figures.transport_share,
                    handling_share=figures.handling_share,
                    commission_share=figures.commission_share,
                    net_amount=figures.net,
                    net_per_kg=figures.net_per_kg,
                    baseline_net_per_kg=baseline_per_kg,
                    uplift_per_kg=(
                        round_money(figures.net_per_kg - baseline_per_kg)
                        if baseline_per_kg is not None
                        else None
                    ),
                    status="pending",
                    reference=None,
                    paid_at=None,
                    marked_paid_by_id=None,
                    created_at=at + timedelta(microseconds=index),
                    updated_at=at,
                    member=member,
                )
            )

        def total(attribute: str) -> Decimal:
            return sum((getattr(p, attribute) for p in payouts), Decimal(0))

        settlement = Settlement(
            id=_new_id(),
            code=await next_code(self.db, "settlement"),
            buyer_id=offer.buyer_id,
            price_per_kg=offer.price_per_kg,
            total_accepted_kg=total("accepted_kg"),
            gross_amount=total("gross_amount"),
            transport_cost=total("transport_share"),
            handling_cost=total("handling_share"),
            commission_amount=total("commission_share"),
            net_to_farmers=total("net_amount"),
            amount_paid=Decimal("0.00"),
            payment_status="pending",
            due_date=delivered_on + timedelta(days=offer.payment_terms_days),
            paid_at=None,
            created_at=at,
            updated_at=at,
            payouts=payouts,
            payments=[],
        )
        settlement.lot = lot
        settlement.offer = offer
        self.db.add(settlement)
        self.settlements[lot.id] = settlement
        self.stats.add("settlements")
        self.audit(
            at,
            None,
            "settlement.create",
            "settlement",
            settlement.id,
            f"{settlement.code} for {lot.code}: buyer owes {rupees(settlement.gross_amount)}, "
            f"farmers net {rupees(settlement.net_to_farmers)}",
            {"gross_amount": settlement.gross_amount, "net_to_farmers": settlement.net_to_farmers},
        )
        return settlement

    def has_open_dispute(self, settlement: Settlement) -> bool:
        return any(
            d.settlement_id == settlement.id and d.status in ("open", "under_review")
            for d in self.disputes
        )

    def refresh_payment_status(self, settlement: Settlement, at: datetime) -> None:
        paid = settlement.amount_paid >= settlement.gross_amount - Decimal("0.01")
        if paid:
            settlement.payment_status = "paid"
            settlement.paid_at = settlement.paid_at or at
        elif self.has_open_dispute(settlement):
            settlement.payment_status = "disputed"
        elif settlement.amount_paid > 0:
            settlement.payment_status = "partially_paid"
        else:
            settlement.payment_status = "pending"
        settlement.updated_at = at

    def record_payment(
        self,
        settlement: Settlement,
        amount: Decimal,
        at: datetime,
        *,
        by: User,
        reference: str,
    ) -> None:
        amount = round_money(amount)
        settlement.payments.append(
            Payment(
                id=_new_id(),
                amount=amount,
                reference=reference,
                paid_at=at,
                recorded_by_id=by.id,
                created_at=at,
            )
        )
        settlement.amount_paid = round_money(settlement.amount_paid + amount)
        self.refresh_payment_status(settlement, at)
        self.stats.add("payments")
        self.audit(
            at,
            by,
            "settlement.payment",
            "settlement",
            settlement.id,
            f"{settlement.code}: payment of {rupees(amount)} recorded ({reference})",
            {"amount": amount, "reference": reference},
        )
        self.notify(
            at,
            self.coordinators,
            "payment",
            f"Payment received: {settlement.code}",
            f"{rupees(amount)} from {self.org(self.buyer_of(settlement.offer))} "
            f"({rupees(settlement.amount_paid)} of {rupees(settlement.gross_amount)} paid).",
            f"/app/coordinator/settlements/{settlement.id}",
        )

    def mark_payout_paid(
        self, settlement: Settlement, payout: FarmerPayout, at: datetime, reference: str
    ) -> None:
        if settlement.payment_status != "paid":
            raise AssertionError("payouts are paid only after the buyer has paid")
        payout.status = "paid"
        payout.reference = reference
        payout.paid_at = at
        payout.marked_paid_by_id = self.coordinator.id
        payout.updated_at = at
        farmer = self.farmer_of(payout.member)
        lot = settlement.lot
        self.audit(
            at,
            self.coordinator,
            "settlement.payout_paid",
            "settlement",
            settlement.id,
            f"{settlement.code}: paid {rupees(payout.net_amount)} to {farmer.full_name} ({reference})",
            {"payout_id": payout.id, "amount": payout.net_amount},
        )
        uplift = (
            f" That is {per_kg(payout.uplift_per_kg)} more than selling alone at the mandi."
            if payout.uplift_per_kg is not None and payout.uplift_per_kg > 0
            else ""
        )
        self.notify(
            at,
            [farmer],
            "payment",
            f"Payment sent: {rupees(payout.net_amount)}",
            f"Your net for {lot.code} ({kg_text(payout.accepted_kg)} accepted) was sent "
            f"by UPI, ref {reference}.{uplift}",
            "/app/farmer/earnings",
        )
        if all(p.status == "paid" for p in settlement.payouts):
            self.set_lot_status(lot, "settled", at)
            lot.settled_at = at
            self.set_demand_status(self.demand_by_id(lot.demand_id), "fulfilled", at)
            self.audit(at, None, "lot.settle", "lot", lot.id, f"{lot.code} settled")

    # ──────────────────────────── disputes ────────────────────────────

    async def raise_dispute(
        self,
        lot: Lot,
        by: User,
        category: DisputeCategory,
        description: str,
        at: datetime,
    ) -> Dispute:
        settlement = self.settlements.get(lot.id)
        dispute = Dispute(
            id=_new_id(),
            code=await next_code(self.db, "dispute"),
            settlement_id=settlement.id if settlement else None,
            raised_by_id=by.id,
            raised_by_role=by.role,
            category=category,
            description=description,
            status="open",
            resolution=None,
            resolved_by_id=None,
            resolved_at=None,
            created_at=at,
            updated_at=at,
        )
        dispute.lot = lot
        self.db.add(dispute)
        self.disputes.append(dispute)
        self.stats.add("disputes")
        if settlement is not None and settlement.payment_status != "paid":
            self.refresh_payment_status(settlement, at)
        self.audit(
            at,
            by,
            "dispute.create",
            "dispute",
            dispute.id,
            f"{dispute.code} ({category}) raised on {lot.code} by {by.full_name}",
        )
        self.notify(
            at,
            self.coordinators,
            "dispute",
            f"Dispute {dispute.code} raised on {lot.code}",
            f"{by.full_name} ({category}): {description[:140]}",
            "/app/coordinator/disputes",
        )
        return dispute

    def update_dispute(
        self,
        dispute: Dispute,
        status: str,
        at: datetime,
        *,
        resolution: str | None = None,
    ) -> None:
        dispute.status = status
        dispute.updated_at = at
        if status in ("resolved", "rejected"):
            dispute.resolution = resolution
            dispute.resolved_by_id = self.coordinator.id
            dispute.resolved_at = at
        settlement = self.settlements.get(dispute.lot_id)
        if settlement is not None and settlement.payment_status != "paid":
            self.refresh_payment_status(settlement, at)
        raiser = next(u for u in self.users.values() if u.id == dispute.raised_by_id)
        self.audit(
            at,
            self.coordinator,
            "dispute.update",
            "dispute",
            dispute.id,
            f"{dispute.code} → {status}" + (f": {resolution}" if resolution else ""),
        )
        self.notify(
            at,
            [raiser],
            "dispute",
            f"Dispute {dispute.code} {status.replace('_', ' ')}",
            resolution or "A coordinator is reviewing your dispute.",
            "/app/disputes",
        )

    # ───────────────────────────── finish ─────────────────────────────

    def sync_harvest_statuses(self) -> None:
        """Each harvest mirrors its most advanced active lot; listed ones past sell-by expire."""
        for harvest in self.harvests:
            best: Lot | None = None
            for member in self.members_by_harvest[harvest.id]:
                lot = self.lot_of_member[member.id]
                if lot.status == "cancelled" or member.consent_status == "declined":
                    continue
                if best is None or LOT_RANK[lot.status] > LOT_RANK[best.status]:
                    best = lot
            if best is not None:
                harvest.status = HARVEST_STATUS_FOR_LOT[best.status]
            elif harvest.status not in ("draft", "cancelled", "expired"):
                harvest.status = "listed"
            if harvest.status == "listed" and harvest.sell_by < self.clock.today:
                harvest.status = "expired"

    def finalise_targets(self) -> None:
        for lot in self.lots:
            if lot.target_quantity_kg <= 0:
                lot.target_quantity_kg = self.lot_total(lot) or kg(1000)


def baseline_net_per_kg(
    crop_code: str,
    crop: Crop,
    harvest: Harvest,
    quantity_kg: Decimal,
    on: date,
    today: date,
) -> Decimal | None:
    """Net ₹/kg of selling ``quantity_kg`` alone at the farmer's nearest mandi on ``on``."""
    if harvest.latitude is None or harvest.longitude is None:
        return None
    market = nearest_market(harvest.latitude, harvest.longitude)
    baseline = baseline_net_proceeds(
        quantity_kg=quantity_kg,
        market_price_per_kg=modal_price(crop_code, market, on, today),
        default_rejection_pct=crop.default_rejection_pct,
        distance_km=road_km(harvest.latitude, harvest.longitude, market.latitude, market.longitude),
        is_illustrative=True,
        market_name=market.name,
    )
    return Decimal(str(baseline.net_per_kg)) if baseline is not None else None
