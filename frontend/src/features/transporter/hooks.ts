/**
 * Server state for the transporter workspace: dashboard, fleet, pickup requests, quotes and trips.
 * Mutations update the cache optimistically where the outcome is certain (fleet toggles, pickups)
 * and always invalidate the request family plus the dashboard so every screen agrees.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { dashboardsApi, keys, transportApi, type TransportRequestListParams } from '@/lib/api';
import type {
  PickupConfirmRequest,
  QuoteCreateRequest,
  TransportQuote,
  TransportRequest,
  TripCompleteRequest,
  UUID,
  Vehicle,
  VehicleCreateRequest,
  VehicleUpdateRequest,
} from '@/types/api';

/* ─────────────────────────────── Queries ─────────────────────────────── */

export function useTransporterDashboard() {
  return useQuery({
    queryKey: keys.dashboards.transporter(),
    queryFn: ({ signal }) => dashboardsApi.transporter(signal),
  });
}

export function useVehicles() {
  return useQuery({
    queryKey: keys.transport.vehicles(),
    queryFn: ({ signal }) => transportApi.listVehicles(signal),
  });
}

export function useTransportRequests(params: TransportRequestListParams = {}) {
  return useQuery({
    queryKey: keys.transport.requestList(params),
    queryFn: ({ signal }) => transportApi.listRequests(params, signal),
  });
}

export function useTransportRequest(id: UUID | undefined) {
  return useQuery({
    queryKey: keys.transport.request(id ?? ''),
    queryFn: ({ signal }) => transportApi.getRequest(id ?? '', signal),
    enabled: Boolean(id),
  });
}

/* ────────────────────────────── Helpers ──────────────────────────────── */

function invalidateTransport(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: keys.transport.requests() }),
    client.invalidateQueries({ queryKey: keys.dashboards.transporter() }),
  ]);
}

function patchRequest(client: QueryClient, id: UUID, update: (request: TransportRequest) => TransportRequest) {
  client.setQueryData<TransportRequest>(keys.transport.request(id), (current) => (current ? update(current) : current));
}

/* ─────────────────────────────── Fleet ───────────────────────────────── */

export function useCreateVehicle() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (req: VehicleCreateRequest) => transportApi.createVehicle(req),
    onSuccess: (vehicle) => {
      client.setQueryData<Vehicle[]>(keys.transport.vehicles(), (current) => (current ? [vehicle, ...current] : [vehicle]));
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.transport.vehicles() }),
  });
}

export function useUpdateVehicle() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, req }: { id: UUID; req: VehicleUpdateRequest }) => transportApi.updateVehicle(id, req),
    onMutate: async ({ id, req }) => {
      await client.cancelQueries({ queryKey: keys.transport.vehicles() });
      const previous = client.getQueryData<Vehicle[]>(keys.transport.vehicles());
      // Only the activation toggle is applied before the server answers; edits wait for the response.
      if (previous && req.is_active !== undefined && Object.keys(req).length === 1) {
        client.setQueryData<Vehicle[]>(
          keys.transport.vehicles(),
          previous.map((vehicle) => (vehicle.id === id ? { ...vehicle, is_active: req.is_active ?? vehicle.is_active } : vehicle)),
        );
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) client.setQueryData(keys.transport.vehicles(), context.previous);
    },
    onSuccess: (vehicle) => {
      client.setQueryData<Vehicle[]>(keys.transport.vehicles(), (current) =>
        current?.map((item) => (item.id === vehicle.id ? vehicle : item)),
      );
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.transport.vehicles() }),
  });
}

export function useDeleteVehicle() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: UUID) => transportApi.deleteVehicle(id),
    onSuccess: (_result, id) => {
      client.setQueryData<Vehicle[]>(keys.transport.vehicles(), (current) => current?.filter((vehicle) => vehicle.id !== id));
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.transport.vehicles() }),
  });
}

/* ─────────────────────────────── Quotes ──────────────────────────────── */

export function useSubmitQuote(requestId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (req: QuoteCreateRequest) => transportApi.submitQuote(requestId, req),
    onSuccess: (quote) => {
      patchRequest(client, requestId, (request) => ({
        ...request,
        status: request.status === 'open' ? 'quoted' : request.status,
        quotes: [quote, ...request.quotes.filter((item) => item.id !== quote.id)],
      }));
    },
    onSettled: () => invalidateTransport(client),
  });
}

export function useWithdrawQuote(requestId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (quoteId: UUID) => transportApi.withdrawQuote(quoteId),
    onMutate: async (quoteId) => {
      await client.cancelQueries({ queryKey: keys.transport.request(requestId) });
      const previous = client.getQueryData<TransportRequest>(keys.transport.request(requestId));
      patchRequest(client, requestId, (request) => ({
        ...request,
        quotes: request.quotes.map((quote): TransportQuote => (quote.id === quoteId ? { ...quote, status: 'withdrawn' } : quote)),
      }));
      return { previous };
    },
    onError: (_error, _quoteId, context) => {
      if (context?.previous) client.setQueryData(keys.transport.request(requestId), context.previous);
    },
    onSettled: () => invalidateTransport(client),
  });
}

/* ──────────────────────────────── Trips ──────────────────────────────── */

export function useConfirmPickup(requestId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ stopId, req }: { stopId: UUID; req: PickupConfirmRequest }) => transportApi.confirmPickup(requestId, stopId, req),
    onMutate: async ({ stopId, req }) => {
      await client.cancelQueries({ queryKey: keys.transport.request(requestId) });
      const previous = client.getQueryData<TransportRequest>(keys.transport.request(requestId));
      patchRequest(client, requestId, (request) => ({
        ...request,
        status: request.status === 'booked' ? 'in_progress' : request.status,
        stops: request.stops.map((stop) =>
          stop.id === stopId ? { ...stop, status: 'picked_up', picked_kg: req.picked_kg, picked_up_at: new Date().toISOString() } : stop,
        ),
      }));
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) client.setQueryData(keys.transport.request(requestId), context.previous);
    },
    onSuccess: (request) => client.setQueryData(keys.transport.request(requestId), request),
    onSettled: () =>
      Promise.all([invalidateTransport(client), client.invalidateQueries({ queryKey: keys.lots.all })]),
  });
}

export function useCompleteTrip(requestId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (req: TripCompleteRequest) => transportApi.complete(requestId, req),
    onSuccess: (request) => client.setQueryData(keys.transport.request(requestId), request),
    onSettled: () =>
      Promise.all([invalidateTransport(client), client.invalidateQueries({ queryKey: keys.lots.all })]),
  });
}
