import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { NetProceeds } from '@/types/api';
import { BreakdownDisclosure } from './BreakdownTable';
import { CertaintyBadge, CertaintyIcon } from './Certainty';
import { Money, useKgFormatter } from './Money';
import { ProceedsBar } from './ProceedsBar';

export interface NetProceedsCardProps {
  data: NetProceeds;
  /** Heading; defaults to the engine's label (e.g. "Pooled sale · FreshMart"). */
  title?: ReactNode;
  /** Eyebrow above the heading; defaults to "You take home". */
  eyebrow?: ReactNode;
  /** `compact` for sidebars and lists: smaller figures, tighter spacing. */
  variant?: 'full' | 'compact';
  /** Open the line-by-line breakdown on first render. */
  defaultExpanded?: boolean;
  /** Extra content in the header's right slot (next to the confidence badge). */
  action?: ReactNode;
  /** Actions under the card body. */
  footer?: ReactNode;
  className?: string;
}

/**
 * What the farmer takes home: the net in the hero bold, net per kg, the gross → net bar, an
 * expandable line-by-line breakdown with certainty, and the conditions still open.
 */
export function NetProceedsCard({
  data,
  title,
  eyebrow,
  variant = 'full',
  defaultExpanded = false,
  action,
  footer,
  className,
}: NetProceedsCardProps) {
  const { t } = useTranslation('domain');
  const formatKg = useKgFormatter();
  const compact = variant === 'compact';

  return (
    <Card as="section" className={cn('overflow-hidden', className)}>
      <div className={cn('flex flex-col', compact ? 'gap-5 p-5 sm:p-6' : 'gap-7 p-6 sm:p-10')}>
        <header className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <p className="eyebrow">{eyebrow ?? t('common:money.youTakeHome')}</p>
            <h3 className={cn('font-display font-bold text-ink', compact ? 'text-[19px] leading-snug' : 'text-h3')}>
              {title ?? data.label}
            </h3>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {action}
            <CertaintyBadge certainty={data.confidence} size={compact ? 'sm' : 'md'} />
          </div>
        </header>

        <div className="flex flex-col gap-3">
          <Money value={data.net_amount} size={compact ? 'xl' : 'hero'} className={cn(data.net_amount >= 0 && 'text-ink')} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted">
            <span className="inline-flex items-baseline gap-1.5">
              <Money value={data.net_per_kg} perKg size={compact ? 'sm' : 'md'} className="text-ink" />
              <span>{t('proceeds.netShort')}</span>
            </span>
            <Dot />
            <span>{t('proceeds.onQuantity', { quantity: formatKg(data.quantity_kg) })}</span>
            <Dot />
            <span>{t('common:money.paymentIn', { count: data.payment_terms_days })}</span>
          </div>
        </div>

        <ProceedsBar
          grossAmount={data.gross_amount}
          netAmount={data.net_amount}
          totalDeductions={data.total_deductions}
          size={compact ? 'sm' : 'md'}
          legend={compact ? 'kept' : 'full'}
        />

        {!compact && data.expected_accepted_kg < data.quantity_kg ? (
          <p className="-mt-2 text-xs text-muted">
            {t('proceeds.expectedAccepted', {
              accepted: formatKg(data.expected_accepted_kg),
              quantity: formatKg(data.quantity_kg),
            })}
          </p>
        ) : null}

        {data.unresolved.length > 0 ? <UnresolvedList items={data.unresolved} compact={compact} /> : null}

        <BreakdownDisclosure data={data} defaultExpanded={defaultExpanded} className="border-t border-line pt-1" />
      </div>
      {footer ? (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-6 py-4 sm:px-10">{footer}</div>
      ) : null}
    </Card>
  );
}

function Dot() {
  return <span aria-hidden="true" className="h-3 w-px bg-line" />;
}

export interface UnresolvedListProps {
  items: readonly string[];
  compact?: boolean;
  className?: string;
}

/** Conditions that can still change the amount, e.g. "Transport quote pending". */
export function UnresolvedList({ items, compact = false, className }: UnresolvedListProps) {
  const { t } = useTranslation('domain');
  return (
    <div
      className={cn(
        'border-s border-danger/50',
        compact ? 'py-1 ps-3.5' : 'py-1.5 ps-4',
        className,
      )}
    >
      <p className="text-[13px] font-semibold text-danger-ink">{t('proceeds.stillOpen', { count: items.length })}</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm text-ink-2">
            <CertaintyIcon certainty="unresolved" className="mt-1" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
