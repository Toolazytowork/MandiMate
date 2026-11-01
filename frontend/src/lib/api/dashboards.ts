import type {
  AdminOverview,
  BuyerDashboard,
  CoordinatorDashboard,
  FarmerDashboard,
  TransporterDashboard,
} from '@/types/api';

import { apiFetch } from './client';

export const dashboardsApi = {
  farmer: (signal?: AbortSignal) => apiFetch<FarmerDashboard>('/dashboard/farmer', { signal }),
  buyer: (signal?: AbortSignal) => apiFetch<BuyerDashboard>('/dashboard/buyer', { signal }),
  transporter: (signal?: AbortSignal) => apiFetch<TransporterDashboard>('/dashboard/transporter', { signal }),
  coordinator: (signal?: AbortSignal) => apiFetch<CoordinatorDashboard>('/dashboard/coordinator', { signal }),
  admin: (signal?: AbortSignal) => apiFetch<AdminOverview>('/dashboard/admin', { signal }),
};
