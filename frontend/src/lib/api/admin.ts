import type { AuditEntry, Role, User, UUID, VerificationStatus, VerifyUserRequest } from '@/types/api';

import { apiFetch } from './client';

export interface AdminUserListParams {
  role?: Role | null;
  verification_status?: VerificationStatus | null;
  /** Free-text search over name, email, phone and organisation. */
  q?: string | null;
  limit?: number | null;
}

export interface AuditLogParams {
  limit?: number | null;
}

export const adminApi = {
  users: (params: AdminUserListParams = {}, signal?: AbortSignal) =>
    apiFetch<User[]>('/admin/users', { query: { ...params }, signal }),
  verifyUser: (id: UUID, req: VerifyUserRequest) =>
    apiFetch<User>(`/admin/users/${id}/verification`, { method: 'POST', body: req }),
  auditLog: (params: AuditLogParams = {}, signal?: AbortSignal) =>
    apiFetch<AuditEntry[]>('/admin/audit-log', { query: { ...params }, signal }),
};
