import type { ActionItem, ISODateTime, OfferStatus } from '@/types/api';

const HOUR_MS = 3_600_000;

/** Offer statuses that still have a validity window running. */
export const OPEN_OFFER_STATUSES: ReadonlySet<OfferStatus> = new Set(['pending', 'countered', 'proposed']);

export type Urgency = 'expired' | 'urgent' | 'soon' | 'normal';

/**
 * How pressing a deadline is: `expired` once passed, `urgent` within 24 h, `soon` within 3 days.
 * Unparseable or missing dates are `normal`.
 */
export function deadlineUrgency(deadline: ISODateTime | null | undefined, now: Date): Urgency {
  if (!deadline) return 'normal';
  const time = new Date(deadline).getTime();
  if (Number.isNaN(time)) return 'normal';
  const remaining = time - now.getTime();
  if (remaining <= 0) return 'expired';
  if (remaining <= 24 * HOUR_MS) return 'urgent';
  if (remaining <= 72 * HOUR_MS) return 'soon';
  return 'normal';
}

export type DurationUnit = 'minutes' | 'hours' | 'days' | 'weeks';

/**
 * A duration as one rounded unit for labels such as "Expires in 3 hours": minutes below an hour,
 * hours below two days, days below two weeks, then weeks. Never less than one minute.
 */
export function durationParts(ms: number): { unit: DurationUnit; count: number } {
  const minutes = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  if (minutes < 60) return { unit: 'minutes', count: minutes };
  const hours = Math.round(minutes / 60);
  if (hours < 48) return { unit: 'hours', count: hours };
  const days = Math.round(hours / 24);
  if (days < 14) return { unit: 'days', count: days };
  return { unit: 'weeks', count: Math.round(days / 7) };
}

function dueTime(item: ActionItem): number {
  if (!item.due_at) return Number.POSITIVE_INFINITY;
  const time = new Date(item.due_at).getTime();
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

/** High priority first, then the earliest due date; undated items keep their API order at the end. */
export function sortActionItems(items: readonly ActionItem[]): ActionItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const priority = Number(b.item.priority === 'high') - Number(a.item.priority === 'high');
      if (priority !== 0) return priority;
      const due = dueTime(a.item) - dueTime(b.item);
      if (due !== 0 && Number.isFinite(due)) return due;
      if (dueTime(a.item) !== dueTime(b.item)) return Number.isFinite(dueTime(a.item)) ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}
