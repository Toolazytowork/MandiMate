/** Small helpers shared by the buyer's sourcing pages (requirements, supply, new offer). */
import type { Grade, SupplyItem } from '@/types/api';

export const GRADES: readonly Grade[] = ['A', 'B', 'C', 'ungraded'];

/** New-offer path for a supply item (or a lot / harvest id), optionally linked to a requirement. */
export function offerPath(item: Pick<SupplyItem, 'kind' | 'id'>, demandId?: string | null): string {
  const params = new URLSearchParams({ [item.kind === 'lot' ? 'lot_id' : 'harvest_id']: item.id });
  if (demandId) params.set('demand_id', demandId);
  return `/app/buyer/offers/new?${params.toString()}`;
}

/** A coordinate typed by hand: blank → null, invalid → NaN (caught by the schema). */
export function parseCoordinate(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return Number(trimmed);
}

export function isLatitude(value: number | null): boolean {
  return value === null || (Number.isFinite(value) && value >= -90 && value <= 90);
}

export function isLongitude(value: number | null): boolean {
  return value === null || (Number.isFinite(value) && value >= -180 && value <= 180);
}
