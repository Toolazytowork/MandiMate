import { CalendarDays, PackageCheck, Truck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CropGlyph, KpiStrip, Money, PageHeader, Quantity, QueryState, SectionCard } from '@/components/domain';
import { Reveal, StaggerGroup, StaggerItem } from '@/components/motion';
import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui';
import { CreateTransportRequestDialog } from '@/features/coordinator-ops/components/CreateTransportRequestDialog';
import { TransportRequestCard } from '@/features/coordinator-ops/components/TransportRequestCard';
import { useLots, useTransportRequests } from '@/features/coordinator-ops/hooks';
import { formatDate } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { Lot, TransportRequest, TransportRequestStatus } from '@/types/api';

type Tab = 'quoting' | 'live' | 'done';

const TAB_STATUSES: Record<Tab, readonly TransportRequestStatus[]> = {
  quoting: ['open', 'quoted'],
  live: ['booked', 'in_progress'],
  done: ['completed', 'cancelled'],
};

export default function TransportPage() {
  const { t } = useTranslation('coordinatorOps');
  const [tab, setTab] = useState<Tab>('quoting');
  const [planning, setPlanning] = useState<Lot | null>(null);

  const lots = useLots({ status: 'offer_accepted' });
  const requests = useTransportRequests({ limit: 100 });

  const needing = useMemo(() => (lots.data ?? []).filter((lot) => !lot.transport_request_id), [lots.data]);
  const grouped = useMemo(() => {
    const result: Record<Tab, TransportRequest[]> = { quoting: [], live: [], done: [] };
    for (const request of requests.data ?? []) {
      const key = (Object.keys(TAB_STATUSES) as Tab[]).find((k) => TAB_STATUSES[k].includes(request.status));
      if (key) result[key].push(request);
    }
    return result;
  }, [requests.data]);

  const quotesWaiting = grouped.quoting.reduce((n, r) => n + r.quotes.filter((q) => q.status === 'submitted').length, 0);
  const liveKg = grouped.live.reduce((n, r) => n + r.total_quantity_kg, 0);

  return (
    <div className="space-y-10">
      <Seo
        title={t('transport.seoTitle', { defaultValue: 'Transport' })}
        description={t('transport.description', { defaultValue: 'Pickup requests, quotes and bookings across all lots.' })}
        path="/app/coordinator/transport"
        noindex
      />
      <PageHeader
        eyebrow={t('eyebrow', { defaultValue: 'Back office' })}
        title={t('transport.title', { defaultValue: 'Transport' })}
        description={t('transport.lede', {
          defaultValue: 'Pool every pickup into one route, compare quotes side by side, and follow each trip until the last crate is loaded.',
        })}
        divider
      />

      <KpiStrip
        loading={lots.isPending || requests.isPending}
        items={[
          { id: 'need', label: t('transport.kpi.need', { defaultValue: 'Lots needing transport' }), value: needing.length, icon: <PackageCheck strokeWidth={1.25} aria-hidden /> },
          { id: 'quotes', label: t('transport.kpi.quotes', { defaultValue: 'Quotes to review' }), value: quotesWaiting },
          { id: 'live', label: t('transport.kpi.live', { defaultValue: 'Trips booked or moving' }), value: grouped.live.length, icon: <Truck strokeWidth={1.25} aria-hidden /> },
          { id: 'kg', label: t('transport.kpi.kg', { defaultValue: 'Produce on the road' }), value: <Quantity kg={liveKg} /> },
        ]}
      />

      <Reveal>
        <SectionCard
          eyebrow={t('transport.need.eyebrow', { defaultValue: 'Step one' })}
          title={t('transport.need.title', { defaultValue: 'Accepted deals waiting for a truck' })}
          description={t('transport.need.description', {
            defaultValue: 'Each lot below has a buyer. Preview the pooled route and open it to verified transporters.',
          })}
          flush
        >
          <QueryState
            query={lots}
            skeleton="list"
            isEmpty={() => needing.length === 0}
            empty={{
              title: t('transport.need.emptyTitle', { defaultValue: 'Every accepted lot has transport' }),
              description: t('transport.need.emptyBody', { defaultValue: 'New deals appear here the moment a buyer’s offer is accepted.' }),
              icon: <Truck strokeWidth={1.25} aria-hidden />,
            }}
          >
            {() => (
              <ul className="divide-y divide-line/70">
                {needing.map((lot) => (
                  <li key={lot.id} className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <div className="flex min-w-0 items-center gap-4">
                      <CropGlyph name={lot.crop_name} lotCode={lot.code} size="md" framed />
                      <div className="min-w-0">
                        <p className="font-display font-bold text-h3 text-ink">{lot.code}</p>
                        <p className="flex flex-wrap gap-x-3 text-small text-muted">
                          <span>{lot.crop_name}</span>
                          <Quantity kg={lot.total_quantity_kg} />
                          <span>{t('transport.need.members', { defaultValue: '{{count}} farmers', count: lot.member_count })}</span>
                          <span className="inline-flex items-center gap-1">
                            <CalendarDays strokeWidth={1.25} className="size-3.5" aria-hidden />
                            {formatDate(lot.pickup_date)}
                          </span>
                          {lot.buyer_name ? (
                            <span>
                              {lot.buyer_name}
                              {lot.price_per_kg != null ? (
                                <>
                                  {' · '}
                                  <Money value={lot.price_per_kg} perKg size="sm" />
                                </>
                              ) : null}
                            </span>
                          ) : null}
                        </p>
                      </div>
                    </div>
                    <Button onClick={() => setPlanning(lot)} leadingIcon={<Truck strokeWidth={1.25} aria-hidden />} className="shrink-0">
                      {t('transport.need.cta', { defaultValue: 'Plan & request' })}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </SectionCard>
      </Reveal>

      <section aria-labelledby="transport-requests" className="space-y-5">
        <div className="flex flex-col gap-1">
          <p className="eyebrow eyebrow-rule">{t('transport.requests.eyebrow', { defaultValue: 'Requests' })}</p>
          <h2 id="transport-requests" className="font-display font-bold text-h2 text-ink">
            {t('transport.requests.title', { defaultValue: 'Quotes and trips' })}
          </h2>
        </div>
        <Tabs value={tab} defaultValue="quoting" onValueChange={(value) => setTab(value as Tab)}>
          <TabsList label={t('transport.tabs.label', { defaultValue: 'Transport requests by stage' })}>
            <TabsTrigger value="quoting" count={grouped.quoting.length}>
              {t('transport.tabs.quoting', { defaultValue: 'Awaiting a booking' })}
            </TabsTrigger>
            <TabsTrigger value="live" count={grouped.live.length}>
              {t('transport.tabs.live', { defaultValue: 'Booked & live' })}
            </TabsTrigger>
            <TabsTrigger value="done" count={grouped.done.length}>
              {t('transport.tabs.done', { defaultValue: 'Completed' })}
            </TabsTrigger>
          </TabsList>
          {(Object.keys(TAB_STATUSES) as Tab[]).map((key) => (
            <TabsContent key={key} value={key} className="pt-6">
              <QueryState
                query={requests}
                skeleton="cards"
                isEmpty={() => grouped[key].length === 0}
                empty={{
                  title: t(`transport.empty.${key}`, {
                    defaultValue:
                      key === 'quoting' ? 'No requests waiting for quotes' : key === 'live' ? 'No trips on the road right now' : 'No completed trips yet',
                  }),
                  icon: <Truck strokeWidth={1.25} aria-hidden />,
                }}
              >
                {() => (
                  <StaggerGroup className="space-y-5">
                    {grouped[key].map((request) => (
                      <StaggerItem key={request.id}>
                        <TransportRequestCard request={request} />
                      </StaggerItem>
                    ))}
                  </StaggerGroup>
                )}
              </QueryState>
            </TabsContent>
          ))}
        </Tabs>
      </section>

      <CreateTransportRequestDialog lot={planning} onOpenChange={(open) => !open && setPlanning(null)} />
    </div>
  );
}
