/**
 * TypeScript port of the backend net-proceeds engine (`backend/app/services/pricing.py`) so the public
 * calculator can answer instantly. Constants, line order, notes, certainty and rounding follow the
 * Python module: every line is rounded half-up to the paisa and the net is the sum of the rounded
 * lines. `POST /calculator/net-proceeds` remains the authority.
 */
import type {
  BreakdownKey,
  BreakdownLine,
  Certainty,
  NetProceeds,
  NetProceedsCalcRequest,
  VehicleType,
} from '@/types/api';

/* ─────────────────────────────── Constants ─────────────────────────────── */

/** ₹/kg for loading & crates at the collection point (estimate). */
export const LOADING_PER_KG = 0.25;
/** ₹/kg hamali / unloading at a mandi (baseline). */
export const MANDI_HANDLING_PER_KG = 0.5;
/** Commission agent fee at a mandi, % of the accepted value (baseline). */
export const MANDI_COMMISSION_PCT = 8;
/** Informal credit rate used to price a payment delay, % per year. */
export const CAPITAL_COST_ANNUAL_PCT = 18;
/** Farm → nearest mandi when the real distance is unknown, km. */
export const BASELINE_DISTANCE_KM = 25;
/** A mandi pays the next day. */
export const BASELINE_PAYMENT_DAYS = 1;
/** Great-circle → road distance. */
export const ROAD_FACTOR = 1.3;
/** Matching radius around a collection point, km. */
export const DEFAULT_RADIUS_KM = 40;
/** Expected rejection used by the public calculator when none is entered, %. */
export const DEFAULT_REJECTION_PCT = 5;
/** Mean Earth radius (IUGG), km. */
export const EARTH_RADIUS_KM = 6371.0088;
const DAYS_PER_YEAR = 365;

export const BASELINE_LABEL = 'Sell alone at local mandi';
export const CALCULATOR_LABEL = 'Your estimate';
export const PLATFORM_FEE_NOTE = 'MandiMate charges buyers, not farmers';

export const UNRESOLVED_QUALITY = 'Quality inspection pending';
export const UNRESOLVED_TRANSPORT_LOCATION = 'Transport cost unknown: location missing';
export const UNRESOLVED_TRANSPORT_QUOTE = 'Transport quote pending';
export const UNRESOLVED_BUYER_UNVERIFIED = 'Buyer not yet verified';
export const UNRESOLVED_FARMER_CONSENT = 'Awaiting farmer consent';
export const UNRESOLVED_BUYER_RESPONSE = 'Awaiting buyer response';

export const LINE_ORDER: readonly BreakdownKey[] = [
  'gross',
  'rejection',
  'transport',
  'handling',
  'commission',
  'payment_wait',
  'platform_fee',
];

export const LINE_LABELS: Record<BreakdownKey, string> = {
  gross: 'Gross sale value',
  rejection: 'Expected rejection',
  transport: 'Transport',
  handling: 'Handling & loading',
  commission: 'Commission',
  payment_wait: 'Cost of waiting for payment',
  platform_fee: 'MandiMate fee',
};

export interface VehicleClass {
  vehicle_type: VehicleType;
  capacity_kg: number;
  base_charge: number;
  per_km_rate: number;
  refrigerated: boolean;
}

export const VEHICLE_CLASSES: readonly VehicleClass[] = [
  { vehicle_type: 'mini_truck', capacity_kg: 750, base_charge: 600, per_km_rate: 18, refrigerated: false },
  { vehicle_type: 'pickup', capacity_kg: 1500, base_charge: 900, per_km_rate: 24, refrigerated: false },
  { vehicle_type: 'light_truck', capacity_kg: 3500, base_charge: 1500, per_km_rate: 32, refrigerated: false },
  { vehicle_type: 'medium_truck', capacity_kg: 9000, base_charge: 2500, per_km_rate: 45, refrigerated: false },
  { vehicle_type: 'reefer_truck', capacity_kg: 5000, base_charge: 3500, per_km_rate: 55, refrigerated: true },
];

