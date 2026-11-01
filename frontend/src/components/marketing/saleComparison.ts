/**
 * "Sell alone at the mandi" versus "pooled with MandiMate", priced with the published net-proceeds
 * engine (src/lib/netProceeds.ts, a port of backend/app/services/pricing.py). Used by the hero deal
 * card, the "net, not gross" explainer and the public calculator, so every number on the marketing
 * site comes from the same formula the product uses.
 */
import type { TFunction } from 'i18next';
import {
  BASELINE_LABEL,
  BASELINE_PAYMENT_DAYS,
  CAPITAL_COST_ANNUAL_PCT,
  computeNetProceeds,
  estimateTransportCost,
  formatNoteNumber,
  formatNoteRupees,
  LOADING_PER_KG,
  MANDI_COMMISSION_PCT,
  MANDI_HANDLING_PER_KG,
  PLATFORM_FEE_NOTE,
  roundMoney,
  UNRESOLVED_TRANSPORT_QUOTE,
  vehicleLabel,
  type TransportEstimate,
} from '@/lib/netProceeds';
import type { NetProceeds } from '@/types/api';

export interface SaleInputs {
  /** The farmer's harvest, kg. */
  quantityKg: number;
  /** Modal price at the local mandi, ₹/kg. */
  mandiPrice: number;
  /** The pooled buyer's written offer, ₹/kg. */
  offerPrice: number;
  /** Farm → mandi, km (the farmer hires a vehicle alone). */
  mandiDistanceKm: number;
  /** Expected rejection when selling alone, %. */
  mandiRejectionPct: number;
  /** Expected rejection in the pooled sale (inspected, graded produce), %. */
  pooledRejectionPct: number;
  /** Total weight of the pooled lot sharing one truck, kg (never less than the farmer's own harvest). */
  lotKg: number;
  /** Route across the members' farms to the buyer, km. */
  routeKm: number;
  /** The pooled buyer's payment terms, days after delivery. */
  paymentDays: number;
}

/**
 * The worked example from the README and the product brief: 400 kg of tomatoes, ₹14/kg alone at the
 * mandi versus ₹16/kg in a 1,000 kg pooled lot. Illustrative inputs, real formula.
 */
export const WORKED_EXAMPLE: SaleInputs = {
  quantityKg: 400,
  mandiPrice: 14,
  offerPrice: 16,
  mandiDistanceKm: 25,
  mandiRejectionPct: 6,
  pooledRejectionPct: 3,
  lotKg: 1000,
  routeKm: 40,
  paymentDays: 7,
};

export interface SaleComparison {
  inputs: SaleInputs;
  mandi: NetProceeds;
  pooled: NetProceeds;
  /** The farmer's own vehicle to the mandi. */
  soloTransport: TransportEstimate;
  /** The shared vehicle for the whole lot. */
  lotTransport: TransportEstimate;
  /** Lot weight actually used (at least the farmer's quantity). */
  lotKg: number;
  /** Net ₹/kg pooled minus net ₹/kg alone. */
  upliftPerKg: number;
  /** Net ₹ pooled minus net ₹ alone, on the farmer's quantity. */
  upliftTotal: number;
  /** Price difference alone, ₹/kg — what a price-only comparison would show. */
  priceGapPerKg: number;
}

function plural(count: number, word: string): string {
  return `${formatNoteNumber(count)} ${word}${count === 1 ? '' : 's'}`;
}

/** Selling alone: own vehicle, mandi hamali, commission agent, crop-average rejection, paid next day. */
function sellAlone(inputs: SaleInputs, transport: TransportEstimate): NetProceeds {
  const trips = transport.trips > 1 ? `, ${plural(transport.trips, 'trip')}` : '';
  return computeNetProceeds({
    label: BASELINE_LABEL,
    quantityKg: inputs.quantityKg,
    pricePerKg: inputs.mandiPrice,
    transportCost: transport.cost_total,
    transportCertainty: 'estimated',
    rejectionPct: inputs.mandiRejectionPct,
    rejectionCertainty: 'estimated',
    handlingPerKg: MANDI_HANDLING_PER_KG,
    commissionPct: MANDI_COMMISSION_PCT,
    commissionCertainty: 'estimated',
    paymentTermsDays: BASELINE_PAYMENT_DAYS,
    grossCertainty: 'estimated',
    grossNote: `${formatNoteNumber(inputs.quantityKg)} kg × ${formatNoteRupees(inputs.mandiPrice)}/kg mandi price`,
    transportNote: `${vehicleLabel(transport.vehicle_type)} hired alone${trips}, ${formatNoteNumber(transport.distance_km)} km to the mandi`,
    handlingNote: `Hamali / unloading at the mandi, ${formatNoteRupees(MANDI_HANDLING_PER_KG)}/kg`,
    rejectionNote: `Expected ${formatNoteNumber(inputs.mandiRejectionPct)}% rejection, sold ungraded`,
    commissionNote: `Commission agent at ${formatNoteNumber(MANDI_COMMISSION_PCT)}%`,
  });
}

