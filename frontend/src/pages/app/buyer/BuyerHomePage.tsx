import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ArrowRight, BadgeCheck, ClipboardList, Handshake, IndianRupee, Package, Plus, Scale, ShieldAlert, Truck } from 'lucide-react';

import {
  ActionList,
  ActivityFeed,
  KpiStrip,
  Money,
  PageHeader,
  Quantity,
  QueryState,
  SectionCard,
  SupplyCard,
} from '@/components/domain';
import type { KpiItem } from '@/components/domain';
import { Reveal } from '@/components/motion';
import { LinkButton } from '@/components/ui';
import { offerPath } from '@/features/buyer/sourcing';
import { useBuyerDashboard } from '@/features/buyer/sourcingHooks';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { formatPct } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { BuyerDashboard, VerificationStatus } from '@/types/api';

function VerificationBanner({ status }: { status: VerificationStatus }) {
  const { t } = useTranslation('buyer');
  if (status === 'verified') return null;
  const pending = status === 'pending';
  const rejected = status === 'rejected';
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col gap-5 rounded-card border bg-paper px-6 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8',
        rejected ? 'border-danger/30' : 'border-line',
      )}
    >
      <div className="flex items-start gap-4">
        <span aria-hidden="true" className={cn('mt-1 shrink-0', rejected ? 'text-danger' : 'text-gold-700')}>
          {pending ? <BadgeCheck className="size-5" strokeWidth={1.25} /> : <ShieldAlert className="size-5" strokeWidth={1.25} />}
        </span>
        <div>
          <p className="font-display text-h3 font-normal text-ink">
            {pending
              ? t('home.verify.pendingTitle', { defaultValue: 'Verification under review' })
              : rejected
                ? t('home.verify.rejectedTitle', { defaultValue: 'Verification needs another look' })
                : t('home.verify.title', { defaultValue: 'Verify your business to make offers' })}
          </p>
          <p className="mt-2 max-w-2xl text-small leading-relaxed text-ink-2">
            {pending
              ? t('home.verify.pendingBody', {
                  defaultValue: 'A coordinator is checking your documents. Farmers see a verified mark on your offers once it is done.',
                })
              : t('home.verify.body', {
                  defaultValue: 'Farmers and coordinators only accept offers from verified buyers. It takes a GSTIN or trade licence and a few minutes.',
                })}
          </p>
        </div>
      </div>
      {!pending && (
        <LinkButton to="/app/verification" variant={rejected ? 'secondary' : 'primary'} trailingIcon={<ArrowRight className="size-4" strokeWidth={1.25} />}>
          {rejected
            ? t('home.verify.review', { defaultValue: 'Review details' })
            : t('home.verify.cta', { defaultValue: 'Start verification' })}
        </LinkButton>
      )}
    </div>
  );
}

function kpis(data: BuyerDashboard, t: (key: string, options?: Record<string, unknown>) => string): KpiItem[] {
  const s = data.stats;
  return [
    {
      id: 'demands',
      label: t('home.kpi.openDemands', { defaultValue: 'Open requirements' }),
      value: s.open_demands,
      icon: <ClipboardList className="size-4" strokeWidth={1.25} />,
    },
    {
      id: 'offers',
      label: t('home.kpi.activeOffers', { defaultValue: 'Active offers' }),
      value: s.active_offers,
      icon: <Handshake className="size-4" strokeWidth={1.25} />,
    },
    {
      id: 'orders',
      label: t('home.kpi.orders', { defaultValue: 'Orders in progress' }),
      value: s.orders_in_progress,
      icon: <Truck className="size-4" strokeWidth={1.25} />,
    },
    {
      id: 'due',
      label: t('home.kpi.amountDue', { defaultValue: 'Amount due' }),
      value: <Money value={s.amount_due} compact />,
      icon: <IndianRupee className="size-4" strokeWidth={1.25} />,
    },
    {
      id: 'sourced',
      label: t('home.kpi.sourced', { defaultValue: 'Sourced to date' }),
      value: <Quantity kg={s.kg_sourced} />,
      icon: <Package className="size-4" strokeWidth={1.25} />,
    },
    {
      id: 'price',
      label: t('home.kpi.avgPrice', { defaultValue: 'Average price paid' }),
      value: s.avg_price_per_kg === null ? '—' : <Money value={s.avg_price_per_kg} perKg />,
      icon: <Scale className="size-4" strokeWidth={1.25} />,
    },
    {
      id: 'ontime',
      label: t('home.kpi.onTime', { defaultValue: 'On-time delivery' }),
      value: s.on_time_delivery_pct === null ? '—' : formatPct(s.on_time_delivery_pct),
      hint:
        s.on_time_delivery_pct === null ? t('home.kpi.onTimeHint', { defaultValue: 'Shown after your first delivery' }) : undefined,
    },
  ];
}

