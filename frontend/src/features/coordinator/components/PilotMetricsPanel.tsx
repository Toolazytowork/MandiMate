import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownRight, ArrowUpRight, Clock, Gauge, HandCoins, PackageX, Repeat, RotateCcw, Truck, Wallet, XCircle } from 'lucide-react';
import { Skeleton, Tooltip } from '@/components/ui';
import { Money } from '@/components/domain';
import { cn } from '@/lib/cn';
import { formatNumber, formatPct } from '@/lib/format';
import type { PilotMetrics } from '@/types/api';

type MetricKey = keyof PilotMetrics;

interface MetricSpec {
  key: MetricKey;
  icon: ReactNode;
  /** Which direction is good news. */
  better: 'higher' | 'lower';
  label: string;
  explanation: string;
}

function useMetricSpecs(): MetricSpec[] {
  const { t } = useTranslation('coordinator');
  return [
    {
      key: 'net_uplift_per_kg',
      icon: <HandCoins strokeWidth={1.25} />,
      better: 'higher',
      label: t('metrics.net_uplift_per_kg.label', { defaultValue: 'Net uplift per kg' }),
      explanation: t('metrics.net_uplift_per_kg.explanation', {
        defaultValue:
          'Average farmer net ₹/kg above selling alone at the local mandi, across settled payouts. The headline promise.',
      }),
    },
    {
      key: 'completion_rate_pct',
      icon: <Gauge strokeWidth={1.25} />,
      better: 'higher',
      label: t('metrics.completion_rate_pct.label', { defaultValue: 'Listed produce sold' }),
      explanation: t('metrics.completion_rate_pct.explanation', {
        defaultValue:
          'Share of listed kilograms that ended in a settled sale. Low means harvests wait or expire unsold.',
      }),
    },
    {
      key: 'avg_hours_listing_to_buyer',
      icon: <Clock strokeWidth={1.25} />,
      better: 'lower',
      label: t('metrics.avg_hours_listing_to_buyer.label', { defaultValue: 'Listing to buyer' }),
      explanation: t('metrics.avg_hours_listing_to_buyer.explanation', {
        defaultValue:
          'Average time from a harvest being listed to a buyer agreeing a deal. Perishables lose value every hour.',
      }),
    },
    {
      key: 'transport_cost_per_kg',
      icon: <Truck strokeWidth={1.25} />,
      better: 'lower',
      label: t('metrics.transport_cost_per_kg.label', { defaultValue: 'Transport cost per kg' }),
      explanation: t('metrics.transport_cost_per_kg.explanation', {
        defaultValue:
          'What the shared trip costs each kilogram. Fuller trucks and tighter routes bring it down.',
      }),
    },
    {
      key: 'avg_payment_delay_days',
      icon: <Wallet strokeWidth={1.25} />,
      better: 'lower',
      label: t('metrics.avg_payment_delay_days.label', { defaultValue: 'Payment delay' }),
      explanation: t('metrics.avg_payment_delay_days.explanation', {
        defaultValue:
          'Average days buyers paid after the agreed due date. Every late day costs farmers interest.',
      }),
    },
    {
      key: 'rejection_rate_pct',
      icon: <PackageX strokeWidth={1.25} />,
      better: 'lower',
      label: t('metrics.rejection_rate_pct.label', { defaultValue: 'Rejection at delivery' }),
      explanation: t('metrics.rejection_rate_pct.explanation', {
        defaultValue:
          'Share of delivered kilograms the buyer rejected on quality. Inspection before pooling keeps it low.',
      }),
    },
    {
      key: 'failed_transactions',
      icon: <XCircle strokeWidth={1.25} />,
      better: 'lower',
      label: t('metrics.failed_transactions.label', { defaultValue: 'Failed transactions' }),
      explanation: t('metrics.failed_transactions.explanation', {
        defaultValue:
          'Deals that were agreed but cancelled or disputed without settlement.',
      }),
    },
    {
      key: 'repeat_farmers_pct',
      icon: <Repeat strokeWidth={1.25} />,
      better: 'higher',
      label: t('metrics.repeat_farmers_pct.label', { defaultValue: 'Repeat farmers' }),
      explanation: t('metrics.repeat_farmers_pct.explanation', {
        defaultValue:
          'Farmers who sold through MandiMate more than once — the clearest sign of trust.',
      }),
    },
    {
      key: 'repeat_buyers_pct',
      icon: <RotateCcw strokeWidth={1.25} />,
      better: 'higher',
      label: t('metrics.repeat_buyers_pct.label', { defaultValue: 'Repeat buyers' }),
      explanation: t('metrics.repeat_buyers_pct.explanation', {
        defaultValue:
          'Buyers who came back for another lot. Repeat demand is what keeps pooling viable.',
      }),
    },
  ];
}

