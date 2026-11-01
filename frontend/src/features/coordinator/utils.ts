/**
 * Pure helpers for the coordinator cockpit: error wording, lot-builder allocations and a client-side
 * pickup order for the route preview. Business rules stay on the API; these only shape what is shown.
 */
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { isApiError } from '@/lib/api';
import { todayIST } from '@/lib/format';
import type { Harvest, ISODate, MatchCandidate, MatchProposal, UUID } from '@/types/api';

/* ─────────────────────────────── Errors ─────────────────────────────── */

/** A human sentence for any thrown value (API detail, network failure, or a generic fallback). */
export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (isApiError(error)) return error.detail || fallback;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/**
 * Maps a 422's `fieldErrors` onto react-hook-form fields. Returns true when at least one field
 * received an inline error (so the caller can skip the toast or keep it short).
 */
export function applyFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): boolean {
  if (!isApiError(error)) return false;
  let applied = false;
  for (const [path, message] of Object.entries(error.fieldErrors)) {
    const field = fields.find((name) => name === path);
    if (field) {
      setError(field, { type: 'server', message });
      applied = true;
    }
  }
  return applied;
}

/* ─────────────────────────────── Dates ──────────────────────────────── */

/** 'YYYY-MM-DD' shifted by whole days (calendar arithmetic in UTC, so no DST drift). */
export function addDays(date: ISODate, days: number): ISODate {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/** Whole days from today (India) to `date`; negative when it has passed. */
export function daysFromToday(date: ISODate, now: Date = new Date()): number {
  const today = todayIST(now);
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/* ───────────────────────────── Harvests ─────────────────────────────── */

/** Listings whose quality still needs a coordinator's eye before pooling. */
export function needsVerification(harvest: Harvest): boolean {
  return (
    harvest.quality_status !== 'inspected' &&
    (harvest.status === 'listed' || harvest.status === 'pooled' || harvest.status === 'draft')
  );
}

/* ──────────────────────────── Lot builder ───────────────────────────── */

export interface CandidateAllocation {
  included: boolean;
  kg: number;
}

export type Allocation = Record<UUID, CandidateAllocation>;

/** Rounds kilograms to one decimal, as the lot engine does. */
export function roundKg(kg: number): number {
  return Math.round(kg * 10) / 10;
}

/** Starting point: the engine's selection (proposed kg > 0 are included). */
export function initialAllocation(proposal: MatchProposal): Allocation {
  const allocation: Allocation = {};
  for (const candidate of proposal.candidates) {
    allocation[candidate.harvest_id] = {
      included: candidate.proposed_kg > 0,
      kg: candidate.proposed_kg > 0 ? candidate.proposed_kg : candidate.available_kg,
    };
  }
  return allocation;
}

/** A candidate's kilograms clamped to what the farmer actually has available. */
export function clampKg(candidate: MatchCandidate, kg: number): number {
  if (!Number.isFinite(kg) || kg < 0) return 0;
  return roundKg(Math.min(kg, candidate.available_kg));
}

export function allocatedKg(candidate: MatchCandidate, allocation: Allocation): number {
  const entry = allocation[candidate.harvest_id];
  if (!entry?.included) return 0;
  return clampKg(candidate, entry.kg);
}

export function allocationTotal(proposal: MatchProposal, allocation: Allocation): number {
  return roundKg(proposal.candidates.reduce((sum, candidate) => sum + allocatedKg(candidate, allocation), 0));
}

/** The members a lot would be created with: included candidates with more than 0 kg. */
export function allocationMembers(proposal: MatchProposal, allocation: Allocation): { harvest_id: UUID; quantity_kg: number }[] {
  return proposal.candidates
    .map((candidate) => ({ harvest_id: candidate.harvest_id, quantity_kg: allocatedKg(candidate, allocation) }))
    .filter((member) => member.quantity_kg > 0);
}

/** Feasibility threshold: the demand's minimum when known, otherwise 90 % of the target. */
export function feasibilityThreshold(target: number, demandMinKg?: number | null): number {
  return typeof demandMinKg === 'number' && demandMinKg > 0 ? demandMinKg : roundKg(target * 0.9);
}

/** The proposal as edited by the coordinator, for explanation and for the lot's record. */
export function adjustedProposal(proposal: MatchProposal, allocation: Allocation, demandMinKg?: number | null): MatchProposal {
  const candidates = proposal.candidates.map((candidate) => ({ ...candidate, proposed_kg: allocatedKg(candidate, allocation) }));
  const total = roundKg(candidates.reduce((sum, candidate) => sum + candidate.proposed_kg, 0));
  return {
    ...proposal,
    candidates,
    selected_total_kg: total,
    shortfall_kg: roundKg(Math.max(0, proposal.target_quantity_kg - total)),
    feasible: total >= feasibilityThreshold(proposal.target_quantity_kg, demandMinKg),
  };
}

/** When a candidate is switched on: give it what is still missing, or all it has. */
export function suggestedKgOnInclude(candidate: MatchCandidate, proposal: MatchProposal, allocation: Allocation): number {
  const remaining = proposal.target_quantity_kg - allocationTotal(proposal, allocation);
  if (remaining <= 0) return candidate.available_kg;
  return roundKg(Math.min(candidate.available_kg, remaining));
}

/* ───────────────────────────── Geography ────────────────────────────── */

const EARTH_RADIUS_KM = 6371;
const ROAD_FACTOR = 1.3;

export function haversineKm(a: readonly [number, number], b: readonly [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface RoutePoint {
  id: string;
  latitude: number;
  longitude: number;
}

/**
 * Visiting order mirroring the routing engine (DOMAIN_RULES §5): start at the stop farthest from the
 * destination, then always the nearest remaining stop. Returns the ordered stops and road kilometres.
 */
export function orderPickupStops<T extends RoutePoint>(stops: readonly T[], destination: readonly [number, number]): { ordered: T[]; roadKm: number } {
  if (stops.length === 0) return { ordered: [], roadKm: 0 };
  const remaining = [...stops];
  const distanceTo = (stop: T, point: readonly [number, number]) => haversineKm([stop.latitude, stop.longitude], point);
  remaining.sort((a, b) => distanceTo(b, destination) - distanceTo(a, destination));
  const ordered: T[] = [remaining.shift()!];
  while (remaining.length > 0) {
    const last = ordered[ordered.length - 1]!;
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((stop, index) => {
      const distance = distanceTo(stop, [last.latitude, last.longitude]);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    ordered.push(remaining.splice(bestIndex, 1)[0]!);
  }
  let km = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    km += distanceTo(ordered[index]!, [previous.latitude, previous.longitude]);
  }
  km += distanceTo(ordered[ordered.length - 1]!, destination);
  return { ordered, roadKm: Math.round(km * ROAD_FACTOR * 10) / 10 };
}

/* ───────────────────────────── Text search ──────────────────────────── */

/** Case- and accent-insensitive "contains" over several fields. */
export function matchesSearch(query: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = query.trim().toLocaleLowerCase('en-IN');
  if (!needle) return true;
  return fields.some((field) => field?.toLocaleLowerCase('en-IN').includes(needle));
}
