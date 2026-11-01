/**
 * Server state for the farmer workspace. Every hook uses the shared API objects and the
 * hierarchical query keys in `@/lib/api/keys`, so a mutation here refreshes every screen that shows
 * the same harvest, offer or lot.
 */
import { useCallback, useMemo } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  aiApi,
  calculatorApi,
  cropsApi,
  dashboardsApi,
  demandsApi,
  earningsApi,
  harvestsApi,
  isApiError,
  keys,
  lotsApi,
  offersApi,
  settlementsApi,
  transportApi,
} from '@/lib/api';
import type { HarvestListParams, LotListParams, OfferListParams } from '@/lib/api';
import type {
  ConsentRequest,
  CounterRequest,
  Crop,
  Demand,
  Harvest,
  HarvestCreateRequest,
  HarvestPhoto,
  HarvestUpdateRequest,
  JoinLotRequest,
  Language,
  Lot,
  NetProceeds,
  NetProceedsCalcRequest,
  Offer,
  UUID,
  VoiceListingRequest,
} from '@/types/api';

import { localCropName } from './lib';

/* ───────────────────────────── Shared bits ─────────────────────────── */

const MINUTE = 60_000;

/** Toasts an API failure in plain words; returns the handler for `onError`. */
export function useErrorToast(): (error: unknown) => void {
  const { t } = useTranslation('farmer');
  return useCallback(
    (error: unknown) => {
      if (isApiError(error)) {
        if (error.isNetworkError) toast.error(t('common:errors.network'));
        else if (error.status === 409) toast.error(error.detail || t('common:errors.conflict'));
        else toast.error(error.detail);
      } else {
        toast.error(t('common:errors.generic'));
      }
    },
    [t],
  );
}

/** Everything a deal decision can change for the farmer: offers, harvests, lots, home, AI advice. */
export function invalidateDeals(queryClient: QueryClient): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: keys.offers.all }),
    queryClient.invalidateQueries({ queryKey: keys.harvests.all }),
    queryClient.invalidateQueries({ queryKey: keys.lots.all }),
    queryClient.invalidateQueries({ queryKey: keys.dashboards.farmer() }),
    queryClient.invalidateQueries({ queryKey: [...keys.ai.all, 'deal-advice'] }),
    queryClient.invalidateQueries({ queryKey: keys.notifications.all }),
  ]);
}

/* ─────────────────────────── Catalogue & home ──────────────────────── */

export function useCrops() {
  return useQuery({
    queryKey: keys.crops.list(),
    queryFn: ({ signal }) => cropsApi.list(signal),
    staleTime: 60 * MINUTE,
  });
}

/**
 * Crop names in the farmer's language. The API sends English names; the catalogue carries the
 * Hindi and Telugu names, so look them up by id (or by English name) and fall back gracefully.
 */
export function useCropName(lang: Language): (cropId: string | null | undefined, fallback: string | null | undefined) => string {
  const crops = useCrops();
  const byId = useMemo(() => new Map((crops.data ?? []).map((crop) => [crop.id, crop])), [crops.data]);
  const byName = useMemo(
    () => new Map((crops.data ?? []).map((crop) => [crop.name.trim().toLowerCase(), crop])),
    [crops.data],
  );
  return useCallback(
    (cropId, fallback) => {
      const crop: Crop | undefined = (cropId ? byId.get(cropId) : undefined) ?? (fallback ? byName.get(fallback.trim().toLowerCase()) : undefined);
      if (crop) return localCropName(crop, lang);
      return fallback ?? '';
    },
    [byId, byName, lang],
  );
}

export function useFarmerDashboard() {
  return useQuery({
    queryKey: keys.dashboards.farmer(),
    queryFn: ({ signal }) => dashboardsApi.farmer(signal),
  });
}

/* ───────────────────────────── Harvests ────────────────────────────── */

export function useMyHarvests(params: HarvestListParams = {}) {
  return useQuery({
    queryKey: keys.harvests.list(params),
    queryFn: ({ signal }) => harvestsApi.list(params, signal),
  });
}

export function useHarvest(id: UUID | undefined) {
  return useQuery({
    queryKey: keys.harvests.detail(id ?? ''),
    queryFn: ({ signal }) => harvestsApi.get(id ?? '', signal),
    enabled: Boolean(id),
  });
}

