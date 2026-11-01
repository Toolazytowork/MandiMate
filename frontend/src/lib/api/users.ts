import type { ChangePasswordRequest, UpdateProfileRequest, User, VerificationRequest } from '@/types/api';

import { apiFetch } from './client';

export const usersApi = {
  updateMe: (req: UpdateProfileRequest) => apiFetch<User>('/users/me', { method: 'PATCH', body: req }),
  changePassword: (req: ChangePasswordRequest) => apiFetch<void>('/users/me/password', { method: 'POST', body: req }),
  /** Buyers and transporters only; moves verification_status to `pending`. */
  requestVerification: (req: VerificationRequest) =>
    apiFetch<User>('/users/me/verification-request', { method: 'POST', body: req }),
};
