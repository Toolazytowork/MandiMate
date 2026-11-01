import type { ContactRequest, HealthStatus, PublicStats } from '@/types/api';

import { apiFetch } from './client';

export const publicApi = {
  health: (signal?: AbortSignal) => apiFetch<HealthStatus>('/health', { signal }),
  stats: (signal?: AbortSignal) => apiFetch<PublicStats>('/public/stats', { signal }),
  contact: (req: ContactRequest) => apiFetch<{ ok: true }>('/public/contact', { method: 'POST', body: req }),
};
