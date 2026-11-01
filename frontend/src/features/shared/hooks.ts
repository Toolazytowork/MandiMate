/**
 * Server state for the screens every role shares: notifications, profile & password, AI status,
 * disputes and verification requests.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { aiApi, disputesApi, keys, lotsApi, notificationsApi, usersApi } from '@/lib/api';
import type { DisputeListParams, NotificationListParams } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type {
  ChangePasswordRequest,
  Dispute,
  DisputeCreateRequest,
  Notification,
  UnreadCount,
  UpdateProfileRequest,
  UUID,
  VerificationRequest,
} from '@/types/api';

const POLL_MS = 60_000;

/* ───────────────────────────── Notifications ───────────────────────────── */

export function useNotifications(params: NotificationListParams) {
  return useQuery({
    queryKey: keys.notifications.list(params),
    queryFn: ({ signal }) => notificationsApi.list(params, signal),
    refetchInterval: POLL_MS,
  });
}

/** Shares its cache entry with the topbar bell. */
export function useUnreadCount() {
  return useQuery({
    queryKey: keys.notifications.unreadCount(),
    queryFn: ({ signal }) => notificationsApi.unreadCount(signal),
    refetchInterval: POLL_MS,
  });
}

interface NotificationSnapshot {
  lists: [readonly unknown[], Notification[] | undefined][];
  count: UnreadCount | undefined;
}

function useNotificationCache() {
  const queryClient = useQueryClient();

  const snapshot = async (): Promise<NotificationSnapshot> => {
    await queryClient.cancelQueries({ queryKey: keys.notifications.all });
    return {
      lists: queryClient.getQueriesData<Notification[]>({ queryKey: keys.notifications.lists() }),
      count: queryClient.getQueryData<UnreadCount>(keys.notifications.unreadCount()),
    };
  };

  const restore = (previous: NotificationSnapshot | undefined) => {
    if (!previous) return;
    for (const [key, data] of previous.lists) queryClient.setQueryData(key, data);
    queryClient.setQueryData(keys.notifications.unreadCount(), previous.count);
  };

  /** Marks matching notifications read in every cached list; returns how many were unread. */
  const markInCache = (matches: (notification: Notification) => boolean): number => {
    const readAt = new Date().toISOString();
    const unreadIds = new Set<UUID>();
    queryClient.setQueriesData<Notification[]>({ queryKey: keys.notifications.lists() }, (list) =>
      list?.map((notification) => {
        if (notification.read_at || !matches(notification)) return notification;
        unreadIds.add(notification.id);
        return { ...notification, read_at: readAt };
      }),
    );
    return unreadIds.size;
  };

  const settle = () => queryClient.invalidateQueries({ queryKey: keys.notifications.all });

  return { queryClient, snapshot, restore, markInCache, settle };
}

/** Optimistically marks one notification read (the bell count drops at once). */
export function useMarkNotificationRead() {
  const cache = useNotificationCache();
  return useMutation({
    mutationFn: (id: UUID) => notificationsApi.markRead(id),
    onMutate: async (id) => {
      const previous = await cache.snapshot();
      const changed = cache.markInCache((notification) => notification.id === id);
      if (changed > 0 && previous.count) {
        cache.queryClient.setQueryData<UnreadCount>(keys.notifications.unreadCount(), {
          count: Math.max(0, previous.count.count - changed),
        });
      }
      return previous;
    },
    onError: (_error, _id, previous) => cache.restore(previous),
    onSettled: () => cache.settle(),
  });
}

/** Optimistically marks everything read. */
export function useMarkAllNotificationsRead() {
  const cache = useNotificationCache();
  return useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onMutate: async () => {
      const previous = await cache.snapshot();
      cache.markInCache(() => true);
      cache.queryClient.setQueryData<UnreadCount>(keys.notifications.unreadCount(), { count: 0 });
      return previous;
    },
    onError: (_error, _variables, previous) => cache.restore(previous),
    onSettled: () => cache.settle(),
  });
}

/* ──────────────────────────── Profile & password ─────────────────────────── */

export function useUpdateProfile() {
  const { setUser } = useAuth();
  return useMutation({
    mutationFn: (req: UpdateProfileRequest) => usersApi.updateMe(req),
    onSuccess: (user) => setUser(user),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (req: ChangePasswordRequest) => usersApi.changePassword(req),
  });
}

/* ──────────────────────────────── AI status ──────────────────────────────── */

export function useAiStatus() {
  return useQuery({
    queryKey: keys.ai.status(),
    queryFn: ({ signal }) => aiApi.status(signal),
    staleTime: 5 * 60_000,
  });
}

/* ──────────────────────────────── Disputes ───────────────────────────────── */

export function useDisputes(params: DisputeListParams = {}) {
  return useQuery({
    queryKey: keys.disputes.list(params),
    queryFn: ({ signal }) => disputesApi.list(params, signal),
  });
}

/** Lots the signed-in user takes part in — the choices when raising a dispute. */
export function useMyLots(enabled = true) {
  return useQuery({
    queryKey: keys.lots.list({ mine: true }),
    queryFn: ({ signal }) => lotsApi.list({ mine: true }, signal),
    enabled,
  });
}

export function useCreateDispute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: DisputeCreateRequest) => disputesApi.create(req),
    onSuccess: (dispute) => {
      // Show it immediately in every cached list it belongs to, newest first.
      queryClient.setQueriesData<Dispute[]>({ queryKey: keys.disputes.lists() }, (list) =>
        list && !list.some((item) => item.id === dispute.id) ? [dispute, ...list] : list,
      );
      void queryClient.invalidateQueries({ queryKey: keys.disputes.all });
      // A dispute moves the lot's settlement to `disputed`.
      void queryClient.invalidateQueries({ queryKey: keys.settlements.all });
      void queryClient.invalidateQueries({ queryKey: keys.lots.detail(dispute.lot_id) });
      void queryClient.invalidateQueries({ queryKey: keys.dashboards.all });
    },
  });
}

/* ────────────────────────────── Verification ─────────────────────────────── */

export function useRequestVerification() {
  const { setUser } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: VerificationRequest) => usersApi.requestVerification(req),
    onSuccess: (user) => {
      setUser(user);
      void queryClient.invalidateQueries({ queryKey: keys.dashboards.all });
    },
  });
}
