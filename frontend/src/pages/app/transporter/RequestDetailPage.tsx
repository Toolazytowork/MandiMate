import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { ArrowRight, CalendarDays, Clock, MapPin, Snowflake, Undo2 } from 'lucide-react';

import {
  ConfirmDialog,
  CropGlyph,
  Money,
  PageHeader,
  QueryState,
  SectionCard,
  StatusBadge,
  TransportPlanSummary,
  useKgFormatter,
  useUiLanguage,
} from '@/components/domain';
import { Reveal } from '@/components/motion';
import { Badge, Button, Card, EmptyState, LinkButton, toast } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { formatDate, formatNumber, formatRelative } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { TransportQuote, TransportRequest } from '@/types/api';

import { QuoteForm } from '@/features/transporter/components/QuoteForm';
import { planFromRequest } from '@/features/transporter/fleet';
import { errorMessage } from '@/features/transporter/forms';
import { useTransportRequest, useVehicles, useWithdrawQuote } from '@/features/transporter/hooks';
import { activeQuote, bookedQuote, isQuotable, myQuotes } from '@/features/transporter/requests';

export default function RequestDetailPage() {
  const { requestId = '' } = useParams();
  const { t } = useTranslation('transporter');
  const request = useTransportRequest(requestId);

  return (
    <div className="flex flex-col gap-8">
      <Seo title={t('detail.seoTitle', { defaultValue: 'Pickup request' })} description={t('detail.seoDescription', { defaultValue: 'Stops, route, load and timing — and your quote.' })} path={`/app/transporter/requests/${requestId}`} noindex />
      <QueryState<TransportRequest> query={request} skeleton="detail" isEmpty={() => false} errorTitle={t('detail.error', { defaultValue: 'Could not load this request' })}>
        {(data) => <RequestDetail request={data} />}
      </QueryState>
    </div>
  );
}

