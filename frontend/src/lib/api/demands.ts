import type { Demand, DemandCreateRequest, DemandStatus, DemandUpdateRequest, UUID } from '@/types/api';

import { apiFetch } from './client';

export interface DemandListParams {
  status?: DemandStatus | null;
  crop_id?: UUID | null;
  limit?: number | null;
}

export const demandsApi = {
  list: (params: DemandListParams = {}, signal?: AbortSignal) =>
    apiFetch<Demand[]>('/demands', { query: { ...params }, signal }),
  get: (id: UUID, signal?: AbortSignal) => apiFetch<Demand>(`/demands/${id}`, { signal }),
  create: (req: DemandCreateRequest) => apiFetch<Demand>('/demands', { method: 'POST', body: req }),
  update: (id: UUID, req: DemandUpdateRequest) => apiFetch<Demand>(`/demands/${id}`, { method: 'PATCH', body: req }),
  cancel: (id: UUID) => apiFetch<Demand>(`/demands/${id}/cancel`, { method: 'POST' }),
};
