import { daysFromToday } from '@/features/coordinator/utils';
import type { Settlement } from '@/types/api';

export { applyFieldErrors, errorMessage } from '@/features/coordinator/utils';

export function outstanding(settlement: Pick<Settlement, 'gross_amount' | 'amount_paid'>): number {
  return Math.max(0, Math.round((settlement.gross_amount - settlement.amount_paid) * 100) / 100);
}

/** Days until the buyer's due date (negative once late); `null` when fully paid. */
export function dueIn(settlement: Pick<Settlement, 'due_date' | 'payment_status'>): number | null {
  if (settlement.payment_status === 'paid') return null;
  return daysFromToday(settlement.due_date);
}

export function isOverdue(settlement: Pick<Settlement, 'due_date' | 'payment_status'>): boolean {
  if (settlement.payment_status === 'overdue') return true;
  const days = dueIn(settlement);
  return days !== null && days < 0;
}
