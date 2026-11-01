import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { MapPin, PackageCheck, SearchX, Truck } from 'lucide-react';
import { z } from 'zod';

import {
  CropGlyph,
  Delta,
  DemoDataNotice,
  GradeBadge,
  Money,
  NetProceedsCard,
  PageHeader,
  QualityBadge,
  SectionCard,
  StatusBadge,
} from '@/components/domain';
import {
  Button,
  Divider,
  EmptyState,
  Field,
  Input,
  LinkButton,
  RadioCard,
  RadioCardGroup,
  SegmentedControl,
  Select,
  Skeleton,
  Textarea,
  toast,
} from '@/components/ui';
import { isLatitude, isLongitude, parseCoordinate } from '@/features/buyer/sourcing';
import {
  useCreateOffer,
  useCrops,
  useDemand,
  useDemands,
  useHarvest,
  useLatestMarketPrice,
  useLot,
} from '@/features/buyer/sourcingHooks';
import { VALIDITY_PRESETS, fromDateTimeLocal, landedCost, safeFarmerView, validUntilFromNow } from '@/features/buyer/utils';
import type { ValidityPresetId } from '@/features/buyer/utils';
import { CoordinatesControl } from '@/features/shared/components/CoordinatesControl';
import { FormAlert } from '@/features/shared/components/FormAlert';
import { apiErrorMessage, applyFieldErrors, blankToNull } from '@/features/shared/forms';
import { useAuth } from '@/lib/auth';
import { formatDate, formatKg, formatNumber, formatPct } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { Demand, Grade, Harvest, Lot, OfferCreateRequest, PickupTerms, QualityStatus, User, UUID } from '@/types/api';

const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/,/g, '')));

/** The lot or harvest an offer is made on, normalised. */
interface Target {
  type: 'lot' | 'harvest';
  id: UUID;
  code: string | null;
  cropId: UUID;
  cropName: string;
  grade: Grade;
  availableKg: number;
  qualityStatus: QualityStatus;
  place: string;
  district: string | null;
  origin: { latitude: number; longitude: number } | null;
  date: string;
  memberCount: number;
  open: boolean;
  statusBadge: ReactNode;
}

const LOT_QUALITY: Record<QualityStatus, number> = { self_reported: 0, pending_inspection: 1, inspected: 2 };

function fromLot(lot: Lot): Target {
  const active = lot.members.filter((m) => m.consent_status !== 'declined');
  const quality = active.reduce<QualityStatus>(
    (worst, m) => (LOT_QUALITY[m.harvest_quality_status] < LOT_QUALITY[worst] ? m.harvest_quality_status : worst),
    'inspected',
  );
  return {
    type: 'lot',
    id: lot.id,
    code: lot.code,
    cropId: lot.crop_id,
    cropName: lot.crop_name,
    grade: lot.grade,
    availableKg: lot.total_quantity_kg,
    qualityStatus: active.length ? quality : 'self_reported',
    place: lot.collection_point_name,
    district: lot.district,
    origin: { latitude: lot.collection_latitude, longitude: lot.collection_longitude },
    date: lot.pickup_date,
    memberCount: lot.member_count,
    open: lot.status === 'open_for_offers',
    statusBadge: <StatusBadge kind="lot" value={lot.status} size="sm" />,
  };
}

function fromHarvest(h: Harvest): Target {
  return {
    type: 'harvest',
    id: h.id,
    code: null,
    cropId: h.crop_id,
    cropName: h.crop_name,
    grade: h.grade,
    availableKg: h.available_kg,
    qualityStatus: h.quality_status,
    place: [h.village, h.district].filter(Boolean).join(', '),
    district: h.district,
    origin: h.latitude !== null && h.longitude !== null ? { latitude: h.latitude, longitude: h.longitude } : null,
    date: h.available_from,
    memberCount: 1,
    open: h.status === 'listed' && h.available_kg > 0,
    statusBadge: <StatusBadge kind="harvest" value={h.status} size="sm" />,
  };
}

