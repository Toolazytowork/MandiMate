import type { Notification, UnreadCount, UUID } from '@/types/api';

import { apiFetch } from './client';

export interface NotificationListParams {
  unread_only?: boolean | null;
  limit?: number | null;
}

export const notificationsApi = {
  list: (params: NotificationListParams = {}, signal?: AbortSignal) =>
    apiFetch<Notification[]>('/notifications', { query: { ...params }, signal }),
  unreadCount: (signal?: AbortSignal) => apiFetch<UnreadCount>('/notifications/unread-count', { signal }),
  markRead: (id: UUID) => apiFetch<Notification>(`/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => apiFetch<void>('/notifications/read-all', { method: 'POST' }),
};