export default function BuyerHomePage() {
  const { t } = useTranslation('buyer');
  const { user } = useAuth();
  const dashboard = useBuyerDashboard();
  const firstName = user?.full_name.split(' ')[0];

  return (
    <div className="space-y-10">
      <Seo
        title={t('home.seo', { defaultValue: 'Sourcing overview' })}
        description={t('home.description', { defaultValue: 'Open requirements, active offers, orders in progress and payments due.' })}
        path="/app/buyer"
        noindex
      />
      <PageHeader
        eyebrow={user?.organization_name ?? t('home.eyebrow', { defaultValue: 'Sourcing desk' })}
        title={
          firstName
            ? t('home.title', { name: firstName, defaultValue: 'Welcome, {{name}}' })
            : t('home.seo', { defaultValue: 'Sourcing overview' })
        }
        description={t('home.description', {
          defaultValue: 'Open requirements, active offers, orders in progress and payments due.',
        })}
        actions={
          <>
            <LinkButton to="/app/buyer/supply" variant="secondary">
              {t('home.browseSupply', { defaultValue: 'Browse supply' })}
            </LinkButton>
            <LinkButton to="/app/buyer/demands/new" leadingIcon={<Plus className="size-4" strokeWidth={1.25} />}>
              {t('home.newDemand', { defaultValue: 'Post a requirement' })}
            </LinkButton>
          </>
        }
      />

      <QueryState query={dashboard} skeleton="detail" isEmpty={() => false}>
        {(data) => (
          <div className="space-y-10">
            <VerificationBanner status={data.verification_status} />
            <Reveal>
              <KpiStrip items={kpis(data, t)} columns={4} />
            </Reveal>

            <SectionCard
              eyebrow={t('home.supply.eyebrow', { defaultValue: 'Matched to your requirements' })}
              title={t('home.supply.title', { defaultValue: 'Recommended supply' })}
              description={t('home.supply.description', {
                defaultValue: 'Pooled lots and single harvests that fit what you buy, nearest and best-inspected first.',
              })}
              action={
                <Link
                  to="/app/buyer/supply"
                  className="inline-flex items-center gap-2 border-b border-ink/30 pb-1 text-[13px] font-semibold text-ink transition-colors hover:border-gold-700 hover:text-gold-700"
                >
                  {t('home.supply.all', { defaultValue: 'All supply' })}
                  <span aria-hidden="true">→</span>
                </Link>
              }
              variant="flat"
            >
              {data.recommended_supply.length === 0 ? (
                <p className="text-small text-muted">
                  {t('home.supply.empty', {
                    defaultValue: 'Nothing matches yet. Post a requirement and coordinators will pool supply towards it.',
                  })}
                </p>
              ) : (
                <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                  {data.recommended_supply.slice(0, 6).map((item) => (
                    <SupplyCard
                      key={`${item.kind}-${item.id}`}
                      item={item}
                      actions={
                        item.my_offer_status ? undefined : (
                          <LinkButton to={offerPath(item)} size="sm" variant="secondary">
                            {t('supply.makeOffer', { defaultValue: 'Make offer' })}
                          </LinkButton>
                        )
                      }
                    />
                  ))}
                </div>
              )}
            </SectionCard>

            <div className="grid gap-6 lg:grid-cols-2">
              <SectionCard title={t('home.actions.title', { defaultValue: 'Needs your attention' })}>
                <ActionList
                  items={data.action_items}
                  limit={6}
                  emptyTitle={t('home.actions.emptyTitle', { defaultValue: 'You are all caught up' })}
                  emptyDescription={t('home.actions.emptyBody', { defaultValue: 'Counter-offers, deliveries and payments due will appear here.' })}
                />
              </SectionCard>
              <SectionCard title={t('home.activity.title', { defaultValue: 'Recent activity' })}>
                <ActivityFeed
                  items={data.recent_activity}
                  limit={8}
                  emptyTitle={t('home.activity.emptyTitle', { defaultValue: 'No activity yet' })}
                />
              </SectionCard>
            </div>
          </div>
        )}
      </QueryState>
    </div>
  );
}
