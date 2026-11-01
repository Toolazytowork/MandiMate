/**
 * Pure helpers for the farmer experience: dates, units, crop names, and the rules that decide
 * which offers and lots need the farmer's answer. No React, no I/O — unit-tested in lib.test.ts.
 */
import { todayIST } from '@/lib/format';
import type {
  BreakdownLine,
  Crop,
  FarmerPayout,
  Harvest,
  HarvestStatus,
  ISODate,
  Language,
  Lot,
  LotMember,
  LotStatus,
  NetProceeds,
  Offer,
  OfferConsent,
  OfferStatus,
  Settlement,
} from '@/types/api';

/* ─────────────────────────────── Units ─────────────────────────────── */

export const KG_PER_QUINTAL = 100;
export type QuantityUnit = 'kg' | 'quintal';

export function toKg(amount: number, unit: QuantityUnit): number {
  return unit === 'quintal' ? amount * KG_PER_QUINTAL : amount;
}

export function fromKg(kg: number, unit: QuantityUnit): number {
  return unit === 'quintal' ? kg / KG_PER_QUINTAL : kg;
}

/** Parses a user-typed number ("1,200", " 4.5 ") — `null` when it is not a finite number. */
export function parseAmount(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[,\s₹]/g, '');
  if (cleaned === '') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/* ─────────────────────────────── Dates ─────────────────────────────── */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: unknown): value is ISODate {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Calendar arithmetic on 'YYYY-MM-DD' dates (no time zone drift). */
export function addDays(isoDate: ISODate, days: number): ISODate {
  const match = ISO_DATE.exec(isoDate);
  if (!match) return isoDate;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: ISODate, to: ISODate): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** Days from today in India to a calendar date. */
export function daysFromToday(date: ISODate, now: Date = new Date()): number {
  return daysBetween(todayIST(now), date);
}

export type DayPeriod = 'morning' | 'afternoon' | 'evening';

/** Part of the day in India Standard Time, for the greeting. */
export function dayPeriod(now: Date = new Date()): DayPeriod {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(now),
  );
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

const LOCALE_TAGS: Record<Language, string> = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN', kn: 'kn-IN', ur: 'ur-IN-u-nu-latn' };

/** "Tuesday, 27 October" in the UI language, in India time. */
export function longDate(now: Date, lang: Language): string {
  return new Intl.DateTimeFormat(LOCALE_TAGS[lang], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Asia/Kolkata',
  }).format(now);
}

/** Short month name for 'YYYY-MM' ("Oct"), with the year when `withYear`. */
export function monthLabel(month: string, lang: Language, withYear = false): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return new Intl.DateTimeFormat(LOCALE_TAGS[lang], {
    month: 'short',
    year: withYear ? 'numeric' : undefined,
    timeZone: 'UTC',
  }).format(date);
}

/* ─────────────────────────────── Names ─────────────────────────────── */

/** The first word of a full name, for a friendly greeting. */
export function firstName(fullName: string | null | undefined): string {
  return (fullName ?? '').trim().split(/\s+/)[0] ?? '';
}

/** A crop's name in the UI language (falls back to English). */
export function localCropName(
  crop: Pick<Crop, 'name' | 'name_hi' | 'name_te'> & Partial<Pick<Crop, 'name_kn' | 'name_ur'>>,
  lang: Language,
): string {
  if (lang === 'hi' && crop.name_hi) return crop.name_hi;
  if (lang === 'te' && crop.name_te) return crop.name_te;
  if (lang === 'kn' && crop.name_kn) return crop.name_kn;
  if (lang === 'ur' && crop.name_ur) return crop.name_ur;
  return crop.name;
}

/* ───────────────────────────── Harvests ────────────────────────────── */

export type HarvestFilter = 'all' | 'selling' | 'deal' | 'sold' | 'closed';

