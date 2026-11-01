/**
 * Pure helpers for the buyer workspace: offer buckets and allowed actions, order detection,
 * delivery arithmetic, settlement balances, landed cost and the farmers' view of an offer.
 * No React here, so every rule is unit-tested in isolation.
 */
import { todayIST } from '@/lib/format';
import {
  LOADING_PER_KG,
  baselineNetProceeds,
  calculate,
  roadKm,
} from '@/lib/netProceeds';
import type {
  Grade,
  ISODate,
  Lot,
  LotMember,
  NetProceeds,
  Offer,
  OfferStatus,
  PickupTerms,
  QualityStatus,
  Settlement,
  TransportRequest,
  UUID,
} from '@/types/api';

/* ─────────────────────────────── Numbers ─────────────────────────────── */

/** Rounds to the paisa / 10 grams, half away from zero. */
export function round2(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value) * 100 + Number.EPSILON * 100) / 100;
}

/** A finite number parsed from user input, or `null` for blanks and garbage. */
export function parseAmount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const trimmed = value.trim().replace(/,/g, '');
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/* ──────────────────────────────── Offers ─────────────────────────────── */

export const OPEN_STATUSES: ReadonlySet<OfferStatus> = new Set(['pending', 'countered', 'proposed']);

/** Where an offer sits in the buyer's inbox. */
export type OfferBucket = 'yours' | 'seller' | 'accepted' | 'closed';

export function offerBucket(offer: Pick<Offer, 'status' | 'awaiting'>): OfferBucket {
  if (offer.status === 'accepted') return 'accepted';
  if (!OPEN_STATUSES.has(offer.status)) return 'closed';
  return offer.awaiting === 'buyer' ? 'yours' : 'seller';
}

export interface BuyerOfferActions {
  /** Adopt the seller's countered terms. */
  acceptCounter: boolean;
  /** Send new terms back to the seller. */
  counter: boolean;
  /** Decline the counter-offer (ends the negotiation). */
  reject: boolean;
  /** Take the offer back while it is still open. */
  withdraw: boolean;
}

/** What the buyer may do next — mirrors the offer status machine in DOMAIN_RULES §2. */
export function buyerOfferActions(offer: Pick<Offer, 'status' | 'awaiting'>): BuyerOfferActions {
  const open = OPEN_STATUSES.has(offer.status);
  const yourTurn = open && offer.awaiting === 'buyer';
  return { acceptCounter: yourTurn, counter: yourTurn, reject: yourTurn, withdraw: open };
}

/** The buyer's own last written price in the negotiation (to show what a counter changed). */
export function lastBuyerPrice(offer: Pick<Offer, 'negotiation'>): number | null {
  const entries = [...offer.negotiation]
    .filter((entry) => entry.author_role === 'buyer' && entry.price_per_kg !== null)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return entries[0]?.price_per_kg ?? null;
}

/** The open offer the buyer already has on a lot or harvest, keyed by target id. */
export function openOfferByTarget(offers: readonly Offer[]): Map<UUID, Offer> {
  const map = new Map<UUID, Offer>();
  for (const offer of offers) {
    if (!OPEN_STATUSES.has(offer.status)) continue;
    const target = offer.target_type === 'lot' ? offer.lot_id : offer.harvest_id;
    if (target && !map.has(target)) map.set(target, offer);
  }
  return map;
}

/* ──────────────────────────────── Orders ─────────────────────────────── */

export interface Order {
  lot: Lot;
  offer: Offer | null;
}

/** Lots whose accepted offer is one of the buyer's own — the buyer's orders, newest first. */
export function ordersFrom(lots: readonly Lot[], acceptedOffers: readonly Offer[]): Order[] {
  const byId = new Map(acceptedOffers.map((offer) => [offer.id, offer]));
  return lots
    .filter((lot) => lot.accepted_offer_id !== null && byId.has(lot.accepted_offer_id))
    .map((lot) => ({ lot, offer: byId.get(lot.accepted_offer_id as UUID) ?? null }));
}

export type OrderStage = 'active' | 'completed' | 'cancelled';

export function orderStage(lot: Pick<Lot, 'status'>): OrderStage {
  if (lot.status === 'settled') return 'completed';
  if (lot.status === 'cancelled') return 'cancelled';
  return 'active';
}