export function useHarvestOptions(id: UUID | undefined) {
  return useQuery({
    queryKey: keys.harvests.options(id ?? ''),
    queryFn: ({ signal }) => harvestsApi.options(id ?? '', signal),
    enabled: Boolean(id),
  });
}

export function useHarvestTimeline(id: UUID | undefined) {
  return useQuery({
    queryKey: keys.harvests.timeline(id ?? ''),
    queryFn: ({ signal }) => harvestsApi.timeline(id ?? '', signal),
    enabled: Boolean(id),
  });
}

export function useCreateHarvest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: HarvestCreateRequest) => harvestsApi.create(req),
    onSuccess: (harvest) => {
      queryClient.setQueryData(keys.harvests.detail(harvest.id), harvest);
      void queryClient.invalidateQueries({ queryKey: keys.harvests.lists() });
      void queryClient.invalidateQueries({ queryKey: keys.dashboards.farmer() });
      void queryClient.invalidateQueries({ queryKey: keys.lots.lists() });
    },
  });
}

export function useUpdateHarvest(id: UUID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: HarvestUpdateRequest) => harvestsApi.update(id, req),
    onSuccess: (harvest) => {
      queryClient.setQueryData(keys.harvests.detail(id), harvest);
      void queryClient.invalidateQueries({ queryKey: keys.harvests.all });
      void queryClient.invalidateQueries({ queryKey: keys.dashboards.farmer() });
      void queryClient.invalidateQueries({ queryKey: [...keys.ai.all, 'deal-advice', id] });
    },
  });
}

export function useCancelHarvest(id: UUID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => harvestsApi.cancel(id),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: keys.harvests.detail(id), exact: true });
      const previous = queryClient.getQueryData<Harvest>(keys.harvests.detail(id));
      if (previous) queryClient.setQueryData<Harvest>(keys.harvests.detail(id), { ...previous, status: 'cancelled' });
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(keys.harvests.detail(id), context.previous);
    },
    onSuccess: (harvest) => queryClient.setQueryData(keys.harvests.detail(id), harvest),
    onSettled: () => invalidateDeals(queryClient),
  });
}

/** Uploads one photo and adds it to the cached harvest so it shows at once. */
export function useUploadHarvestPhoto(id: UUID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => harvestsApi.uploadPhoto(id, file, file.name),
    onSuccess: (photo: HarvestPhoto) => {
      queryClient.setQueryData<Harvest>(keys.harvests.detail(id), (current) =>
        current && !current.photos.some((existing) => existing.id === photo.id)
          ? { ...current, photos: [...current.photos, photo] }
          : current,
      );
      void queryClient.invalidateQueries({ queryKey: keys.harvests.lists() });
    },
  });
}

export function useDeleteHarvestPhoto(id: UUID) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (photoId: UUID) => harvestsApi.deletePhoto(id, photoId),
    onMutate: async (photoId) => {
      await queryClient.cancelQueries({ queryKey: keys.harvests.detail(id), exact: true });
      const previous = queryClient.getQueryData<Harvest>(keys.harvests.detail(id));
      if (previous) {
        queryClient.setQueryData<Harvest>(keys.harvests.detail(id), {
          ...previous,
          photos: previous.photos.filter((photo) => photo.id !== photoId),
        });
      }
      return { previous };
    },
    onError: (_error, _photoId, context) => {
      if (context?.previous) queryClient.setQueryData(keys.harvests.detail(id), context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.harvests.detail(id), exact: true }),
  });
}

/* ──────────────────────────────── AI ───────────────────────────────── */

export function useVoiceListing() {
  return useMutation({
    mutationFn: (req: VoiceListingRequest) => aiApi.voiceListing(req),
  });
}

/** The deal assistant's explanation of a harvest's options. `refetch()` asks for a fresh one. */
export function useDealAdvice(harvestId: UUID | null | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.ai.dealAdvice(harvestId ?? ''),
    queryFn: () => aiApi.dealAdvice({ harvest_id: harvestId ?? '' }),
    enabled: Boolean(harvestId) && enabled,
    staleTime: 10 * MINUTE,
    refetchOnWindowFocus: false,
  });
}

