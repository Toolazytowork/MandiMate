/**
 * Status vocabulary shared by every StatusBadge: which enum each kind uses, its translation keys in
 * the `common` namespace and a restrained tone per value.
 *
 * Tone grammar: forest = open / healthy, gold = a deal in motion, info = logistics underway,
 * warning = waiting on someone, success = money settled or done, danger = failed, overdue or
 * disputed, neutral = inactive (draft, cancelled, withdrawn).
 */
import type { BadgeTone } from '@/components/ui';
import type {
  ConsentDecision,
  DemandStatus,
  DisputeStatus,
  HarvestStatus,
  LotStatus,
  OfferStatus,
  PaymentStatus,
  PayoutStatus,
  QuoteStatus,
  StopStatus,
  TransportRequestStatus,
  VerificationStatus,
} from '@/types/api';

export interface StatusValueMap {
  harvest: HarvestStatus;
  lot: LotStatus;
  offer: OfferStatus;
  transport: TransportRequestStatus;
  quote: QuoteStatus;
  payment: PaymentStatus;
  payout: PayoutStatus;
  dispute: DisputeStatus;
  demand: DemandStatus;
  verification: VerificationStatus;
  consent: ConsentDecision;
  stop: StopStatus;
}

export type StatusKind = keyof StatusValueMap;

/** Enum group under `common:enums.*` for each kind. */
const ENUM_GROUP: Record<StatusKind, string> = {
  harvest: 'harvestStatus',
  lot: 'lotStatus',
  offer: 'offerStatus',
  transport: 'transportRequestStatus',
  quote: 'quoteStatus',
  payment: 'paymentStatus',
  payout: 'payoutStatus',
  dispute: 'disputeStatus',
  demand: 'demandStatus',
  verification: 'verificationStatus',
  consent: 'consentDecision',
  stop: 'stopStatus',
};

type ToneTable = { [K in StatusKind]: Record<StatusValueMap[K], BadgeTone> };

export const STATUS_TONES: ToneTable = {
  harvest: {
    draft: 'neutral',
    listed: 'forest',
    pooled: 'gold',
    committed: 'gold',
    picked_up: 'info',
    delivered: 'info',
    settled: 'success',
    cancelled: 'neutral',
    expired: 'danger',
  },
  lot: {
    forming: 'neutral',
    awaiting_consent: 'warning',
    open_for_offers: 'forest',
    offer_accepted: 'gold',
    transport_booked: 'info',
    in_transit: 'info',
    delivered: 'forest',
    settled: 'success',
    cancelled: 'neutral',
  },
  offer: {
    pending: 'gold',
    countered: 'info',
    proposed: 'warning',
    accepted: 'success',
    rejected: 'danger',
    withdrawn: 'neutral',
    expired: 'neutral',
  },
  transport: {
    open: 'forest',
    quoted: 'gold',
    booked: 'info',
    in_progress: 'info',
    completed: 'success',
    cancelled: 'neutral',
  },
  quote: {
    submitted: 'info',
    accepted: 'success',
    rejected: 'neutral',
    withdrawn: 'neutral',
  },
  payment: {
    pending: 'warning',
    partially_paid: 'gold',
    paid: 'success',
    overdue: 'danger',
    disputed: 'danger',
  },
  payout: {
    pending: 'warning',
    paid: 'success',
  },
  dispute: {
    open: 'danger',
    under_review: 'warning',
    resolved: 'success',
    rejected: 'neutral',
  },
  demand: {
    open: 'forest',
    matched: 'gold',
    fulfilled: 'success',
    cancelled: 'neutral',
    expired: 'neutral',
  },
  verification: {
    unverified: 'neutral',
    pending: 'warning',
    verified: 'success',
    rejected: 'danger',
  },
  consent: {
    pending: 'warning',
    accepted: 'success',
    declined: 'neutral',
  },
  stop: {
    pending: 'neutral',
    picked_up: 'success',
    skipped: 'neutral',
  },
};

/** Badge tone for a status value (`neutral` for values the table does not know). */
export function statusTone<K extends StatusKind>(kind: K, value: StatusValueMap[K]): BadgeTone {
  const table: Record<string, BadgeTone> = STATUS_TONES[kind];
  return table[value] ?? 'neutral';
}

/** Translation key of a status label, e.g. `common:enums.lotStatus.open_for_offers`. */
export function statusLabelKey<K extends StatusKind>(kind: K, value: StatusValueMap[K]): string {
  return `common:enums.${ENUM_GROUP[kind]}.${value}`;
}
