import type { NetProceeds, NetProceedsCalcRequest } from '@/types/api';

import { apiFetch } from './client';

export const calculatorApi = {
  netProceeds: (req: NetProceedsCalcRequest) =>
    apiFetch<NetProceeds>('/calculator/net-proceeds', { method: 'POST', body: req }),
};