export function useCounterSuggestion(offerId: UUID, harvestId: UUID | null | undefined, enabled: boolean) {
  const params = { harvest_id: harvestId ?? null };
  return useQuery({
    queryKey: keys.ai.counterSuggestion(offerId, params),
    queryFn: () => aiApi.counterSuggestion(offerId, params),
    enabled,
    staleTime: 5 * MINUTE,
    refetchOnWindowFocus: false,
  });
}

/* ────────────────────────────── Offers ─────────────────────────────── */

export function useOffers(params: OfferListParams = {}, enabled = true) {
  return useQuery({
    queryKey: keys.offers.list(params),
    queryFn: ({ signal }) => offersApi.list(params, signal),
    enabled,
  });
}

export function useOffer(id: UUID | undefined) {
  return useQuery({
    queryKey: keys.offers.detail(id ?? ''),
    queryFn: ({ signal }) => offersApi.get(id ?? '', signal),
    enabled: Boolean(id),
  });
}

/** The farmer's own share of an offer, from gross to net. */
export function useOfferBreakdown(id: UUID | null | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.offers.breakdown(id ?? ''),
    queryFn: ({ signal }) => offersApi.breakdown(id ?? '', {}, signal),
    enabled: Boolean(id) && enabled,
    retry: false,
  });
}

/** Net breakdowns for a list of offers, keyed by offer id (missing while loading or on error). */
export function useOfferBreakdowns(offerIds: readonly UUID[]): { byId: Map<UUID, NetProceeds>; loading: Set<UUID> } {
  const results = useQueries({
    queries: offerIds.map((id) => ({
      queryKey: keys.offers.breakdown(id),
      queryFn: ({ signal }: { signal: AbortSignal }) => offersApi.breakdown(id, {}, signal),
      retry: false,
      staleTime: MINUTE,
    })),
  });
  const byId = new Map<UUID, NetProceeds>();
  const loading = new Set<UUID>();
  results.forEach((result, index) => {
    const id = offerIds[index];
    if (!id) return;
    if (result.data) byId.set(id, result.data);
    else if (result.isPending) loading.add(id);
  });
  return { byId, loading };
}

function setOffer(queryClient: QueryClient, offer: Offer) {
  queryClient.setQueryData(keys.offers.detail(offer.id), offer);
}

export function useAcceptOffer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ offerId, message }: { offerId: UUID; message?: string | null }) => offersApi.accept(offerId, { message }),
    onSuccess: (offer) => setOffer(queryClient, offer),
    onSettled: () => invalidateDeals(queryClient),
  });
}

export function useCounterOffer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ offerId, req }: { offerId: UUID; req: CounterRequest }) => offersApi.counter(offerId, req),
    onSuccess: (offer) => setOffer(queryClient, offer),
    onSettled: () => invalidateDeals(queryClient),
  });
}

export function useRejectOffer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ offerId, message }: { offerId: UUID; message?: string | null }) => offersApi.reject(offerId, { message }),
    onSuccess: (offer) => setOffer(queryClient, offer),
    onSettled: () => invalidateDeals(queryClient),
  });
}

/** Agree or decline a pooled deal. The farmer's row flips at once; rolled back if the API refuses. */
export function useOfferConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ offerId, req }: { offerId: UUID; req: ConsentRequest }) => offersApi.consent(offerId, req),
    onMutate: async ({ offerId, req }) => {
      const key = keys.offers.detail(offerId);
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      const previous = queryClient.getQueryData<Offer>(key);
      if (previous) {
        queryClient.setQueryData<Offer>(key, {
          ...previous,
          consents: previous.consents.map((consent) =>
            consent.is_mine ? { ...consent, decision: req.decision, decided_at: new Date().toISOString() } : consent,
          ),
        });
      }
      return { previous, key };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous);
    },
    onSuccess: (offer) => setOffer(queryClient, offer),
    onSettled: () => invalidateDeals(queryClient),
  });
}

/* ─────────────────────────────── Lots ──────────────────────────────── */

export function useLots(params: LotListParams = {}) {
  return useQuery({
    queryKey: keys.lots.list(params),
    queryFn: ({ signal }) => lotsApi.list(params, signal),
  });
}

export function useLot(id: UUID | undefined) {
  return useQuery({
    queryKey: keys.lots.detail(id ?? ''),
    queryFn: ({ signal }) => lotsApi.get(id ?? '', signal),
    enabled: Boolean(id),
  });
}

