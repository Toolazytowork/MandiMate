import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Combine, TrendingDown, TrendingUp, Scale } from 'lucide-react';
import { Badge, LinkButton, type BadgeTone } from '@/components/ui';
import { AiPanel, CropGlyph, Money, PageHeader, Quantity, QueryState, SectionCard } from '@/components/domain';
import { Reveal } from '@/components/motion';
import { PilotMetricsPanel } from '@/features/coordinator/components/PilotMetricsPanel';
import { useSupplyDemandInsights } from '@/features/coordinator/hooks';
import { addDays } from '@/features/coordinator/utils';
import { formatDate, formatKg, todayIST } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { CropBalance, SupplyForecastPoint } from '@/types/api';

const SIGNAL_TONE: Record<CropBalance['signal'], BadgeTone> = { surplus: 'warning', balanced: 'success', shortage: 'gold' };
const SERIES_COLORS = [
  'var(--color-forest-700)',
  'var(--color-gold-400)',
  'var(--color-forest-400)',
  'var(--color-gold-600)',
  'var(--color-forest-200)',
  'var(--color-gold-200)',
];

const axisTick = { fill: 'var(--color-muted)', fontSize: 12 };
const tooltipStyle = {
  background: 'var(--color-paper)',
  border: '1px solid var(--color-line)',
  borderRadius: 2,
  boxShadow: 'none',
  fontSize: 12,
};

export default function InsightsPage() {
  const { t } = useTranslation('coordinator');
  const insights = useSupplyDemandInsights();

  return (
    <div className="flex flex-col gap-8 md:gap-10">
      <Seo
        title={t('insights.seoTitle', { defaultValue: 'Insights' })}
        description={t('insights.seoDescription', { defaultValue: 'Supply and demand by crop, upcoming harvests and pilot metrics.' })}
        path="/app/coordinator/insights"
        noindex
      />
      <Reveal>
        <PageHeader
          eyebrow={t('insights.eyebrow', { defaultValue: 'Insights' })}
          title={t('insights.title', { defaultValue: 'Supply meets demand' })}
          description={t('insights.description', {
            defaultValue: 'Where buyers want more than farmers have listed, where there is too much, and what is coming in the next two weeks.',
          })}
          actions={
            <LinkButton to="/app/coordinator/lot-builder" leadingIcon={<Combine aria-hidden="true" strokeWidth={1.25} />}>
              {t('insights.buildLot', { defaultValue: 'Build a lot' })}
            </LinkButton>
          }
        />
      </Reveal>

      <QueryState
        query={insights}
        skeleton="detail"
        isEmpty={() => false}
      >
        {(data) => (
          <>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <SectionCard
                eyebrow={t('insights.balanceEyebrow', { defaultValue: 'Crop balance' })}
                title={t('insights.balanceTitle', { defaultValue: 'Listed versus demanded' })}
                description={t('insights.balanceDescription', { defaultValue: 'Open buyer demand against what farmers have listed and not yet committed.' })}
              >
                {data.by_crop.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted">{t('insights.noBalance', { defaultValue: 'No listings or open demand yet.' })}</p>
                ) : (
                  <BalanceChart rows={data.by_crop} />
                )}
              </SectionCard>
              <AiPanel
                ai={data.summary}
                eyebrow={t('insights.aiEyebrow', { defaultValue: 'This week' })}
                title={t('insights.aiTitle', { defaultValue: 'What the numbers say' })}
                loading={insights.isFetching && !insights.data}
              />
            </div>

            <SectionCard
              eyebrow={t('insights.signalsEyebrow', { defaultValue: 'Signals' })}
              title={t('insights.signalsTitle', { defaultValue: 'Crop by crop' })}
              flush
            >
              <ul className="divide-y divide-line">
                {[...data.by_crop]
                  .sort((a, b) => Math.abs(b.gap_kg) - Math.abs(a.gap_kg))
                  .map((row) => (
                    <SignalRow key={row.crop_id} row={row} />
                  ))}
              </ul>
            </SectionCard>

            <SectionCard
              eyebrow={t('insights.upcomingEyebrow', { defaultValue: 'Next 14 days' })}
              title={t('insights.upcomingTitle', { defaultValue: 'Harvests coming available' })}
              description={t('insights.upcomingDescription', { defaultValue: 'Listed kg by the day it becomes available — plan lots and trucks ahead.' })}
            >
              <UpcomingChart points={data.upcoming_supply} />
            </SectionCard>

            <section aria-labelledby="insights-metrics" className="overflow-hidden rounded-panel border border-line bg-paper">
              <header className="flex flex-col gap-3 px-5 pb-6 pt-8 sm:px-8">
                <p className="eyebrow eyebrow-rule">{t('metrics.eyebrow', { defaultValue: 'Pilot scorecard' })}</p>
                <h2 id="insights-metrics" className="font-display text-h2 font-bold text-ink">
                  {t('metrics.title', { defaultValue: 'Are farmers actually earning more?' })}
                </h2>
                <p className="max-w-measure text-sm font-normal leading-relaxed text-ink-2">
                  {t('metrics.description', {
                    defaultValue: 'The measures the pilot is judged on, computed from settled deals only — never from estimates.',
                  })}
                </p>
              </header>
              <div className="border-t border-line">
                <PilotMetricsPanel metrics={data.pilot_metrics} />
              </div>
            </section>
          </>
        )}
      </QueryState>
      {insights.isPending ? (
        <span className="sr-only" role="status">
          {t('insights.loading', { defaultValue: 'Loading insights' })}
        </span>
      ) : null}
    </div>
  );
}

