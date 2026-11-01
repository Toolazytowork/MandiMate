import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Combine, HandCoins, Lock, Store } from 'lucide-react';
import { EmptyState, Tooltip } from '@/components/ui';
import { StaggerGroup, StaggerItem } from '@/components/motion';
import { cn } from '@/lib/cn';
import { formatINR } from '@/lib/format';
import type { SellingOption, SellingOptions, SellingOptionSource } from '@/types/api';
import { BreakdownDisclosure } from './BreakdownTable';
import { CertaintyBadge } from './Certainty';
import { Delta, Money, Quantity, useKgFormatter } from './Money';
import { UnresolvedList } from './NetProceedsCard';
import { ProceedsBar } from './ProceedsBar';
import { AwaitingBadge, BuyerTrust, MinPriceIndicator, ValidityCountdown } from './OfferMeta';
import { findBaseline, orderSellingOptions, upliftPerKg } from './proceeds';
import { OPEN_OFFER_STATUSES } from './schedule';
import { StatusBadge } from './StatusBadge';

const SOURCE_ICONS: Record<SellingOptionSource, typeof Store> = {
  direct_offer: HandCoins,
  pooled_offer: Combine,
  baseline: Store,
};

export interface SellingOptionsCompareProps {
  data: SellingOptions;
  /** CTA slot under each card, e.g. Accept / Counter for offers. Not called for the baseline. */
  renderActions?: (option: SellingOption) => ReactNode;
  /** The headline above the cards: harvest, uplift vs the mandi and the farmer's minimum. */
  showSummary?: boolean;
  className?: string;
}

/**
 * Every way to sell one harvest, side by side and ranked by what the farmer takes home — not by
 * the quoted price. Editorial columns under hairline rules: the best net carries a green rule and a
 * tracked-caps label; the mandi baseline sits last under a muted dashed rule so the uplift is obvious.
 */
export function SellingOptionsCompare({ data, renderActions, showSummary = true, className }: SellingOptionsCompareProps) {
  const { t } = useTranslation('domain');
  const ordered = useMemo(() => orderSellingOptions(data.options), [data.options]);
  const baseline = useMemo(() => findBaseline(data.options), [data.options]);
  const offers = ordered.filter((option) => option.source !== 'baseline');

  return (
    <section aria-label={t('compare.label')} className={cn('flex flex-col gap-6', className)}>
      {showSummary ? <CompareSummary data={data} offers={offers} baseline={baseline} /> : null}

      {offers.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<HandCoins />}
          title={t('compare.emptyTitle')}
          description={baseline ? t('compare.emptyWithBaseline') : t('compare.emptyBody')}
        />
      ) : null}

      {ordered.length > 0 ? (
        <StaggerGroup
          as="ol"
          className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,18.5rem),1fr))] items-stretch gap-5 pt-2"
        >
          {ordered.map((option) => (
            <StaggerItem as="li" key={option.option_id} className="flex min-w-0">
              <OptionCard
                option={option}
                uplift={upliftPerKg(option, baseline)}
                actions={option.source === 'baseline' ? null : renderActions?.(option)}
              />
            </StaggerItem>
          ))}
        </StaggerGroup>
      ) : null}
    </section>
  );
}

/* ─────────────────────────────── Summary ─────────────────────────────── */

interface CompareSummaryProps {
  data: SellingOptions;
  offers: readonly SellingOption[];
  baseline: SellingOption | null;
}

