/**
 * Queries and mutations for the buyer's sourcing desk: dashboard, requirements (demands),
 * supply and new offers.
 */
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  cropsApi,
  dashboardsApi,
  demandsApi,
  harvestsApi,
  keys,
  lotsApi,
  marketApi,
  offersApi,
  supplyApi,
} from '@/lib/api';
import type { DemandListParams, SupplyParams } from '@/lib/api';
import type { DemandCreateRequest, OfferCreateRequest, UUID } from '@/types/api';

export function useBuyerDashboard() {
  return useQuery({ queryKey: keys.dashboards.buyer(), queryFn: ({ signal }) => dashboardsApi.buyer(signal) });
}

export function useCrops() {
  return useQuery({ queryKey: keys.crops.list(), queryFn: ({ signal }) => cropsApi.list(signal), staleTime: 10 * 60_000 });
}

export function useDemands(params: DemandListParams = {}) {
  return useQuery({ queryKey: keys.demands.list(params), queryFn: ({ signal }) => demandsApi.list(params, signal) });
}

export function useDemand(id: UUID | undefined) {
  return useQuery({
    queryKey: keys.demands.detail(id ?? ''),
    queryFn: ({ signal }) => demandsApi.get(id as UUID, signal),
    enabled: Boolean(id),
  });
}

export function useCreateDemand() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (req: DemandCreateRequest) => demandsApi.create(req),
    onSuccess: (demand) => {
      client.setQueryData(keys.demands.detail(demand.id), demand);
      void client.invalidateQueries({ queryKey: keys.demands.lists() });
      void client.invalidateQueries({ queryKey: keys.dashboards.buyer() });
    },
  });
}

export function useCancelDemand(id: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => demandsApi.cancel(id),
    onSuccess: (demand) => {
      client.setQueryData(keys.demands.detail(id), demand);
      void client.invalidateQueries({ queryKey: keys.demands.lists() });
      void client.invalidateQueries({ queryKey: keys.dashboards.buyer() });
    },
  });
}

export function useSupply(params: SupplyParams = {}, enabled = true) {
  return useQuery({
    queryKey: keys.supply.list(params),
    queryFn: ({ signal }) => supplyApi.list(params, signal),
    enabled,
  });
}

export function useLots(ids: readonly UUID[]) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: keys.lots.detail(id),
      queryFn: ({ signal }: { signal: AbortSignal }) => lotsApi.get(id, signal),
    })),
  });
}

export function useLot(id: UUID | null) {
  return useQuery({
    queryKey: keys.lots.detail(id ?? ''),
    queryFn: ({ signal }) => lotsApi.get(id as UUID, signal),
    enabled: Boolean(id),
  });
}

export function useHarvest(id: UUID | null) {
  return useQuery({
    queryKey: keys.harvests.detail(id ?? ''),
    queryFn: ({ signal }) => harvestsApi.get(id as UUID, signal),
    enabled: Boolean(id),
  });
}

export function useLatestMarketPrice(cropId: UUID | null | undefined, district?: string | null) {
  const params = { crop_id: cropId ?? null, district: district ?? null, limit: 1 };
  return useQuery({
    queryKey: keys.market.prices(params),
    queryFn: ({ signal }) => marketApi.prices(params, signal),
    enabled: Boolean(cropId),
    select: (prices) => prices[0] ?? null,
  });
}

export function useCreateOffer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (req: OfferCreateRequest) => offersApi.create(req),
    onSuccess: (offer) => {
      client.setQueryData(keys.offers.detail(offer.id), offer);
      void client.invalidateQueries({ queryKey: keys.offers.lists() });
      void client.invalidateQueries({ queryKey: keys.supply.all });
      void client.invalidateQueries({ queryKey: keys.dashboards.buyer() });
      if (offer.lot_id) void client.invalidateQueries({ queryKey: keys.lots.detail(offer.lot_id) });
      if (offer.harvest_id) void client.invalidateQueries({ queryKey: keys.harvests.detail(offer.harvest_id) });
      if (offer.demand_id) void client.invalidateQueries({ queryKey: keys.demands.detail(offer.demand_id) });
    },
  });
}
