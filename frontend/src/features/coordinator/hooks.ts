/**
 * Server state for the coordinator cockpit (TanStack Query). Every hook uses the shared API objects
 * and the hierarchical query keys, and invalidates exactly what a mutation can change.
 */
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import {
  aiApi,
  coordinatorApi,
  cropsApi,
  dashboardsApi,
  demandsApi,
  harvestsApi,
  insightsApi,
  isApiError,
  keys,
  lotsApi,
  marketApi,
  offersApi,
  settlementsApi,
  transportApi,
  type HarvestListParams,
  type LotListParams,
} from '@/lib/api';
import type {
  ConsentRequest,
  CounterRequest,
  DeliveryRecordRequest,
  Harvest,
  HarvestCreateRequest,
  HarvestVerifyRequest,
  Lot,
  LotCreateRequest,
  MatchPreviewRequest,
  MatchProposal,
  Offer,
  OfferActionRequest,
  RegisterFarmerRequest,
  UUID,
  VoiceListingRequest,
} from '@/types/api';

const LONG_STALE = 60 * 60_000;

function invalidateAll(client: QueryClient, queryKeys: readonly QueryKey[]): Promise<unknown> {
  return Promise.all(queryKeys.map((queryKey) => client.invalidateQueries({ queryKey })));
}

/* ──────────────────────────── Catalogue & home ──────────────────────────── */

export function useCrops() {
  return useQuery({ queryKey: keys.crops.list(), queryFn: ({ signal }) => cropsApi.list(signal), staleTime: LONG_STALE });
}

export function useCoordinatorDashboard() {
  return useQuery({ queryKey: keys.dashboards.coordinator(), queryFn: ({ signal }) => dashboardsApi.coordinator(signal) });
}

export function useSupplyDemandInsights() {
  return useQuery({ queryKey: keys.insights.supplyDemand(), queryFn: ({ signal }) => insightsApi.supplyDemand(signal) });
}

export function useMarketPrices(cropId: UUID | null | undefined) {
  const params = { crop_id: cropId, limit: 5 };
  return useQuery({
    queryKey: keys.market.prices(params),
    queryFn: ({ signal }) => marketApi.prices(params, signal),
    enabled: Boolean(cropId),
    staleTime: 10 * 60_000,
  });
}

/* ──────────────────────────────── Farmers ───────────────────────────────── */

export function useFarmers() {
  return useQuery({ queryKey: keys.coordinator.farmers(), queryFn: ({ signal }) => coordinatorApi.farmers(signal) });
}

export function useRegisterFarmer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (req: RegisterFarmerRequest) => coordinatorApi.registerFarmer(req),
    onSuccess: () => invalidateAll(client, [keys.coordinator.farmers(), keys.dashboards.coordinator()]),
  });
}

/* ──────────────────────────────── Harvests ──────────────────────────────── */

export function useHarvestList(params: HarvestListParams = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: keys.harvests.list(params),
    queryFn: ({ signal }) => harvestsApi.list(params, signal),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

function patchHarvestLists(client: QueryClient, harvestId: UUID, patch: (harvest: Harvest) => Harvest) {
  client.setQueriesData<Harvest[]>({ queryKey: keys.harvests.lists() }, (current) =>
    current?.map((harvest) => (harvest.id === harvestId ? patch(harvest) : harvest)),
  );
}

/** Inspection result; the queue updates instantly and rolls back if the API refuses. */
export function useVerifyHarvest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, req }: { id: UUID; req: HarvestVerifyRequest }) => harvestsApi.verify(id, req),
    onMutate: async ({ id, req }) => {
      await client.cancelQueries({ queryKey: keys.harvests.lists() });
      const snapshot = client.getQueriesData<Harvest[]>({ queryKey: keys.harvests.lists() });
      patchHarvestLists(client, id, (harvest) => ({
        ...harvest,
        grade: req.grade,
        quality_notes: req.quality_notes ?? harvest.quality_notes,
        quality_status: 'inspected',
      }));
      return { snapshot };
    },
    onError: (_error, _vars, context) => {
      for (const [queryKey, data] of context?.snapshot ?? []) client.setQueryData(queryKey, data);
    },
    onSuccess: (harvest) => {
      patchHarvestLists(client, harvest.id, () => harvest);
      client.setQueryData(keys.harvests.detail(harvest.id), harvest);
    },
    onSettled: (_data, _error, { id }) =>
      invalidateAll(client, [keys.harvests.lists(), keys.harvests.detail(id), keys.dashboards.coordinator()]),
  });
}

