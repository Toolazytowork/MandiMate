import { BadgeCheck, CalendarDays, Check, Clock, MapPin, Route, Snowflake, Truck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { ConfirmDialog, CropGlyph, Delta, Money, Quantity, StatusBadge } from '@/components/domain';
import { Badge, Button, Card, Progress, toast } from '@/components/ui';
import { errorMessage } from '@/features/coordinator/utils';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import type { TransportQuote, TransportRequest } from '@/types/api';

import { useAcceptQuote } from '../hooks';

const QUOTABLE = new Set<TransportRequest['status']>(['open', 'quoted']);
const LIVE = new Set<TransportRequest['status']>(['booked', 'in_progress']);

/** One transport request: route facts, quotes side by side, and live trip progress once booked. */
export function TransportRequestCard({ request }: { request: TransportRequest }) {
  const { t } = useTranslation('coordinatorOps');
  const vehicle = t(`common:enums.vehicleType.${request.suggested_vehicle_type}`, {
    defaultValue: request.suggested_vehicle_type.replace(/_/g, ' '),
  });

  return (
    <Card as="article" className="overflow-hidden" aria-labelledby={`req-${request.id}`}>
      <header className="flex flex-col gap-4 border-b border-line/70 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="flex min-w-0 items-start gap-4">
          <CropGlyph name={request.crop_name} lotCode={request.lot_code} size="md" framed />
          <div className="min-w-0 space-y-1">
            <p className="eyebrow text-muted">{request.crop_name}</p>
            <h3 id={`req-${request.id}`} className="font-display font-bold text-h3 text-ink">
              <Link to={`/app/coordinator/lots/${request.lot_id}`} className="link-luxe">
                {request.lot_code}
              </Link>
            </h3>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-small text-muted">
              <li className="inline-flex items-center gap-1.5">
                <Quantity kg={request.total_quantity_kg} />
              </li>
              <li className="inline-flex items-center gap-1.5">
                <CalendarDays strokeWidth={1.25} className="size-3.5" aria-hidden />
                {formatDate(request.pickup_date)}
              </li>
              <li className="inline-flex items-center gap-1.5">
                <MapPin strokeWidth={1.25} className="size-3.5" aria-hidden />
                {request.destination_name}
              </li>
              <li className="inline-flex items-center gap-1.5">
                <Route strokeWidth={1.25} className="size-3.5" aria-hidden />
                {t('transport.km', { defaultValue: '{{km}} km', km: formatNumber(request.estimated_distance_km) })}
              </li>
              {request.requires_refrigeration ? (
                <li className="inline-flex items-center gap-1.5 text-ink-2">
                  <Snowflake strokeWidth={1.25} className="size-3.5" aria-hidden />
                  {t('transport.reefer', { defaultValue: 'Refrigerated' })}
                </li>
              ) : null}
            </ul>
          </div>
        </div>
        <div className="flex shrink-0 flex-row items-center gap-3 sm:flex-col sm:items-end">
          <StatusBadge kind="transport" value={request.status} />
          <p className="text-small text-muted">
            {t('transport.estimate', { defaultValue: 'Estimate' })}{' '}
            <Money value={request.estimated_cost} size="sm" className="text-ink" /> · {vehicle}
          </p>
        </div>
      </header>

      {QUOTABLE.has(request.status) ? <QuotesCompare request={request} /> : null}
      {LIVE.has(request.status) || request.status === 'completed' ? <TripProgress request={request} /> : null}
      {request.notes ? (
        <p className="border-t border-line/70 px-5 py-4 text-small text-muted sm:px-6">
          <span className="font-medium text-ink">{t('transport.notes', { defaultValue: 'Notes' })}: </span>
          {request.notes}
        </p>
      ) : null}
    </Card>
  );
}

function QuotesCompare({ request }: { request: TransportRequest }) {
  const { t } = useTranslation('coordinatorOps');
  const accept = useAcceptQuote();
  const [pending, setPending] = useState<TransportQuote | null>(null);
  const quotes = request.quotes
    .filter((quote) => quote.status === 'submitted')
    .sort((a, b) => a.price_total - b.price_total);
  const best = quotes[0]?.id;

  if (quotes.length === 0) {
    return (
      <div className="flex items-center gap-3 px-5 py-6 text-small text-muted sm:px-6">
        <Clock strokeWidth={1.25} className="size-4 shrink-0" aria-hidden />
        {t('transport.quotes.none', {
          defaultValue: 'Waiting for quotes. Verified transporters nearby have been notified.',
        })}
      </div>
    );
  }

  return (
    <section className="p-5 sm:p-6" aria-label={t('transport.quotes.label', { defaultValue: 'Quotes' })}>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h4 className="eyebrow text-muted">
          {t('transport.quotes.title', { defaultValue: '{{count}} quotes, lowest first', count: quotes.length })}
        </h4>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {quotes.map((quote) => {
          const isBest = quote.id === best;
          const vsEstimate = quote.price_total - request.estimated_cost;
          return (
            <li
              key={quote.id}
              className={cn(
                'flex flex-col gap-4 rounded-card border bg-paper p-5 transition-colors',
                isBest ? 'border-gold-700/50' : 'border-line',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{quote.transporter_name}</p>
                  <p className="text-small text-muted">
                    {t(`common:enums.vehicleType.${quote.vehicle_type}`, { defaultValue: quote.vehicle_type.replace(/_/g, ' ') })}
                    {' · '}
                    <Quantity kg={quote.capacity_kg} />
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {isBest ? (
                    <Badge tone="gold" size="sm">
                      {t('transport.quotes.best', { defaultValue: 'Lowest' })}
                    </Badge>
                  ) : null}
                  {quote.transporter_verified ? (
                    <Badge tone="success" size="sm" icon={<BadgeCheck strokeWidth={1.25} aria-hidden />}>
                      {t('transport.quotes.verified', { defaultValue: 'Verified' })}
                    </Badge>
                  ) : (
                    <Badge tone="warning" size="sm">
                      {t('transport.quotes.unverified', { defaultValue: 'Unverified' })}
                    </Badge>
                  )}
                </div>
              </div>
              <dl className="grid grid-cols-3 gap-2 border-t border-line/70 pt-3 text-small">
                <div>
                  <dt className="text-[13px] font-semibold text-muted">{t('transport.quotes.total', { defaultValue: 'Total' })}</dt>
                  <dd className="font-display font-bold text-h3 text-ink">
                    <Money value={quote.price_total} size="sm" />
                  </dd>
                </div>
                <div>
                  <dt className="text-[13px] font-semibold text-muted">{t('transport.quotes.perKg', { defaultValue: 'Per kg' })}</dt>
                  <dd className="text-ink">
                    <Money value={quote.price_per_kg} perKg decimals={2} size="sm" />
                  </dd>
                </div>
                <div>
                  <dt className="text-[13px] font-semibold text-muted">{t('transport.quotes.eta', { defaultValue: 'ETA' })}</dt>
                  <dd className="text-ink">{t('transport.quotes.hours', { defaultValue: '{{hours}} h', hours: formatNumber(quote.eta_hours) })}</dd>
                </div>
              </dl>
              <div className="flex items-center justify-between gap-3">
                <Delta value={vsEstimate} perKg={false} goodWhen="down" label={t('transport.quotes.vsEstimate', { defaultValue: 'vs estimate' })} />
                <Button size="sm" variant={isBest ? 'primary' : 'secondary'} onClick={() => setPending(quote)} leadingIcon={<Check strokeWidth={1.25} aria-hidden />}>
                  {t('transport.quotes.accept', { defaultValue: 'Book' })}
                </Button>
              </div>
              {quote.notes ? <p className="text-small text-muted">{quote.notes}</p> : null}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={t('transport.quotes.confirmTitle', { defaultValue: 'Book {{name}}?', name: pending?.transporter_name ?? '' })}
        description={t('transport.quotes.confirmBody', {
          defaultValue: 'Other quotes on {{code}} will be declined and the transporter is notified to plan the pickup.',
          code: request.lot_code,
        })}
        confirmLabel={t('transport.quotes.confirm', { defaultValue: 'Book transport' })}
        loading={accept.isPending}
        onConfirm={() =>
          pending
            ? accept.mutateAsync(pending.id).then(
                () => {
                  toast.success(t('transport.quotes.booked', { defaultValue: '{{name}} booked for {{code}}', name: pending.transporter_name, code: request.lot_code }));
                  setPending(null);
                },
                (error: unknown) => {
                  toast.error(errorMessage(error));
                  throw error;
                },
              )
            : undefined
        }
      >
        {pending ? (
          <dl className="grid grid-cols-2 gap-3 rounded-card border border-line bg-parchment/50 p-4 text-small">
            <dt className="text-muted">{t('transport.quotes.total', { defaultValue: 'Total' })}</dt>
            <dd className="text-end font-medium text-ink"><Money value={pending.price_total} /></dd>
            <dt className="text-muted">{t('transport.quotes.perKg', { defaultValue: 'Per kg' })}</dt>
            <dd className="text-end text-ink"><Money value={pending.price_per_kg} perKg decimals={2} /></dd>
          </dl>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}

function TripProgress({ request }: { request: TransportRequest }) {
  const { t } = useTranslation('coordinatorOps');
  const stops = [...request.stops].sort((a, b) => a.sequence - b.sequence);
  const done = stops.filter((stop) => stop.status !== 'pending').length;
  const pickedKg = stops.reduce((sum, stop) => sum + (stop.picked_kg ?? 0), 0);
  const booked = request.quotes.find((quote) => quote.id === request.booked_quote_id);

  return (
    <section className="space-y-4 p-5 sm:p-6" aria-label={t('transport.trip.label', { defaultValue: 'Trip progress' })}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="inline-flex items-center gap-2 text-small text-ink">
          <Truck strokeWidth={1.25} className="size-4 text-muted" aria-hidden />
          <span className="font-medium">{request.transporter_name ?? booked?.transporter_name ?? '—'}</span>
          {booked ? (
            <span className="text-muted">
              · <Money value={booked.price_total} size="sm" />
            </span>
          ) : null}
        </p>
        <p className="text-small text-muted">
          {t('transport.trip.summary', {
            defaultValue: '{{done}} of {{total}} stops · {{kg}} kg collected',
            done,
            total: stops.length,
            kg: formatNumber(pickedKg),
          })}
        </p>
      </div>
      <Progress
        value={stops.length ? (done / stops.length) * 100 : 0}
        label={t('transport.trip.label', { defaultValue: 'Trip progress' })}
        valueText={t('transport.trip.valueText', { defaultValue: '{{done}} of {{total}} stops', done, total: stops.length })}
        tone={request.status === 'completed' ? 'forest' : 'gold'}
      />
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {stops.map((stop) => (
          <li key={stop.id} className="flex items-center justify-between gap-3 rounded-sm border border-line px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-small font-medium text-ink">
                <span className="me-2 font-display not-italic tabular-nums text-gold-700">{String(stop.sequence).padStart(2, '0')}</span>
                {stop.farmer_name}
              </p>
              <p className="truncate text-micro text-muted">
                {stop.village ?? '—'} · <Quantity kg={stop.picked_kg ?? stop.quantity_kg} />
                {stop.picked_up_at ? ` · ${formatDateTime(stop.picked_up_at)}` : ''}
              </p>
            </div>
            <StatusBadge kind="stop" value={stop.status} size="sm" />
          </li>
        ))}
      </ol>
    </section>
  );
}