function CompareSummary({ data, offers, baseline }: CompareSummaryProps) {
  const { t } = useTranslation('domain');
  const formatKg = useKgFormatter();
  const best = offers.find((option) => option.is_best) ?? offers.find((option) => option.option_id === data.best_option_id) ?? null;
  const uplift = data.uplift_vs_baseline_per_kg;
  const showUplift = best !== null && baseline !== null && typeof uplift === 'number';

  return (
    <div className="flex flex-col gap-5 border-b border-line pb-8 md:flex-row md:items-end md:justify-between">
      <div className="flex min-w-0 flex-col gap-3">
        <p className="eyebrow eyebrow-rule">{t('compare.eyebrow')}</p>
        <h2 className="font-display text-h2 font-bold text-ink md:text-h1">
          {t('compare.title', { quantity: formatKg(data.quantity_kg), crop: data.crop_name })}
        </h2>
        {typeof data.min_price_per_kg === 'number' ? (
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted">
            <Tooltip content={t('common:money.minimumPriceHint')}>
              <button type="button" aria-label={t('common:money.minimumPriceHint')} className="inline-flex cursor-help rounded-sm p-0.5">
                <Lock aria-hidden="true" strokeWidth={1.25} className="size-3.5" />
              </button>
            </Tooltip>
            <span>{t('compare.minimum')}</span>
            <Money value={data.min_price_per_kg} perKg size="sm" className="text-ink" />
            <span>{t('proceeds.netShort')}</span>
          </p>
        ) : null}
      </div>

      {showUplift ? (
        <div className="flex flex-col items-start gap-2 md:items-end md:text-end">
          <Delta value={uplift} size="md" />
          <p className="max-w-xs text-sm font-normal leading-snug text-ink-2">
            {uplift > 0
              ? t('compare.upliftTotal', { amount: formatINR(uplift * best.quantity_kg) })
              : t('compare.baselineAhead')}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/* ───────────────────────────── Option card ───────────────────────────── */

interface OptionCardProps {
  option: SellingOption;
  uplift: number | null;
  actions: ReactNode;
}

function OptionCard({ option, uplift, actions }: OptionCardProps) {
  const { t } = useTranslation('domain');
  const isBaseline = option.source === 'baseline';
  const SourceIcon = SOURCE_ICONS[option.source];
  const isOpen = option.offer_status !== null && OPEN_OFFER_STATUSES.has(option.offer_status);

  return (
    <article
      className={cn(
        'relative flex w-full flex-col rounded-card border p-5 transition-[border-color,box-shadow] duration-300 ease-luxe sm:p-6',
        isBaseline ? 'border-dashed border-ink/25 bg-parchment/50' : 'border-line bg-paper shadow-luxe-sm hover:border-forest-400',
        option.is_best && 'border-2 border-forest-500 hover:border-forest-600',
      )}
    >
      <div className="relative flex flex-1 flex-col gap-6">
        <header className="flex flex-col gap-2.5">
          {option.is_best ? <BestLabel label={t('compare.bestNet')} /> : null}
          <p className={cn('eyebrow flex items-center gap-1.5', isBaseline && '[--eyebrow:var(--color-muted)]')}>
            <SourceIcon aria-hidden="true" strokeWidth={1.25} className="size-3.5" />
            {isBaseline ? t('compare.baselineEyebrow') : t(`common:enums.sellingOptionSource.${option.source}`)}
          </p>
          <h3 className={cn('font-display text-h3 font-bold', isBaseline ? 'text-ink-2' : 'text-ink')}>{option.title}</h3>
          {option.buyer_name && !option.title.includes(option.buyer_name) ? (
            <p className="text-sm text-ink-2">{option.buyer_name}</p>
          ) : null}
          {isBaseline ? (
            <p className="text-[13px] font-normal leading-snug text-muted">{t('compare.baselineNote')}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {option.buyer_verified !== null ? <BuyerTrust verified={option.buyer_verified} /> : null}
              {option.offer_status ? <StatusBadge kind="offer" value={option.offer_status} size="sm" /> : null}
              {option.awaiting && option.offer_status !== 'proposed' ? <AwaitingBadge awaiting={option.awaiting} /> : null}
            </div>
          )}
          {isOpen && option.valid_until ? <ValidityCountdown validUntil={option.valid_until} /> : null}
        </header>

        <div className="flex flex-col gap-2.5">
          <p className="text-[13px] font-semibold text-muted">{t('common:money.youTakeHome')}</p>
          <Money
            value={option.net_amount}
            size="xl"
            tone={isBaseline ? 'muted' : 'default'}
            className={cn(!isBaseline && option.net_amount >= 0 && 'text-ink')}
          />
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
            <span className="inline-flex items-baseline gap-1.5 text-sm text-muted">
              <Money value={option.net_per_kg} perKg size="sm" className={isBaseline ? 'text-muted' : 'text-ink'} />
              {t('proceeds.netShort')}
            </span>
            <Delta value={uplift} />
          </div>
        </div>

        <ProceedsBar
          grossAmount={option.gross_amount}
          netAmount={option.net_amount}
          totalDeductions={option.total_deductions}
          size="sm"
          legend="kept"
          muted={isBaseline}
        />

        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5 text-sm">
          <Fact label={t('compare.price')}>
            <Money value={option.gross_price_per_kg} perKg size="sm" />
          </Fact>
          <Fact label={t('common:money.deductions')}>
            <Money value={-option.total_deductions} size="sm" />
          </Fact>
          <Fact label={t('compare.payment')}>{t('common:money.paymentIn', { count: option.payment_terms_days })}</Fact>
          <Fact label={t('common:labels.quantity')}>
            <Quantity kg={option.quantity_kg} size="sm" />
          </Fact>
        </dl>

        <div className="flex flex-col gap-3">
          <MinPriceIndicator meets={option.meets_min_price} />
          <CertaintyBadge certainty={option.confidence} size="sm" className="self-start" />
          {option.unresolved.length > 0 ? <UnresolvedList items={option.unresolved} compact /> : null}
        </div>

        <BreakdownDisclosure data={option} showLegend={false} className="mt-auto border-t border-line pt-1" />
      </div>

      {actions ? (
        <footer className="relative flex flex-wrap items-center gap-3 border-t border-line pt-5">{actions}</footer>
      ) : null}
    </article>
  );
}

function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-[13px] font-semibold text-muted">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  );
}

/** "Best net" as a green pill; the card's green border does the rest. */
function BestLabel({ label }: { label: string }) {
  return <p className="inline-flex h-7 items-center self-start rounded-full bg-forest-600 px-3 text-[13px] font-semibold leading-none text-white">{label}</p>;
}