/* ──────────────────────────── Number helpers ──────────────────────────── */

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const rounded = (Math.sign(value) * Math.round(Math.abs(value) * factor + Number.EPSILON * factor)) / factor;
  return rounded === 0 ? 0 : rounded;
}

/** Half-up to 2 decimals, never returning a negative zero (`round_money`). */
export function roundMoney(value: number): number {
  return roundTo(value, 2);
}

const noteNumber = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const noteRupees = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Up to 2 decimals without trailing zeros, Indian grouping: 1240000.5 → "12,40,000.5" (`format_number`). */
export function formatNoteNumber(value: number): string {
  const rounded = roundMoney(value);
  return `${rounded < 0 ? '-' : ''}${noteNumber.format(Math.abs(rounded))}`;
}

/** "₹1,050.00": always 2 decimals, Indian grouping (`format_rupees`). */
export function formatNoteRupees(value: number): string {
  const rounded = roundMoney(value);
  return `${rounded < 0 ? '-' : ''}₹${noteRupees.format(Math.abs(rounded))}`;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be a finite number, got ${value}`);
  return value;
}

function nonNegative(value: number, name: string): number {
  if (finite(value, name) < 0) throw new RangeError(`${name} must not be negative, got ${value}`);
  return value;
}

function percent(value: number, name: string): number {
  if (finite(value, name) < 0 || value > 100) throw new RangeError(`${name} must be between 0 and 100, got ${value}`);
  return value;
}

function checkDays(days: number): number {
  if (!Number.isInteger(days) || days < 0) {
    throw new RangeError(`payment_terms_days must be a non-negative integer, got ${days}`);
  }
  return days;
}

/* ─────────────────────────────── Distances ─────────────────────────────── */

function greatCircleKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dPhi = phi2 - phi1;
  const dLambda = toRad(lon2 - lon1);
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Great-circle distance in km, 2 decimals. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return roundMoney(greatCircleKm(lat1, lon1, lat2, lon2));
}

/** Estimated road distance: great-circle × ROAD_FACTOR, 1 decimal. */
export function roadKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return roundTo(greatCircleKm(lat1, lon1, lat2, lon2) * ROAD_FACTOR, 1);
}

/* ─────────────────────────────── Transport ─────────────────────────────── */

export interface TransportEstimate {
  vehicle_type: VehicleType;
  capacity_kg: number;
  trips: number;
  distance_km: number;
  cost_total: number;
  cost_per_kg: number;
  utilization_pct: number;
}

/** "mini_truck" → "Mini truck". */
export function vehicleLabel(vehicleType: VehicleType): string {
  const words = vehicleType.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Cheapest standard vehicle for the load. Only classes whose refrigeration matches are eligible; the
 * smallest that carries the whole load is used, otherwise the largest makes ceil(load / capacity)
 * trips. A zero load needs no trip and costs nothing.
 */
export function estimateTransportCost(totalKg: number, distanceKm: number, refrigerated = false): TransportEstimate {
  const load = nonNegative(totalKg, 'total_kg');
  const distance = nonNegative(distanceKm, 'distance_km');
  const eligible = VEHICLE_CLASSES.filter((vehicle) => vehicle.refrigerated === refrigerated).sort(
    (a, b) => a.capacity_kg - b.capacity_kg,
  );
  const vehicle = eligible.find((candidate) => candidate.capacity_kg >= load) ?? eligible[eligible.length - 1]!;
  const trips = Math.ceil(load / vehicle.capacity_kg);
  const cost = trips * (vehicle.base_charge + vehicle.per_km_rate * distance);
  return {
    vehicle_type: vehicle.vehicle_type,
    capacity_kg: vehicle.capacity_kg,
    trips,
    distance_km: roundMoney(distance),
    cost_total: roundMoney(cost),
    cost_per_kg: load > 0 ? roundMoney(cost / load) : 0,
    utilization_pct: trips ? roundMoney((load / (vehicle.capacity_kg * trips)) * 100) : 0,
  };
}

/** "Mini truck, 1 trip, 25 km". */
export function describeTransportEstimate(estimate: TransportEstimate): string {
  return `${vehicleLabel(estimate.vehicle_type)}, ${plural(estimate.trips, 'trip')}, ${formatNoteNumber(estimate.distance_km)} km`;
}

/* ───────────────────────────── Net proceeds ───────────────────────────── */

/** `unresolved` if any is unresolved, else `estimated` if any is estimated, else `confirmed`. */
export function overallConfidence(certainties: Iterable<Certainty>): Certainty {
  const seen = new Set(certainties);
  if (seen.has('unresolved')) return 'unresolved';
  if (seen.has('estimated')) return 'estimated';
  return 'confirmed';
}

function paymentWaitRate(days: number): number {
  return (CAPITAL_COST_ANNUAL_PCT / 100) * (days / DAYS_PER_YEAR);
}

function paymentWaitNote(days: number): string {
  if (days === 0) return 'Paid on delivery';
  return `Cost of waiting ${plural(days, 'day')} at ${formatNoteNumber(CAPITAL_COST_ANNUAL_PCT)}%/yr`;
}

function commissionNote(commissionPct: number): string {
  if (commissionPct === 0) return 'No commission';
  return `${formatNoteNumber(commissionPct)}% of the accepted value`;
}

export interface NetProceedsInput {
  label: string;
  quantityKg: number;
  pricePerKg: number;
  /** Total transport borne by this quantity (already shared by weight for a pooled lot). */
  transportCost: number;
  transportCertainty: Certainty;
  rejectionPct: number;
  rejectionCertainty: Certainty;
  handlingPerKg: number;
  commissionPct: number;
  commissionCertainty: Certainty;
  paymentTermsDays: number;
  /** Default `confirmed` (a buyer's written price). */
  grossCertainty?: Certainty;
  /** Default `estimated`. */
  handlingCertainty?: Certainty;
  grossNote?: string | null;
  transportNote?: string | null;
  handlingNote?: string | null;
  rejectionNote?: string | null;
  commissionNote?: string | null;
  /** The caller's open conditions, e.g. "Transport quote pending". */
  unresolved?: readonly string[];
}

/**
 * What the farmer keeps from selling `quantityKg` at `pricePerKg` (DOMAIN_RULES §3, `compute_net_proceeds`).
 * Lines come in the fixed order with signed amounts; each is rounded to 2 decimals and the net is the
 * sum of the rounded lines, so the breakdown always adds up. "Quality inspection pending" and
 * "Transport cost unknown: location missing" are added when those lines are unresolved.
 */
export function computeNetProceeds(input: NetProceedsInput): NetProceeds {
  const quantity = nonNegative(input.quantityKg, 'quantity_kg');
  const price = nonNegative(input.pricePerKg, 'price_per_kg');
  const transportTotal = nonNegative(input.transportCost, 'transport_cost');
  const handlingRate = nonNegative(input.handlingPerKg, 'handling_per_kg');
  const rejection = percent(input.rejectionPct, 'rejection_pct');
  const commission = percent(input.commissionPct, 'commission_pct');
  const days = checkDays(input.paymentTermsDays);

  const rejectedKg = (quantity * rejection) / 100;
  const gross = price * quantity;
  const rejectionAmount = -(price * rejectedKg);
  const acceptedValue = gross + rejectionAmount;

  const exact: Record<BreakdownKey, number> = {
    gross,
    rejection: rejectionAmount,
    transport: -transportTotal,
    handling: -(handlingRate * quantity),
    commission: -((acceptedValue * commission) / 100),
    payment_wait: -(acceptedValue * paymentWaitRate(days)),
    platform_fee: 0,
  };

  const certainties: Record<BreakdownKey, Certainty> = {
    gross: input.grossCertainty ?? 'confirmed',
    rejection: input.rejectionCertainty,
    transport: input.transportCertainty,
    handling: input.handlingCertainty ?? 'estimated',
    commission: input.commissionCertainty,
    payment_wait: 'estimated',
    platform_fee: 'confirmed',
  };

  const notes: Record<BreakdownKey, string | null> = {
    gross: input.grossNote || `${formatNoteNumber(quantity)} kg × ${formatNoteRupees(price)}/kg`,
    rejection: input.rejectionNote || `Expected ${formatNoteNumber(rejection)}% rejection`,
    transport: input.transportNote ?? null,
    handling: input.handlingNote || `${formatNoteRupees(handlingRate)}/kg loading & handling`,
    commission: input.commissionNote || commissionNote(commission),
    payment_wait: paymentWaitNote(days),
    platform_fee: PLATFORM_FEE_NOTE,
  };

  const perKg = (amount: number) => (quantity > 0 ? roundMoney(amount / quantity) : 0);
  const amounts = Object.fromEntries(LINE_ORDER.map((key) => [key, roundMoney(exact[key])])) as Record<
    BreakdownKey,
    number
  >;

  const lines: BreakdownLine[] = LINE_ORDER.map((key) => ({
    key,
    label: LINE_LABELS[key],
    amount: amounts[key],
    per_kg: perKg(amounts[key]),
    certainty: certainties[key],
    note: notes[key],
  }));

  const grossAmount = amounts.gross;
  const net = roundMoney(LINE_ORDER.reduce((sum, key) => sum + amounts[key], 0));

  const derived: string[] = [];
  if (input.rejectionCertainty === 'unresolved') derived.push(UNRESOLVED_QUALITY);
  if (input.transportCertainty === 'unresolved') derived.push(UNRESOLVED_TRANSPORT_LOCATION);
  const unresolved = [...new Set([...(input.unresolved ?? []), ...derived])];

  return {
    label: input.label,
    quantity_kg: roundMoney(quantity),
    expected_accepted_kg: roundMoney(quantity - rejectedKg),
    gross_price_per_kg: roundMoney(price),
    gross_amount: grossAmount,
    lines,
    total_deductions: roundMoney(grossAmount - net),
    net_amount: net,
    net_per_kg: perKg(net),
    payment_terms_days: days,
    confidence: overallConfidence(Object.values(certainties)),
    unresolved,
  };
}

/* ─────────────────────────────── Baseline ─────────────────────────────── */

export interface BaselineInput {
  quantityKg: number;
  /** Latest modal price; `null` when there is none (no baseline then). */
  marketPricePerKg: number | null;
  defaultRejectionPct: number;
  distanceKm?: number;
  isIllustrative?: boolean;
  marketName?: string | null;
}

/**
 * The credible alternative: the farmer sells alone at the local mandi (`baseline_net_proceeds`).
 * Every line is an estimate. `null` when there is no market price to anchor it.
 */
export function baselineNetProceeds({
  quantityKg,
  marketPricePerKg,
  defaultRejectionPct,
  distanceKm = BASELINE_DISTANCE_KM,
  isIllustrative = false,
  marketName = null,
}: BaselineInput): NetProceeds | null {
  if (marketPricePerKg === null) return null;
  const transport = estimateTransportCost(quantityKg, distanceKm);
  const rejection = percent(defaultRejectionPct, 'default_rejection_pct');
  const where = marketName ? ` at ${marketName}` : '';
  const trips = transport.trips > 1 ? `, ${plural(transport.trips, 'trip')}` : '';
  return computeNetProceeds({
    label: BASELINE_LABEL,
    quantityKg,
    pricePerKg: marketPricePerKg,
    transportCost: transport.cost_total,
    transportCertainty: 'estimated',
    rejectionPct: rejection,
    rejectionCertainty: 'estimated',
    handlingPerKg: MANDI_HANDLING_PER_KG,
    commissionPct: MANDI_COMMISSION_PCT,
    commissionCertainty: 'estimated',
    paymentTermsDays: BASELINE_PAYMENT_DAYS,
    grossCertainty: 'estimated',
    handlingCertainty: 'estimated',
    grossNote: isIllustrative
      ? `Illustrative modal price${where} (not live market data)`
      : `Latest modal price${where}`,
    transportNote: `${vehicleLabel(transport.vehicle_type)} hired alone${trips}, ${formatNoteNumber(transport.distance_km)} km to the mandi`,
    handlingNote: `Hamali / unloading at the mandi, ${formatNoteRupees(MANDI_HANDLING_PER_KG)}/kg`,
    rejectionNote: `Expected ${formatNoteNumber(rejection)}% rejection (crop average)`,
    commissionNote: `Commission agent at ${formatNoteNumber(MANDI_COMMISSION_PCT)}%`,
  });
}

/* ──────────────────────────── Public calculator ──────────────────────────── */

/**
 * `POST /calculator/net-proceeds` (`calculate`): a quick estimate from whatever the visitor knows.
 * Transport: the entered total (confirmed), else an estimate from the distance, else left out
 * (0, "Not included"). Handling defaults to the loading estimate, commission to 0 (confirmed),
 * rejection to 5 % (estimated) and payment terms to 0 days. The price itself is an estimate.
 */
export function calculate(req: NetProceedsCalcRequest): NetProceeds {
  const quantity = req.quantity_kg;

  let transportCost: number;
  let transportCertainty: Certainty;
  let transportNote: string;
  if (req.transport_cost_total !== null && req.transport_cost_total !== undefined) {
    transportCost = req.transport_cost_total;
    transportCertainty = 'confirmed';
    transportNote = 'Transport cost you entered';
  } else if (req.distance_km !== null && req.distance_km !== undefined) {
    const estimate = estimateTransportCost(quantity, req.distance_km);
    transportCost = estimate.cost_total;
    transportCertainty = 'estimated';
    transportNote = `Estimated: ${describeTransportEstimate(estimate)}`;
  } else {
    transportCost = 0;
    transportCertainty = 'estimated';
    transportNote = 'Not included';
  }

  let handling: number;
  let handlingNote: string;
  if (req.handling_charge_per_kg !== null && req.handling_charge_per_kg !== undefined) {
    handling = req.handling_charge_per_kg;
    handlingNote = `${formatNoteRupees(handling)}/kg you entered`;
  } else {
    handling = LOADING_PER_KG;
    handlingNote = `Loading & crates at the collection point, ${formatNoteRupees(LOADING_PER_KG)}/kg`;
  }

  let rejection: number;
  let rejectionNote: string;
  if (req.expected_rejection_pct !== null && req.expected_rejection_pct !== undefined) {
    rejection = req.expected_rejection_pct;
    rejectionNote = `Expected ${formatNoteNumber(rejection)}% rejection`;
  } else {
    rejection = DEFAULT_REJECTION_PCT;
    rejectionNote = `Expected ${formatNoteNumber(rejection)}% rejection (typical for fresh produce)`;
  }

  return computeNetProceeds({
    label: CALCULATOR_LABEL,
    quantityKg: quantity,
    pricePerKg: req.price_per_kg,
    transportCost,
    transportCertainty,
    rejectionPct: rejection,
    rejectionCertainty: 'estimated',
    handlingPerKg: handling,
    commissionPct: req.commission_pct ?? 0,
    commissionCertainty: 'confirmed',
    paymentTermsDays: req.payment_terms_days ?? 0,
    grossCertainty: 'estimated',
    handlingCertainty: 'estimated',
    transportNote,
    handlingNote,
    rejectionNote,
  });
}
