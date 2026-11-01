import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { CircleAlert, Clock, Snowflake, Truck } from 'lucide-react';
import { z } from 'zod';

import { Money, UtilisationGauge, useKgFormatter } from '@/components/domain';
import {
  Button,
  Field,
  Input,
  RadioCard,
  RadioCardGroup,
  SegmentedControl,
  Select,
  Skeleton,
  Textarea,
  toast,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatNumber, formatPct } from '@/lib/format';
import type { QuoteCreateRequest, TransportRequest, Vehicle, VehicleType } from '@/types/api';

import {
  VEHICLE_CLASSES,
  VEHICLE_TYPES,
  fareFor,
  isRefrigerated,
  suggestedEtaHours,
  tripsNeeded,
  utilisationPct,
  vehicleRates,
} from '../fleet';
import { applyApiFieldErrors, errorMessage, numberField, optionalText } from '../forms';
import { useSubmitQuote } from '../hooks';

type Source = 'fleet' | 'type';

interface QuoteFormInput {
  source: Source;
  vehicle_id: string;
  vehicle_type: string;
  capacity_kg: string;
  price_total: string;
  eta_hours: string;
  notes: string;
}

const MAX_ETA_HOURS = 720;
const MAX_AMOUNT = 1_000_000_000;

function isVehicleType(value: string): value is VehicleType {
  return (VEHICLE_TYPES as readonly string[]).includes(value);
}

/** The vehicle MandiMate would pick from the fleet: smallest one that carries everything (cold if needed). */
function bestVehicle(vehicles: readonly Vehicle[], request: TransportRequest): Vehicle | undefined {
  const eligible = vehicles.filter((vehicle) => !request.requires_refrigeration || isRefrigerated(vehicle));
  const fitting = eligible.filter((vehicle) => vehicle.capacity_kg >= request.total_quantity_kg);
  const pool = fitting.length > 0 ? fitting : eligible;
  return [...pool].sort((a, b) => (fitting.length > 0 ? a.capacity_kg - b.capacity_kg : b.capacity_kg - a.capacity_kg))[0];
}

function suggestedFare(request: TransportRequest, rates: { baseCharge: number; perKm: number }, capacityKg: number): number {
  return fareFor(rates, request.estimated_distance_km, tripsNeeded(request.total_quantity_kg, capacityKg));
}

export interface QuoteFormProps {
  request: TransportRequest;
  vehicles: readonly Vehicle[] | undefined;
  vehiclesLoading?: boolean;
}

/**
 * The transporter's price for a pickup request: one of their vehicles (or a vehicle class), a total
 * fare with live ₹/kg, utilisation and comparison with MandiMate's estimate, an ETA and notes.
 */