function BalanceChart({ rows }: { rows: CropBalance[] }) {
  const { t } = useTranslation('coordinator');
  const data = rows.map((row) => ({ name: row.crop_name, listed: row.listed_kg, demanded: row.demanded_kg }));
  const listed = t('insights.listed', { defaultValue: 'Listed' });
  const demanded = t('insights.demanded', { defaultValue: 'Demanded' });
  return (
    <figure className="flex flex-col gap-3">
      <div className="h-72 w-full" role="img" aria-label={t('insights.balanceAria', { defaultValue: 'Bar chart of listed and demanded kilograms by crop' })}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={4} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--color-line)" />
            <XAxis dataKey="name" tickLine={false} axisLine={false} tick={axisTick} interval={0} />
            <YAxis tickLine={false} axisLine={false} tick={axisTick} width={56} tickFormatter={(value: number) => formatKg(value)} />
            <Tooltip
              cursor={{ fill: 'var(--color-parchment)', opacity: 0.6 }}
              contentStyle={tooltipStyle}
              formatter={(value) => formatKg(Number(value))}
            />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="listed" name={listed} fill="var(--color-forest-700)" radius={[1, 1, 0, 0]} maxBarSize={36} />
            <Bar dataKey="demanded" name={demanded} fill="var(--color-gold-400)" radius={[1, 1, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">
        <table>
          <thead>
            <tr>
              <th>{t('insights.crop', { defaultValue: 'Crop' })}</th>
              <th>{listed}</th>
              <th>{demanded}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.crop_id}>
                <td>{row.crop_name}</td>
                <td>{formatKg(row.listed_kg)}</td>
                <td>{formatKg(row.demanded_kg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}

function SignalRow({ row }: { row: CropBalance }) {
  const { t } = useTranslation('coordinator');
  const Icon = row.signal === 'shortage' ? TrendingUp : row.signal === 'surplus' ? TrendingDown : Scale;
  const label =
    row.signal === 'shortage'
      ? t('insights.signal.shortage', { defaultValue: 'Shortage' })
      : row.signal === 'surplus'
        ? t('insights.signal.surplus', { defaultValue: 'Surplus' })
        : t('insights.signal.balanced', { defaultValue: 'Balanced' });
  const advice =
    row.signal === 'shortage'
      ? t('insights.advice.shortage', { defaultValue: 'Buyers want more — list and pool quickly, hold firm on price.' })
      : row.signal === 'surplus'
        ? t('insights.advice.surplus', { defaultValue: 'More listed than wanted — find buyers before sell-by dates.' })
        : t('insights.advice.balanced', { defaultValue: 'Supply matches demand.' });
  return (
    <li className="grid gap-3 px-5 py-4 sm:px-6 md:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))] md:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <CropGlyph name={row.crop_name} size="sm" framed />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-display text-lg font-normal text-ink">{row.crop_name}</p>
            <Badge tone={SIGNAL_TONE[row.signal]} size="sm" icon={<Icon aria-hidden="true" strokeWidth={1.25} />}>
              {label}
            </Badge>
          </div>
          <p className="truncate text-xs text-muted">{advice}</p>
        </div>
      </div>
      <Metric label={t('insights.gap', { defaultValue: 'Gap' })}>
        <span className={row.gap_kg > 0 ? 'text-gold-700' : row.gap_kg < 0 ? 'text-warning-ink' : 'text-ink'}>
          {row.gap_kg > 0 ? '+' : ''}
          <Quantity kg={row.gap_kg} />
        </span>
      </Metric>
      <Metric label={t('insights.avgOffer', { defaultValue: 'Avg offer' })}>
        <Money value={row.avg_offer_price_per_kg} perKg />
      </Metric>
      <Metric label={t('insights.mandi', { defaultValue: 'Mandi modal' })}>
        <Money value={row.market_modal_price_per_kg} perKg tone="muted" />
      </Metric>
    </li>
  );
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 md:flex-col md:items-start md:gap-0.5">
      <span className="text-[13px] font-semibold text-muted">{label}</span>
      <span className="tabular-nums">{children}</span>
    </div>
  );
}

function UpcomingChart({ points }: { points: SupplyForecastPoint[] }) {
  const { t } = useTranslation('coordinator');
  const { data, crops, total } = useMemo(() => {
    const today = todayIST();
    const days = Array.from({ length: 14 }, (_, index) => addDays(today, index));
    const cropNames = [...new Set(points.map((point) => point.crop_name))];
    const byDay = days.map((day) => {
      const entry: Record<string, string | number> = { date: day, label: formatDate(day).replace(/\s\d{4}$/, '') };
      for (const crop of cropNames) entry[crop] = 0;
      return entry;
    });
    let sum = 0;
    for (const point of points) {
      const row = byDay.find((entry) => entry.date === point.date);
      if (!row) continue;
      row[point.crop_name] = Number(row[point.crop_name] ?? 0) + point.quantity_kg;
      sum += point.quantity_kg;
    }
    return { data: byDay, crops: cropNames, total: sum };
  }, [points]);

  if (points.length === 0) {
    return <p className="py-10 text-center text-sm text-muted">{t('insights.noUpcoming', { defaultValue: 'Nothing scheduled to become available in the next 14 days.' })}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <p className="font-display text-h2 font-bold text-ink">
          <Quantity kg={total} size="xl" />
        </p>
        <p className="text-sm text-muted">{t('insights.upcomingTotal', { defaultValue: 'across {{count}} crops', count: crops.length })}</p>
      </div>
      <div className="h-64 w-full" role="img" aria-label={t('insights.upcomingAria', { defaultValue: 'Stacked bar chart of kilograms becoming available per day' })}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--color-line)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} minTickGap={8} />
            <YAxis tickLine={false} axisLine={false} tick={axisTick} width={56} tickFormatter={(value: number) => formatKg(value)} />
            <Tooltip cursor={{ fill: 'var(--color-parchment)', opacity: 0.6 }} contentStyle={tooltipStyle} formatter={(value) => formatKg(Number(value))} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
            {crops.map((crop, index) => (
              <Bar
                key={crop}
                dataKey={crop}
                stackId="supply"
                fill={SERIES_COLORS[index % SERIES_COLORS.length]}
                radius={index === crops.length - 1 ? [1, 1, 0, 0] : [0, 0, 0, 0]}
                maxBarSize={28}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