/** Pooled: transport shared by weight, loading only, no commission, the buyer's payment terms. */
function sellPooled(inputs: SaleInputs, transport: TransportEstimate, lotKg: number, hypothetical: boolean): NetProceeds {
  const share = lotKg > 0 ? roundMoney((transport.cost_total * inputs.quantityKg) / lotKg) : 0;
  const trips = transport.trips > 1 ? `, ${plural(transport.trips, 'trip')}` : '';
  return computeNetProceeds({
    label: 'Pooled with MandiMate',
    quantityKg: inputs.quantityKg,
    pricePerKg: inputs.offerPrice,
    transportCost: share,
    transportCertainty: 'estimated',
    rejectionPct: inputs.pooledRejectionPct,
    rejectionCertainty: 'estimated',
    handlingPerKg: LOADING_PER_KG,
    commissionPct: 0,
    commissionCertainty: 'confirmed',
    paymentTermsDays: inputs.paymentDays,
    // A buyer's written offer is confirmed; a price typed into the calculator is only an estimate.
    grossCertainty: hypothetical ? 'estimated' : 'confirmed',
    grossNote: `${formatNoteNumber(inputs.quantityKg)} kg × ${formatNoteRupees(inputs.offerPrice)}/kg ${hypothetical ? 'offer price you entered' : 'buyer’s written offer'}`,
    transportNote: `Shared by weight: your ${formatNoteNumber(inputs.quantityKg)} of ${formatNoteNumber(lotKg)} kg on one ${vehicleLabel(transport.vehicle_type).toLowerCase()}${trips}, ${formatNoteNumber(transport.distance_km)} km route`,
    handlingNote: `Loading & crates at the collection point, ${formatNoteRupees(LOADING_PER_KG)}/kg`,
    rejectionNote: `Expected ${formatNoteNumber(inputs.pooledRejectionPct)}% rejection, inspected and graded`,
    commissionNote: 'No commission on MandiMate deals',
    unresolved: ['Transport quote pending'],
  });
}

export interface CompareOptions {
  /** The offer price is the visitor's own guess (calculator), not a buyer's written offer. */
  hypothetical?: boolean;
}

/** Both ways of selling the same harvest, with the uplift a farmer would actually feel. */
export function compareSale(inputs: SaleInputs, { hypothetical = false }: CompareOptions = {}): SaleComparison {
  const lotKg = Math.max(inputs.lotKg, inputs.quantityKg);
  const soloTransport = estimateTransportCost(inputs.quantityKg, inputs.mandiDistanceKm);
  const lotTransport = estimateTransportCost(lotKg, inputs.routeKm);
  const mandi = sellAlone(inputs, soloTransport);
  const pooled = sellPooled(inputs, lotTransport, lotKg, hypothetical);
  return {
    inputs,
    mandi,
    pooled,
    soloTransport,
    lotTransport,
    lotKg,
    upliftPerKg: roundMoney(pooled.net_per_kg - mandi.net_per_kg),
    upliftTotal: roundMoney(pooled.net_amount - mandi.net_amount),
    priceGapPerKg: roundMoney(inputs.offerPrice - inputs.mandiPrice),
  };
}

/** The worked example, computed once (deterministic: identical on the server and the client). */
export const WORKED: SaleComparison = compareSale(WORKED_EXAMPLE);

/** ₹/kg of a breakdown line, signed (negative for deductions). */
export function linePerKg(data: NetProceeds, key: NetProceeds['lines'][number]['key']): number {
  return data.lines.find((line) => line.key === key)?.per_kg ?? 0;
}

/* ─────────────────────────────── Translation ─────────────────────────────── */

/**
 * The same two options with their label, line notes and open items in the visitor's language. The
 * numbers are untouched; English output is identical to `compareSale`. Keys live in the `marketing`
 * namespace under `sale.*` (vehicle names reuse `common:enums.vehicleType.*`). Call it at render
 * time with the `t` from `useTranslation`.
 */
