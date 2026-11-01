import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { IndianRupee, Scale, ScrollText, ShieldAlert, Users, Weight } from 'lucide-react';

import { KpiStrip, PageHeader, QueryState, SectionCard, type KpiItem } from '@/components/domain';
import { LinkButton } from '@/components/ui';
import { Reveal } from '@/components/motion';
import { useAdminOverview } from '@/features/admin/hooks';
import { formatINR, formatKg, formatNumber, formatPct, formatPerKg } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { AdminOverview, LotStatus, Role } from '@/types/api';

const ROLES: Role[] = ['farmer', 'buyer', 'transporter', 'coordinator', 'admin'];
const LOT_STATUSES: LotStatus[] = [
  'forming',
  'awaiting_consent',
  'open_for_offers',
  'offer_accepted',
  'transport_booked',
  'in_transit',
  'delivered',
  'settled',
  'cancelled',
];

export default function AdminHomePage() {
  const { t } = useTranslation('admin');
  const query = useAdminOverview();

  return (
    <div className="space-y-8">
      <Seo
        title={t('home.seoTitle', { defaultValue: 'Admin overview' })}
        description={t('home.description', { defaultValue: 'Users, verifications, traded volume and the health of the pilot.' })}
        path="/app/admin"
        noindex
      />
      <PageHeader
        eyebrow={t('home.eyebrow', { defaultValue: 'Administration' })}
        title={t('home.title', { defaultValue: 'Admin overview' })}
        description={t('home.description', { defaultValue: 'Users, verifications, traded volume and the health of the pilot.' })}
        actions={
          <>
            <LinkButton to="/app/admin/audit" variant="secondary" leadingIcon={<ScrollText aria-hidden="true" strokeWidth={1.25} />}>
              {t('home.audit', { defaultValue: 'Audit log' })}
            </LinkButton>
            <LinkButton to="/app/admin/users" leadingIcon={<Users aria-hidden="true" strokeWidth={1.25} />}>
              {t('home.users', { defaultValue: 'Manage users' })}
            </LinkButton>
          </>
        }
        divider
      />
      <QueryState query={query} skeleton="cards" isEmpty={() => false}>
        {(data) => <Overview data={data} />}
      </QueryState>
    </div>
  );
}

