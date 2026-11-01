import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Boxes, Combine, HandCoins, Mic, PackageCheck, Scale, Sprout, UserPlus, Users, Wallet } from 'lucide-react';
import { Card, LinkButton } from '@/components/ui';
import { ActionList, ActivityFeed, KpiStrip, Money, PageHeader, Quantity, QueryState, SectionCard, type KpiItem } from '@/components/domain';
import { Reveal } from '@/components/motion';
import { Contours } from '@/components/art';
import { PilotMetricsPanel } from '@/features/coordinator/components/PilotMetricsPanel';
import { PipelineBoard } from '@/features/coordinator/components/PipelineBoard';
import { useCoordinatorDashboard } from '@/features/coordinator/hooks';
import { useAuth } from '@/lib/auth';
import { formatNumber } from '@/lib/format';
import { Seo } from '@/lib/seo';

function greetingKey(now: Date): 'morning' | 'afternoon' | 'evening' {
  const hour = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(now));
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

export default function CoordinatorHomePage() {
  const { t } = useTranslation('coordinator');
  const { user } = useAuth();
  const dashboard = useCoordinatorDashboard();
  const stats = dashboard.data?.stats;
  const loading = dashboard.isPending;
  const firstName = user?.full_name.split(/\s+/)[0] ?? '';
  const part = greetingKey(new Date());
  const greeting =
    part === 'morning'
      ? t('home.greetingMorning', { defaultValue: 'Good morning, {{name}}', name: firstName })
      : part === 'afternoon'
        ? t('home.greetingAfternoon', { defaultValue: 'Good afternoon, {{name}}', name: firstName })
        : t('home.greetingEvening', { defaultValue: 'Good evening, {{name}}', name: firstName });

  const kpis: KpiItem[] = [
    {
      id: 'farmers',
      icon: <Users strokeWidth={1.25} />,
      label: t('home.kpi.farmers', { defaultValue: 'Farmers' }),
      value: formatNumber(stats?.farmers),
      hint: t('home.kpi.farmersHint', { defaultValue: 'In your FPO' }),
    },
    {
      id: 'listed',
      icon: <Sprout strokeWidth={1.25} />,
      label: t('home.kpi.listed', { defaultValue: 'Listed now' }),
      value: <Quantity kg={stats?.listed_kg} size="xl" />,
      hint: t('home.kpi.listedHint', { defaultValue: 'Ready to pool' }),
    },
    {
      id: 'forming',
      icon: <Combine strokeWidth={1.25} />,
      label: t('home.kpi.forming', { defaultValue: 'Lots forming' }),
      value: formatNumber(stats?.lots_forming),
      hint: t('home.kpi.formingHint', { defaultValue: 'Gathering consent' }),
    },
    {
      id: 'active',
      icon: <Boxes strokeWidth={1.25} />,
      label: t('home.kpi.active', { defaultValue: 'Lots in motion' }),
      value: formatNumber(stats?.lots_active),
      hint: t('home.kpi.activeHint', { defaultValue: 'Open, agreed or on the road' }),
    },
    {
      id: 'offers',
      icon: <HandCoins strokeWidth={1.25} />,
      label: t('home.kpi.offers', { defaultValue: 'Offers to answer' }),
      value: formatNumber(stats?.offers_pending),
      hint: t('home.kpi.offersHint', { defaultValue: 'Waiting on the seller side' }),
    },
    {
      id: 'deliveries',
      icon: <PackageCheck strokeWidth={1.25} />,
      label: t('home.kpi.deliveries', { defaultValue: 'Deliveries due' }),
      value: formatNumber(stats?.deliveries_pending),
      hint: t('home.kpi.deliveriesHint', { defaultValue: 'To record' }),
    },
    {
      id: 'settlements',
      icon: <Wallet strokeWidth={1.25} />,
      label: t('home.kpi.settlements', { defaultValue: 'Awaiting payment' }),
      value: <Money value={stats?.settlements_pending_amount} compact size="xl" />,
      hint: t('home.kpi.settlementsHint', { defaultValue: 'Buyer balances outstanding' }),
    },
    {
      id: 'disputes',
      icon: <Scale strokeWidth={1.25} />,
      label: t('home.kpi.disputes', { defaultValue: 'Open disputes' }),
      value: formatNumber(stats?.open_disputes),
      hint: t('home.kpi.disputesHint', { defaultValue: 'Need a decision' }),
    },
  ];

  return (
    <div className="flex flex-col gap-8 md:gap-10">
      <Seo
        title={t('home.seoTitle', { defaultValue: 'Operations' })}
        description={t('home.seoDescription', { defaultValue: 'The pipeline of every lot from listing to settlement, with pilot metrics.' })}
        path="/app/coordinator"
        noindex
      />

      <Reveal>
        <PageHeader
          eyebrow={user?.fpo_name ?? t('home.eyebrow', { defaultValue: 'Operations' })}
          title={firstName ? greeting : t('home.title', { defaultValue: 'The deal desk' })}
          description={t('home.description', {
            defaultValue: 'Pool small harvests into buyer-ready lots, negotiate for the group and see every deal through to the farmer’s payout.',
          })}
          actions={
            <>
              <LinkButton to="/app/coordinator/farmers/new" variant="secondary" leadingIcon={<UserPlus aria-hidden="true" strokeWidth={1.25} />}>
                {t('home.registerFarmer', { defaultValue: 'Register farmer' })}
              </LinkButton>
              <LinkButton to="/app/coordinator/harvests/new" variant="secondary" leadingIcon={<Mic aria-hidden="true" strokeWidth={1.25} />}>
                {t('home.assistedListing', { defaultValue: 'Assisted listing' })}
              </LinkButton>
              <LinkButton to="/app/coordinator/lot-builder" leadingIcon={<Combine aria-hidden="true" strokeWidth={1.25} />}>
                {t('home.buildLot', { defaultValue: 'Build a lot' })}
              </LinkButton>
            </>
          }
        />
      </Reveal>

      {dashboard.isError ? (
        <Card className="p-6">
          <QueryState query={dashboard}>{() => null}</QueryState>
        </Card>
      ) : (
        <>
          <KpiStrip items={kpis} loading={loading} columns={4} />

          <SectionCard
            eyebrow={t('pipeline.eyebrow', { defaultValue: 'Deal pipeline' })}
            title={t('pipeline.title', { defaultValue: 'From listing to settlement' })}
            action={
              <Link to="/app/coordinator/lots" className="inline-flex items-center gap-2 border-b border-ink/30 pb-1 text-[13px] font-semibold text-ink transition-colors duration-300 hover:border-ink">
                {t('pipeline.allLots', { defaultValue: 'All lots' })}
                <span aria-hidden="true">→</span>
              </Link>
            }
            flush
            className="overflow-hidden"
          >
            <PipelineBoard columns={dashboard.data?.pipeline} loading={loading} />
          </SectionCard>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <SectionCard
              eyebrow={t('home.actionsEyebrow', { defaultValue: 'Needs you' })}
              title={t('home.actionsTitle', { defaultValue: 'Action items' })}
              description={t('home.actionsDescription', { defaultValue: 'Urgent first, then by due time.' })}
            >
              {loading ? (
                <QueryState query={dashboard} skeleton="list">
                  {() => null}
                </QueryState>
              ) : (
                <ActionList
                  items={dashboard.data?.action_items ?? []}
                  limit={8}
                  emptyTitle={t('home.actionsEmptyTitle', { defaultValue: 'Nothing is waiting on you' })}
                  emptyDescription={t('home.actionsEmptyBody', {
                    defaultValue: 'Consents, offers, quotes and deliveries that need a coordinator will appear here.',
                  })}
                />
              )}
            </SectionCard>
            <SectionCard
              eyebrow={t('home.activityEyebrow', { defaultValue: 'Latest' })}
              title={t('home.activityTitle', { defaultValue: 'Activity across the FPO' })}
            >
              {loading ? (
                <QueryState query={dashboard} skeleton="list">
                  {() => null}
                </QueryState>
              ) : (
                <ActivityFeed items={dashboard.data?.recent_activity ?? []} limit={8} />
              )}
            </SectionCard>
          </div>

          <section aria-labelledby="pilot-metrics-heading" className="relative overflow-hidden rounded-panel border border-line bg-paper">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 text-forest-900/[0.035]">
              <Contours variant="basin" className="size-full" />
            </div>
            <header className="relative flex flex-col gap-4 px-5 pb-4 pt-8 sm:px-8 md:flex-row md:items-end md:justify-between">
              <div className="flex flex-col gap-3">
                <p className="eyebrow eyebrow-rule">{t('metrics.eyebrow', { defaultValue: 'Pilot scorecard' })}</p>
                <h2 id="pilot-metrics-heading" className="font-display text-h2 font-bold text-ink">
                  {t('metrics.title', { defaultValue: 'Are farmers actually earning more?' })}
                </h2>
                <p className="max-w-measure text-sm font-normal leading-relaxed text-ink-2">
                  {t('metrics.description', {
                    defaultValue: 'The measures the pilot is judged on, computed from settled deals only — never from estimates.',
                  })}
                </p>
              </div>
              <Link to="/app/coordinator/insights" className="inline-flex items-center gap-2 border-b border-ink/30 pb-1 text-[13px] font-semibold text-ink transition-colors duration-300 hover:border-ink self-start md:self-end">
                {t('metrics.openInsights', { defaultValue: 'Open insights' })}
                <span aria-hidden="true">→</span>
              </Link>
            </header>
            <div className="relative mt-4 overflow-hidden border-t border-line">
              <PilotMetricsPanel metrics={dashboard.data?.pilot_metrics} loading={loading} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
