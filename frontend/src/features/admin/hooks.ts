/** Server state for the admin console: overview, users & verification, audit log. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { adminApi, dashboardsApi, keys } from '@/lib/api';
import type { AdminUserListParams, AuditLogParams } from '@/lib/api';
import type { User, UUID, VerifyUserRequest } from '@/types/api';

export function useAdminOverview() {
  return useQuery({
    queryKey: keys.dashboards.admin(),
    queryFn: ({ signal }) => dashboardsApi.admin(signal),
  });
}

export function useAdminUsers(params: AdminUserListParams) {
  return useQuery({
    queryKey: keys.admin.users(params),
    queryFn: ({ signal }) => adminApi.users(params, signal),
    placeholderData: keepPreviousData,
  });
}

export function useVerifyUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, req }: { id: UUID; req: VerifyUserRequest }) => adminApi.verifyUser(id, req),
    onSuccess: (user: User) => {
      queryClient.setQueriesData<User[]>({ queryKey: ['admin', 'users'] }, (list) =>
        list?.map((item) => (item.id === user.id ? user : item)),
      );
      void queryClient.invalidateQueries({ queryKey: keys.admin.all });
      void queryClient.invalidateQueries({ queryKey: keys.dashboards.admin() });
    },
  });
}

export function useAuditLog(params: AuditLogParams) {
  return useQuery({
    queryKey: keys.admin.auditLog(params),
    queryFn: ({ signal }) => adminApi.auditLog(params, signal),
  });
}