export function useUploadHarvestPhoto() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }: { id: UUID; file: File }) => harvestsApi.uploadPhoto(id, file, file.name),
    onSuccess: (photo, { id }) => {
      patchHarvestLists(client, id, (harvest) => ({ ...harvest, photos: [...harvest.photos, photo] }));
      return client.invalidateQueries({ queryKey: keys.harvests.detail(id) });
    },
  });
}

export function useDeleteHarvestPhoto() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, photoId }: { id: UUID; photoId: UUID }) => harvestsApi.deletePhoto(id, photoId),
    onSuccess: (_data, { id, photoId }) => {
      patchHarvestLists(client, id, (harvest) => ({ ...harvest, photos: harvest.photos.filter((photo) => photo.id !== photoId) }));
      return client.invalidateQueries({ queryKey: keys.harvests.detail(id) });
    },
  });
}

export function useCreateHarvest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (req: HarvestCreateRequest) => harvestsApi.create(req),
    onSuccess: (harvest) => {
      client.setQueryData(keys.harvests.detail(harvest.id), harvest);
      return invalidateAll(client, [keys.harvests.lists(), keys.coordinator.farmers(), keys.dashboards.coordinator(), keys.insights.all]);
    },
  });
}

export function useVoiceListing() {
  return useMutation({ mutationFn: (req: VoiceListingRequest) => aiApi.voiceListing(req) });
}

/* ───────────────────────────── Demands & matching ───────────────────────── */

export function useOpenDemands() {
  const params = { status: 'open' as const };
  return useQuery({ queryKey: keys.demands.list(params), queryFn: ({ signal }) => demandsApi.list(params, signal) });
}

export function useMatchPreview() {
  return useMutation({ mutationFn: (req: MatchPreviewRequest) => lotsApi.matchPreview(req) });
}

export function useMatchExplanation() {
  return useMutation({ mutationFn: (proposal: MatchProposal) => aiApi.matchExplanation({ proposal }) });
}

export function useCreateLot() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (req: LotCreateRequest) => lotsApi.create(req),
    onSuccess: (lot) => {
      client.setQueryData(keys.lots.detail(lot.id), lot);
      return invalidateAll(client, [keys.lots.lists(), keys.harvests.lists(), keys.demands.lists(), keys.dashboards.coordinator()]);
    },
  });
}

/* ─────────────────────────────────── Lots ───────────────────────────────── */

export function useLots(params: LotListParams = {}) {
  return useQuery({
    queryKey: keys.lots.list(params),
    queryFn: ({ signal }) => lotsApi.list(params, signal),
    placeholderData: keepPreviousData,
  });
}

export function useLot(id: UUID) {
  return useQuery({ queryKey: keys.lots.detail(id), queryFn: ({ signal }) => lotsApi.get(id, signal), enabled: Boolean(id) });
}

export function useLotTimeline(id: UUID) {
  return useQuery({ queryKey: keys.lots.timeline(id), queryFn: ({ signal }) => lotsApi.timeline(id, signal), enabled: Boolean(id) });
}

