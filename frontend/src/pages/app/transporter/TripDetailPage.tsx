import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { CalendarDays, Check, CircleCheckBig, MapPin, Navigation, PackageCheck, Snowflake } from 'lucide-react';
import { z } from 'zod';

import {
  ConfirmDialog,
  Money,
  PageHeader,
  QueryState,
  RouteMap,
  SectionCard,
  StatusBadge,
  useKgFormatter,
  useUiLanguage,
} from '@/components/domain';
import { Reveal } from '@/components/motion';
import { Badge, Button, Card, Dialog, Field, Input, Progress, Textarea, toast } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { PickupStop, TransportRequest } from '@/types/api';

import { PICKUP_TOLERANCE, directionsUrl } from '@/features/transporter/fleet';
import { applyApiFieldErrors, errorMessage, numberField, optionalText } from '@/features/transporter/forms';
import { useCompleteTrip, useConfirmPickup, useTransportRequest } from '@/features/transporter/hooks';
import { bookedQuote, tripProgress } from '@/features/transporter/requests';

export default function TripDetailPage() {
  const { requestId = '' } = useParams();
  const { t } = useTranslation('transporter');
  const trip = useTransportRequest(requestId);

  return (
    <div className="flex flex-col gap-8">
      <Seo title={t('tripDetail.seoTitle', { defaultValue: 'Trip' })} description={t('tripDetail.seoDescription', { defaultValue: 'Farm stops in order, pickups and delivery.' })} path={`/app/transporter/trips/${requestId}`} noindex />
      <QueryState<TransportRequest> query={trip} skeleton="detail" isEmpty={() => false} errorTitle={t('tripDetail.error', { defaultValue: 'Could not load this trip' })}>
        {(data) => <TripDetail trip={data} />}
      </QueryState>
    </div>
  );
}

