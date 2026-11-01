import type { FarmerSummary, RegisteredFarmer, RegisterFarmerRequest } from '@/types/api';

import { apiFetch } from './client';

export const coordinatorApi = {
  farmers: (signal?: AbortSignal) => apiFetch<FarmerSummary[]>('/coordinator/farmers', { signal }),
  /** The response carries a one-time temporary password for the coordinator to hand over. */
  registerFarmer: (req: RegisterFarmerRequest) =>
    apiFetch<RegisteredFarmer>('/coordinator/farmers', { method: 'POST', body: req }),
};