interface FormValues {
  price_per_kg: string;
  quantity_kg: string;
  pickup_terms: PickupTerms;
  delivery_location: string;
  delivery_latitude: string;
  delivery_longitude: string;
  payment_terms_days: string;
  max_rejection_pct: string;
  handling_charge_per_kg: string;
  quality_spec: string;
  valid_until: string;
  notes: string;
  demand_id: string;
}

const FIELDS = [
  'price_per_kg',
  'quantity_kg',
  'pickup_terms',
  'delivery_location',
  'delivery_latitude',
  'delivery_longitude',
  'payment_terms_days',
  'max_rejection_pct',
  'handling_charge_per_kg',
  'quality_spec',
  'valid_until',
  'notes',
  'demand_id',
] as const;

function defaultsFor(target: Target, demand: Demand | null, user: User | null): FormValues {
  return {
    price_per_kg: demand?.target_price_per_kg?.toString() ?? '',
    quantity_kg: String(Math.min(target.availableKg, demand?.quantity_kg ?? target.availableKg)),
    pickup_terms: 'buyer_pickup',
    delivery_location: demand?.delivery_location ?? [user?.organization_name, user?.district].filter(Boolean).join(', '),
    delivery_latitude: (demand?.delivery_latitude ?? user?.latitude)?.toString() ?? '',
    delivery_longitude: (demand?.delivery_longitude ?? user?.longitude)?.toString() ?? '',
    payment_terms_days: String(demand?.payment_terms_days ?? 7),
    max_rejection_pct: String(demand?.max_rejection_pct ?? 5),
    handling_charge_per_kg: '0',
    quality_spec: demand?.quality_spec ?? '',
    valid_until: validUntilFromNow(72),
    notes: '',
    demand_id: demand?.id ?? '',
  };
}

function TargetSummary({ target }: { target: Target }) {
  const { t } = useTranslation('buyer');
  return (
    <div className="overflow-hidden rounded-panel bg-forest-900 p-7 text-ivory sm:p-10">
      <div className="flex items-start gap-4">
        <CropGlyph name={target.cropName} lotCode={target.code} size="lg" framed />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-gold-400">
            {target.type === 'lot'
              ? t('offer.target.lot', { count: target.memberCount, defaultValue: 'Pooled lot · {{count}} farmers' })
              : t('offer.target.harvest', { defaultValue: 'Single harvest' })}
          </p>
          <h2 className="mt-2 font-display text-h2 font-bold text-ivory">
            {target.cropName}
            {target.code && <span className="ms-2 font-mono text-small text-ivory/60">{target.code}</span>}
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <GradeBadge grade={target.grade} size="sm" />
            <QualityBadge status={target.qualityStatus} />
            {target.statusBadge}
          </div>
        </div>
      </div>
      <div className="mt-8 grid gap-6 border-t border-ivory/15 pt-6 sm:grid-cols-3">
        <div>
          <p className="text-[13px] font-semibold text-ivory/60">{t('offer.target.available', { defaultValue: 'Available' })}</p>
          <p className="mt-1 font-display text-h2 font-bold tabular-nums">{formatKg(target.availableKg)}</p>
        </div>
        <div>
          <p className="text-[13px] font-semibold text-ivory/60">{t('offer.target.from', { defaultValue: 'Collection point' })}</p>
          <p className="mt-1 text-small text-ivory/85">{target.place || '—'}</p>
        </div>
        <div>
          <p className="text-[13px] font-semibold text-ivory/60">
            {target.type === 'lot' ? t('offer.target.pickup', { defaultValue: 'Pickup date' }) : t('offer.target.availableFrom', { defaultValue: 'Available from' })}
          </p>
          <p className="mt-1 text-small text-ivory/85">{formatDate(target.date)}</p>
        </div>
      </div>
    </div>
  );
}