function RequestDetail({ request }: { request: TransportRequest }) {
  const { t } = useTranslation('transporter');
  const { user } = useAuth();
  const locale = useUiLanguage();
  const formatKg = useKgFormatter();
  const vehicles = useVehicles();
  const withdraw = useWithdrawQuote(request.id);
  const [confirming, setConfirming] = useState<TransportQuote | null>(null);

  const mine = myQuotes(request, user?.id);
  const pending = activeQuote(request, user?.id);
  const booked = bookedQuote(request, user?.id);
  const quotable = isQuotable(request);
  const plan = planFromRequest(request);

  const onWithdraw = async () => {
    if (!confirming) return;
    try {
      await withdraw.mutateAsync(confirming.id);
      toast.success(t('detail.withdrawn', { defaultValue: 'Quote withdrawn' }), { description: t('detail.withdrawnBody', { defaultValue: 'You can send a new price while the request is open.' }) });
    } catch (error) {
      toast.error(errorMessage(error, t('detail.withdrawFailed', { defaultValue: 'Could not withdraw the quote' })));
      throw error;
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={request.lot_code}
        title={t('request.title', { quantity: formatKg(request.total_quantity_kg), crop: request.crop_name })}
        description={t('detail.description', { defaultValue: '{{count}} farm stops, collected in order and delivered to {{destination}}.', count: request.stops.length, destination: request.destination_name })}
        breadcrumbs={[
          { label: t('nav.home', { defaultValue: 'Home' }), to: '/app/transporter' },
          { label: t('requests.title', { defaultValue: 'Pickup requests' }), to: '/app/transporter/requests' },
          { label: request.lot_code },
        ]}
        meta={
          <>
            <StatusBadge kind="transport" value={request.status} />
            {request.requires_refrigeration ? (
              <Badge tone="info" icon={<Snowflake strokeWidth={1.25} />}>{t('request.refrigerated')}</Badge>
            ) : null}
            <Badge tone="neutral" icon={<CalendarDays strokeWidth={1.25} />}>
              {t('detail.pickupOn', { defaultValue: 'Pickup {{date}}', date: formatDate(request.pickup_date, { locale }) })}
            </Badge>
          </>
        }
        actions={booked ? <LinkButton to={`/app/transporter/trips/${request.id}`} trailingIcon={<ArrowRight strokeWidth={1.25} />}>{t('detail.openTrip', { defaultValue: 'Open trip' })}</LinkButton> : undefined}
        divider
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col gap-6">
          <Reveal>
            <SectionCard eyebrow={t('detail.routeEyebrow', { defaultValue: 'Route' })} title={t('detail.routeTitle', { defaultValue: 'The run, stop by stop' })} variant="flat">
              <TransportPlanSummary plan={plan} />
            </SectionCard>
          </Reveal>

          <SectionCard title={t('detail.stopsTitle', { defaultValue: 'Farm stops' })} flush>
            <ol className="divide-y divide-line">
              {[...request.stops].sort((a, b) => a.sequence - b.sequence).map((stop) => (
                <li key={stop.id} className="flex items-center gap-4 px-5 py-4 sm:px-6">
                  <span aria-hidden="true" className="w-8 shrink-0 font-display text-xl not-italic tabular-nums text-gold-700">
                    {String(stop.sequence).padStart(2, '0')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{stop.farmer_name}</p>
                    <p className="flex items-center gap-1 truncate text-sm text-muted">
                      <MapPin aria-hidden="true" strokeWidth={1.25} className="size-3.5" />
                      {stop.village ?? t('detail.noVillage', { defaultValue: 'Village not given' })}
                    </p>
                  </div>
                  <span className="tabular-nums text-sm text-ink/85">{formatKg(stop.quantity_kg)}</span>
                </li>
              ))}
            </ol>
          </SectionCard>

          {request.notes ? (
            <Card variant="parchment" className="p-5 sm:p-6">
              <p className="eyebrow mb-2">{t('detail.coordinatorNotes', { defaultValue: 'From the coordinator' })}</p>
              <p className="text-body text-ink/85">{request.notes}</p>
            </Card>
          ) : null}
        </div>

        <aside className="flex flex-col gap-6 lg:sticky lg:top-24">
          <Card className="flex items-center gap-4 p-5 sm:p-6">
            <CropGlyph name={request.crop_name} lotCode={request.lot_code} framed size="lg" />
            <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="text-[13px] font-semibold text-muted">{t('request.estimate')}</dt>
                <dd><Money value={request.estimated_cost} size="md" /></dd>
              </div>
              <div>
                <dt className="text-[13px] font-semibold text-muted">{t('request.distance')}</dt>
                <dd className="tabular-nums text-ink">{t('common:units.kmValue', { value: formatNumber(request.estimated_distance_km, { maxDecimals: 1 }) })}</dd>
              </div>
              <div>
                <dt className="text-[13px] font-semibold text-muted">{t('request.suggested')}</dt>
                <dd className="text-ink">{t(`common:enums.vehicleType.${request.suggested_vehicle_type}`)}</dd>
              </div>
              <div>
                <dt className="text-[13px] font-semibold text-muted">{t('detail.perKg', { defaultValue: 'Estimate per kg' })}</dt>
                <dd><Money value={request.total_quantity_kg > 0 ? request.estimated_cost / request.total_quantity_kg : null} perKg size="sm" /></dd>
              </div>
            </dl>
          </Card>

          {mine.length > 0 ? (
            <SectionCard title={t('detail.yourQuotes', { defaultValue: 'Your quotes' })} flush>
              <ul className="divide-y divide-line">
                {mine.map((quote) => (
                  <li key={quote.id} className="flex flex-col gap-3 px-5 py-4 sm:px-6">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-col">
                        <Money value={quote.price_total} size="lg" />
                        <span className="text-xs text-muted">
                          <Money value={quote.price_per_kg} perKg size="sm" className="text-xs font-normal text-muted" /> · {t(`common:enums.vehicleType.${quote.vehicle_type}`)}
                        </span>
                      </div>
                      <StatusBadge kind="quote" value={quote.status} size="sm" />
                    </div>
                    <p className="flex items-center gap-1.5 text-xs text-muted">
                      <Clock aria-hidden="true" strokeWidth={1.25} className="size-3.5" />
                      {t('detail.quoteMeta', { defaultValue: '{{hours}} h to deliver · sent {{when}}', hours: formatNumber(quote.eta_hours, { maxDecimals: 1 }), when: formatRelative(quote.created_at, { locale }) })}
                    </p>
                    {quote.notes ? <p className="text-sm text-ink/80">{quote.notes}</p> : null}
                    {quote.status === 'submitted' && quotable ? (
                      <Button variant="secondary" size="sm" leadingIcon={<Undo2 strokeWidth={1.25} />} onClick={() => setConfirming(quote)} className="self-start">
                        {t('detail.withdraw', { defaultValue: 'Withdraw quote' })}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}

          {quotable && !pending ? (
            <SectionCard
              eyebrow={t('detail.quoteEyebrow', { defaultValue: 'Your price' })}
              title={mine.length > 0 ? t('detail.requote', { defaultValue: 'Send a new quote' }) : t('detail.quoteTitle', { defaultValue: 'Quote this run' })}
              description={t('detail.quoteDescription', { defaultValue: 'One price for every stop and the drop. Farmers see transport as a cost per kg, so a fair, full truck helps everyone.' })}
            >
              <QuoteForm request={request} vehicles={vehicles.data} vehiclesLoading={vehicles.isPending} />
            </SectionCard>
          ) : null}

          {!quotable && !booked ? (
            <EmptyState
              size="sm"
              title={t('detail.closed', { defaultValue: 'Quoting has closed' })}
              description={t('detail.closedBody', { defaultValue: 'This request has been booked or cancelled. Look for other loads that fit your fleet.' })}
              action={<LinkButton to="/app/transporter/requests" variant="secondary">{t('detail.browse', { defaultValue: 'Browse requests' })}</LinkButton>}
            />
          ) : null}
        </aside>
      </div>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => (open ? undefined : setConfirming(null))}
        title={t('detail.withdrawTitle', { defaultValue: 'Withdraw this quote?' })}
        description={t('detail.withdrawBody', { defaultValue: 'The coordinator will no longer see it. You can send a fresh price while the request stays open.' })}
        confirmLabel={t('detail.withdraw', { defaultValue: 'Withdraw quote' })}
        tone="danger"
        onConfirm={onWithdraw}
      />
    </>
  );
}
