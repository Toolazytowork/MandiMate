/**
 * Pure helpers over `TransportRequest` for the transporter's point of view. A transporter only ever
 * receives their own quotes on a request (docs/API_CONTRACT.md), so "my quote" is any quote listed.
 */
import { todayIST } from '@/lib/format';
import type { ISODate, TransportQuote, TransportRequest, TransportRequestStatus } from '@/types/api';

export const QUOTABLE_STATUSES: ReadonlySet<TransportRequestStatus> = new Set(['open', 'quoted']);
export const TRIP_STATUSES: ReadonlySet<TransportRequestStatus> = new Set(['booked', 'in_progress', 'completed']);

export function isQuotable(request: Pick<TransportRequest, 'status'>): boolean {
  return QUOTABLE_STATUSES.has(request.status);
}

/** Own quotes, newest first. */
export function myQuotes(request: TransportRequest, userId: string | undefined): TransportQuote[] {
  return request.quotes
    .filter((quote) => !userId || quote.transporter_id === userId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** The quote still in front of the coordinator (one per transporter at a time). */
export function activeQuote(request: TransportRequest, userId: string | undefined): TransportQuote | null {
  return myQuotes(request, userId).find((quote) => quote.status === 'submitted') ?? null;
}

/** The booked quote, when it is this transporter's. */
export function bookedQuote(request: TransportRequest, userId: string | undefined): TransportQuote | null {
  if (!request.booked_quote_id) return null;
  return myQuotes(request, userId).find((quote) => quote.id === request.booked_quote_id) ?? null;
}

export function isMyTrip(request: TransportRequest, userId: string | undefined): boolean {
  return TRIP_STATUSES.has(request.status) && bookedQuote(request, userId) !== null;
}

export interface TripProgress {
  total: number;
  picked: number;
  skipped: number;
  pending: number;
  plannedKg: number;
  pickedKg: number;
  /** 0–100 across stops that are done (picked or skipped). */
  pct: number;
  nextStopId: string | null;
}

export function tripProgress(request: Pick<TransportRequest, 'stops'>): TripProgress {
  const ordered = [...request.stops].sort((a, b) => a.sequence - b.sequence);
  const picked = ordered.filter((stop) => stop.status === 'picked_up');
  const skipped = ordered.filter((stop) => stop.status === 'skipped').length;
  const pending = ordered.filter((stop) => stop.status === 'pending');
  const total = ordered.length;
  return {
    total,
    picked: picked.length,
    skipped,
    pending: pending.length,
    plannedKg: ordered.reduce((sum, stop) => sum + stop.quantity_kg, 0),
    pickedKg: picked.reduce((sum, stop) => sum + (stop.picked_kg ?? 0), 0),
    pct: total > 0 ? ((picked.length + skipped) / total) * 100 : 0,
    nextStopId: pending[0]?.id ?? null,
  };
}

export type PickupWindow = 'any' | 'today' | 'next3' | 'week';

/** Whole days from today (IST) to a calendar date; negative in the past. */
export function daysUntil(date: ISODate, today: string = todayIST()): number {
  const parse = (value: string) => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  return Math.round((parse(date) - parse(today)) / 86_400_000);
}

export function inPickupWindow(date: ISODate, window: PickupWindow, today?: string): boolean {
  if (window === 'any') return true;
  const days = daysUntil(date, today);
  if (window === 'today') return days <= 0;
  if (window === 'next3') return days <= 3;
  return days <= 7;
}

/** Destination and crop text for search. */
export function requestSearchText(request: TransportRequest): string {
  return [request.lot_code, request.crop_name, request.destination_name, ...request.stops.map((stop) => stop.village ?? '')]
    .join(' ')
    .toLocaleLowerCase('en-IN');
}