function MetricValue({ metricKey, value }: { metricKey: MetricKey; value: number | null }) {
  const { t } = useTranslation('coordinator');
  if (value === null) return <span className="text-muted">—</span>;
  switch (metricKey) {
    case 'net_uplift_per_kg':
      return <Money value={value} perKg signed size="xl" className={value >= 0 ? 'text-forest-700' : undefined} />;
    case 'transport_cost_per_kg':
      return <Money value={value} perKg size="xl" />;
    case 'avg_hours_listing_to_buyer':
      return value >= 48 ? (
        <span>
          {formatNumber(value / 24, { maxDecimals: 1 })}
          <span className="ms-1 font-sans text-base text-muted">{t('metrics.unitDays', { defaultValue: 'days' })}</span>
        </span>
      ) : (
        <span>
          {formatNumber(value, { maxDecimals: 1 })}
          <span className="ms-1 font-sans text-base text-muted">{t('metrics.unitHours', { defaultValue: 'hours' })}</span>
        </span>
      );
    case 'avg_payment_delay_days':
      return (
        <span>
          {formatNumber(value, { maxDecimals: 1 })}
          <span className="ms-1 font-sans text-base text-muted">{t('metrics.unitDays', { defaultValue: 'days' })}</span>
        </span>
      );
    case 'failed_transactions':
      return <span>{formatNumber(value)}</span>;
    default:
      return <span>{formatPct(value)}</span>;
  }
}

export interface PilotMetricsPanelProps {
  metrics: PilotMetrics | undefined;
  loading?: boolean;
  /** Fewer columns for narrow sidebars. */
  columns?: 2 | 3;
  className?: string;
}

/**
 * The pilot's scorecard — every number MandiMate promised to measure, each with a plain explanation
 * of what it means and which direction is good news.
 */
export function PilotMetricsPanel({ metrics, loading = false, columns = 3, className }: PilotMetricsPanelProps) {
  const { t } = useTranslation('coordinator');
  const specs = useMetricSpecs();
  return (
    <ul
      className={cn(
        '-mb-px -me-px grid grid-cols-1 sm:grid-cols-2',
        columns === 3 && 'xl:grid-cols-3',
        className,
      )}
    >
      {specs.map((spec) => {
        const value = metrics ? metrics[spec.key] : null;
        const BetterIcon = spec.better === 'higher' ? ArrowUpRight : ArrowDownRight;
        return (
          <li key={spec.key} className="flex min-w-0 flex-col gap-3 border-b border-e border-line px-5 py-6 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-2">
                <span aria-hidden="true" className="text-muted [&_svg]:size-4 [&_svg]:stroke-[1.25]">
                  {spec.icon}
                </span>
                <span className="text-[13px] font-semibold text-ink-2">{spec.label}</span>
              </p>
              <Tooltip
                content={
                  spec.better === 'higher'
                    ? t('metrics.higherIsBetter', { defaultValue: 'Higher is better' })
                    : t('metrics.lowerIsBetter', { defaultValue: 'Lower is better' })
                }
              >
                <button
                  type="button"
                  className="grid size-6 cursor-help place-items-center rounded-full border border-line bg-paper text-muted"
                  aria-label={
                    spec.better === 'higher'
                      ? t('metrics.higherIsBetter', { defaultValue: 'Higher is better' })
                      : t('metrics.lowerIsBetter', { defaultValue: 'Lower is better' })
                  }
                >
                  <BetterIcon aria-hidden="true" strokeWidth={1.25} className="size-3.5" />
                </button>
              </Tooltip>
            </div>
            <div className="min-h-10 font-display text-display-sm font-bold leading-none tracking-[-0.02em] tabular-nums text-ink">
              {loading ? <Skeleton className="h-9 w-28" /> : <MetricValue metricKey={spec.key} value={value} />}
            </div>
            <p className="text-[13px] font-normal leading-relaxed text-ink-2">
              {spec.explanation}
            </p>
            {!loading && value === null ? (
              <p className="text-xs text-ink/50">{t('metrics.notEnoughData', { defaultValue: 'Not enough settled deals yet to measure this.' })}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