/** Whether the buyer can record weights and the quality check now (DOMAIN_RULES §2, settlement_service). */
export function canRecordDelivery(lot: Pick<Lot, 'status' | 'pickup_terms'>): boolean {
  if (lot.pickup_terms === 'buyer_pickup') return lot.status === 'offer_accepted';
  return lot.status === 'transport_booked' || lot.status === 'in_transit';
}

export function isDelivered(lot: Pick<Lot, 'status'>): boolean {
  return lot.status === 'delivered' || lot.status === 'settled';
}

/** Members that are part of the deal (declined farmers are out of the lot). */
export function activeMembers(members: readonly LotMember[]): LotMember[] {
  return members.filter((member) => member.consent_status !== 'declined');
}

const QUALITY_RANK: Record<QualityStatus, number> = { self_reported: 0, pending_inspection: 1, inspected: 2 };

/** A lot is only as inspected as its least-inspected harvest (same rule as the supply API). */
export function lotQualityStatus(members: readonly LotMember[]): QualityStatus {
  const active = activeMembers(members);
  if (active.length === 0) return 'self_reported';
  return active.reduce<QualityStatus>(
    (worst, member) => (QUALITY_RANK[member.harvest_quality_status] < QUALITY_RANK[worst] ? member.harvest_quality_status : worst),
    'inspected',
  );
}

/* ─────────────────────────────── Delivery ────────────────────────────── */

/** Delivered weight may exceed the dispatched weight by up to 2 % (scale differences). */
export const DELIVERY_TOLERANCE = 1.02;

/** Picked-up weight per member when a pickup was confirmed, else the member's quantity. */
export function dispatchedByMember(
  members: readonly LotMember[],
  request?: Pick<TransportRequest, 'stops'> | null,
): Map<UUID, number> {
  const picked = new Map<UUID, number>();
  for (const stop of request?.stops ?? []) {
    if (stop.picked_kg !== null) picked.set(stop.member_id, stop.picked_kg);
  }
  return new Map(activeMembers(members).map((member) => [member.id, picked.get(member.id) ?? member.quantity_kg]));
}

export interface DeliveryLine {
  dispatched: number;
  delivered: number | null;
  accepted: number | null;
}

export interface DeliveryLineResult {
  /** delivered − accepted (null until both are entered). */
  rejected: number | null;
  /** dispatched − delivered, never below zero. */
  shortage: number | null;
  /** delivered − dispatched when more arrived than left the farm. */
  surplus: number;
  /** The most that may be recorded as delivered. */
  maxDelivered: number;
  overLimit: boolean;
  acceptedAboveDelivered: boolean;
}

export function deliveryLine({ dispatched, delivered, accepted }: DeliveryLine): DeliveryLineResult {
  const maxDelivered = round2(dispatched * DELIVERY_TOLERANCE);
  const rejected = delivered !== null && accepted !== null ? round2(Math.max(0, delivered - accepted)) : null;
  const shortage = delivered !== null ? round2(Math.max(0, dispatched - delivered)) : null;
  const surplus = delivered !== null ? round2(Math.max(0, delivered - dispatched)) : 0;
  return {
    rejected,
    shortage,
    surplus,
    maxDelivered,
    overLimit: delivered !== null && delivered > maxDelivered + 1e-9,
    acceptedAboveDelivered: delivered !== null && accepted !== null && accepted > delivered + 1e-9,
  };
}

export interface DeliveryTotals {
  dispatched: number;
  delivered: number;
  accepted: number;
  rejected: number;
  shortage: number;
  /** Every line has both weights entered. */
  complete: boolean;
}

export function deliveryTotals(lines: readonly DeliveryLine[]): DeliveryTotals {
  const totals: DeliveryTotals = { dispatched: 0, delivered: 0, accepted: 0, rejected: 0, shortage: 0, complete: true };
  for (const line of lines) {
    const result = deliveryLine(line);
    totals.dispatched += line.dispatched;
    totals.delivered += line.delivered ?? 0;
    totals.accepted += line.accepted ?? 0;
    totals.rejected += result.rejected ?? 0;
    totals.shortage += result.shortage ?? 0;
    if (line.delivered === null || line.accepted === null) totals.complete = false;
  }
  return {
    ...totals,
    dispatched: round2(totals.dispatched),
    delivered: round2(totals.delivered),
    accepted: round2(totals.accepted),
    rejected: round2(totals.rejected),
    shortage: round2(totals.shortage),
  };
}