/** A non-persisted route and vehicle preview; cached like a read. */
export function useTransportPlan(lotId: UUID, enabled: boolean) {
  return useQuery({
    queryKey: keys.lots.transportPlan(lotId),
    queryFn: () => lotsApi.transportPlan(lotId),
    enabled: enabled && Boolean(lotId),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** The delivery record, or `null` until one exists (the API answers 404). */
export function useLotDelivery(lotId: UUID, enabled: boolean) {
  return useQuery({
    queryKey: keys.lots.delivery(lotId),
    queryFn: async ({ signal }) => {
      try {
        return await lotsApi.getDelivery(lotId, signal);
      } catch (error) {
        if (isApiError(error) && error.status === 404) return null;
        throw error;
      }
    },
    enabled: enabled && Boolean(lotId),
  });
}

export function useTransportRequest(id: UUID | null | undefined) {
  return useQuery({
    queryKey: keys.transport.request(id ?? ''),
    queryFn: ({ signal }) => transportApi.getRequest(id!, signal),
    enabled: Boolean(id),
  });
}

export function useSettlement(id: UUID | null | undefined) {
  return useQuery({
    queryKey: keys.settlements.detail(id ?? ''),
    queryFn: ({ signal }) => settlementsApi.get(id!, signal),
    enabled: Boolean(id),
  });
}

function lotKeys(lotId: UUID): QueryKey[] {
  return [keys.lots.detail(lotId), keys.lots.lists(), keys.harvests.lists(), keys.dashboards.coordinator()];
}

export function useOpenLot() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (lotId: UUID) => lotsApi.open(lotId),
    onSuccess: (lot) => {
      client.setQueryData(keys.lots.detail(lot.id), lot);
      return invalidateAll(client, lotKeys(lot.id));
    },
  });
}

export function useCancelLot() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (lotId: UUID) => lotsApi.cancel(lotId),
    onSuccess: (lot) => {
      client.setQueryData(keys.lots.detail(lot.id), lot);
      return invalidateAll(client, [...lotKeys(lot.id), keys.offers.lists()]);
    },
  });
}

/** Assisted consent for a lot member — the row flips immediately and rolls back on failure. */
export function useMemberConsent(lotId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, req }: { memberId: UUID; req: ConsentRequest }) => lotsApi.consent(lotId, memberId, req),
    onMutate: async ({ memberId, req }) => {
      await client.cancelQueries({ queryKey: keys.lots.detail(lotId), exact: true });
      const previous = client.getQueryData<Lot>(keys.lots.detail(lotId));
      if (previous) {
        client.setQueryData<Lot>(keys.lots.detail(lotId), {
          ...previous,
          members: previous.members.map((member) =>
            member.id === memberId ? { ...member, consent_status: req.decision, consented_at: new Date().toISOString() } : member,
          ),
        });
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) client.setQueryData(keys.lots.detail(lotId), context.previous);
    },
    onSuccess: (lot) => client.setQueryData(keys.lots.detail(lotId), lot),
    onSettled: () => invalidateAll(client, lotKeys(lotId)),
  });
}

export function useCreateTransportRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ lotId, notes }: { lotId: UUID; notes?: string | null }) => transportApi.createRequest({ lot_id: lotId, notes }),
    onSuccess: (request) => {
      client.setQueryData(keys.transport.request(request.id), request);
      return invalidateAll(client, [keys.transport.requests(), ...lotKeys(request.lot_id)]);
    },
  });
}

export function useRecordDelivery(lotId: UUID) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (req: DeliveryRecordRequest) => lotsApi.recordDelivery(lotId, req),
    onSuccess: (record) => {
      client.setQueryData(keys.lots.delivery(lotId), record);
      return invalidateAll(client, [...lotKeys(lotId), keys.settlements.all, keys.transport.requests()]);
    },
  });
}

/* ────────────────────────────────── Offers ──────────────────────────────── */

export function useLotOffers(lotId: UUID) {
  const params = { lot_id: lotId };
  return useQuery({
    queryKey: keys.offers.list(params),
    queryFn: ({ signal }) => offersApi.list(params, signal),
    enabled: Boolean(lotId),
  });
}

export function useOffer(id: UUID) {
  return useQuery({ queryKey: keys.offers.detail(id), queryFn: ({ signal }) => offersApi.get(id, signal), enabled: Boolean(id) });
}