const HARVEST_FILTERS: Record<Exclude<HarvestFilter, 'all'>, readonly HarvestStatus[]> = {
  selling: ['draft', 'listed', 'pooled'],
  deal: ['committed', 'picked_up', 'delivered'],
  sold: ['settled'],
  closed: ['cancelled', 'expired'],
};

export function harvestMatchesFilter(status: HarvestStatus, filter: HarvestFilter): boolean {
  return filter === 'all' || HARVEST_FILTERS[filter].includes(status);
}

export const EDITABLE_HARVEST_STATUSES: readonly HarvestStatus[] = ['draft', 'listed'];
export const CANCELLABLE_HARVEST_STATUSES: readonly HarvestStatus[] = ['draft', 'listed', 'pooled'];
export const POOLABLE_HARVEST_STATUSES: readonly HarvestStatus[] = ['listed', 'pooled'];

/** Kilograms already promised to lots or deals. */
export function committedKg(harvest: Pick<Harvest, 'quantity_kg' | 'available_kg'>): number {
  return Math.max(0, Math.round((harvest.quantity_kg - harvest.available_kg) * 10) / 10);
}

/** Orders harvests so the most pressing (selling soonest) come first, closed ones last. */
export function sortHarvests(harvests: readonly Harvest[]): Harvest[] {
  const rank = (status: HarvestStatus) =>
    HARVEST_FILTERS.selling.includes(status) ? 0 : HARVEST_FILTERS.deal.includes(status) ? 1 : status === 'settled' ? 2 : 3;
  return [...harvests].sort((a, b) => rank(a.status) - rank(b.status) || a.sell_by.localeCompare(b.sell_by));
}

/* ────────────────────────────── Offers ─────────────────────────────── */

export const CLOSED_OFFER_STATUSES: ReadonlySet<OfferStatus> = new Set(['accepted', 'rejected', 'withdrawn', 'expired']);

export function myConsent(offer: Pick<Offer, 'consents'>): OfferConsent | undefined {
  return offer.consents.find((consent) => consent.is_mine);
}

/** A direct offer on the farmer's own harvest that waits for the farmer's accept / counter / reject. */
export function canRespondToOffer(offer: Pick<Offer, 'target_type' | 'status' | 'awaiting'>): boolean {
  return offer.target_type === 'harvest' && offer.status === 'pending' && offer.awaiting === 'seller';
}

/** A pooled-lot deal proposed to the members that still needs this farmer's yes or no. */
export function needsMyConsent(offer: Pick<Offer, 'status' | 'consents'>): boolean {
  return offer.status === 'proposed' && myConsent(offer)?.decision === 'pending';
}

export type OfferBucket = 'needs' | 'progress' | 'closed';

export function offerBucket(offer: Offer): OfferBucket {
  if (canRespondToOffer(offer) || needsMyConsent(offer)) return 'needs';
  if (CLOSED_OFFER_STATUSES.has(offer.status)) return 'closed';
  return 'progress';
}

export function groupOffers(offers: readonly Offer[]): Record<OfferBucket, Offer[]> {
  const groups: Record<OfferBucket, Offer[]> = { needs: [], progress: [], closed: [] };
  for (const offer of offers) groups[offerBucket(offer)].push(offer);
  const byDeadline = (a: Offer, b: Offer) => a.valid_until.localeCompare(b.valid_until);
  groups.needs.sort(byDeadline);
  groups.progress.sort(byDeadline);
  groups.closed.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return groups;
}

/**
 * Net take-home at another price per kg. Gross, rejection, commission and payment-wait lines all
 * scale with the price (DOMAIN_RULES §3); transport, handling and the fee do not — so the net is
 * linear in price and this is exact for the engine's formula.
 */