/* ────────────────────────────── Settlements ──────────────────────────── */

/** A settlement counts as paid within a paisa of the gross amount (settlement_service). */
export const PAID_TOLERANCE = 0.01;

export function outstandingAmount(settlement: Pick<Settlement, 'gross_amount' | 'amount_paid'>): number {
  return round2(Math.max(0, settlement.gross_amount - settlement.amount_paid));
}

export function isSettled(settlement: Pick<Settlement, 'payment_status' | 'gross_amount' | 'amount_paid'>): boolean {
  return settlement.payment_status === 'paid' || outstandingAmount(settlement) <= PAID_TOLERANCE;
}

export function isOverdue(
  settlement: Pick<Settlement, 'payment_status' | 'due_date' | 'gross_amount' | 'amount_paid'>,
  today: ISODate = todayIST(),
): boolean {
  if (isSettled(settlement)) return false;
  return settlement.payment_status === 'overdue' || settlement.due_date < today;
}

/** Whole days from `today` to `due` (negative once overdue). */
export function daysUntil(due: ISODate, today: ISODate = todayIST()): number {
  const toUtc = (date: ISODate) => {
    const [year, month, day] = date.split('-').map(Number);
    return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
  };
  return Math.round((toUtc(due) - toUtc(today)) / 86_400_000);
}

export interface PaymentSummary {
  outstanding: number;
  overdue: number;
  overdueCount: number;
  paidTotal: number;
  /** The open settlement due soonest. */
  nextDue: Settlement | null;
}

export function paymentSummary(settlements: readonly Settlement[], today: ISODate = todayIST()): PaymentSummary {
  let outstanding = 0;
  let overdue = 0;
  let overdueCount = 0;
  let paidTotal = 0;
  let nextDue: Settlement | null = null;
  for (const settlement of settlements) {
    paidTotal += settlement.amount_paid;
    if (isSettled(settlement)) continue;
    const owed = outstandingAmount(settlement);
    outstanding += owed;
    if (isOverdue(settlement, today)) {
      overdue += owed;
      overdueCount += 1;
    }
    if (!nextDue || settlement.due_date < nextDue.due_date) nextDue = settlement;
  }
  return { outstanding: round2(outstanding), overdue: round2(overdue), overdueCount, paidTotal: round2(paidTotal), nextDue };
}

/* ─────────────────────────────── Dates ───────────────────────────────── */

const pad = (value: number) => String(value).padStart(2, '0');

