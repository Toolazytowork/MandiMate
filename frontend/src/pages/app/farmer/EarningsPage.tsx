import { useId, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronDown, Coins, Sprout } from 'lucide-react';

import { LinkButton } from '@/components/ui';
import { Delta, Money, PageHeader, QueryState, SectionCard, StatusBadge } from '@/components/domain';
import { CountUp, Reveal } from '@/components/motion';
import { useEarnings } from '@/features/farmer/hooks';
import { HeroSurface } from '@/features/farmer/components/Surfaces';
import { monthLabel } from '@/features/farmer/lib';
import { FARMER_BASE } from '@/features/farmer-deals/shared';
import { cn } from '@/lib/cn';
import { formatDate, formatINR, formatKg, formatPerKg } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { FarmerEarnings, FarmerSale, Language } from '@/types/api';

const COLORS = {
  net: 'var(--color-forest-900)',
  baseline: 'var(--color-gold-500)',
  grid: 'var(--color-line)',
  axis: 'var(--color-muted)',
  transport: 'var(--color-forest-900)',
  handling: 'var(--color-gold-400)',
  commission: 'var(--color-muted)',
};

export default function EarningsPage() {
  const { t } = useTranslation('farmerDeals');
  const earnings = useEarnings();
  return (
    <div className="flex flex-col gap-10">
      <Seo
        title={t('earnings.seoTitle', { defaultValue: 'Earnings' })}
        description={t('earnings.description', { defaultValue: 'What you took home this season, and how it compares with selling alone at the mandi.' })}
        path={`${FARMER_BASE}/earnings`}
        noindex
      />
      <PageHeader
        eyebrow={t('earnings.eyebrow', { defaultValue: 'Your money' })}
        title={t('earnings.title', { defaultValue: 'Earnings' })}
        description={t('earnings.description', { defaultValue: 'What you took home this season, and how it compares with selling alone at the mandi.' })}
      />
      <QueryState
        query={earnings}
        skeleton="detail"
        isEmpty={(data) => data.totals.sales_count === 0 && data.totals.pending_amount === 0}
        empty={{
          icon: <Coins strokeWidth={1.25} />,
          title: t('earnings.empty', { defaultValue: 'No earnings yet' }),
          description: t('earnings.emptyBody', { defaultValue: 'When your first sale is settled, your take-home and how it beats the mandi show here.' }),
          action: (
            <LinkButton to={`${FARMER_BASE}/offers`} variant="primary">
              {t('sales.seeOffers', { defaultValue: 'See your offers' })}
            </LinkButton>
          ),
        }}
      >
        {(data) => <EarningsView data={data} />}
      </QueryState>
    </div>
  );
}