export function localizeSaleComparison(
  comparison: SaleComparison,
  t: TFunction,
  { hypothetical = false }: CompareOptions = {},
): { mandi: NetProceeds; pooled: NetProceeds } {
  const { inputs, soloTransport, lotTransport, lotKg } = comparison;
  const tm = (key: string, defaultValue: string, values: Record<string, unknown> = {}) =>
    t(`sale.${key}`, { ns: 'marketing', defaultValue, ...values }) as string;
  const vehicle = (transport: TransportEstimate) =>
    t(`common:enums.vehicleType.${transport.vehicle_type}`, { defaultValue: vehicleLabel(transport.vehicle_type) }) as string;
  const trips = (transport: TransportEstimate) =>
    tm('trips', `${formatNoteNumber(transport.trips)} trip${transport.trips === 1 ? '' : 's'}`, { count: transport.trips });

  const paymentNote = (days: number) =>
    days === 0
      ? tm('paidOnDelivery', 'Paid on delivery')
      : tm('paymentWaitNote', `Cost of waiting ${formatNoteNumber(days)} day${days === 1 ? '' : 's'} at {{rate}}%/yr`, {
          count: days,
          rate: formatNoteNumber(CAPITAL_COST_ANNUAL_PCT),
        });

  const withNotes = (data: NetProceeds, label: string, notes: Partial<Record<NetProceeds['lines'][number]['key'], string>>): NetProceeds => ({
    ...data,
    label,
    lines: data.lines.map((line) => {
      if (line.key === 'payment_wait') return { ...line, note: paymentNote(data.payment_terms_days) };
      if (line.key === 'platform_fee' && line.note === PLATFORM_FEE_NOTE) {
        return { ...line, note: tm('platformFeeNote', PLATFORM_FEE_NOTE) };
      }
      const note = notes[line.key];
      return note === undefined ? line : { ...line, note };
    }),
    unresolved: data.unresolved.map((item) =>
      item === UNRESOLVED_TRANSPORT_QUOTE ? tm('transportQuotePending', UNRESOLVED_TRANSPORT_QUOTE) : item,
    ),
  });

  const soloVehicle = vehicle(soloTransport);
  const mandiTransport =
    soloTransport.trips > 1
      ? tm('mandiTransportNoteTrips', '{{vehicle}} hired alone, {{trips}}, {{distance}} km to the mandi', {
          vehicle: soloVehicle,
          trips: trips(soloTransport),
          distance: formatNoteNumber(soloTransport.distance_km),
        })
      : tm('mandiTransportNote', '{{vehicle}} hired alone, {{distance}} km to the mandi', {
          vehicle: soloVehicle,
          distance: formatNoteNumber(soloTransport.distance_km),
        });

  const mandi = withNotes(comparison.mandi, tm('mandiLabel', BASELINE_LABEL), {
    gross: tm('mandiGrossNote', '{{quantity}} kg × {{price}}/kg mandi price', {
      quantity: formatNoteNumber(inputs.quantityKg),
      price: formatNoteRupees(inputs.mandiPrice),
    }),
    transport: mandiTransport,
    handling: tm('mandiHandlingNote', 'Hamali / unloading at the mandi, {{rate}}/kg', { rate: formatNoteRupees(MANDI_HANDLING_PER_KG) }),
    rejection: tm('mandiRejectionNote', 'Expected {{pct}}% rejection, sold ungraded', { pct: formatNoteNumber(inputs.mandiRejectionPct) }),
    commission: tm('mandiCommissionNote', 'Commission agent at {{pct}}%', { pct: formatNoteNumber(MANDI_COMMISSION_PCT) }),
  });

  const lotVehicle = vehicle(lotTransport).toLowerCase();
  const sharedValues = {
    quantity: formatNoteNumber(inputs.quantityKg),
    lotKg: formatNoteNumber(lotKg),
    vehicle: lotVehicle,
    distance: formatNoteNumber(lotTransport.distance_km),
  };
  const pooledTransport =
    lotTransport.trips > 1
      ? tm('pooledTransportNoteTrips', 'Shared by weight: your {{quantity}} of {{lotKg}} kg on one {{vehicle}}, {{trips}}, {{distance}} km route', {
          ...sharedValues,
          trips: trips(lotTransport),
        })
      : tm('pooledTransportNote', 'Shared by weight: your {{quantity}} of {{lotKg}} kg on one {{vehicle}}, {{distance}} km route', sharedValues);

  const grossValues = { quantity: formatNoteNumber(inputs.quantityKg), price: formatNoteRupees(inputs.offerPrice) };
  const pooled = withNotes(comparison.pooled, tm('pooledLabel', 'Pooled with MandiMate'), {
    gross: hypothetical
      ? tm('pooledGrossNoteEntered', '{{quantity}} kg × {{price}}/kg offer price you entered', grossValues)
      : tm('pooledGrossNoteOffer', '{{quantity}} kg × {{price}}/kg buyer’s written offer', grossValues),
    transport: pooledTransport,
    handling: tm('pooledHandlingNote', 'Loading & crates at the collection point, {{rate}}/kg', { rate: formatNoteRupees(LOADING_PER_KG) }),
    rejection: tm('pooledRejectionNote', 'Expected {{pct}}% rejection, inspected and graded', { pct: formatNoteNumber(inputs.pooledRejectionPct) }),
    commission: tm('commissionNote', 'No commission on MandiMate deals'),
  });

  return { mandi, pooled };
}