export function useOfferBreakdown(offerId: UUID, harvestId?: UUID | null, enabled = true) {
  const params = { harvest_id: harvestId ?? null };
  return useQuery({
    queryKey: keys.offers.breakdown(offerId, params),
    queryFn: ({ signal }) => offersApi.breakdown(offerId, params, signal),
    enabled: enabled && Boolean(offerId),
    placeholderData: keepPreviousData,
  });
}

/** Whole-lot net proceeds for several offers at once (the cockpit's comparison). */
export function useOfferBreakdowns(offerIds: readonly UUID[]) {
  return useQueries({
    queries: offerIds.map((id) => ({
      queryKey: keys.offers.breakdown(id, {}),
      queryFn: ({ signal }: { signal: AbortSignal }) => offersApi.breakdown(id, {}, signal),
      staleTime: 60_000,
    })),
  });
}

function offerKeys(offer: Offer): QueryKey[] {
  const list: QueryKey[] = [keys.offers.lists(), keys.offers.detail(offer.id), keys.dashboards.coordinator(), keys.harvests.lists()];
  if (offer.lot_id) list.push(keys.lots.detail(offer.lot_id), keys.lots.lists());
  return list;
}

function useOfferMutation<V>(mutationFn: (vars: V) => Promise<Offer>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (offer) => {
      client.setQueryData(keys.offers.detail(offer.id), offer);
      return invalidateAll(client, offerKeys(offer));
    },
  });
}

export function useCounterOffer() {
  return useOfferMutation(({ id, req }: { id: UUID; req: CounterRequest }) => offersApi.counter(id, req));
}

export function useAcceptOffer() {
  return useOfferMutation(({ id, req }: { id: UUID; req?: OfferActionRequest }) => offersApi.accept(id, req));
}

export function useRejectOffer() {
  return useOfferMutation(({ id, req }: { id: UUID; req?: OfferActionRequest }) => offersApi.reject(id, req));
}

/** Assisted consent to a proposed deal on a farmer's behalf (audit-logged by the API). Optimistic. */
export function useOfferConsent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, memberId, req }: { id: UUID; memberId: UUID; req: ConsentRequest }) =>
      offersApi.consent(id, req, { member_id: memberId }),
    onMutate: async ({ id, memberId, req }) => {
      await client.cancelQueries({ queryKey: keys.offers.detail(id), exact: true });
      const previous = client.getQueryData<Offer>(keys.offers.detail(id));
      const patch = (offer: Offer): Offer => ({
        ...offer,
        consents: offer.consents.map((consent) =>
          consent.member_id === memberId ? { ...consent, decision: req.decision, decided_at: new Date().toISOString() } : consent,
        ),
      });
      if (previous) client.setQueryData(keys.offers.detail(id), patch(previous));
      const lists = client.getQueriesData<Offer[]>({ queryKey: keys.offers.lists() });
      client.setQueriesData<Offer[]>({ queryKey: keys.offers.lists() }, (current) =>
        current?.map((offer) => (offer.id === id ? patch(offer) : offer)),
      );
      return { previous, lists };
    },
    onError: (_error, { id }, context) => {
      if (context?.previous) client.setQueryData(keys.offers.detail(id), context.previous);
      for (const [queryKey, data] of context?.lists ?? []) client.setQueryData(queryKey, data);
    },
    onSuccess: (offer) => {
      client.setQueryData(keys.offers.detail(offer.id), offer);
      return invalidateAll(client, offerKeys(offer));
    },
  });
}

/** Rules-based counter-offer price (AI words the rationale). Fetched on demand. */
export function useCounterSuggestion(offerId: UUID, harvestId: UUID | null, enabled: boolean) {
  const params = { harvest_id: harvestId };
  return useQuery({
    queryKey: keys.ai.counterSuggestion(offerId, params),
    queryFn: () => aiApi.counterSuggestion(offerId, params),
    enabled: enabled && Boolean(offerId),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
