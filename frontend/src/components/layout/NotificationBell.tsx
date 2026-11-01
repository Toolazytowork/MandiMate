import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Bell } from 'lucide-react';
import { notificationsApi, keys } from '@/lib/api';
import { cn } from '@/lib/cn';

const POLL_MS = 60_000;

/** Bell linking to /app/notifications with a gold unread badge, refreshed every minute. */
export function NotificationBell({ className }: { className?: string }) {
  const { t } = useTranslation('common');
  const { data } = useQuery({
    queryKey: keys.notifications.unreadCount(),
    queryFn: ({ signal }) => notificationsApi.unreadCount(signal),
    refetchInterval: POLL_MS,
  });
  const count = data?.count ?? 0;
  const label =
    count > 0
      ? t('a11y.unreadNotifications', { count, defaultValue: `${count} unread notifications` })
      : t('a11y.notifications', { defaultValue: 'Notifications' });

  return (
    <Link
      to="/app/notifications"
      aria-label={label}
      className={cn(
        'relative inline-flex size-10 items-center justify-center rounded-sm text-ink/75 transition-colors hover:bg-ink/[0.04] hover:text-ink',
        className,
      )}
    >
      <Bell aria-hidden="true" strokeWidth={1.25} className="size-5" />
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="absolute end-1 top-1 inline-flex h-4 min-w-4 animate-pop-in items-center justify-center rounded-full bg-gold-700 px-1 text-[9px] font-medium tabular-nums leading-none text-ivory ring-2 ring-ivory"
        >
          {count > 9 ? '9+' : count}
        </span>
      ) : null}
    </Link>
  );
}
