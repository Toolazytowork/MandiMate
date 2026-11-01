import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import {
  Bell,
  BellOff,
  CalendarClock,
  CheckCheck,
  FileSignature,
  HandCoins,
  IndianRupee,
  Layers,
  PackageCheck,
  Scale,
  ShieldCheck,
  Truck,
  type LucideIcon,
} from 'lucide-react';

import { PageHeader, QueryState , useUiLanguage } from '@/components/domain';
import { Badge, Button, SegmentedControl, toast } from '@/components/ui';
import { StaggerGroup, StaggerItem } from '@/components/motion';
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications, useUnreadCount } from '@/features/shared/hooks';
import { apiErrorMessage } from '@/features/shared/forms';
import { cn } from '@/lib/cn';
import { formatDate, formatRelative, formatTime } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { Notification, NotificationType } from '@/types/api';

const TYPE_ICONS: Record<NotificationType, LucideIcon> = {
  offer: HandCoins,
  consent: FileSignature,
  lot: Layers,
  pickup: Truck,
  delivery: PackageCheck,
  payment: IndianRupee,
  harvest_deadline: CalendarClock,
  dispute: Scale,
  verification: ShieldCheck,
  system: Bell,
};

const TYPE_TONES: Partial<Record<NotificationType, string>> = {
  offer: 'text-gold-700',
  payment: 'text-forest-700',
  dispute: 'text-danger-ink',
  harvest_deadline: 'text-warning-ink',
};

type Filter = 'unread' | 'all';

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export default function NotificationsPage() {
  const { t } = useTranslation('shared');
  const lang = useUiLanguage();
  const locale = lang;
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const query = useNotifications({ unread_only: filter === 'unread' ? true : undefined, limit: 100 });
  const unread = useUnreadCount();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const unreadCount = unread.data?.count ?? 0;

  const groupLabel = (iso: string) => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (dayKey(iso) === dayKey(today.toISOString())) return t('notifications.today', { defaultValue: 'Today' });
    if (dayKey(iso) === dayKey(yesterday.toISOString())) return t('notifications.yesterday', { defaultValue: 'Yesterday' });
    return formatDate(iso, { locale });
  };

  const open = (n: Notification) => {
    if (!n.read_at) markRead.mutate(n.id);
    if (n.link) navigate(n.link);
  };

  const onMarkAll = () =>
    markAll.mutate(undefined, {
      onSuccess: () => toast.success(t('notifications.allRead', { defaultValue: 'All caught up.' })),
      onError: (error) => toast.error(apiErrorMessage(error, t)),
    });

  return (
    <div className="space-y-8">
      <Seo
        title={t('notifications.seoTitle', { defaultValue: 'Notifications' })}
        description={t('notifications.description', {
          defaultValue: 'Offers, consents, pickups and payments that need your attention, newest first.',
        })}
        path="/app/notifications"
        noindex
      />
      <PageHeader
        eyebrow={t('notifications.eyebrow', { defaultValue: 'Inbox' })}
        title={t('notifications.title', { defaultValue: 'Notifications' })}
        description={t('notifications.description', {
          defaultValue: 'Offers, consents, pickups and payments that need your attention, newest first.',
        })}
        meta={
          unreadCount > 0 ? (
            <Badge tone="gold" dot>
              {t('notifications.unreadCount', { defaultValue: '{{count}} unread', count: unreadCount })}
            </Badge>
          ) : null
        }
        actions={
          <Button
            variant="secondary"
            leadingIcon={<CheckCheck aria-hidden="true" strokeWidth={1.25} />}
            onClick={onMarkAll}
            loading={markAll.isPending}
            disabled={unreadCount === 0}
          >
            {t('notifications.markAll', { defaultValue: 'Mark all as read' })}
          </Button>
        }
        divider
      />

      <SegmentedControl<Filter>
        label={t('notifications.filter', { defaultValue: 'Show' })}
        value={filter}
        onValueChange={setFilter}
        size="sm"
        options={[
          { value: 'all', label: t('notifications.all', { defaultValue: 'All' }) },
          {
            value: 'unread',
            label: t('notifications.unread', { defaultValue: 'Unread' }) + (unreadCount ? ` · ${unreadCount}` : ''),
          },
        ]}
      />

      <QueryState
        query={query}
        skeleton="list"
        empty={{
          icon: <BellOff aria-hidden="true" strokeWidth={1.25} />,
          title:
            filter === 'unread'
              ? t('notifications.emptyUnreadTitle', { defaultValue: 'Nothing unread' })
              : t('notifications.emptyTitle', { defaultValue: 'No notifications yet' }),
          description: t('notifications.emptyBody', {
            defaultValue: 'When an offer arrives, a lot needs your consent or a payment lands, you will hear about it here.',
          }),
        }}
      >
        {(items) => <Grouped items={items} groupLabel={groupLabel} onOpen={open} onMarkRead={(id) => markRead.mutate(id)} />}
      </QueryState>
    </div>
  );
}

