import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ChevronRight, CircleCheck, Clock } from 'lucide-react';
import { EmptyState } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import type { ActionItem } from '@/types/api';
import { useNow, useUiLanguage } from './hooks';
import { ACTION_ICONS } from './icons';
import { useDurationLabel } from './OfferMeta';
import { deadlineUrgency, sortActionItems } from './schedule';

export interface ActionListProps {
  items: readonly ActionItem[];
  /** Show at most this many (after sorting by priority and due date). */
  limit?: number;
  emptyTitle?: ReactNode;
  emptyDescription?: ReactNode;
  className?: string;
}

/**
 * What needs the viewer's attention, most urgent first: a kind icon, the task, why it matters and
 * when it is due. Urgent items carry a thin green rule and a tracked-caps "Urgent" label; overdue dates turn rust.
 */
export function ActionList({ items, limit, emptyTitle, emptyDescription, className }: ActionListProps) {
  const { t } = useTranslation('domain');
  const sorted = sortActionItems(items);
  const visible = limit === undefined ? sorted : sorted.slice(0, limit);

  if (visible.length === 0) {
    return (
      <EmptyState
        framed={false}
        size="sm"
        icon={<CircleCheck />}
        title={emptyTitle ?? t('actions.emptyTitle')}
        description={emptyDescription ?? t('actions.emptyBody')}
        className={className}
      />
    );
  }

  return (
    <ul className={cn('flex flex-col divide-y divide-line', className)}>
      {visible.map((item) => (
        <ActionRow key={item.id} item={item} />
      ))}
    </ul>
  );
}

function ActionRow({ item }: { item: ActionItem }) {
  const { t } = useTranslation('domain');
  const now = useNow();
  const locale = useUiLanguage();
  const duration = useDurationLabel();
  const Icon = ACTION_ICONS[item.kind];
  const urgent = item.priority === 'high';
  const urgency = deadlineUrgency(item.due_at, now);
  const remaining = item.due_at ? new Date(item.due_at).getTime() - now.getTime() : 0;

  return (
    <li className="relative">
      {urgent ? <span aria-hidden="true" className="absolute inset-y-4 start-0 w-px bg-gold-500" /> : null}
      <Link
        to={item.link}
        className="group flex items-start gap-4 rounded-sm py-5 ps-4 pe-2 transition-colors hover:bg-paper focus-visible:bg-paper"
      >
        <span aria-hidden="true" className={cn('mt-0.5 shrink-0', urgent ? 'text-gold-700' : 'text-muted')}>
          <Icon strokeWidth={1.25} className="size-[18px]" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="text-ink">{item.title}</span>
            {urgent ? (
              <span className="text-[13px] font-semibold text-gold-700">{t('common:enums.priority.high')}</span>
            ) : null}
          </span>
          <span className="line-clamp-2 text-sm font-normal leading-snug text-ink-2">{item.description}</span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] font-semibold text-muted">
            <span>{t(`common:enums.actionKind.${item.kind}`)}</span>
            {item.due_at ? (
              <span
                className={cn(
                  'inline-flex items-center gap-1',
                  urgency === 'expired' && 'text-danger-ink',
                  urgency === 'urgent' && 'text-gold-700',
                )}
              >
                <Clock aria-hidden="true" strokeWidth={1.25} className="size-3.5" />
                <time dateTime={item.due_at} title={formatDateTime(item.due_at, { locale })}>
                  {urgency === 'expired'
                    ? t('due.overdueBy', { time: duration(remaining) })
                    : t('due.in', { time: duration(remaining) })}
                </time>
              </span>
            ) : null}
          </span>
        </span>
        <ChevronRight
          aria-hidden="true"
          strokeWidth={1.25}
          className="mt-1 size-4 shrink-0 text-ink/25 transition-transform duration-200 ease-luxe group-hover:translate-x-0.5 group-hover:text-ink/50"
        />
      </Link>
    </li>
  );
}
