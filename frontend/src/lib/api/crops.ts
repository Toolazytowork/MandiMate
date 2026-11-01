import type { Crop } from '@/types/api';

import { apiFetch } from './client';

export const cropsApi = {
  list: (signal?: AbortSignal) => apiFetch<Crop[]>('/crops', { signal }),
};