interface GroupedProps {
  items: Notification[];
  groupLabel: (iso: string) => string;
  onOpen: (n: Notification) => void;
  onMarkRead: (id: string) => void;
}

function Grouped({ items, groupLabel, onOpen, onMarkRead }: GroupedProps) {
  const { t } = useTranslation('shared');
  const lang = useUiLanguage();
  const groups = useMemo(() => {
    const sorted = [...items].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const out: { key: string; label: string; items: Notification[] }[] = [];
    for (const n of sorted) {
      const key = dayKey(n.created_at);
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(n);
      else out.push({ key, label: groupLabel(n.created_at), items: [n] });
    }
    return out;
  }, [items, groupLabel]);

  return (
    <div className="space-y-10">
      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`day-${group.key}`} className="space-y-3">
          <h2
            id={`day-${group.key}`}
            className="flex items-center gap-3 text-[13px] font-semibold text-muted"
          >
            {group.label}
            <span aria-hidden="true" className="h-px flex-1 bg-line" />
          </h2>
          <StaggerGroup as="ul" className="divide-y divide-line overflow-hidden rounded-card border border-line bg-paper">
            {group.items.map((n) => {
              const Icon = TYPE_ICONS[n.type] ?? Bell;
              const isUnread = !n.read_at;
              return (
                <StaggerItem as="li" key={n.id} className="relative">
                  <div
                    className={cn(
                      'group flex items-start gap-4 px-4 py-4 transition-colors sm:px-5',
                      isUnread ? 'bg-paper' : 'bg-transparent',
                      'hover:bg-parchment/70',
                    )}
                  >
                    <Icon
                      aria-hidden="true"
                      strokeWidth={1.25}
                      className={cn('mt-0.5 size-[18px] shrink-0', TYPE_TONES[n.type] ?? 'text-muted')}
                    />
                    <button
                      type="button"
                      onClick={() => onOpen(n)}
                      className="min-w-0 flex-1 rounded-sm text-start outline-none focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ink"
                    >
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className={cn('text-[15px] leading-snug text-ink', isUnread ? 'font-medium' : 'font-normal')}>
                          {n.title}
                        </span>
                        <span className="text-xs text-muted">
                          <time dateTime={n.created_at} title={formatTime(n.created_at, { locale: lang })}>
                            {formatRelative(n.created_at, { locale: lang })}
                          </time>
                        </span>
                      </span>
                      <span className="mt-1 block text-sm font-normal leading-relaxed text-ink-2">{n.body}</span>
                      <span className="mt-2 inline-flex items-center gap-2 text-[13px] font-semibold text-muted">
                        {t(`common:enums.notificationType.${n.type}`, { defaultValue: n.type.replace('_', ' ') })}
                        {n.link ? (
                          <span className="text-ink underline decoration-line underline-offset-4 group-hover:decoration-ink">
                            {t('notifications.open', { defaultValue: 'Open' })} →
                          </span>
                        ) : null}
                      </span>
                    </button>
                    {isUnread ? (
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <span className="size-1.5 rounded-full bg-gold-700" aria-hidden="true" />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onMarkRead(n.id)}
                          aria-label={t('notifications.markReadAria', { defaultValue: 'Mark “{{title}}” as read', title: n.title })}
                        >
                          {t('notifications.markRead', { defaultValue: 'Mark read' })}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </StaggerItem>
              );
            })}
          </StaggerGroup>
        </section>
      ))}
    </div>
  );
}