function EarningsView({ data }: { data: FarmerEarnings }) {
  const { t, i18n } = useTranslation('farmerDeals');
  const lang = (i18n.resolvedLanguage ?? 'en') as Language;
  const { totals } = data;

  const months = useMemo(
    () =>
      data.by_month.map((month) => ({
        label: monthLabel(month.month, lang),
        net: month.net_amount,
        baseline: month.baseline_net_amount,
      })),
    [data.by_month, lang],
  );

  const deductions = useMemo(() => {
    const sum = (key: 'transport_share' | 'handling_share' | 'commission_share') => data.sales.reduce((acc, sale) => acc + sale[key], 0);
    return [
      { key: 'transport', label: t('earnings.transport', { defaultValue: 'Transport' }), value: sum('transport_share'), color: COLORS.transport },
      { key: 'handling', label: t('earnings.handling', { defaultValue: 'Loading & handling' }), value: sum('handling_share'), color: COLORS.handling },
      { key: 'commission', label: t('earnings.commission', { defaultValue: 'Commission' }), value: sum('commission_share'), color: COLORS.commission },
    ].filter((item) => item.value > 0);
  }, [data.sales, t]);
  const deductionTotal = deductions.reduce((acc, item) => acc + item.value, 0);

  return (
    <div className="flex flex-col gap-10">
      <HeroSurface aria-labelledby="earnings-hero" className="p-6 sm:p-10 md:p-12">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-end">
          <div className="flex flex-col gap-3">
            <p id="earnings-hero" className="text-[13px] font-semibold text-gold-400">
              {t('earnings.heroEyebrow', { defaultValue: 'Taken home this season' })}
            </p>
            <p className="font-display text-display-md font-bold leading-none tabular-nums text-ivory sm:text-display-lg">
              <CountUp value={totals.net_amount} format={(n) => formatINR(Math.round(n))} />
            </p>
            <p className="text-sm font-normal text-ivory/70">
              {t('earnings.heroGross', {
                defaultValue: 'From {{gross}} of sales, after {{costs}} of costs.',
                gross: formatINR(totals.gross_amount),
                costs: formatINR(totals.total_deductions),
              })}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-6 border-t border-white/15 pt-6 lg:border-s lg:border-t-0 lg:ps-8 lg:pt-0">
            <HeroFact label={t('earnings.uplift', { defaultValue: 'Better than the mandi' })}>
              {totals.avg_uplift_per_kg !== null ? (
                <Delta value={totals.avg_uplift_per_kg} label={null} size="md" />
              ) : (
                <span className="text-ivory/60">—</span>
              )}
            </HeroFact>
            <HeroFact label={t('earnings.avgNet', { defaultValue: 'Average take-home' })}>{totals.avg_net_per_kg !== null ? formatPerKg(totals.avg_net_per_kg) : '—'}</HeroFact>
            <HeroFact label={t('earnings.kgSold', { defaultValue: 'Sold' })}>{formatKg(totals.kg_sold)}</HeroFact>
            <HeroFact label={t('earnings.pending', { defaultValue: 'Still to be paid' })}>{formatINR(totals.pending_amount)}</HeroFact>
          </dl>
        </div>
      </HeroSurface>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Reveal>
          <SectionCard
            title={t('earnings.monthly', { defaultValue: 'Each month: MandiMate vs mandi' })}
            description={t('earnings.monthlyBody', { defaultValue: 'Bars are what you took home. The gold line is what selling alone at the mandi would have left you.' })}
          >
            {months.length === 0 ? (
              <p className="text-sm text-muted">{t('earnings.noMonths', { defaultValue: 'No months to show yet.' })}</p>
            ) : (
              <div className="h-72 w-full" role="img" aria-label={t('earnings.chartLabel', { defaultValue: 'Monthly take-home compared with the mandi' })}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={months} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke={COLORS.grid} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: COLORS.axis, fontSize: 12 }} />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={56}
                      tick={{ fill: COLORS.axis, fontSize: 12 }}
                      tickFormatter={(value: number) => formatINR(value, { compact: true })}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(27,22,17,0.04)' }}
                      formatter={(value, name) => [
                        formatINR(Number(value)),
                        name === 'net' ? t('earnings.legendNet', { defaultValue: 'Taken home' }) : t('earnings.legendMandi', { defaultValue: 'Mandi alone' }),
                      ]}
                      contentStyle={{ borderRadius: 2, border: '1px solid var(--color-line)', background: 'var(--color-paper)', fontSize: 13, boxShadow: 'none' }}
                    />
                    <Bar dataKey="net" fill={COLORS.net} radius={[1, 1, 0, 0]} maxBarSize={28} />
                    <Line dataKey="baseline" stroke={COLORS.baseline} strokeWidth={1.25} strokeDasharray="5 4" dot={{ r: 3, fill: COLORS.baseline }} type="monotone" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="mt-5 flex flex-wrap gap-6 text-[13px] font-semibold text-muted">
              <LegendSwatch color={COLORS.net} label={t('earnings.legendNet', { defaultValue: 'Taken home' })} />
              <LegendSwatch color={COLORS.baseline} label={t('earnings.legendMandi', { defaultValue: 'Mandi alone' })} dashed />
            </div>
          </SectionCard>
        </Reveal>

        <Reveal delay={0.08}>
          <SectionCard
            title={t('earnings.where', { defaultValue: 'Where the costs went' })}
            description={t('earnings.whereBody', { defaultValue: 'Your share of transport, handling and commission across all sales.' })}
          >
            {deductions.length === 0 ? (
              <p className="text-sm text-muted">{t('earnings.noCosts', { defaultValue: 'No costs recorded yet.' })}</p>
            ) : (
              <div className="flex flex-col items-center gap-6">
                <div className="relative h-52 w-52" role="img" aria-label={t('earnings.donutLabel', { defaultValue: 'Costs by type' })}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={deductions} dataKey="value" nameKey="label" innerRadius="68%" outerRadius="100%" paddingAngle={2} stroke="none">
                        {deductions.map((item) => (
                          <Cell key={item.key} fill={item.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                    <div>
                      <p className="text-[13px] font-semibold text-muted">{t('earnings.totalCosts', { defaultValue: 'Total' })}</p>
                      <p className="font-display text-2xl font-bold text-ink">{formatINR(deductionTotal, { compact: true })}</p>
                    </div>
                  </div>
                </div>
                <ul className="flex w-full flex-col divide-y divide-line">
                  {deductions.map((item) => (
                    <li key={item.key} className="flex items-center justify-between gap-3 py-3 text-sm">
                      <LegendSwatch color={item.color} label={item.label} />
                      <span className="tabular-nums text-ink">
                        {formatINR(item.value)}{' '}
                        <span className="text-muted">({deductionTotal > 0 ? Math.round((item.value / deductionTotal) * 100) : 0}%)</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </SectionCard>
        </Reveal>
      </div>

      <SectionCard
        title={t('earnings.ledger', { defaultValue: 'Every sale' })}
        description={t('earnings.ledgerBody', { defaultValue: 'Tap a sale to see exactly how the money was worked out.' })}
        flush
      >
        {data.sales.length === 0 ? (
          <p className="px-6 py-6 text-sm text-muted sm:px-8">{t('earnings.noSales', { defaultValue: 'No settled sales yet.' })}</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.sales.map((sale) => (
              <SaleRow key={sale.payout_id} sale={sale} />
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function HeroFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="text-[13px] font-semibold text-ivory/60">{label}</dt>
      <dd className="font-display text-2xl font-bold tabular-nums text-ivory">{children}</dd>
    </div>
  );
}

function LegendSwatch({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className={cn('inline-block shrink-0', dashed ? 'h-0 w-4 border-t border-dashed' : 'size-2 rounded-full')}
        style={dashed ? { borderColor: color } : { background: color }}
      />
      {label}
    </span>
  );
}

function SaleRow({ sale }: { sale: FarmerSale }) {
  const { t } = useTranslation('farmerDeals');
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-12 w-full flex-wrap items-center gap-x-6 gap-y-2 px-6 py-5 text-start transition-colors duration-300 ease-luxe hover:bg-parchment/50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-2px] focus-visible:outline-gold-700 sm:px-8"
      >
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <Sprout aria-hidden="true" strokeWidth={1.25} className="size-4 shrink-0 text-muted" />
          <span className="min-w-0">
            <span className="block truncate text-[15px] text-ink">
              {t('earnings.saleTitle', { defaultValue: '{{crop}} to {{buyer}}', crop: sale.crop_name, buyer: sale.buyer_name })}
            </span>
            <span className="mt-1 block text-[13px] font-semibold text-muted tabular-nums">
              {sale.lot_code} · {formatKg(sale.accepted_kg)}
              {sale.settled_at ? ` · ${formatDate(sale.settled_at)}` : ''}
            </span>
          </span>
        </span>
        <span className="flex items-center gap-4">
          <StatusBadge kind="payout" value={sale.status} size="sm" />
          <span className="text-end">
            <Money value={sale.net_amount} className="block font-display text-lg font-bold text-ink" />
            <Delta value={sale.uplift_per_kg} size="sm" />
          </span>
          <ChevronDown aria-hidden="true" strokeWidth={1.25} className={cn('size-4 text-muted transition-transform', open && 'rotate-180')} />
        </span>
      </button>
      <div id={panelId} hidden={!open} className="px-6 pb-6 sm:px-8">
        <div className="border-s border-gold-400/60 ps-5 sm:ps-6">
          <dl className="flex flex-col divide-y divide-line text-sm">
            <LedgerLine label={t('earnings.lineGross', { defaultValue: '{{kg}} × {{price}}', kg: formatKg(sale.accepted_kg), price: formatPerKg(sale.price_per_kg) })} value={sale.gross_amount} />
            <LedgerLine label={t('earnings.transport', { defaultValue: 'Transport' })} value={-sale.transport_share} />
            <LedgerLine label={t('earnings.handling', { defaultValue: 'Loading & handling' })} value={-sale.handling_share} />
            <LedgerLine label={t('earnings.commission', { defaultValue: 'Commission' })} value={-sale.commission_share} />
            <LedgerLine label={t('earnings.lineNet', { defaultValue: 'You took home' })} value={sale.net_amount} strong />
          </dl>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span>{t('earnings.netPerKg', { defaultValue: 'Take-home {{perKg}}', perKg: formatPerKg(sale.net_per_kg) })}</span>
            {sale.baseline_net_per_kg !== null ? (
              <span>{t('earnings.mandiPerKg', { defaultValue: 'Mandi alone {{perKg}}', perKg: formatPerKg(sale.baseline_net_per_kg) })}</span>
            ) : null}
            {sale.rejected_kg > 0 ? <span>{t('earnings.rejectedKg', { defaultValue: '{{kg}} not accepted', kg: formatKg(sale.rejected_kg) })}</span> : null}
          </p>
        </div>
      </div>
    </li>
  );
}

function LedgerLine({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between gap-4 py-2', strong && 'pt-3')}>
      <dt className={strong ? 'text-[13px] font-semibold text-ink' : 'text-muted'}>{label}</dt>
      <dd className={strong ? 'font-display text-xl font-bold tabular-nums text-ink' : 'tabular-nums text-ink'}>
        <Money value={value} />
      </dd>
    </div>
  );
}
