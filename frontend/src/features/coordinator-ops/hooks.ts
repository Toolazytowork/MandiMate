/**
 * Server state for the coordinator back office: transport, settlements, disputes and verifications.
 * Reads reuse the shared API objects and hierarchical keys; mutations invalidate exactly what they change.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';

import {
  disputesApi,
  keys,
  settlementsApi,
  transportApi,
  type DisputeListParams,
  type SettlementListParams,
  type TransportRequestListParams,
} from '@/lib/api';
import type {
  DisputeUpdateRequest,
  MarkPayoutPaidRequest,
  RecordPaymentRequest,
  Settlement,
  UUID,
} from '@/types/api';

export { useCreateTransportRequest, useLots, useSettlement, useTransportPlan } from '@/features/coordinator/hooks';
export { useAdminUsers, useVerifyUser } from '@/features/admin/hooks';

function invalidateAll(client: QueryClient, queryKeys: readonly QueryKey[]): Promise<unknown> {
  return Promise.all(queryKeys.map((queryKey) => client.invalidateQueries({ queryKey })));
}

/* ─────────────────────────────── Transport ─────────────────────────────── */

export function useTransportRequests(params: TransportRequestListParams = {}) {
  return useQuery({
    queryKey: keys.transport.requestList(params),
    queryFn: ({ signal }) => transportApi.listRequests(params, signal),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}

export function useAcceptQuote() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (quoteId: UUID) => transportApi.acceptQuote(quoteId),
    onSuccess: (request) => {
      client.setQueryData(keys.transport.request(request.id), request);
      return invalidateAll(client, [
        keys.transport.requests(),
        keys.lots.detail(request.lot_id),
        keys.lots.lists(),
        keys.dashboards.coordinator(),
      ]);
    },
  });
}

/* ────────────────────────────── Settlements ────────────────────────────── */

export function useSettlements(params: SettlementListParams = {}) {
  return useQuery({
    queryKey: keys.settlements.list(params),
    queryFn: ({ signal }) => settlementsApi.list(params, signal),
    placeholderData: keepPreviousData,
  });
}

function settlementKeys(settlement: Settlement): QueryKey[] {
  return [
    keys.settlements.lists(),
    keys.lots.detail(settlement.lot_id),
    keys.lots.lists(),
    keys.dashboards.coordinator(),
  ];
}

export function useRecordPayment(settlementId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (req: RecordPaymentRequest) => settlementsApi.recordPayment(settlementId, req),
    onSuccess: (settlement) => {
      client.setQueryData(keys.settlements.detail(settlement.id), settlement);
      return invalidateAll(client, settlementKeys(settlement));
    },
  });
}

export function useMarkPayoutPaid(settlementId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ payoutId, req }: { payoutId: UUID; req: MarkPayoutPaidRequest }) =>
      settlementsApi.markPayoutPaid(settlementId, payoutId, req),
    onSuccess: (settlement) => {
      client.setQueryData(keys.settlements.detail(settlement.id), settlement);
      return invalidateAll(client, settlementKeys(settlement));
    },
  });
}

/* ──────────────────────────────── Disputes ─────────────────────────────── */

export function useDisputes(params: DisputeListParams = {}) {
  return useQuery({
    queryKey: keys.disputes.list(params),
    queryFn: ({ signal }) => disputesApi.list(params, signal),
    placeholderData: keepPreviousData,
  });
}

export function useUpdateDispute() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, req }: { id: UUID; req: DisputeUpdateRequest }) => disputesApi.update(id, req),
    onSuccess: (dispute) =>
      invalidateAll(client, [
        keys.disputes.all,
        keys.dashboards.coordinator(),
        ...(dispute.settlement_id ? [keys.settlements.detail(dispute.settlement_id), keys.settlements.lists()] : []),
      ]),
  });
}
