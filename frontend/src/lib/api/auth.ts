import type { AuthResponse, LoginRequest, SignupRequest, User } from '@/types/api';

import { apiFetch, refreshSession } from './client';

export const authApi = {
  signup: (req: SignupRequest) => apiFetch<AuthResponse>('/auth/signup', { method: 'POST', body: req }),
  login: (req: LoginRequest) => apiFetch<AuthResponse>('/auth/login', { method: 'POST', body: req }),
  /** Rotates the session cookies. Shares the single in-flight refresh used by the 401 handler. */
  refresh: (): Promise<AuthResponse> => refreshSession(),
  logout: () => apiFetch<void>('/auth/logout', { method: 'POST' }),
  me: (signal?: AbortSignal) => apiFetch<User>('/auth/me', { signal }),
};