export function useLotTimeline(id: UUID | null | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.lots.timeline(id ?? ''),
    queryFn: ({ signal }) => lotsApi.timeline(id ?? '', signal),
    enabled: Boolean(id) && enabled,
  });
}

/** The delivery record, or `null` until the buyer's check has been recorded (the API answers 404). */
export function useLotDelivery(id: UUID | null | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.lots.delivery(id ?? ''),
    queryFn: async ({ signal }) => {
      try {
        return await lotsApi.getDelivery(id ?? '', signal);
      } catch (error) {
        if (isApiError(error) && error.status === 404) return null;
        throw error;
      }
    },
    enabled: Boolean(id) && enabled,
  });
}

export function useTransportRequest(id: UUID | null | undefined) {
  return useQuery({
    queryKey: keys.transport.request(id ?? ''),
    queryFn: ({ signal }) => transportApi.getRequest(id ?? '', signal),
    enabled: Boolean(id),
    retry: false,
  });
}

function patchLotMember(lot: Lot, memberId: UUID, decision: ConsentRequest['decision']): Lot {
  return {
    ...lot,
    members: lot.members.map((member) =>
      member.id === memberId ? { ...member, consent_status: decision, consented_at: new Date().toISOString() } : member,
    ),
  };
}

/** Say yes or no to being pooled into a forming lot (optimistic on the lot page). */
export function useLotConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ lotId, memberId, req }: { lotId: UUID; memberId: UUID; req: ConsentRequest }) =>
      lotsApi.consent(lotId, memberId, req),
    onMutate: async ({ lotId, memberId, req }) => {
      const key = keys.lots.detail(lotId);
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      const previous = queryClient.getQueryData<Lot>(key);
      if (previous) queryClient.setQueryData<Lot>(key, patchLotMember(previous, memberId, req.decision));
      return { previous, key };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous);
    },
    onSuccess: (lot) => queryClient.setQueryData(keys.lots.detail(lot.id), lot),
    onSettled: () => invalidateDeals(queryClient),
  });
}

export function useJoinLot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ lotId, req }: { lotId: UUID; req: JoinLotRequest }) => lotsApi.join(lotId, req),
    onSuccess: (lot) => queryClient.setQueryData(keys.lots.detail(lot.id), lot),
    onSettled: () => invalidateDeals(queryClient),
  });
}

/* ──────────────────────── Money: sales & earnings ──────────────────── */

export function useMySettlements() {
  return useQuery({
    queryKey: keys.settlements.list(),
    queryFn: ({ signal }) => settlementsApi.list({}, signal),
  });
}

export function useEarnings() {
  return useQuery({
    queryKey: keys.earnings.detail(),
    queryFn: ({ signal }) => earningsApi.get(signal),
  });
}

/* ──────────────────────────── Buyer demand ─────────────────────────── */

export function useOpenDemands() {
  return useQuery({
    queryKey: keys.demands.list({ status: 'open' }),
    queryFn: ({ signal }) => demandsApi.list({ status: 'open' }, signal),
  });
}

/**
 * A rough net-per-kg for each demand that names a target price: what a pooled lot filling the
 * whole order would keep after transport (by distance, when both places are known), loading,
 * typical rejection and the payment wait. Uses the public calculator — the same engine as offers.
 */
export function useDemandNetEstimates(
  demands: readonly Demand[],
  distanceFor: (demand: Demand) => number | null,
): Map<UUID, NetProceeds> {
  const requests = demands
    .filter((demand) => typeof demand.target_price_per_kg === 'number' && demand.target_price_per_kg > 0)
    .map((demand) => {
      const req: NetProceedsCalcRequest = {
        quantity_kg: demand.quantity_kg,
        price_per_kg: demand.target_price_per_kg ?? 0,
        distance_km: distanceFor(demand),
        payment_terms_days: demand.payment_terms_days,
      };
      return { id: demand.id, req };
    });
  const results = useQueries({
    queries: requests.map(({ id, req }) => ({
      queryKey: [...keys.calculator.all, 'demand-estimate', id, req] as const,
      queryFn: () => calculatorApi.netProceeds(req),
      staleTime: 10 * MINUTE,
      retry: false,
    })),
  });
  const map = new Map<UUID, NetProceeds>();
  results.forEach((result, index) => {
    const request = requests[index];
    if (request && result.data) map.set(request.id, result.data);
  });
  return map;
}
