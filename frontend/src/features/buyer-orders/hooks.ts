/**
 * Server state for the buyer's deal flow: offers in negotiation, accepted orders (lots), delivery
 * and quality check, and settlements owed. Every mutation invalidates the families it changes plus
 * the buyer dashboard, so all buyer screens agree after an action.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { keys, lotsApi, offersApi, settlementsApi, transportApi } from '@/lib/api';
import { ordersFrom, type Order } from '@/features/buyer/utils';
import type { CounterRequest, DeliveryRecordRequest, OfferActionRequest, RecordPaymentRequest, UUID } from '@/types/api';

/* ─────────────────────────────── Queries ─────────────────────────────── */

export function useBuyerOffers() {
  return useQuery({
    queryKey: keys.offers.list({ limit: 200 }),
    queryFn: ({ signal }) => offersApi.list({ limit: 200 }, signal),
  });
}

export function useBuyerOffer(id: UUID | undefined) {
  return useQuery({
    queryKey: keys.offers.detail(id ?? ''),
    queryFn: ({ signal }) => offersApi.get(id ?? '', signal),
    enabled: Boolean(id),
  });
}

export function useAcceptedOffers() {
  return useQuery({
    queryKey: keys.offers.list({ status: 'accepted', limit: 200 }),
    queryFn: ({ signal }) => offersApi.list({ status: 'accepted', limit: 200 }, signal),
  });
}

export function useBuyerLots() {
  return useQuery({
    queryKey: keys.lots.list({ mine: true, limit: 200 }),
    queryFn: ({ signal }) => lotsApi.list({ mine: true, limit: 200 }, signal),
  });
}

/** Lots whose accepted offer is the buyer's own, joined with that offer. */
export function useBuyerOrders() {
  const lots = useBuyerLots();
  const offers = useAcceptedOffers();
  const data = useMemo<Order[] | undefined>(
    () => (lots.data && offers.data ? ordersFrom(lots.data, offers.data) : undefined),
    [lots.data, offers.data],
  );
  return {
    data,
    error: lots.error ?? offers.error,
    isPending: lots.isPending || offers.isPending,
    isError: lots.isError || offers.isError,
    isFetching: lots.isFetching || offers.isFetching,
    refetch: () => Promise.all([lots.refetch(), offers.refetch()]),
  };
}

export function useLot(id: UUID | undefined) {
  return useQuery({
    queryKey: keys.lots.detail(id ?? ''),
    queryFn: ({ signal }) => lotsApi.get(id ?? '', signal),
    enabled: Boolean(id),
  });
}

export function useLotTimeline(id: UUID | undefined) {
  return useQuery({
    queryKey: keys.lots.timeline(id ?? ''),
    queryFn: ({ signal }) => lotsApi.timeline(id ?? '', signal),
    enabled: Boolean(id),
  });
}

export function useLotDelivery(id: UUID | undefined, enabled: boolean) {
  return useQuery({
    queryKey: keys.lots.delivery(id ?? ''),
    queryFn: ({ signal }) => lotsApi.getDelivery(id ?? '', signal),
    enabled: Boolean(id) && enabled,
    retry: false,
  });
}

export function useTransportRequest(id: UUID | null | undefined) {
  return useQuery({
    queryKey: keys.transport.request(id ?? ''),
    queryFn: ({ signal }) => transportApi.getRequest(id ?? '', signal),
    enabled: Boolean(id),
  });
}

export function useBuyerSettlements() {
  return useQuery({
    queryKey: keys.settlements.list({ limit: 200 }),
    queryFn: ({ signal }) => settlementsApi.list({ limit: 200 }, signal),
  });
}

/* ────────────────────────────── Mutations ────────────────────────────── */

function invalidateOffers(client: QueryClient, id: UUID) {
  return Promise.all([
    client.invalidateQueries({ queryKey: keys.offers.lists() }),
    client.invalidateQueries({ queryKey: keys.offers.detail(id) }),
    client.invalidateQueries({ queryKey: keys.lots.all }),
    client.invalidateQueries({ queryKey: keys.dashboards.buyer() }),
  ]);
}

export type OfferAction = 'accept' | 'reject' | 'withdraw';

export function useOfferAction(id: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ action, req }: { action: OfferAction; req?: OfferActionRequest }) => offersApi[action](id, req ?? {}),
    onSuccess: (offer) => {
      client.setQueryData(keys.offers.detail(id), offer);
      return invalidateOffers(client, id);
    },
  });
}

export function useCounterOffer(id: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (req: CounterRequest) => offersApi.counter(id, req),
    onSuccess: (offer) => {
      client.setQueryData(keys.offers.detail(id), offer);
      return invalidateOffers(client, id);
    },
  });
}

export function useRecordDelivery(lotId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (req: DeliveryRecordRequest) => lotsApi.recordDelivery(lotId, req),
    onSuccess: (record) => {
      client.setQueryData(keys.lots.delivery(lotId), record);
      return Promise.all([
        client.invalidateQueries({ queryKey: keys.lots.all }),
        client.invalidateQueries({ queryKey: keys.settlements.all }),
        client.invalidateQueries({ queryKey: keys.dashboards.buyer() }),
      ]);
    },
  });
}

export function useRecordPayment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, req }: { id: UUID; req: RecordPaymentRequest }) => settlementsApi.recordPayment(id, req),
    onSuccess: (settlement) => {
      client.setQueryData(keys.settlements.detail(settlement.id), settlement);
      return Promise.all([
        client.invalidateQueries({ queryKey: keys.settlements.lists() }),
        client.invalidateQueries({ queryKey: keys.lots.all }),
        client.invalidateQueries({ queryKey: keys.dashboards.buyer() }),
      ]);
    },
  });
}
