import type { SupplyDemandInsights } from '@/types/api';

import { apiFetch } from './client';

export const insightsApi = {
  supplyDemand: (signal?: AbortSignal) => apiFetch<SupplyDemandInsights>('/insights/supply-demand', { signal }),
};
