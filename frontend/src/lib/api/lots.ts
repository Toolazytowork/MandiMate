import type {
  ConsentRequest,
  DeliveryRecord,
  DeliveryRecordRequest,
  JoinLotRequest,
  JourneyStep,
  Lot,
  LotCreateRequest,
  LotStatus,
  MatchPreviewRequest,
  MatchProposal,
  TransportPlan,
  UUID,
} from '@/types/api';

import { apiFetch } from './client';

export interface LotListParams {
  status?: LotStatus | null;
  crop_id?: UUID | null;
  mine?: boolean | null;
  limit?: number | null;
}

export const lotsApi = {
  matchPreview: (req: MatchPreviewRequest) =>
    apiFetch<MatchProposal>('/lots/match-preview', { method: 'POST', body: req }),
  list: (params: LotListParams = {}, signal?: AbortSignal) => apiFetch<Lot[]>('/lots', { query: { ...params }, signal }),
  get: (id: UUID, signal?: AbortSignal) => apiFetch<Lot>(`/lots/${id}`, { signal }),
  create: (req: LotCreateRequest) => apiFetch<Lot>('/lots', { method: 'POST', body: req }),
  join: (id: UUID, req: JoinLotRequest) => apiFetch<Lot>(`/lots/${id}/join`, { method: 'POST', body: req }),
  /** The member's own farmer, or a coordinator recording assisted consent. */
  consent: (id: UUID, memberId: UUID, req: ConsentRequest) =>
    apiFetch<Lot>(`/lots/${id}/members/${memberId}/consent`, { method: 'POST', body: req }),
  open: (id: UUID) => apiFetch<Lot>(`/lots/${id}/open`, { method: 'POST' }),
  cancel: (id: UUID) => apiFetch<Lot>(`/lots/${id}/cancel`, { method: 'POST' }),
  timeline: (id: UUID, signal?: AbortSignal) => apiFetch<JourneyStep[]>(`/lots/${id}/timeline`, { signal }),
  /** Non-persisted route and vehicle preview. */
  transportPlan: (id: UUID) => apiFetch<TransportPlan>(`/lots/${id}/transport-plan`, { method: 'POST' }),
  /** Rejects with a 404 ApiError until delivery has been recorded. */
  getDelivery: (id: UUID, signal?: AbortSignal) => apiFetch<DeliveryRecord>(`/lots/${id}/delivery`, { signal }),
  recordDelivery: (id: UUID, req: DeliveryRecordRequest) =>
    apiFetch<DeliveryRecord>(`/lots/${id}/delivery`, { method: 'POST', body: req }),
};
