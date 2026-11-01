import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Route } from 'lucide-react';

import { PageHeader, QueryState } from '@/components/domain';
import { StaggerGroup, StaggerItem } from '@/components/motion';
import { LinkButton, Tabs, TabsList, TabsTrigger } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { Seo } from '@/lib/seo';
import type { TransportRequestStatus } from '@/types/api';

import { TripCard } from '@/features/transporter/components/TripCard';
import { useTransportRequests } from '@/features/transporter/hooks';
import { bookedQuote, isMyTrip } from '@/features/transporter/requests';

type TripTab = Extract<TransportRequestStatus, 'booked' | 'in_progress' | 'completed'>;

export default function TripsPage() {
  const { t } = useTranslation('transporter');
  const { user } = useAuth();
  const requests = useTransportRequests({ mine: true, limit: 200 });
  const [tab, setTab] = useState<TripTab>('booked');

  const trips = useMemo(() => (requests.data ?? []).filter((request) => isMyTrip(request, user?.id)), [requests.data, user?.id]);
  const counts = useMemo(
    () => ({
      booked: trips.filter((trip) => trip.status === 'booked').length,
      in_progress: trips.filter((trip) => trip.status === 'in_progress').length,
      completed: trips.filter((trip) => trip.status === 'completed').length,
    }),
    [trips],
  );
  const visible = useMemo(() => {
    const rows = trips.filter((trip) => trip.status === tab);
    return rows.sort((a, b) => (tab === 'completed' ? b.pickup_date.localeCompare(a.pickup_date) : a.pickup_date.localeCompare(b.pickup_date)));
  }, [trips, tab]);

  const labels: Record<TripTab, string> = {
    booked: t('trips.booked', { defaultValue: 'Booked' }),
    in_progress: t('trips.inProgress', { defaultValue: 'In progress' }),
    completed: t('trips.completed', { defaultValue: 'Completed' }),
  };

  return (
    <div className="flex flex-col gap-8">
      <Seo title={t('trips.seoTitle', { defaultValue: 'My trips' })} description={t('trips.seoDescription', { defaultValue: 'Booked, running and completed pickups.' })} path="/app/transporter/trips" noindex />
      <PageHeader
        eyebrow={t('trips.eyebrow', { defaultValue: 'On the road' })}
        title={t('trips.title', { defaultValue: 'My trips' })}
        description={t('trips.description', { defaultValue: 'Every booked run, the farms still to visit and what each trip pays.' })}
        breadcrumbs={[{ label: t('nav.home', { defaultValue: 'Home' }), to: '/app/transporter' }, { label: t('trips.title', { defaultValue: 'My trips' }) }]}
        divider
      />

      <Tabs value={tab} defaultValue="booked" onValueChange={(value) => setTab(value as TripTab)}>
        <TabsList label={t('trips.tabs', { defaultValue: 'Trip status' })}>
          {(['booked', 'in_progress', 'completed'] as const).map((key) => (
            <TabsTrigger key={key} value={key} count={requests.data ? counts[key] : undefined}>
              {labels[key]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <QueryState
        query={requests}
        skeleton="cards"
        isEmpty={() => visible.length === 0}
        errorTitle={t('trips.error', { defaultValue: 'Could not load your trips' })}
        empty={{
          icon: <Route strokeWidth={1.25} />,
          title: t('trips.empty', { defaultValue: 'No {{status}} trips', status: labels[tab].toLocaleLowerCase('en-IN') }),
          description:
            tab === 'completed'
              ? t('trips.emptyCompleted', { defaultValue: 'Completed runs and what they paid will be kept here.' })
              : t('trips.emptyBody', { defaultValue: 'Quote on open requests — when a coordinator books you, the trip lands here.' }),
          action: tab === 'completed' ? undefined : <LinkButton to="/app/transporter/requests">{t('home.findLoads', { defaultValue: 'Find loads' })}</LinkButton>,
        }}
      >
        {() => (
          <StaggerGroup className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((trip) => (
              <StaggerItem key={trip.id}>
                <TripCard trip={trip} quote={bookedQuote(trip, user?.id)} className="h-full" />
              </StaggerItem>
            ))}
          </StaggerGroup>
        )}
      </QueryState>
    </div>
  );
}