/** `YYYY-MM-DDTHH:mm` in the browser's local time, for `<input type="datetime-local">`. */
export function toDateTimeLocal(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A datetime-local value → ISO-8601 UTC, or null when it cannot be parsed. */
export function fromDateTimeLocal(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Offer validity presets, in hours from now. */
export const VALIDITY_PRESETS = [
  { id: '24h', hours: 24 },
  { id: '3d', hours: 72 },
  { id: '7d', hours: 168 },
] as const;
export type ValidityPresetId = (typeof VALIDITY_PRESETS)[number]['id'];

/** Now + hours, rounded up to the next quarter hour, as a datetime-local value. */
export function validUntilFromNow(hours: number, now: Date = new Date()): string {
  const date = new Date(now.getTime() + hours * 3_600_000);
  const minutes = date.getMinutes();
  const rounded = Math.ceil(minutes / 15) * 15;
  date.setMinutes(rounded, 0, 0);
  return toDateTimeLocal(date);
}

/** Adds days to a calendar date ('YYYY-MM-DD'). */
export function addDays(date: ISODate, days: number): ISODate {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** A payment date ('YYYY-MM-DD') → ISO timestamp: now for today, midday IST for earlier days. */
export function paidAtFromDate(date: ISODate, today: ISODate = todayIST(), now: Date = new Date()): string {
  if (date === today) return now.toISOString();
  return new Date(`${date}T12:00:00+05:30`).toISOString();
}

/* ───────────────────────── Landed cost & farmer view ─────────────────────── */

export interface LandedCostInput {
  pricePerKg: number | null;
  quantityKg: number | null;
  maxRejectionPct: number | null;
}

export interface LandedCost {
  /** price × quantity: what the buyer pays if every kilogram is accepted. */
  orderValue: number | null;
  /** price × quantity × (1 − max rejection): the floor if rejection reaches the agreed maximum. */
  floorValue: number | null;
  /** Kilograms that may be rejected at most. */
  maxRejectedKg: number | null;
}

export function landedCost({ pricePerKg, quantityKg, maxRejectionPct }: LandedCostInput): LandedCost {
  if (pricePerKg === null || quantityKg === null || pricePerKg <= 0 || quantityKg <= 0) {
    return { orderValue: null, floorValue: null, maxRejectedKg: null };
  }
  const orderValue = round2(pricePerKg * quantityKg);
  if (maxRejectionPct === null || maxRejectionPct < 0) return { orderValue, floorValue: null, maxRejectedKg: null };
  const share = Math.min(100, maxRejectionPct) / 100;
  return {
    orderValue,
    floorValue: round2(orderValue * (1 - share)),
    maxRejectedKg: round2(quantityKg * share),
  };
}

export interface FarmerViewInput {
  pricePerKg: number;
  quantityKg: number;
  pickupTerms: PickupTerms;
  paymentTermsDays: number;
  maxRejectionPct: number;
  handlingChargePerKg: number;
  grade: Grade;
  qualityStatus: QualityStatus;
  /** Crop default rejection, % (catalogue). */
  defaultRejectionPct: number | null;
  /** Collection point / farm and delivery point, when known. */
  origin: { latitude: number; longitude: number } | null;
  destination: { latitude: number; longitude: number } | null;
  /** Latest mandi modal price for the crop, ₹/kg. */
  marketPricePerKg: number | null;
  marketIsIllustrative?: boolean;
}

export interface FarmerView {
  offer: NetProceeds;
  baseline: NetProceeds | null;
  /** offer.net_per_kg − baseline.net_per_kg */
  upliftPerKg: number | null;
  /** Transport left out because the delivery point is unknown. */
  transportUnknown: boolean;
}

/**
 * What the farmers would take home from this offer, estimated with the same engine the farmers see
 * (DOMAIN_RULES §3), next to what selling alone at the mandi nets them. Indicative only — the
 * farmers' real figures come from the API once the offer exists.
 */
export function farmerView(input: FarmerViewInput): FarmerView {
  const inspectedA = input.qualityStatus === 'inspected' && input.grade === 'A';
  const cropRejection = input.defaultRejectionPct ?? input.maxRejectionPct;
  const expectedRejection = Math.min(input.maxRejectionPct, cropRejection * (inspectedA ? 0.5 : 1));

  let distanceKm: number | null = null;
  let transportUnknown = false;
  if (input.pickupTerms === 'mandimate_delivery') {
    if (input.origin && input.destination) {
      distanceKm = roadKm(input.origin.latitude, input.origin.longitude, input.destination.latitude, input.destination.longitude);
    } else {
      transportUnknown = true;
    }
  }

  const offer = calculate({
    quantity_kg: input.quantityKg,
    price_per_kg: input.pricePerKg,
    transport_cost_total: input.pickupTerms === 'buyer_pickup' ? 0 : null,
    distance_km: distanceKm,
    handling_charge_per_kg: round2(input.handlingChargePerKg + LOADING_PER_KG),
    commission_pct: 0,
    expected_rejection_pct: expectedRejection,
    payment_terms_days: input.paymentTermsDays,
  });

  const baseline =
    input.marketPricePerKg !== null && input.defaultRejectionPct !== null
      ? baselineNetProceeds({
          quantityKg: input.quantityKg,
          marketPricePerKg: input.marketPricePerKg,
          defaultRejectionPct: input.defaultRejectionPct,
          isIllustrative: input.marketIsIllustrative ?? false,
        })
      : null;

  return {
    offer,
    baseline,
    upliftPerKg: baseline ? round2(offer.net_per_kg - baseline.net_per_kg) : null,
    transportUnknown,
  };
}

/** `farmerView` for live form input: `null` instead of throwing on incomplete or out-of-range values. */
export function safeFarmerView(input: FarmerViewInput): FarmerView | null {
  const valid =
    Number.isFinite(input.pricePerKg) &&
    input.pricePerKg > 0 &&
    Number.isFinite(input.quantityKg) &&
    input.quantityKg > 0 &&
    Number.isInteger(input.paymentTermsDays) &&
    input.paymentTermsDays >= 0 &&
    input.maxRejectionPct >= 0 &&
    input.maxRejectionPct <= 100 &&
    input.handlingChargePerKg >= 0;
  if (!valid) return null;
  try {
    return farmerView(input);
  } catch {
    return null;
  }
}
