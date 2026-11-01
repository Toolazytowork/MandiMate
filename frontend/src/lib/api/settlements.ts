import type { MarkPayoutPaidRequest, PaymentStatus, RecordPaymentRequest, Settlement, UUID } from '@/types/api';

import { apiFetch } from './client';

export interface SettlementListParams {
  payment_status?: PaymentStatus | null;
  limit?: number | null;
}

export const settlementsApi = {
  list: (params: SettlementListParams = {}, signal?: AbortSignal) =>
    apiFetch<Settlement[]>('/settlements', { query: { ...params }, signal }),
  get: (id: UUID, signal?: AbortSignal) => apiFetch<Settlement>(`/settlements/${id}`, { signal }),
  recordPayment: (id: UUID, req: RecordPaymentRequest) =>
    apiFetch<Settlement>(`/settlements/${id}/payments`, { method: 'POST', body: req }),
  markPayoutPaid: (id: UUID, payoutId: UUID, req: MarkPayoutPaidRequest = {}) =>
    apiFetch<Settlement>(`/settlements/${id}/payouts/${payoutId}/mark-paid`, { method: 'POST', body: req }),
};
