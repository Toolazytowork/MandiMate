import type { Dispute, DisputeCreateRequest, DisputeStatus, DisputeUpdateRequest, UUID } from '@/types/api';

import { apiFetch } from './client';

export interface DisputeListParams {
  status?: DisputeStatus | null;
  limit?: number | null;
}

export const disputesApi = {
  list: (params: DisputeListParams = {}, signal?: AbortSignal) =>
    apiFetch<Dispute[]>('/disputes', { query: { ...params }, signal }),
  create: (req: DisputeCreateRequest) => apiFetch<Dispute>('/disputes', { method: 'POST', body: req }),
  update: (id: UUID, req: DisputeUpdateRequest) =>
    apiFetch<Dispute>(`/disputes/${id}`, { method: 'PATCH', body: req }),
};