function TripDetail({ trip }: { trip: TransportRequest }) {
  const { t } = useTranslation('transporter');
  const { user } = useAuth();
  const locale = useUiLanguage();
  const formatKg = useKgFormatter();
  const complete = useCompleteTrip(trip.id);
  const [picking, setPicking] = useState<PickupStop | null>(null);
  const [completing, setCompleting] = useState(false);

  const quote = bookedQuote(trip, user?.id);
  const progress = tripProgress(trip);
  const stops = [...trip.stops].sort((a, b) => a.sequence - b.sequence);
  const running = trip.status === 'booked' || trip.status === 'in_progress';
  const canComplete = running && progress.pending === 0 && progress.total > 0;

  const onComplete = async () => {
    try {
      await complete.mutateAsync({});
      toast.success(t('tripDetail.completed', { defaultValue: 'Trip completed' }), { description: t('tripDetail.completedBody', { defaultValue: 'The coordinator will record delivery and quality at {{destination}}.', destination: trip.destination_name }) });
    } catch (error) {
      toast.error(errorMessage(error, t('tripDetail.completeFailed', { defaultValue: 'Could not complete the trip' })));
      throw error;
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={trip.lot_code}
        title={t('trip.title', { crop: trip.crop_name, destination: trip.destination_name })}
        description={t('tripDetail.description', { defaultValue: 'Collect each farm in order, confirm the kilograms you load, then complete the trip at the drop.' })}
        breadcrumbs={[
          { label: t('nav.home', { defaultValue: 'Home' }), to: '/app/transporter' },
          { label: t('trips.title', { defaultValue: 'My trips' }), to: '/app/transporter/trips' },
          { label: trip.lot_code },
        ]}
        meta={
          <>
            <StatusBadge kind="transport" value={trip.status} />
            <Badge tone="neutral" icon={<CalendarDays strokeWidth={1.25} />}>{formatDate(trip.pickup_date, { locale })}</Badge>
            {trip.requires_refrigeration ? <Badge tone="info" icon={<Snowflake strokeWidth={1.25} />}>{t('request.refrigerated')}</Badge> : null}
          </>
        }
        actions={
          running ? (
            <Button size="lg" disabled={!canComplete} leadingIcon={<CircleCheckBig strokeWidth={1.25} />} onClick={() => setCompleting(true)}>
              {t('tripDetail.complete', { defaultValue: 'Complete trip' })}
            </Button>
          ) : undefined
        }
        divider
      />

      <Reveal>
        <Card variant="dark" className="grid gap-6 p-6 sm:grid-cols-[1.4fr_1fr] sm:p-8">
          <div className="flex flex-col gap-3">
            <p className="eyebrow text-gold-400">{t('trip.progressLabel')}</p>
            <p className="font-display font-bold text-h2 text-ivory">
              {t('trip.stopsDone', { done: progress.picked + progress.skipped, total: progress.total })}
            </p>
            <Progress
              value={progress.pct}
              tone="gold"
              label={t('trip.progressLabel')}
              valueText={t('trip.collectedOf', { picked: formatKg(progress.pickedKg), planned: formatKg(progress.plannedKg) })}
            />
            <p className="text-sm text-ivory/70">{t('trip.collectedOf', { picked: formatKg(progress.pickedKg), planned: formatKg(progress.plannedKg) })}</p>
          </div>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-[13px] font-semibold text-ivory/60">{trip.status === 'completed' ? t('trip.earned') : t('trip.pays')}</dt>
              <dd className="text-ivory"><Money value={quote?.price_total ?? null} size="lg" /></dd>
            </div>
            <div>
              <dt className="text-[13px] font-semibold text-ivory/60">{t('request.distance')}</dt>
              <dd className="tabular-nums text-ivory">{t('common:units.kmValue', { value: formatNumber(trip.estimated_distance_km, { maxDecimals: 1 }) })}</dd>
            </div>
            <div>
              <dt className="text-[13px] font-semibold text-ivory/60">{t('tripDetail.vehicle', { defaultValue: 'Vehicle' })}</dt>
              <dd className="text-ivory">{quote ? t(`common:enums.vehicleType.${quote.vehicle_type}`) : '—'}</dd>
            </div>
            <div>
              <dt className="text-[13px] font-semibold text-ivory/60">{t('tripDetail.dropAt', { defaultValue: 'Drop at' })}</dt>
              <dd className="text-ivory">{trip.destination_name}</dd>
            </div>
          </dl>
        </Card>
      </Reveal>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
        <SectionCard eyebrow={t('tripDetail.stopsEyebrow', { defaultValue: 'In order' })} title={t('tripDetail.stopsTitle', { defaultValue: 'Farm stops' })} flush>
          <ol className="divide-y divide-line">
            {stops.map((stop) => {
              const isNext = stop.id === progress.nextStopId && running;
              const done = stop.status === 'picked_up';
              return (
                <li key={stop.id} className={cn('flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-center sm:px-6', isNext && 'bg-parchment/60')}>
                  <div className="flex min-w-0 flex-1 items-start gap-4">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex w-9 shrink-0 pt-0.5 font-display text-xl not-italic tabular-nums',
                        done ? 'text-forest-600' : isNext ? 'text-gold-700' : 'text-muted',
                      )}
                    >
                      {done ? <Check strokeWidth={1.25} className="mt-1 size-5" /> : String(stop.sequence).padStart(2, '0')}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                        {stop.farmer_name}
                        <StatusBadge kind="stop" value={stop.status} size="sm" />
                      </p>
                      <p className="flex items-center gap-1 text-sm text-muted">
                        <MapPin aria-hidden="true" strokeWidth={1.25} className="size-3.5" />
                        {stop.village ?? t('detail.noVillage', { defaultValue: 'Village not given' })}
                      </p>
                      <p className="mt-1 text-sm tabular-nums text-ink/80">
                        {done
                          ? t('tripDetail.picked', { defaultValue: '{{picked}} loaded of {{planned}} planned', picked: formatKg(stop.picked_kg ?? 0), planned: formatKg(stop.quantity_kg) })
                          : t('tripDetail.planned', { defaultValue: '{{planned}} planned', planned: formatKg(stop.quantity_kg) })}
                        {done && stop.picked_up_at ? <span className="text-muted"> · {formatDateTime(stop.picked_up_at, { locale })}</span> : null}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2 ps-13 sm:ps-0">
                    <a
                      href={directionsUrl(stop.latitude, stop.longitude)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-10 items-center gap-1.5 rounded-sm border border-ink/25 px-4 text-[13px] font-semibold text-ink transition-colors hover:border-ink/50"
                    >
                      <Navigation aria-hidden="true" strokeWidth={1.25} className="size-3.5" />
                      {t('tripDetail.directions', { defaultValue: 'Directions' })}
                    </a>
                    {running && stop.status === 'pending' ? (
                      <Button size="sm" variant={isNext ? 'primary' : 'secondary'} leadingIcon={<PackageCheck strokeWidth={1.25} />} onClick={() => setPicking(stop)}>
                        {t('tripDetail.confirmPickup', { defaultValue: 'Confirm pickup' })}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </SectionCard>

        <div className="flex flex-col gap-6 lg:sticky lg:top-24">
          <SectionCard title={t('tripDetail.map', { defaultValue: 'Route' })} variant="flat">
            <RouteMap
              stops={stops}
              destination={{ name: trip.destination_name, latitude: trip.destination_latitude, longitude: trip.destination_longitude }}
              totalDistanceKm={trip.estimated_distance_km}
              showLegend={false}
            />
          </SectionCard>
          {running && !canComplete ? (
            <p className="text-sm text-muted">{t('tripDetail.completeHint', { defaultValue: 'Complete the trip once every stop is confirmed.' })}</p>
          ) : null}
        </div>
      </div>

      <PickupDialog trip={trip} stop={picking} onClose={() => setPicking(null)} />

      <ConfirmDialog
        open={completing}
        onOpenChange={setCompleting}
        title={t('tripDetail.completeTitle', { defaultValue: 'Complete this trip?' })}
        description={t('tripDetail.completeBody', { defaultValue: '{{kg}} loaded from {{count}} farms, delivered to {{destination}}.', kg: formatKg(progress.pickedKg), count: progress.picked, destination: trip.destination_name })}
        confirmLabel={t('tripDetail.complete', { defaultValue: 'Complete trip' })}
        tone="gold"
        onConfirm={onComplete}
      />
    </>
  );
}

interface PickupInput {
  picked_kg: string;
  note: string;
}

function PickupDialog({ trip, stop, onClose }: { trip: TransportRequest; stop: PickupStop | null; onClose: () => void }) {
  const { t } = useTranslation('transporter');
  const formatKg = useKgFormatter();
  const confirm = useConfirmPickup(trip.id);
  const maxKg = stop ? Math.floor(stop.quantity_kg * PICKUP_TOLERANCE) : 0;

  const schema = z.object({
    picked_kg: numberField({
      required: t('tripDetail.errors.kgRequired', { defaultValue: 'Enter the kilograms loaded' }),
      invalid: t('tripDetail.errors.number', { defaultValue: 'Enter a number' }),
      min: { value: 0, message: t('tripDetail.errors.kgMin', { defaultValue: 'Cannot be negative' }) },
      max: { value: maxKg, message: t('tripDetail.errors.kgMax', { defaultValue: 'At most {{max}} (5% over plan)', max: formatKg(maxKg) }) },
    }),
    note: optionalText(500, t('tripDetail.errors.noteLong', { defaultValue: 'Keep the note under 500 characters' })),
  });

  const form = useForm<PickupInput, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    values: { picked_kg: stop ? String(stop.quantity_kg) : '', note: '' },
  });
  const { register, handleSubmit, setError, formState: { errors } } = form;

  const onSubmit = handleSubmit(async (values) => {
    if (!stop) return;
    try {
      await confirm.mutateAsync({ stopId: stop.id, req: { picked_kg: values.picked_kg, note: values.note } });
      toast.success(t('tripDetail.pickedToast', { defaultValue: 'Pickup confirmed at {{farmer}}', farmer: stop.farmer_name }), {
        description: t('tripDetail.pickedToastBody', { defaultValue: '{{kg}} on board.', kg: formatKg(values.picked_kg) }),
      });
      onClose();
    } catch (error) {
      if (!applyApiFieldErrors(error, setError, ['picked_kg', 'note'])) {
        toast.error(errorMessage(error, t('tripDetail.pickFailed', { defaultValue: 'Could not confirm the pickup' })));
      }
    }
  });

  return (
    <Dialog
      open={stop !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      dismissible={!confirm.isPending}
      title={t('tripDetail.pickTitle', { defaultValue: 'Confirm pickup' })}
      description={stop ? t('tripDetail.pickDescription', { defaultValue: 'Stop {{n}} · {{farmer}}, {{village}} — {{planned}} planned.', n: stop.sequence, farmer: stop.farmer_name, village: stop.village ?? '—', planned: formatKg(stop.quantity_kg) }) : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={confirm.isPending}>{t('tripDetail.cancel', { defaultValue: 'Cancel' })}</Button>
          <Button type="submit" form="pickup-form" loading={confirm.isPending}>{t('tripDetail.confirmPickup', { defaultValue: 'Confirm pickup' })}</Button>
        </>
      }
    >
      <form id="pickup-form" noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
        <Field label={t('tripDetail.pickedKg', { defaultValue: 'Kilograms loaded' })} hint={t('tripDetail.pickedHint', { defaultValue: 'Weigh at the farm gate. Up to 5% over plan is accepted.' })} error={errors.picked_kg?.message} required>
          <Input inputMode="decimal" autoComplete="off" trailing="kg" {...register('picked_kg')} />
        </Field>
        <Field label={t('tripDetail.note', { defaultValue: 'Note' })} error={errors.note?.message} optional>
          <Textarea rows={2} placeholder={t('tripDetail.notePlaceholder', { defaultValue: 'Short weight, crates, anything the coordinator should know' })} {...register('note')} />
        </Field>
      </form>
    </Dialog>
  );
}
