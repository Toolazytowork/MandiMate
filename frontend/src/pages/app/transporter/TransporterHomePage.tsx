import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ArrowRight, ClipboardList, Gauge, Route, Send, Truck, Wallet } from 'lucide-react';

import {
  ActionList,
  ActivityFeed,
  KpiStrip,
  Money,
  PageHeader,
  QueryState,
  SectionCard,
  StatCard,
  useKgFormatter,
  type KpiItem,
} from '@/components/domain';
import { Badge, EmptyState, LinkButton } from '@/components/ui';
import { Reveal, StaggerGroup, StaggerItem } from '@/components/motion';
import { useAuth } from '@/lib/auth';
import { formatNumber, formatPct } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { TransporterDashboard } from '@/types/api';

import { RequestCard } from '@/features/transporter/components/RequestCard';
import { TripCard } from '@/features/transporter/components/TripCard';
import { fleetFits } from '@/features/transporter/fleet';
import { useTransporterDashboard, useVehicles } from '@/features/transporter/hooks';
import { activeQuote, bookedQuote } from '@/features/transporter/requests';

export default function TransporterHomePage() {
  const { t } = useTranslation('transporter');
  const { user } = useAuth();
  const dashboard = useTransporterDashboard();
  const vehicles = useVehicles();
  const formatKg = useKgFormatter();
  const firstName = user?.full_name?.split(' ')[0];

  return (
    <div className="flex flex-col gap-10 sm:gap-12">
      <Seo title={t('home.seoTitle', { defaultValue: 'Transporter home' })} description={t('home.seoDescription', { defaultValue: 'Open pickups, active trips and what your fleet earned.' })} path="/app/transporter" noindex />
      <PageHeader
        eyebrow={t('home.eyebrow', { defaultValue: 'Transporter' })}
        title={firstName ? t('home.titleNamed', { defaultValue: 'Good day, {{name}}', name: firstName }) : t('home.title', { defaultValue: 'Your road today' })}
        description={t('home.description', { defaultValue: 'Pooled harvests waiting for a truck, the trips you are running and what they pay.' })}
        actions={
          <>
            <LinkButton to="/app/transporter/vehicles" variant="secondary" leadingIcon={<Truck strokeWidth={1.25} />}>
              {t('home.fleet', { defaultValue: 'My fleet' })}
            </LinkButton>
            <LinkButton to="/app/transporter/requests" trailingIcon={<ArrowRight strokeWidth={1.25} />}>
              {t('home.findLoads', { defaultValue: 'Find loads' })}
            </LinkButton>
          </>
        }
        divider
      />

      <QueryState<TransporterDashboard> query={dashboard} skeleton="cards" isEmpty={() => false} errorTitle={t('home.error', { defaultValue: 'Could not load your dashboard' })}>
        {(data) => {
          const kpis: KpiItem[] = [
            { id: 'open', label: t('home.kpi.open', { defaultValue: 'Open requests' }), value: formatNumber(data.stats.open_requests), icon: <ClipboardList strokeWidth={1.25} /> },
            { id: 'quotes', label: t('home.kpi.quotes', { defaultValue: 'Quotes sent' }), value: formatNumber(data.stats.quotes_submitted), icon: <Send strokeWidth={1.25} /> },
            { id: 'trips', label: t('home.kpi.completed', { defaultValue: 'Trips completed' }), value: formatNumber(data.stats.completed_trips), icon: <Route strokeWidth={1.25} /> },
            {
              id: 'util',
              label: t('home.kpi.utilisation', { defaultValue: 'Avg. utilisation' }),
              value: data.stats.avg_utilization_pct == null ? '—' : formatPct(data.stats.avg_utilization_pct, { decimals: 0 }),
              icon: <Gauge strokeWidth={1.25} />,
              hint: t('home.kpi.utilisationHint', { defaultValue: 'Load as a share of capacity' }),
            },
          ];
          return (
            <div className="flex flex-col gap-10 sm:gap-12">
              <Reveal>
                <div className="grid gap-4 lg:grid-cols-[1.1fr_2fr]">
                  <StatCard
                    tone="dark"
                    size="lg"
                    label={t('home.earnings', { defaultValue: 'Earned on MandiMate' })}
                    value={<Money value={data.stats.earnings_total} size="xl" />}
                    icon={<Wallet strokeWidth={1.25} />}
                    hint={t('home.moved', { defaultValue: '{{kg}} moved · {{count}} active trips', kg: formatKg(data.stats.kg_moved), count: data.stats.active_trips })}
                  />
                  <KpiStrip items={kpis} columns={2} />
                </div>
              </Reveal>

              <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
                <div className="flex flex-col gap-6">
                  <SectionCard
                    eyebrow={t('home.tripsEyebrow', { defaultValue: 'On the road' })}
                    title={t('home.tripsTitle', { defaultValue: 'Active trips' })}
                    action={<Link to="/app/transporter/trips" className="inline-flex items-center gap-2 border-b border-ink/40 pb-1 text-[13px] font-semibold text-ink transition-colors hover:border-gold-700 hover:text-gold-700">{t('home.allTrips', { defaultValue: 'All trips' })}<span aria-hidden="true">→</span></Link>}
                    variant="flat"
                  >
                    {data.active_trips.length === 0 ? (
                      <EmptyState
                        size="sm"
                        framed={false}
                        icon={<Truck strokeWidth={1.25} />}
                        title={t('home.noTrips', { defaultValue: 'No trips booked right now' })}
                        description={t('home.noTripsBody', { defaultValue: 'When a coordinator books your quote, the trip appears here with every farm stop in order.' })}
                      />
                    ) : (
                      <StaggerGroup className="grid gap-4 md:grid-cols-2">
                        {data.active_trips.map((trip) => (
                          <StaggerItem key={trip.id}>
                            <TripCard trip={trip} quote={bookedQuote(trip, user?.id)} compact />
                          </StaggerItem>
                        ))}
                      </StaggerGroup>
                    )}
                  </SectionCard>

                  <SectionCard
                    eyebrow={t('home.openEyebrow', { defaultValue: 'Waiting for a truck' })}
                    title={t('home.openTitle', { defaultValue: 'Open pickup requests' })}
                    action={
                      <span className="flex items-center gap-4">
                        <Badge tone="gold" size="sm">{formatNumber(data.stats.open_requests)}</Badge>
                        <Link to="/app/transporter/requests" className="inline-flex items-center gap-2 border-b border-ink/40 pb-1 text-[13px] font-semibold text-ink transition-colors hover:border-gold-700 hover:text-gold-700">{t('home.allRequests', { defaultValue: 'Browse all' })}<span aria-hidden="true">→</span></Link>
                      </span>
                    }
                    variant="flat"
                  >
                    {data.open_requests.length === 0 ? (
                      <EmptyState
                        size="sm"
                        framed={false}
                        icon={<ClipboardList strokeWidth={1.25} />}
                        title={t('home.noOpen', { defaultValue: 'No open requests' })}
                        description={t('home.noOpenBody', { defaultValue: 'New pooled lots are posted as soon as farmers consent.' })}
                      />
                    ) : (
                      <StaggerGroup className="grid gap-4 md:grid-cols-2">
                        {data.open_requests.slice(0, 4).map((request) => (
                          <StaggerItem key={request.id}>
                            <RequestCard
                              request={request}
                              to={`/app/transporter/requests/${request.id}`}
                              myQuote={activeQuote(request, user?.id)}
                              fits={fleetFits(vehicles.data, request)}
                            />
                          </StaggerItem>
                        ))}
                      </StaggerGroup>
                    )}
                  </SectionCard>
                </div>

                <div className="flex flex-col gap-6">
                  <SectionCard title={t('home.actions', { defaultValue: 'Needs your attention' })} variant="parchment">
                    <ActionList items={data.action_items} limit={5} emptyTitle={t('home.noActions', { defaultValue: 'All clear' })} emptyDescription={t('home.noActionsBody', { defaultValue: 'Nothing is waiting on you.' })} />
                  </SectionCard>
                  <SectionCard title={t('home.activity', { defaultValue: 'Recent activity' })}>
                    <ActivityFeed items={data.recent_activity} limit={6} />
                  </SectionCard>
                </div>
              </div>
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}
