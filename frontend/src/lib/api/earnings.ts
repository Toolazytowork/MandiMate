import type { FarmerEarnings } from '@/types/api';

import { apiFetch } from './client';

export const earningsApi = {
  get: (signal?: AbortSignal) => apiFetch<FarmerEarnings>('/earnings', { signal }),
};
