import type { MarketPrice, UUID } from '@/types/api';

import { apiFetch } from './client';

export interface MarketPriceParams {
  crop_id?: UUID | null;
  district?: string | null;
  limit?: number | null;
}

export const marketApi = {
  /** Latest first. */
  prices: (params: MarketPriceParams = {}, signal?: AbortSignal) =>
    apiFetch<MarketPrice[]>('/market-prices', { query: { ...params }, signal }),
};
