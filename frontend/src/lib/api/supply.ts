import type { Grade, SupplyItem, UUID } from '@/types/api';

import { apiFetch } from './client';

export interface SupplyParams {
  crop_id?: UUID | null;
  grade?: Grade | null;
  district?: string | null;
  limit?: number | null;
}

export const supplyApi = {
  /** Lots open for offers and individually listed harvests. */
  list: (params: SupplyParams = {}, signal?: AbortSignal) =>
    apiFetch<SupplyItem[]>('/supply', { query: { ...params }, signal }),
};