function OfferForm({ target, demand }: { target: Target; demand: Demand | null }) {
  const { t } = useTranslation('buyer');
  const navigate = useNavigate();
  const { user } = useAuth();
  const create = useCreateOffer();
  const crops = useCrops();
  const market = useLatestMarketPrice(target.cropId, target.district);
  const demands = useDemands({ crop_id: target.cropId, limit: 50 });
  const openDemands = (demands.data ?? []).filter((d) => d.status === 'open' || d.status === 'matched');
  const [preset, setPreset] = useState<ValidityPresetId | 'custom'>('3d');

  const schema = useMemo(() => {
    const positive = t('form.positive', { defaultValue: 'Enter a number above zero' });
    return z
      .object({
        price_per_kg: z.string().refine((v) => {
          const n = num(v);
          return n !== null && Number.isFinite(n) && n > 0 && n <= 10_000;
        }, positive),
        quantity_kg: z.string().refine((v) => {
          const n = num(v);
          return n !== null && Number.isFinite(n) && n > 0;
        }, positive),
        pickup_terms: z.enum(['buyer_pickup', 'mandimate_delivery']),
        delivery_location: z.string().trim().min(2, t('form.locationRequired', { defaultValue: 'Where should it be delivered?' })).max(200),
        delivery_latitude: z.string().refine((v) => isLatitude(parseCoordinate(v)), t('form.lat', { defaultValue: 'Latitude is between −90 and 90' })),
        delivery_longitude: z.string().refine((v) => isLongitude(parseCoordinate(v)), t('form.lng', { defaultValue: 'Longitude is between −180 and 180' })),
        payment_terms_days: z.string().refine((v) => {
          const n = num(v);
          return n !== null && Number.isInteger(n) && n >= 0 && n <= 90;
        }, t('form.days', { defaultValue: 'Whole days from 0 to 90' })),
        max_rejection_pct: z.string().refine((v) => {
          const n = num(v);
          return n !== null && n >= 0 && n <= 50;
        }, t('form.rejection', { defaultValue: 'Between 0 and 50 %' })),
        handling_charge_per_kg: z.string().refine((v) => {
          const n = num(v);
          return n === null || (Number.isFinite(n) && n >= 0 && n <= 100);
        }, t('form.handling', { defaultValue: 'Between ₹0 and ₹100 per kg' })),
        quality_spec: z.string().max(1000),
        valid_until: z.string().refine((v) => {
          const iso = fromDateTimeLocal(v);
          return iso !== null && new Date(iso).getTime() > Date.now();
        }, t('form.validFuture', { defaultValue: 'Choose a time in the future' })),
        notes: z.string().max(2000),
        demand_id: z.string(),
      })
      .superRefine((values, ctx) => {
        const qty = num(values.quantity_kg);
        if (qty !== null && qty > target.availableKg + 1e-9) {
          ctx.addIssue({
            code: 'custom',
            path: ['quantity_kg'],
            message: t('form.qtyAboveAvailable', { max: formatKg(target.availableKg), defaultValue: 'At most {{max}} is available' }),
          });
        }
        const lat = parseCoordinate(values.delivery_latitude);
        const lng = parseCoordinate(values.delivery_longitude);
        if ((lat === null) !== (lng === null)) {
          ctx.addIssue({
            code: 'custom',
            path: [lat === null ? 'delivery_latitude' : 'delivery_longitude'],
            message: t('form.bothCoords', { defaultValue: 'Enter both latitude and longitude, or neither' }),
          });
        }
        const price = num(values.price_per_kg);
        const handling = num(values.handling_charge_per_kg) ?? 0;
        if (price !== null && handling >= price) {
          ctx.addIssue({ code: 'custom', path: ['handling_charge_per_kg'], message: t('form.handlingAbovePrice', { defaultValue: 'Must be below the price' }) });
        }
      });
  }, [t, target.availableKg]);

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaultsFor(target, demand, user) });

  const v = watch();
  const price = num(v.price_per_kg);
  const qty = num(v.quantity_kg);
  const rejection = num(v.max_rejection_pct);
  const handling = num(v.handling_charge_per_kg) ?? 0;
  const lat = parseCoordinate(v.delivery_latitude);
  const lng = parseCoordinate(v.delivery_longitude);
  const coordsOk = lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng);
  const cost = landedCost({ pricePerKg: price, quantityKg: qty, maxRejectionPct: rejection });
  const crop = crops.data?.find((c) => c.id === target.cropId);
  const marketPrice = market.data ?? null;

  const farmer =
    price !== null && qty !== null
      ? safeFarmerView({
          pricePerKg: price,
          quantityKg: qty,
          pickupTerms: v.pickup_terms,
          paymentTermsDays: num(v.payment_terms_days) ?? 0,
          maxRejectionPct: rejection ?? 0,
          handlingChargePerKg: handling,
          grade: target.grade,
          qualityStatus: target.qualityStatus,
          defaultRejectionPct: crop?.default_rejection_pct ?? null,
          origin: target.origin,
          destination: coordsOk ? { latitude: lat, longitude: lng } : null,
          marketPricePerKg: marketPrice?.modal_price_per_kg ?? null,
          marketIsIllustrative: marketPrice?.is_illustrative ?? false,
        })
      : null;

  const choosePreset = (id: ValidityPresetId | 'custom') => {
    setPreset(id);
    const found = VALIDITY_PRESETS.find((p) => p.id === id);
    if (found) setValue('valid_until', validUntilFromNow(found.hours), { shouldValidate: true });
  };

  const onDemandChange = (id: string) => {
    setValue('demand_id', id);
    const d = openDemands.find((x) => x.id === id);
    if (!d) return;
    setValue('delivery_location', d.delivery_location, { shouldValidate: true });
    setValue('delivery_latitude', d.delivery_latitude?.toString() ?? '');
    setValue('delivery_longitude', d.delivery_longitude?.toString() ?? '');
    setValue('payment_terms_days', String(d.payment_terms_days));
    setValue('max_rejection_pct', String(d.max_rejection_pct));
    if (d.quality_spec) setValue('quality_spec', d.quality_spec);
    if (d.target_price_per_kg !== null && !v.price_per_kg) setValue('price_per_kg', String(d.target_price_per_kg));
  };

  const onSubmit = handleSubmit(async (values) => {
    const req: OfferCreateRequest = {
      target_type: target.type,
      lot_id: target.type === 'lot' ? target.id : null,
      harvest_id: target.type === 'harvest' ? target.id : null,
      demand_id: values.demand_id || null,
      price_per_kg: num(values.price_per_kg) as number,
      quantity_kg: num(values.quantity_kg) as number,
      pickup_terms: values.pickup_terms,
      delivery_location: values.delivery_location.trim(),
      delivery_latitude: parseCoordinate(values.delivery_latitude),
      delivery_longitude: parseCoordinate(values.delivery_longitude),
      payment_terms_days: num(values.payment_terms_days) as number,
      max_rejection_pct: num(values.max_rejection_pct) as number,
      handling_charge_per_kg: num(values.handling_charge_per_kg) ?? 0,
      quality_spec: blankToNull(values.quality_spec),
      valid_until: fromDateTimeLocal(values.valid_until) as string,
      notes: blankToNull(values.notes),
    };
    try {
      const offer = await create.mutateAsync(req);
      toast.success(t('offer.sent', { defaultValue: 'Offer sent' }), {
        description:
          target.type === 'lot'
            ? t('offer.sentLot', { defaultValue: 'The coordinator reviews it, then each farmer gives consent.' })
            : t('offer.sentHarvest', { defaultValue: 'The farmer will review your terms.' }),
      });
      navigate(`/app/buyer/offers/${offer.id}`);
    } catch (error) {
      const applied = applyFieldErrors(error, setError, {
        fields: FIELDS,
        aliases: { lot_id: 'quantity_kg', harvest_id: 'quantity_kg' },
      });
      if (applied.length === 0) toast.error(apiErrorMessage(error, t));
    }
  });

  const pickupLabel = v.pickup_terms === 'buyer_pickup';

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
      <div className="space-y-6">
        {user && user.verification_status !== 'verified' && (
          <FormAlert tone="warning" title={t('offer.unverifiedTitle', { defaultValue: 'Your business is not verified yet' })} live={false}>
            {t('offer.unverifiedBody', { defaultValue: 'Sellers see offers from unverified buyers with a caution mark.' })}{' '}
            <LinkButton to="/app/verification" variant="ghost" size="sm">
              {t('home.verify.cta', { defaultValue: 'Start verification' })}
            </LinkButton>
          </FormAlert>
        )}
        {create.isError && Object.keys(errors).length === 0 && (
          <FormAlert title={t('offer.failed', { defaultValue: 'The offer was not sent' })}>{apiErrorMessage(create.error, t)}</FormAlert>
        )}

        <SectionCard eyebrow="01" title={t('offer.price', { defaultValue: 'Price & quantity' })}>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label={t('offer.pricePerKg', { defaultValue: 'Price (₹/kg)' })}
              required
              error={errors.price_per_kg?.message}
              hint={
                marketPrice ? (
                  <span className="inline-flex flex-wrap items-center gap-1">
                    {t('offer.mandiHint', {
                      market: marketPrice.market_name,
                      date: formatDate(marketPrice.price_date),
                      defaultValue: 'Mandi modal at {{market}} on {{date}}:',
                    })}{' '}
                    <Money value={marketPrice.modal_price_per_kg} perKg />
                    <DemoDataNotice show={marketPrice.is_illustrative} kind="prices" variant="inline" />
                  </span>
                ) : undefined
              }
            >
              <Input inputMode="decimal" leading="₹" trailing="/kg" {...register('price_per_kg')} autoFocus />
            </Field>
            <Field
              label={t('offer.quantity', { defaultValue: 'Quantity (kg)' })}
              required
              error={errors.quantity_kg?.message}
              hint={t('offer.qtyHint', { max: formatKg(target.availableKg), defaultValue: 'Up to {{max}}' })}
            >
              <Input inputMode="decimal" trailing="kg" {...register('quantity_kg')} />
            </Field>
          </div>
        </SectionCard>

        <SectionCard eyebrow="02" title={t('offer.logistics', { defaultValue: 'Pickup & delivery' })}>
          <div className="space-y-5">
            <RadioCardGroup
              label={t('offer.pickupTerms', { defaultValue: 'Who moves the produce' })}
              value={v.pickup_terms}
              onValueChange={(next) => setValue('pickup_terms', next as PickupTerms, { shouldValidate: true })}
              columns={2}
              error={errors.pickup_terms?.message}
            >
              <RadioCard
                value="buyer_pickup"
                icon={<PackageCheck strokeWidth={1.25} className="size-5" />}
                title={t('common:enums.pickupTerms.buyer_pickup', { defaultValue: 'Buyer collects' })}
                description={t('offer.buyerPickupBody', {
                  defaultValue: `You send a vehicle to the collection point and pay for transport. Farmers pay nothing to move the produce, so more of your price reaches them.`,
                })}
              />
              <RadioCard
                value="mandimate_delivery"
                icon={<Truck strokeWidth={1.25} className="size-5" />}
                title={t('common:enums.pickupTerms.mandimate_delivery', { defaultValue: 'MandiMate delivers' })}
                description={t('offer.deliveryBody', {
                  defaultValue: `MandiMate books a truck to your door. The fare is shared by the farmers' pool and deducted from their proceeds — price accordingly.`,
                })}
              />
            </RadioCardGroup>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                className="sm:col-span-2"
                label={t('form.deliveryLocation', { defaultValue: 'Delivery location' })}
                required
                error={errors.delivery_location?.message}
                hint={pickupLabel ? t('offer.deliveryHintPickup', { defaultValue: 'Where your vehicle takes it — for the record and the farmers.' }) : t('offer.deliveryHintMandimate', { defaultValue: 'The truck delivers here. Add coordinates for an exact transport estimate.' })}
              >
                <Input leading={<MapPin strokeWidth={1.25} className="size-4" />} {...register('delivery_location')} />
              </Field>
              <Field label={t('form.latitude', { defaultValue: 'Latitude' })} optional error={errors.delivery_latitude?.message}>
                <Input inputMode="decimal" {...register('delivery_latitude')} />
              </Field>
              <Field label={t('form.longitude', { defaultValue: 'Longitude' })} optional error={errors.delivery_longitude?.message}>
                <Input inputMode="decimal" {...register('delivery_longitude')} />
              </Field>
              <div className="sm:col-span-2">
                <CoordinatesControl
                  latitude={coordsOk ? lat : null}
                  longitude={coordsOk ? lng : null}
                  onChange={(c) => {
                    setValue('delivery_latitude', c ? c.latitude.toFixed(6) : '', { shouldValidate: true });
                    setValue('delivery_longitude', c ? c.longitude.toFixed(6) : '', { shouldValidate: true });
                  }}
                />
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard eyebrow="03" title={t('offer.terms', { defaultValue: 'Payment & quality' })}>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field
              label={t('form.paymentDays', { defaultValue: 'Payment within (days)' })}
              required
              error={errors.payment_terms_days?.message}
              hint={t('offer.paymentHint', { defaultValue: 'Each day of waiting costs farmers interest.' })}
            >
              <Input inputMode="numeric" trailing={t('form.days_unit', { defaultValue: 'days' })} {...register('payment_terms_days')} />
            </Field>
            <Field
              label={t('form.maxRejection', { defaultValue: 'Maximum rejection' })}
              required
              error={errors.max_rejection_pct?.message}
            >
              <Input inputMode="decimal" trailing="%" {...register('max_rejection_pct')} />
            </Field>
            <Field
              label={t('offer.handling', { defaultValue: 'Handling charge' })}
              optional
              error={errors.handling_charge_per_kg?.message}
              hint={t('offer.handlingHint', { defaultValue: 'Sorting or packing you deduct, per kg.' })}
            >
              <Input inputMode="decimal" leading="₹" trailing="/kg" {...register('handling_charge_per_kg')} />
            </Field>
            <Field className="sm:col-span-3" label={t('form.qualitySpec', { defaultValue: 'Quality specification' })} optional error={errors.quality_spec?.message}>
              <Textarea rows={3} {...register('quality_spec')} />
            </Field>
          </div>
        </SectionCard>

        <SectionCard eyebrow="04" title={t('offer.validity', { defaultValue: 'Validity & context' })}>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-3 sm:col-span-2">
              <SegmentedControl
                label={t('offer.validFor', { defaultValue: 'Offer valid for' })}
                value={preset}
                onValueChange={choosePreset}
                size="sm"
                options={[
                  { value: '24h', label: t('offer.preset.24h', { defaultValue: '24 hours' }) },
                  { value: '3d', label: t('offer.preset.3d', { defaultValue: '3 days' }) },
                  { value: '7d', label: t('offer.preset.7d', { defaultValue: '7 days' }) },
                  { value: 'custom', label: t('offer.preset.custom', { defaultValue: 'Custom' }) },
                ]}
              />
              <Field label={t('offer.validUntil', { defaultValue: 'Valid until' })} required error={errors.valid_until?.message}>
                <Input
                  type="datetime-local"
                  {...register('valid_until', { onChange: () => setPreset('custom') })}
                />
              </Field>
            </div>
            <Field
              className="sm:col-span-2"
              label={t('offer.demand', { defaultValue: 'For requirement' })}
              optional
              hint={t('offer.demandHint', { defaultValue: 'Linking fills in your delivery and payment terms.' })}
              error={errors.demand_id?.message}
            >
              <Select value={v.demand_id} onChange={(e) => onDemandChange(e.target.value)}>
                <option value="">{t('offer.noDemand', { defaultValue: 'Not linked' })}</option>
                {openDemands.map((d) => (
                  <option key={d.id} value={d.id}>
                    {`${d.crop_name} · ${formatKg(d.quantity_kg)} · ${formatDate(d.needed_by)}`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field className="sm:col-span-2" label={t('form.notes', { defaultValue: 'Notes' })} optional error={errors.notes?.message}>
              <Textarea rows={3} {...register('notes')} placeholder={t('offer.notesPlaceholder', { defaultValue: 'Anything the seller should know — crates, timing, contacts.' })} />
            </Field>
          </div>
        </SectionCard>
      </div>

      <aside className="space-y-5 lg:sticky lg:top-24" aria-label={t('offer.landedTitle', { defaultValue: 'Landed cost' })}>
        <div className="rounded-card border border-line bg-paper p-7">
          <p className="text-[13px] font-semibold text-gold-700">{t('offer.landedTitle', { defaultValue: 'Landed cost' })}</p>
          <p className="mt-3 font-display text-display-sm font-bold tabular-nums text-ink" aria-live="polite">
            {cost.orderValue === null ? '—' : <Money value={cost.orderValue} size="xl" />}
          </p>
          <p className="text-small text-muted">
            {t('offer.landedSub', { defaultValue: 'If every kilogram is accepted' })}
          </p>
          <Divider className="my-5" />
          <dl className="space-y-3 text-small">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{t('offer.landed.price', { defaultValue: 'Produce' })}</dt>
              <dd className="tabular-nums text-ink">
                {price !== null && qty !== null ? `${formatKg(qty)} × ₹${formatNumber(price, { maxDecimals: 2 })}` : '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{t('offer.landed.floor', { defaultValue: 'At max rejection' })}</dt>
              <dd className="tabular-nums text-ink">
                {cost.floorValue === null ? '—' : <Money value={cost.floorValue} />}
                {cost.maxRejectedKg !== null && rejection !== null && (
                  <span className="block text-end text-micro text-muted">
                    {t('offer.landed.rejectKg', { kg: formatKg(cost.maxRejectedKg), pct: formatPct(rejection), defaultValue: 'up to {{kg}} ({{pct}})' })}
                  </span>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{t('offer.landed.transport', { defaultValue: 'Transport' })}</dt>
              <dd className="text-end text-ink">
                {pickupLabel
                  ? t('offer.landed.yourVehicle', { defaultValue: 'Your vehicle — add your own cost' })
                  : t('offer.landed.included', { defaultValue: 'Included — borne by farmers' })}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{t('offer.landed.pay', { defaultValue: 'Payment due' })}</dt>
              <dd className="text-ink">
                {t('offer.landed.payDays', { count: num(v.payment_terms_days) ?? 0, defaultValue: '{{count}} days after delivery' })}
              </dd>
            </div>
          </dl>
          <Button type="submit" fullWidth className="mt-6" loading={create.isPending} disabled={!target.open}>
            {t('offer.submit', { defaultValue: 'Send offer' })}
          </Button>
          <p className="mt-3 text-center text-micro text-muted">
            {target.type === 'lot'
              ? t('offer.submitNoteLot', { defaultValue: 'Binding once the coordinator and every farmer consent.' })
              : t('offer.submitNoteHarvest', { defaultValue: 'Binding once the farmer accepts.' })}
          </p>
        </div>

        {farmer ? (
          <div className="space-y-3">
            <NetProceedsCard
              data={farmer.offer}
              variant="compact"
              eyebrow={t('offer.farmerEyebrow', { defaultValue: 'Indicative' })}
              title={t('offer.farmerTitle', { defaultValue: 'What farmers would net' })}
            />
            {farmer.baseline && farmer.upliftPerKg !== null && (
              <div className="flex items-center justify-between gap-3 border-y border-line px-1 py-4 text-small">
                <span className="text-muted">
                  {t('offer.vsMandi', { defaultValue: 'vs selling alone at the mandi' })}{' '}
                  <Money value={farmer.baseline.net_per_kg} perKg />
                </span>
                <Delta value={farmer.upliftPerKg} />
              </div>
            )}
            {farmer.transportUnknown && (
              <p className="text-micro text-muted">
                {t('offer.transportUnknown', { defaultValue: 'Add delivery coordinates to include the transport estimate.' })}
              </p>
            )}
            <p className="text-micro text-muted">
              {t('offer.farmerNote', { defaultValue: 'Farmers compare this net — not your headline price — with selling alone. Shorter payment and lower rejection lift it.' })}
            </p>
          </div>
        ) : (
          <p className="border-t border-line pt-5 text-small leading-relaxed text-muted">
            {t('offer.farmerEmpty', { defaultValue: 'Enter a price and quantity to see what farmers would take home.' })}
          </p>
        )}
      </aside>
    </form>
  );
}

export default function NewOfferPage() {
  const { t } = useTranslation('buyer');
  const [params] = useSearchParams();
  const lotId = params.get('lot_id');
  const harvestId = lotId ? null : params.get('harvest_id');
  const demandId = params.get('demand_id');
  const lot = useLot(lotId);
  const harvest = useHarvest(harvestId);
  const demand = useDemand(demandId ?? undefined);

  const query = lotId ? lot : harvest;
  const target = lot.data ? fromLot(lot.data) : harvest.data ? fromHarvest(harvest.data) : null;
  const demandReady = !demandId || demand.isSuccess || demand.isError;

  return (
    <div className="space-y-8">
      <Seo
        title={t('offer.title', { defaultValue: 'Make an offer' })}
        description={t('offer.description', { defaultValue: 'Price, quantity and terms for a lot or harvest.' })}
        path="/app/buyer/offers/new"
        noindex
      />
      <PageHeader
        breadcrumbs={[
          { label: t('supply.title', { defaultValue: 'Available supply' }), to: '/app/buyer/supply' },
          { label: t('offer.crumb', { defaultValue: 'New offer' }) },
        ]}
        title={t('offer.title', { defaultValue: 'Make an offer' })}
        description={t('offer.lede', {
          defaultValue: 'Farmers weigh what they take home after transport, handling, rejection and waiting for payment. Clear terms win lots.',
        })}
      />

      {!lotId && !harvestId ? (
        <EmptyState
          framed
          icon={<SearchX strokeWidth={1.25} className="size-5" />}
          title={t('offer.noTarget', { defaultValue: 'Choose supply to make an offer on' })}
          description={t('offer.noTargetBody', { defaultValue: 'Offers are made on a pooled lot or a single harvest.' })}
          action={<LinkButton to="/app/buyer/supply">{t('home.browseSupply', { defaultValue: 'Browse supply' })}</LinkButton>}
        />
      ) : query.isError ? (
        <EmptyState
          framed
          icon={<SearchX strokeWidth={1.25} className="size-5" />}
          title={t('offer.targetError', { defaultValue: 'This supply is not available' })}
          description={apiErrorMessage(query.error, t)}
          action={<LinkButton to="/app/buyer/supply">{t('home.browseSupply', { defaultValue: 'Browse supply' })}</LinkButton>}
        />
      ) : !target || !demandReady ? (
        <div className="space-y-6">
          <Skeleton className="h-52 rounded-panel" />
          <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
            <Skeleton className="h-96 rounded-card" />
            <Skeleton className="h-72 rounded-card" />
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          <TargetSummary target={target} />
          {!target.open && (
            <FormAlert tone="warning" title={t('offer.closedTitle', { defaultValue: 'Not open for offers' })} live={false}>
              {t('offer.closedBody', { defaultValue: 'This supply is no longer taking offers. Browse open lots instead.' })}
            </FormAlert>
          )}
          <OfferForm target={target} demand={demand.data ?? null} />
        </div>
      )}
    </div>
  );
}
