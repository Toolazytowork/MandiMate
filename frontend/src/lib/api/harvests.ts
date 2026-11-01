import type {
  Harvest,
  HarvestCreateRequest,
  HarvestPhoto,
  HarvestStatus,
  HarvestUpdateRequest,
  HarvestVerifyRequest,
  JourneyStep,
  SellingOptions,
  UUID,
} from '@/types/api';

import { apiFetch } from './client';

export interface HarvestListParams {
  status?: HarvestStatus | null;
  crop_id?: UUID | null;
  farmer_id?: UUID | null;
  limit?: number | null;
}

export const harvestsApi = {
  list: (params: HarvestListParams = {}, signal?: AbortSignal) =>
    apiFetch<Harvest[]>('/harvests', { query: { ...params }, signal }),
  get: (id: UUID, signal?: AbortSignal) => apiFetch<Harvest>(`/harvests/${id}`, { signal }),
  create: (req: HarvestCreateRequest) => apiFetch<Harvest>('/harvests', { method: 'POST', body: req }),
  update: (id: UUID, req: HarvestUpdateRequest) => apiFetch<Harvest>(`/harvests/${id}`, { method: 'PATCH', body: req }),
  cancel: (id: UUID) => apiFetch<Harvest>(`/harvests/${id}/cancel`, { method: 'POST' }),
  /** Coordinator inspection: sets the grade and moves quality_status to `inspected`. */
  verify: (id: UUID, req: HarvestVerifyRequest) =>
    apiFetch<Harvest>(`/harvests/${id}/verify`, { method: 'POST', body: req }),
  /** JPEG / PNG / WebP up to 8 MB, sent as multipart field `file`. */
  uploadPhoto: (id: UUID, file: Blob, filename?: string) => {
    const form = new FormData();
    if (filename) form.append('file', file, filename);
    else form.append('file', file);
    return apiFetch<HarvestPhoto>(`/harvests/${id}/photos`, { method: 'POST', body: form });
  },
  deletePhoto: (id: UUID, photoId: UUID) =>
    apiFetch<void>(`/harvests/${id}/photos/${photoId}`, { method: 'DELETE' }),
  options: (id: UUID, signal?: AbortSignal) => apiFetch<SellingOptions>(`/harvests/${id}/options`, { signal }),
  timeline: (id: UUID, signal?: AbortSignal) => apiFetch<JourneyStep[]>(`/harvests/${id}/timeline`, { signal }),
};
