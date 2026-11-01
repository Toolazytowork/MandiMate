import type {
  PickupConfirmRequest,
  QuoteCreateRequest,
  TransportQuote,
  TransportRequest,
  TransportRequestCreateRequest,
  TransportRequestStatus,
  TripCompleteRequest,
  UUID,
  Vehicle,
  VehicleCreateRequest,
  VehicleUpdateRequest,
} from '@/types/api';

import { apiFetch } from './client';

export interface TransportRequestListParams {
  status?: TransportRequestStatus | null;
  /** Transporters: only requests they quoted on or were booked for. */
  mine?: boolean | null;
  limit?: number | null;
}

export const transportApi = {
  listVehicles: (signal?: AbortSignal) => apiFetch<Vehicle[]>('/vehicles', { signal }),
  createVehicle: (req: VehicleCreateRequest) => apiFetch<Vehicle>('/vehicles', { method: 'POST', body: req }),
  updateVehicle: (id: UUID, req: VehicleUpdateRequest) =>
    apiFetch<Vehicle>(`/vehicles/${id}`, { method: 'PATCH', body: req }),
  deleteVehicle: (id: UUID) => apiFetch<void>(`/vehicles/${id}`, { method: 'DELETE' }),

  listRequests: (params: TransportRequestListParams = {}, signal?: AbortSignal) =>
    apiFetch<TransportRequest[]>('/transport-requests', { query: { ...params }, signal }),
  getRequest: (id: UUID, signal?: AbortSignal) => apiFetch<TransportRequest>(`/transport-requests/${id}`, { signal }),
  createRequest: (req: TransportRequestCreateRequest) =>
    apiFetch<TransportRequest>('/transport-requests', { method: 'POST', body: req }),

  submitQuote: (requestId: UUID, req: QuoteCreateRequest) =>
    apiFetch<TransportQuote>(`/transport-requests/${requestId}/quotes`, { method: 'POST', body: req }),
  /** Coordinator books the quote; the request becomes `booked`. */
  acceptQuote: (quoteId: UUID) =>
    apiFetch<TransportRequest>(`/transport-quotes/${quoteId}/accept`, { method: 'POST' }),
  withdrawQuote: (quoteId: UUID) =>
    apiFetch<TransportQuote>(`/transport-quotes/${quoteId}/withdraw`, { method: 'POST' }),

  confirmPickup: (requestId: UUID, stopId: UUID, req: PickupConfirmRequest) =>
    apiFetch<TransportRequest>(`/transport-requests/${requestId}/stops/${stopId}/pickup`, {
      method: 'POST',
      body: req,
    }),
  complete: (requestId: UUID, req: TripCompleteRequest = {}) =>
    apiFetch<TransportRequest>(`/transport-requests/${requestId}/complete`, { method: 'POST', body: req }),
};
