import type {
  AiStatus,
  AiText,
  CounterSuggestion,
  DealAdvice,
  DealAdviceRequest,
  MatchExplanationRequest,
  UUID,
  VoiceDraft,
  VoiceListingRequest,
} from '@/types/api';

import { apiFetch } from './client';

export interface CounterSuggestionParams {
  /** For lot offers: compute the floor price for this member's harvest. */
  harvest_id?: UUID | null;
}

export const aiApi = {
  status: (signal?: AbortSignal) => apiFetch<AiStatus>('/ai/status', { signal }),
  voiceListing: (req: VoiceListingRequest) =>
    apiFetch<VoiceDraft>('/ai/voice-listing', { method: 'POST', body: req }),
  dealAdvice: (req: DealAdviceRequest) => apiFetch<DealAdvice>('/ai/deal-advice', { method: 'POST', body: req }),
  counterSuggestion: (offerId: UUID, params: CounterSuggestionParams = {}) =>
    apiFetch<CounterSuggestion>(`/ai/offers/${offerId}/counter-suggestion`, { method: 'POST', query: { ...params } }),
  matchExplanation: (req: MatchExplanationRequest) =>
    apiFetch<AiText>('/ai/match-explanation', { method: 'POST', body: req }),
};
