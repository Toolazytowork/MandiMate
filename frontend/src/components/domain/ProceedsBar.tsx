import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { formatINR } from '@/lib/format';
import { Money } from './Money';
import { proceedsShares } from './proceeds';

const KEPT_FILL = 'linear-gradient(var(--color-forest-600), var(--color-forest-600))';
const KEPT_FILL_MUTED = 'linear-gradient(var(--color-forest-300), var(--color-forest-300))';
const DEDUCTION_FILL =
  'repeating-linear-gradient(135deg, rgba(155, 58, 43, 0.45) 0 1px, rgba(155, 58, 43, 0.08) 1px 4px)';

export interface ProceedsBarProps {
  grossAmount: number;
  netAmount: number;
  totalDeductions: number;
  size?: 'sm' | 'md';
  /** `kept`: "Kept 85%" beside the bar. `full`: kept share, deductions and sale value under it. */
  legend?: 'none' | 'kept' | 'full';
  /** Quieter colours for the baseline. */
  muted?: boolean;
  className?: string;
}

/** Gross → net at a glance: the share the farmer keeps (forest) beside the deductions (hatched rust). */
export function ProceedsBar({
  grossAmount,
  netAmount,
  totalDeductions,
  size = 'md',
  legend = 'none',
  muted = false,
  className,
}: ProceedsBarProps) {
  const { t } = useTranslation('domain');
  const shares = proceedsShares(grossAmount, netAmount);
  const label = t('proceeds.barLabel', {
    pct: shares.keptPct,
    net: formatINR(netAmount),
    gross: formatINR(grossAmount),
  });

  return (
    <div className={cn('flex', legend === 'kept' ? 'items-center gap-3' : 'flex-col gap-2', className)}>
      <div
        role="img"
        aria-label={label}
        className={cn(
          'flex min-w-0 gap-[2px] rounded-full bg-ink/[0.05]',
          legend === 'kept' ? 'flex-1' : 'w-full',
          size === 'sm' ? 'h-1' : 'h-1.5',
        )}
      >
        {shares.net > 0 ? (
          <span
            className="h-full rounded-full transition-[width] duration-700 ease-luxe"
            style={{ width: `${shares.net * 100}%`, backgroundImage: muted ? KEPT_FILL_MUTED : KEPT_FILL }}
          />
        ) : null}
        {shares.deductions > 0 ? (
          <span
            className="h-full flex-1 rounded-full"
            style={{ backgroundImage: DEDUCTION_FILL, opacity: muted ? 0.65 : 1 }}
          />
        ) : null}
      </div>
      {legend === 'kept' ? (
        <span aria-hidden="true" className="shrink-0 text-[13px] font-medium tabular-nums text-muted">
          {t('proceeds.kept', { pct: shares.keptPct })}
        </span>
      ) : null}
      {legend === 'full' ? (
        <dl className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted">
          <div className="flex items-center gap-1.5">
            <dt className="flex items-center">
              <span aria-hidden="true" className="size-1.5 rounded-full" style={{ backgroundImage: muted ? KEPT_FILL_MUTED : KEPT_FILL }} />
              <span className="sr-only">{t('proceeds.keptLabel')}</span>
            </dt>
            <dd className="font-medium text-ink/80">{t('proceeds.kept', { pct: shares.keptPct })}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-1.5 rounded-full" style={{ backgroundImage: DEDUCTION_FILL }} />
              {t('common:money.deductions')}
            </dt>
            <dd>
              <Money value={-totalDeductions} size="sm" />
            </dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt>{t('proceeds.saleValue')}</dt>
            <dd>
              <Money value={grossAmount} size="sm" className="text-ink/80" />
            </dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}
