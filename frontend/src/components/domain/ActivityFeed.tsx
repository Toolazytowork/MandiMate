import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { History } from 'lucide-react';
import { EmptyState } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDateTime, formatRelative } from '@/lib/format';
import type { ActivityItem } from '@/types/api';
import { useNow, useUiLanguage } from './hooks';
import { ACTIVITY_ICONS } from './icons';

export interface ActivityFeedProps {
  items: readonly ActivityItem[];
  limit?: number;
  emptyTitle?: ReactNode;
  emptyDescription?: ReactNode;
  className?: string;
}

/** Recent events as a hairline list: plain kind icon, title, detail and relative time. */
export function ActivityFeed({ items, limit, emptyTitle, emptyDescription, className }: ActivityFeedProps) {
  const { t } = useTranslation('domain');
  const now = useNow();
  const locale = useUiLanguage();
  const visible = limit === undefined ? items : items.slice(0, limit);

  if (visible.length === 0) {
    return (
      <EmptyState
        framed={false}
        size="sm"
        icon={<History />}
        title={emptyTitle ?? t('activity.emptyTitle')}
        description={emptyDescription ?? t('activity.emptyBody')}
        className={className}
      />
    );
  }

  return (
    <ol aria-label={t('activity.label')} className={cn('relative flex flex-col divide-y divide-line', className)}>
      {visible.map((item) => {
        const Icon = ACTIVITY_ICONS[item.kind];
        return (
          <li key={item.id} className="relative flex gap-4 py-4 first:pt-0 last:pb-0">
            <span aria-hidden="true" className="relative mt-0.5 shrink-0 text-muted">
              <Icon strokeWidth={1.25} className="size-4" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                {item.link ? (
                  <Link to={item.link} className="link-luxe text-sm text-ink">
                    {item.title}
                  </Link>
                ) : (
                  <span className="text-sm text-ink">{item.title}</span>
                )}
                <time dateTime={item.at} title={formatDateTime(item.at, { locale })} className="shrink-0 text-xs tabular-nums text-muted">
                  {formatRelative(item.at, { now, locale })}
                </time>
              </p>
              <p className="text-sm font-normal leading-snug text-ink-2">{item.description}</p>
              <p className="text-[13px] font-semibold text-muted">{t(`common:enums.notificationType.${item.kind}`)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
