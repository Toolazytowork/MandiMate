import type {
  ConsentRequest,
  CounterRequest,
  NetProceeds,
  Offer,
  OfferActionRequest,
  OfferCreateRequest,
  OfferStatus,
  UUID,
} from '@/types/api';

import { apiFetch } from './client';

export interface OfferListParams {
  status?: OfferStatus | null;
  lot_id?: UUID | null;
  harvest_id?: UUID | null;
  limit?: number | null;
}

export interface OfferConsentParams {
  /** Coordinator only: record an assisted consent for this lot member. */
  member_id?: UUID | null;
}

export interface OfferBreakdownParams {
  /** Coordinator only: the breakdown for one member's harvest instead of the whole lot. */
  harvest_id?: UUID | null;
}

export const offersApi = {
  list: (params: OfferListParams = {}, signal?: AbortSignal) =>
    apiFetch<Offer[]>('/offers', { query: { ...params }, signal }),
  get: (id: UUID, signal?: AbortSignal) => apiFetch<Offer>(`/offers/${id}`, { signal }),
  create: (req: OfferCreateRequest) => apiFetch<Offer>('/offers', { method: 'POST', body: req }),
  counter: (id: UUID, req: CounterRequest) => apiFetch<Offer>(`/offers/${id}/counter`, { method: 'POST', body: req }),
  accept: (id: UUID, req: OfferActionRequest = {}) =>
    apiFetch<Offer>(`/offers/${id}/accept`, { method: 'POST', body: req }),
  reject: (id: UUID, req: OfferActionRequest = {}) =>
    apiFetch<Offer>(`/offers/${id}/reject`, { method: 'POST', body: req }),
  withdraw: (id: UUID, req: OfferActionRequest = {}) =>
    apiFetch<Offer>(`/offers/${id}/withdraw`, { method: 'POST', body: req }),
  consent: (id: UUID, req: ConsentRequest, params: OfferConsentParams = {}) =>
    apiFetch<Offer>(`/offers/${id}/consent`, { method: 'POST', body: req, query: { ...params } }),
  breakdown: (id: UUID, params: OfferBreakdownParams = {}, signal?: AbortSignal) =>
    apiFetch<NetProceeds>(`/offers/${id}/breakdown`, { query: { ...params }, signal }),
};