export function QuoteForm({ request, vehicles, vehiclesLoading = false }: QuoteFormProps) {
  const { t } = useTranslation('transporter');
  const formatKg = useKgFormatter();
  const submit = useSubmitQuote(request.id);

  const active = useMemo(() => (vehicles ?? []).filter((vehicle) => vehicle.is_active), [vehicles]);
  const byId = useMemo(() => new Map(active.map((vehicle) => [vehicle.id, vehicle])), [active]);
  const initialVehicle = bestVehicle(active, request);
  const etaSuggestion = suggestedEtaHours(request.estimated_distance_km, request.stops.length);

  const schema = useMemo(
    () =>
      z
        .object({
          source: z.enum(['fleet', 'type']),
          vehicle_id: z.string(),
          vehicle_type: z.string(),
          capacity_kg: numberField({
            required: t('quote.errors.capacityRequired'),
            invalid: t('quote.errors.number'),
            min: { value: 0, inclusive: false, message: t('quote.errors.capacityPositive') },
            max: { value: 1_000_000, message: t('quote.errors.capacityMax') },
          }),
          price_total: numberField({
            required: t('quote.errors.priceRequired'),
            invalid: t('quote.errors.number'),
            min: { value: 0, inclusive: false, message: t('quote.errors.pricePositive') },
            max: { value: MAX_AMOUNT, message: t('quote.errors.priceMax') },
          }),
          eta_hours: numberField({
            required: t('quote.errors.etaRequired'),
            invalid: t('quote.errors.number'),
            min: { value: 0, inclusive: false, message: t('quote.errors.etaPositive') },
            max: { value: MAX_ETA_HOURS, message: t('quote.errors.etaMax', { max: MAX_ETA_HOURS }) },
          }),
          notes: optionalText(2000, t('quote.errors.notesLong')),
        })
        .superRefine((values, ctx) => {
          if (values.source === 'fleet' && !byId.has(values.vehicle_id)) {
            ctx.addIssue({ code: 'custom', path: ['vehicle_id'], message: t('quote.errors.vehicleRequired') });
            return;
          }
          if (!isVehicleType(values.vehicle_type)) {
            ctx.addIssue({ code: 'custom', path: ['vehicle_type'], message: t('quote.errors.typeRequired') });
            return;
          }
          if (request.requires_refrigeration) {
            const vehicle = byId.get(values.vehicle_id);
            const cold = values.source === 'fleet' ? Boolean(vehicle && isRefrigerated(vehicle)) : values.vehicle_type === 'reefer_truck';
            if (!cold) {
              ctx.addIssue({
                code: 'custom',
                path: [values.source === 'fleet' ? 'vehicle_id' : 'vehicle_type'],
                message: t('quote.errors.needsCold'),
              });
            }
          }
        }),
    [byId, request.requires_refrigeration, t],
  );

  const defaults = (): QuoteFormInput => {
    if (initialVehicle) {
      return {
        source: 'fleet',
        vehicle_id: initialVehicle.id,
        vehicle_type: initialVehicle.vehicle_type,
        capacity_kg: String(initialVehicle.capacity_kg),
        price_total: String(suggestedFare(request, vehicleRates(initialVehicle), initialVehicle.capacity_kg)),
        eta_hours: String(etaSuggestion),
        notes: '',
      };
    }
    const type: VehicleType = request.requires_refrigeration ? 'reefer_truck' : request.suggested_vehicle_type;
    const vehicleClass = VEHICLE_CLASSES[type];
    return {
      source: 'type',
      vehicle_id: '',
      vehicle_type: type,
      capacity_kg: String(vehicleClass.capacityKg),
      price_total: String(suggestedFare(request, vehicleClass, vehicleClass.capacityKg)),
      eta_hours: String(etaSuggestion),
      notes: '',
    };
  };

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    getFieldState,
    formState: { errors, isSubmitted },
  } = useForm({ resolver: zodResolver(schema), defaultValues: defaults() });

  const values = watch();
  const selectedVehicle = values.source === 'fleet' ? byId.get(values.vehicle_id) : undefined;
  const capacity = Number(values.capacity_kg);
  const price = Number(values.price_total);
  const validCapacity = Number.isFinite(capacity) && capacity > 0;
  const validPrice = Number.isFinite(price) && price > 0;
  const rates = selectedVehicle
    ? vehicleRates(selectedVehicle)
    : isVehicleType(values.vehicle_type)
      ? VEHICLE_CLASSES[values.vehicle_type]
      : null;
  const suggestion = rates && validCapacity ? suggestedFare(request, rates, capacity) : null;
  const trips = validCapacity ? tripsNeeded(request.total_quantity_kg, capacity) : 1;
  const utilisation = validCapacity ? utilisationPct(request.total_quantity_kg, capacity) : 0;
  const perKg = validPrice && request.total_quantity_kg > 0 ? price / request.total_quantity_kg : null;
  const vsEstimate = validPrice && request.estimated_cost > 0 ? ((price - request.estimated_cost) / request.estimated_cost) * 100 : null;

  const revalidate = { shouldValidate: isSubmitted, shouldDirty: true } as const;

  /** Refill capacity and price from a vehicle or class unless the transporter typed their own. */
  const applyRates = (next: { capacityKg: number; baseCharge: number; perKm: number }) => {
    setValue('capacity_kg', String(next.capacityKg), revalidate);
    if (!getFieldState('price_total').isDirty) {
      setValue('price_total', String(suggestedFare(request, next, next.capacityKg)), { shouldValidate: isSubmitted });
    }
  };

  const chooseVehicle = (id: string) => {
    const vehicle = byId.get(id);
    setValue('vehicle_id', id, revalidate);
    if (!vehicle) return;
    setValue('vehicle_type', vehicle.vehicle_type, revalidate);
    applyRates({ capacityKg: vehicle.capacity_kg, ...vehicleRates(vehicle) });
  };

  const chooseSource = (source: Source) => {
    setValue('source', source, revalidate);
    if (source === 'fleet') {
      const vehicle = byId.get(values.vehicle_id) ?? initialVehicle;
      if (vehicle) chooseVehicle(vehicle.id);
    } else if (isVehicleType(values.vehicle_type)) {
      applyRates(VEHICLE_CLASSES[values.vehicle_type]);
    }
  };

  const onValid = handleSubmit(async (data) => {
    const vehicleType = data.vehicle_type as VehicleType;
    const payload: QuoteCreateRequest = {
      vehicle_id: data.source === 'fleet' ? data.vehicle_id : null,
      vehicle_type: vehicleType,
      capacity_kg: data.capacity_kg,
      price_total: Math.round(data.price_total * 100) / 100,
      eta_hours: data.eta_hours,
      notes: data.notes,
    };
    try {
      await submit.mutateAsync(payload);
      toast.success(t('quote.sentTitle'), { description: t('quote.sentBody') });
    } catch (error) {
      const placed = applyApiFieldErrors(error, setError, ['vehicle_id', 'vehicle_type', 'capacity_kg', 'price_total', 'eta_hours', 'notes']);
      if (!placed) toast.error(t('quote.failed'), { description: errorMessage(error, t('common:errors.generic')) });
    }
  });

  const typeField = register('vehicle_type', {
    onChange: (event: { target: { value: string } }) => {
      const next = event.target.value;
      if (isVehicleType(next)) applyRates(VEHICLE_CLASSES[next]);
    },
  });

  return (
    <form onSubmit={onValid} noValidate className="flex flex-col gap-6">
      {vehiclesLoading ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-11 w-full rounded-sm" />
          <Skeleton className="h-20 w-full rounded-card" />
        </div>
      ) : (
        <>
          {active.length > 0 ? (
            <SegmentedControl<Source>
              label={t('quote.sourceLabel')}
              value={values.source}
              onValueChange={chooseSource}
              fullWidth
              size="sm"
              options={[
                { value: 'fleet', label: t('quote.fromFleet'), icon: <Truck aria-hidden="true" strokeWidth={1.25} /> },
                { value: 'type', label: t('quote.otherVehicle') },
              ]}
            />
          ) : (
            <p className="rounded-card border border-dashed border-line px-4 py-3 text-sm leading-relaxed text-muted">
              {t('quote.noFleet')}{' '}
              <Link to="/app/transporter/vehicles" className="link-luxe font-medium text-gold-700">
                {t('quote.addVehicles')}
              </Link>
            </p>
          )}

          {values.source === 'fleet' && active.length > 0 ? (
            <RadioCardGroup
              label={t('quote.vehicle')}
              value={values.vehicle_id}
              onValueChange={chooseVehicle}
              columns={1}
              required
              error={errors.vehicle_id?.message}
            >
              {active.map((vehicle) => {
                const tooCold = request.requires_refrigeration && !isRefrigerated(vehicle);
                const fare = suggestedFare(request, vehicleRates(vehicle), vehicle.capacity_kg);
                return (
                  <RadioCard
                    key={vehicle.id}
                    value={vehicle.id}
                    disabled={tooCold}
                    icon={isRefrigerated(vehicle) ? <Snowflake strokeWidth={1.25} /> : <Truck strokeWidth={1.25} />}
                    title={<span className="font-mono tracking-wide">{vehicle.registration_number}</span>}
                    description={[
                      t(`common:enums.vehicleType.${vehicle.vehicle_type}`),
                      formatKg(vehicle.capacity_kg),
                      tooCold ? t('quote.notRefrigerated') : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    meta={tooCold ? null : <Money value={fare} size="sm" />}
                  />
                );
              })}
            </RadioCardGroup>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('quote.vehicleType')} error={errors.vehicle_type?.message} required>
                <Select {...typeField}>
                  {VEHICLE_TYPES.map((type) => (
                    <option key={type} value={type} disabled={request.requires_refrigeration && type !== 'reefer_truck'}>
                      {t(`common:enums.vehicleType.${type}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('quote.capacity')} error={errors.capacity_kg?.message} required>
                <Input inputMode="decimal" autoComplete="off" trailing={t('common:units.kg')} {...register('capacity_kg')} />
              </Field>
            </div>
          )}
        </>
      )}

      {request.requires_refrigeration ? (
        <p className="flex items-start gap-2 text-[13px] leading-5 text-ink-2">
          <Snowflake aria-hidden="true" strokeWidth={1.25} className="mt-0.5 size-3.5 shrink-0" />
          {t('quote.coldChain')}
        </p>
      ) : null}

      <Field
        label={t('quote.price')}
        error={errors.price_total?.message}
        required
        labelAside={
          suggestion !== null && String(suggestion) !== values.price_total ? (
            <button
              type="button"
              onClick={() => setValue('price_total', String(suggestion), revalidate)}
              className="inline-flex items-center gap-1 border-b border-gold-700/40 text-[13px] font-semibold text-gold-700 transition-colors hover:border-gold-700"
            >
              {t('quote.useSuggested', { amount: formatNumber(suggestion) })}
            </button>
          ) : null
        }
        hint={selectedVehicle ? t('quote.suggestedFromRates') : t('quote.suggestedFromClass')}
      >
        <Input inputMode="decimal" autoComplete="off" size="lg" leading="₹" className="font-display font-bold text-h3" {...register('price_total')} />
      </Field>

      {/* Live read-out: how the coordinator will compare this quote. */}
      <div aria-live="polite" className="grid items-center gap-5 rounded-card border border-line bg-parchment/50 p-5 sm:grid-cols-[auto_1fr]">
        <UtilisationGauge pct={utilisation} className="mx-auto w-32 sm:mx-0" />
        <dl className="grid grid-cols-2 gap-x-5 gap-y-3 text-sm">
          <div className="flex flex-col gap-1">
            <dt className="text-[13px] font-semibold text-muted">{t('quote.perKg')}</dt>
            <dd>{perKg !== null ? <Money value={perKg} perKg size="lg" /> : <span className="text-muted">—</span>}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-[13px] font-semibold text-muted">{t('quote.vsEstimate')}</dt>
            <dd
              className={cn(
                'font-medium tabular-nums',
                vsEstimate === null ? 'text-muted' : vsEstimate <= 0 ? 'text-success-ink' : vsEstimate > 15 ? 'text-warning-ink' : 'text-ink',
              )}
            >
              {vsEstimate === null
                ? '—'
                : Math.abs(vsEstimate) < 0.5
                  ? t('quote.matchesEstimate')
                  : vsEstimate < 0
                    ? t('quote.belowEstimate', { pct: formatPct(Math.abs(vsEstimate), { decimals: 0 }) })
                    : t('quote.aboveEstimate', { pct: formatPct(vsEstimate, { decimals: 0 }) })}
            </dd>
          </div>
          <div className="col-span-2 flex flex-col gap-1">
            <dt className="text-[13px] font-semibold text-muted">{t('quote.load')}</dt>
            <dd className={cn('text-ink/85', trips > 1 && 'font-medium text-warning-ink')}>
              {trips > 1
                ? t('quote.multipleTrips', { count: trips, load: formatKg(request.total_quantity_kg) })
                : t('quote.singleTrip', { load: formatKg(request.total_quantity_kg), capacity: validCapacity ? formatKg(capacity) : '—' })}
            </dd>
          </div>
        </dl>
      </div>

      <Field label={t('quote.eta')} error={errors.eta_hours?.message} hint={t('quote.etaHint', { hours: formatNumber(etaSuggestion, { maxDecimals: 1 }) })} required>
        <Input inputMode="decimal" autoComplete="off" leading={<Clock strokeWidth={1.25} />} trailing={t('quote.hours')} {...register('eta_hours')} />
      </Field>

      <Field label={t('quote.notes')} error={errors.notes?.message} optional>
        <Textarea rows={3} placeholder={t('quote.notesPlaceholder')} {...register('notes')} />
      </Field>

      {Object.keys(errors).length > 0 && isSubmitted ? (
        <p role="alert" className="flex items-center gap-2 text-sm text-danger-ink">
          <CircleAlert aria-hidden="true" strokeWidth={1.25} className="size-4" />
          {t('quote.fixErrors')}
        </p>
      ) : null}

      <Button type="submit" size="lg" fullWidth loading={submit.isPending}>
        {t('common:actions.submitQuote')}
      </Button>
      <p className="-mt-3 text-center text-xs leading-relaxed text-muted">{t('quote.disclaimer')}</p>
    </form>
  );
}