function Overview({ data }: { data: AdminOverview }) {
  const { t } = useTranslation('admin');
  const totalUsers = ROLES.reduce((sum, r) => sum + (data.users_by_role[r] ?? 0), 0);
  const maxRole = Math.max(1, ...ROLES.map((r) => data.users_by_role[r] ?? 0));
  const m = data.pilot_metrics;

  const headline: KpiItem[] = [
    {
      id: 'users',
      label: t('home.totalUsers', { defaultValue: 'People on MandiMate' }),
      value: formatNumber(totalUsers),
      icon: <Users aria-hidden="true" strokeWidth={1.25} />,
      hint: t('home.farmersHint', { defaultValue: '{{count}} farmers', count: data.users_by_role.farmer ?? 0 }),
    },
    {
      id: 'pending',
      label: t('home.pending', { defaultValue: 'Pending verifications' }),
      value: formatNumber(data.pending_verifications),
      icon: <ShieldAlert aria-hidden="true" strokeWidth={1.25} />,
      hint:
        data.pending_verifications > 0
          ? t('home.pendingHint', { defaultValue: 'Buyers and transporters waiting' })
          : t('home.pendingNone', { defaultValue: 'All clear' }),
    },
    {
      id: 'gmv',
      label: t('home.gmv', { defaultValue: 'Gross merchandise value' }),
      value: formatINR(data.total_gmv, { compact: true }),
      icon: <IndianRupee aria-hidden="true" strokeWidth={1.25} />,
    },
    {
      id: 'kg',
      label: t('home.kg', { defaultValue: 'Produce traded' }),
      value: formatKg(data.total_kg_traded),
      icon: <Weight aria-hidden="true" strokeWidth={1.25} />,
    },
  ];

  const pilot: KpiItem[] = [
    {
      id: 'uplift',
      label: t('home.uplift', { defaultValue: 'Farmer net uplift' }),
      value: m.net_uplift_per_kg == null ? '—' : formatPerKg(m.net_uplift_per_kg, { signed: true }),
      hint: t('home.upliftHint', { defaultValue: 'Net ₹/kg above selling alone' }),
    },
    { id: 'completion', label: t('home.completion', { defaultValue: 'Completion rate' }), value: formatPct(m.completion_rate_pct) },
    {
      id: 'hours',
      label: t('home.hours', { defaultValue: 'Listing → buyer' }),
      value: m.avg_hours_listing_to_buyer == null ? '—' : t('home.hoursValue', { defaultValue: '{{h}} h', h: formatNumber(m.avg_hours_listing_to_buyer, { maxDecimals: 1 }) }),
    },
    { id: 'transport', label: t('home.transport', { defaultValue: 'Transport cost' }), value: formatPerKg(m.transport_cost_per_kg) },
    {
      id: 'delay',
      label: t('home.delay', { defaultValue: 'Payment delay' }),
      value: m.avg_payment_delay_days == null ? '—' : t('home.daysValue', { defaultValue: '{{d}} days', d: formatNumber(m.avg_payment_delay_days, { maxDecimals: 1 }) }),
    },
    { id: 'rejection', label: t('home.rejection', { defaultValue: 'Rejection rate' }), value: formatPct(m.rejection_rate_pct) },
    { id: 'failed', label: t('home.failed', { defaultValue: 'Failed transactions' }), value: formatNumber(m.failed_transactions) },
    {
      id: 'repeat',
      label: t('home.repeat', { defaultValue: 'Repeat farmers / buyers' }),
      value: `${formatPct(m.repeat_farmers_pct)} / ${formatPct(m.repeat_buyers_pct)}`,
    },
  ];

  const chart = LOT_STATUSES.map((s) => ({
    status: s,
    label: t(`common:enums.lotStatus.${s}`, { defaultValue: s.replace(/_/g, ' ') }),
    count: data.lots_by_status[s] ?? 0,
  }));
  const totalLots = chart.reduce((sum, c) => sum + c.count, 0);

  return (
    <div className="space-y-8">
      <Reveal>
        <KpiStrip items={headline} columns={4} />
      </Reveal>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Reveal delay={0.06}>
          <SectionCard
            eyebrow={t('home.lotsEyebrow', { defaultValue: 'Pipeline' })}
            title={t('home.lotsTitle', { defaultValue: 'Lots by status' })}
            description={t('home.lotsBody', { defaultValue: '{{count}} lots across the pilot', count: totalLots })}
          >
            <figure aria-label={t('home.lotsTitle', { defaultValue: 'Lots by status' })} className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }} barCategoryGap={8}>
                  <CartesianGrid horizontal={false} stroke="var(--color-line)" strokeDasharray="2 4" />
                  <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={128}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 12, fill: 'var(--color-ink-2)', fontFamily: 'var(--font-sans)' }}
                  />
                  <ChartTooltip
                    cursor={{ fill: 'var(--color-parchment)' }}
                    contentStyle={{
                      borderRadius: 2,
                      border: '1px solid var(--color-line)',
                      background: 'var(--color-paper)',
                      boxShadow: 'none',
                      fontSize: 12,
                    }}
                    formatter={(value) => [String(value), t('home.lots', { defaultValue: 'Lots' })]}
                  />
                  <Bar dataKey="count" fill="var(--color-forest-900)" radius={0} maxBarSize={14} />
                </BarChart>
              </ResponsiveContainer>
              <figcaption className="sr-only">
                {chart.map((c) => `${c.label}: ${c.count}`).join(', ')}
              </figcaption>
            </figure>
          </SectionCard>
        </Reveal>

        <Reveal delay={0.12}>
          <SectionCard
            eyebrow={t('home.peopleEyebrow', { defaultValue: 'Community' })}
            title={t('home.peopleTitle', { defaultValue: 'Users by role' })}
            action={
              <LinkButton to="/app/admin/users?verification=pending" variant="ghost" size="sm">
                {t('home.review', { defaultValue: 'Review pending' })}
              </LinkButton>
            }
          >
            <ul className="divide-y divide-line border-y border-line">
              {ROLES.map((r) => {
                const count = data.users_by_role[r] ?? 0;
                return (
                  <li key={r} className="py-3.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[13px] font-semibold text-ink-2">
                        {t(`common:enums.role.${r}`, { defaultValue: r })}
                      </span>
                      <span className="font-display text-2xl font-bold leading-none text-ink tabular-nums">{formatNumber(count)}</span>
                    </div>
                    <div className="mt-2.5 h-px overflow-hidden bg-line" aria-hidden="true">
                      <div
                        className={r === 'farmer' ? 'h-full bg-gold-700' : 'h-full bg-ink'}
                        style={{ width: `${(count / maxRole) * 100}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </SectionCard>
        </Reveal>
      </div>

      <Reveal delay={0.06}>
        <SectionCard
          eyebrow={<span className="inline-flex items-center gap-1.5"><Scale className="size-3.5" strokeWidth={1.25} aria-hidden="true" />{t('home.pilotEyebrow', { defaultValue: 'Pilot health' })}</span>}
          title={t('home.pilotTitle', { defaultValue: 'Is pooling paying farmers more?' })}
          description={t('home.pilotBody', {
            defaultValue: 'The measures the pilot is judged on, computed from settled payouts. A dash means not enough data yet.',
          })}
        >
          <KpiStrip items={pilot} columns={4} />
        </SectionCard>
      </Reveal>
    </div>
  );
}