export function estimateNetAtPrice(
  proceeds: Pick<NetProceeds, 'lines' | 'net_amount' | 'gross_price_per_kg' | 'quantity_kg'>,
  price: number,
): { net: number; netPerKg: number } | null {
  if (!(proceeds.gross_price_per_kg > 0) || !(proceeds.quantity_kg > 0) || !Number.isFinite(price)) return null;
  const fixed = proceeds.lines
    .filter((line: BreakdownLine) => line.key === 'transport' || line.key === 'handling' || line.key === 'platform_fee')
    .reduce((sum, line) => sum + line.amount, 0);
  const variable = proceeds.net_amount - fixed;
  const net = Math.round(((variable * price) / proceeds.gross_price_per_kg + fixed) * 100) / 100;
  return { net, netPerKg: Math.round((net / proceeds.quantity_kg) * 100) / 100 };
}

/* ─────────────────────────────── Lots ──────────────────────────────── */

export const JOINABLE_LOT_STATUSES: readonly LotStatus[] = ['forming', 'awaiting_consent'];
export const SALE_LOT_STATUSES: readonly LotStatus[] = ['offer_accepted', 'transport_booked', 'in_transit', 'delivered', 'settled'];
export const ACTIVE_SALE_LOT_STATUSES: readonly LotStatus[] = ['offer_accepted', 'transport_booked', 'in_transit', 'delivered'];

export function myMember(lot: Pick<Lot, 'members'>): LotMember | undefined {
  return lot.members.find((member) => member.is_mine && member.consent_status !== 'declined') ?? lot.members.find((member) => member.is_mine);
}

/** The farmer has (not declined) produce in this lot. */
export function isMyLot(lot: Pick<Lot, 'members'>): boolean {
  return lot.members.some((member) => member.is_mine && member.consent_status !== 'declined');
}

/** The farmer was added to a forming lot and must say yes or no. */
export function awaitingMyLotConsent(lot: Pick<Lot, 'members' | 'status'>): boolean {
  return JOINABLE_LOT_STATUSES.includes(lot.status) && lot.members.some((member) => member.is_mine && member.consent_status === 'pending');
}

/**
 * The farmer's harvests that could join a lot: same crop, still poolable, kilograms left, ready by
 * the pickup date and not past sell-by. Ungraded produce may join a graded lot (it is then flagged
 * for inspection); other grades must match exactly.
 */
export function compatibleHarvests(lot: Pick<Lot, 'crop_id' | 'grade' | 'pickup_date' | 'members'>, harvests: readonly Harvest[]): Harvest[] {
  const inLot = new Set(lot.members.filter((member) => member.consent_status !== 'declined').map((member) => member.harvest_id));
  return harvests.filter(
    (harvest) =>
      harvest.crop_id === lot.crop_id &&
      POOLABLE_HARVEST_STATUSES.includes(harvest.status) &&
      harvest.available_kg > 0 &&
      !inLot.has(harvest.id) &&
      (harvest.grade === lot.grade || harvest.grade === 'ungraded') &&
      harvest.available_from <= lot.pickup_date &&
      lot.pickup_date <= harvest.sell_by,
  );
}

export function isJoinable(lot: Lot, harvests: readonly Harvest[]): boolean {
  return !isMyLot(lot) && JOINABLE_LOT_STATUSES.includes(lot.status) && compatibleHarvests(lot, harvests).length > 0;
}

/* ──────────────────────────── Settlements ──────────────────────────── */

/** Farmers only receive their own payout in a settlement. */
export function myPayout(settlement: Pick<Settlement, 'payouts'> | null | undefined, farmerId?: string | null): FarmerPayout | undefined {
  if (!settlement) return undefined;
  return settlement.payouts.find((payout) => !farmerId || payout.farmer_id === farmerId) ?? settlement.payouts[0];
}

/* ───────────────────────────── Geography ───────────────────────────── */

const ROAD_FACTOR = 1.3;

/** Approximate road kilometres between two points (haversine × road factor, DOMAIN_RULES §3). */
export function roadKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const km = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(km * ROAD_FACTOR * 10) / 10;
}
