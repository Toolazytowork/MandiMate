import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { z } from 'zod';

import { PageHeader, SectionCard } from '@/components/domain';
import { Button, Field, Input, LinkButton, Select, Textarea, toast } from '@/components/ui';
import { GRADES, isLatitude, isLongitude, parseCoordinate } from '@/features/buyer/sourcing';
import { useCreateDemand, useCrops } from '@/features/buyer/sourcingHooks';
import { CoordinatesControl } from '@/features/shared/components/CoordinatesControl';
import { FormAlert } from '@/features/shared/components/FormAlert';
import { apiErrorMessage, applyFieldErrors, blankToNull } from '@/features/shared/forms';
import { StateSuggestions } from '@/features/shared/indianStates';
import { useAuth } from '@/lib/auth';
import { todayIST } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { DemandCreateRequest, Grade } from '@/types/api';

import { addDays } from '@/features/buyer/utils';

const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/,/g, '')));

interface FormValues {
  crop_id: string;
  grade_required: string;
  quantity_kg: string;
  min_quantity_kg: string;
  target_price_per_kg: string;
  delivery_location: string;
  delivery_district: string;
  delivery_state: string;
  delivery_latitude: string;
  delivery_longitude: string;
  needed_by: string;
  payment_terms_days: string;
  max_rejection_pct: string;
  quality_spec: string;
  notes: string;
}

const FIELDS = [
  'crop_id',
  'grade_required',
  'quantity_kg',
  'min_quantity_kg',
  'target_price_per_kg',
  'delivery_location',
  'delivery_district',
  'delivery_state',
  'delivery_latitude',
  'delivery_longitude',
  'needed_by',
  'payment_terms_days',
  'max_rejection_pct',
  'quality_spec',
  'notes',
] as const;

export default function NewDemandPage() {
  const { t } = useTranslation('buyer');
  const navigate = useNavigate();
  const { user } = useAuth();
  const crops = useCrops();
  const create = useCreateDemand();
  const today = todayIST();

  const schema = useMemo(() => {
    const req = t('form.required', { defaultValue: 'Required' });
    const positive = t('form.positive', { defaultValue: 'Enter a number above zero' });
    return z
      .object({
        crop_id: z.string().min(1, t('form.cropRequired', { defaultValue: 'Choose a crop' })),
        grade_required: z.string().refine((v) => (GRADES as readonly string[]).includes(v), req),
        quantity_kg: z.string().refine((v) => (num(v) ?? 0) > 0, positive),
        min_quantity_kg: z.string(),
        target_price_per_kg: z
          .string()
          .refine((v) => num(v) === null || (num(v) as number) > 0, positive),
        delivery_location: z.string().trim().min(2, t('form.locationRequired', { defaultValue: 'Where should it be delivered?' })).max(200),
        delivery_district: z.string().max(100),
        delivery_state: z.string().max(100),
        delivery_latitude: z.string().refine((v) => isLatitude(parseCoordinate(v)), t('form.lat', { defaultValue: 'Latitude is between −90 and 90' })),
        delivery_longitude: z
          .string()
          .refine((v) => isLongitude(parseCoordinate(v)), t('form.lng', { defaultValue: 'Longitude is between −180 and 180' })),
        needed_by: z.string().refine((v) => v >= today, t('form.future', { defaultValue: 'Pick today or a later date' })),
        payment_terms_days: z.string().refine((v) => {
          const n = num(v);
          return n !== null && Number.isInteger(n) && n >= 0 && n <= 90;
        }, t('form.days', { defaultValue: 'Whole days from 0 to 90' })),
        max_rejection_pct: z.string().refine((v) => {
          const n = num(v);
          return n !== null && n >= 0 && n <= 50;
        }, t('form.rejection', { defaultValue: 'Between 0 and 50 %' })),
        quality_spec: z.string().max(1000),
        notes: z.string().max(2000),
      })
      .superRefine((values, ctx) => {
        const qty = num(values.quantity_kg);
        const min = num(values.min_quantity_kg);
        if (min !== null && (!Number.isFinite(min) || min <= 0)) {
          ctx.addIssue({ code: 'custom', path: ['min_quantity_kg'], message: positive });
        } else if (min !== null && qty !== null && min > qty) {
          ctx.addIssue({
            code: 'custom',
            path: ['min_quantity_kg'],
            message: t('form.minAboveQty', { defaultValue: 'Cannot exceed the full quantity' }),
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
      });
  }, [t, today]);

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      crop_id: '',
      grade_required: 'A',
      quantity_kg: '',
      min_quantity_kg: '',
      target_price_per_kg: '',
      delivery_location: user?.organization_name ? `${user.organization_name}${user.district ? `, ${user.district}` : ''}` : '',
      delivery_district: user?.district ?? '',
      delivery_state: user?.state ?? '',
      delivery_latitude: user?.latitude?.toString() ?? '',
      delivery_longitude: user?.longitude?.toString() ?? '',
      needed_by: addDays(today, 7),
      payment_terms_days: '7',
      max_rejection_pct: '5',
      quality_spec: '',
      notes: '',
    },
  });

  const lat = parseCoordinate(watch('delivery_latitude'));
  const lng = parseCoordinate(watch('delivery_longitude'));
  const cropId = watch('crop_id');
  const crop = crops.data?.find((c) => c.id === cropId);

  const onSubmit = handleSubmit(async (v) => {
    const req: DemandCreateRequest = {
      crop_id: v.crop_id,
      grade_required: v.grade_required as Grade,
      quantity_kg: num(v.quantity_kg) as number,
      min_quantity_kg: num(v.min_quantity_kg) ?? undefined,
      target_price_per_kg: num(v.target_price_per_kg),
      delivery_location: v.delivery_location.trim(),
      delivery_district: blankToNull(v.delivery_district),
      delivery_state: blankToNull(v.delivery_state),
      delivery_latitude: parseCoordinate(v.delivery_latitude),
      delivery_longitude: parseCoordinate(v.delivery_longitude),
      needed_by: v.needed_by,
      payment_terms_days: num(v.payment_terms_days) as number,
      max_rejection_pct: num(v.max_rejection_pct) as number,
      quality_spec: blankToNull(v.quality_spec),
      notes: blankToNull(v.notes),
    };
    try {
      const demand = await create.mutateAsync(req);
      toast.success(t('newDemand.posted', { defaultValue: 'Requirement posted' }), {
        description: t('newDemand.postedBody', { defaultValue: 'Coordinators can now pool supply towards it.' }),
      });
      navigate(`/app/buyer/demands/${demand.id}`);
    } catch (error) {
      const applied = applyFieldErrors(error, setError, { fields: FIELDS });
      if (applied.length === 0) toast.error(apiErrorMessage(error, t));
    }
  });

  return (
    <div className="space-y-8">
      <Seo
        title={t('newDemand.title', { defaultValue: 'Post a requirement' })}
        description={t('newDemand.lede', { defaultValue: 'Tell coordinators what to pool for you.' })}
        path="/app/buyer/demands/new"
        noindex
      />
      <PageHeader
        breadcrumbs={[
          { label: t('demands.title', { defaultValue: 'Requirements' }), to: '/app/buyer/demands' },
          { label: t('newDemand.crumb', { defaultValue: 'New' }) },
        ]}
        title={t('newDemand.title', { defaultValue: 'Post a requirement' })}
        description={t('newDemand.lede', {
          defaultValue: 'Be precise — coordinators pool nearby harvests to exactly this grade, quantity and date, and farmers see your terms before they consent.',
        })}
      />

      <form onSubmit={onSubmit} noValidate className="mx-auto max-w-3xl space-y-8">
        {create.isError && Object.keys(errors).length === 0 && (
          <FormAlert title={t('newDemand.failed', { defaultValue: 'Could not post the requirement' })}>
            {apiErrorMessage(create.error, t)}
          </FormAlert>
        )}

        <SectionCard eyebrow="01" title={t('newDemand.what', { defaultValue: 'What you need' })}>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={t('form.crop', { defaultValue: 'Crop' })} required error={errors.crop_id?.message}>
              <Select {...register('crop_id')} placeholder={crops.isPending ? t('form.loading', { defaultValue: 'Loading…' }) : t('form.chooseCrop', { defaultValue: 'Choose a crop' })}>
                {crops.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('form.grade', { defaultValue: 'Minimum grade' })} required error={errors.grade_required?.message}>
              <Select {...register('grade_required')}>
                {(crop?.grades ?? GRADES).map((g) => (
                  <option key={g} value={g}>
                    {t(`common:enums.grade.${g}`, { defaultValue: g })}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t('form.quantity', { defaultValue: 'Quantity (kg)' })}
              required
              error={errors.quantity_kg?.message}
            >
              <Input inputMode="decimal" placeholder="2000" {...register('quantity_kg')} trailing="kg" />
            </Field>
            <Field
              label={t('form.minQuantity', { defaultValue: 'Smallest lot you accept (kg)' })}
              optional
              hint={t('form.minQuantityHint', { defaultValue: 'Leave blank to accept partial lots of any size.' })}
              error={errors.min_quantity_kg?.message}
            >
              <Input inputMode="decimal" {...register('min_quantity_kg')} trailing="kg" />
            </Field>
            <Field
              label={t('form.targetPrice', { defaultValue: 'Target price (₹/kg)' })}
              optional
              hint={t('form.targetPriceHint', { defaultValue: 'Shown to coordinators as a guide, not a binding offer.' })}
              error={errors.target_price_per_kg?.message}
            >
              <Input inputMode="decimal" leading="₹" {...register('target_price_per_kg')} trailing="/kg" />
            </Field>
            <Field label={t('form.neededBy', { defaultValue: 'Needed by' })} required error={errors.needed_by?.message}>
              <Input type="date" min={today} {...register('needed_by')} />
            </Field>
          </div>
        </SectionCard>

        <SectionCard eyebrow="02" title={t('newDemand.where', { defaultValue: 'Where it goes' })}>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              className="sm:col-span-2"
              label={t('form.deliveryLocation', { defaultValue: 'Delivery location' })}
              required
              hint={t('form.deliveryLocationHint', { defaultValue: 'Warehouse, mandi yard or processing unit, as a transporter would find it.' })}
              error={errors.delivery_location?.message}
            >
              <Input {...register('delivery_location')} autoComplete="street-address" />
            </Field>
            <Field label={t('form.district', { defaultValue: 'District' })} optional error={errors.delivery_district?.message}>
              <Input {...register('delivery_district')} />
            </Field>
            <Field label={t('form.state', { defaultValue: 'State' })} optional error={errors.delivery_state?.message}>
              <Input list="demand-states" {...register('delivery_state')} />
            </Field>
            <StateSuggestions id="demand-states" />
            <Field label={t('form.latitude', { defaultValue: 'Latitude' })} optional error={errors.delivery_latitude?.message}>
              <Input inputMode="decimal" {...register('delivery_latitude')} />
            </Field>
            <Field label={t('form.longitude', { defaultValue: 'Longitude' })} optional error={errors.delivery_longitude?.message}>
              <Input inputMode="decimal" {...register('delivery_longitude')} />
            </Field>
            <div className="sm:col-span-2">
              <p className="mb-2 text-small text-muted">
                {t('form.coordsHint', { defaultValue: 'Coordinates let MandiMate price transport to your door precisely.' })}
              </p>
              <CoordinatesControl
                latitude={lat !== null && Number.isFinite(lat) ? lat : null}
                longitude={lng !== null && Number.isFinite(lng) ? lng : null}
                onChange={(c) => {
                  setValue('delivery_latitude', c ? c.latitude.toFixed(6) : '', { shouldValidate: true });
                  setValue('delivery_longitude', c ? c.longitude.toFixed(6) : '', { shouldValidate: true });
                }}
              />
            </div>
          </div>
        </SectionCard>

        <SectionCard eyebrow="03" title={t('newDemand.terms', { defaultValue: 'Terms & quality' })}>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label={t('form.paymentDays', { defaultValue: 'Payment within (days)' })}
              required
              hint={t('form.paymentDaysHint', { defaultValue: 'Shorter terms raise what farmers net — and your chances.' })}
              error={errors.payment_terms_days?.message}
            >
              <Input inputMode="numeric" {...register('payment_terms_days')} trailing={t('form.days_unit', { defaultValue: 'days' })} />
            </Field>
            <Field
              label={t('form.maxRejection', { defaultValue: 'Maximum rejection' })}
              required
              hint={t('form.maxRejectionHint', { defaultValue: 'The most you may reject at your quality check.' })}
              error={errors.max_rejection_pct?.message}
            >
              <Input inputMode="decimal" {...register('max_rejection_pct')} trailing="%" />
            </Field>
            <Field
              className="sm:col-span-2"
              label={t('form.qualitySpec', { defaultValue: 'Quality specification' })}
              optional
              hint={t('form.qualitySpecHint', { defaultValue: 'Size, colour, ripeness, moisture — what your QC checks.' })}
              error={errors.quality_spec?.message}
            >
              <Textarea rows={3} {...register('quality_spec')} />
            </Field>
            <Field className="sm:col-span-2" label={t('form.notes', { defaultValue: 'Notes' })} optional error={errors.notes?.message}>
              <Textarea rows={3} {...register('notes')} />
            </Field>
          </div>
        </SectionCard>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <LinkButton to="/app/buyer/demands" variant="ghost">
            {t('common:actions.cancel', { defaultValue: 'Cancel' })}
          </LinkButton>
          <Button type="submit" loading={create.isPending}>
            {t('newDemand.submit', { defaultValue: 'Post requirement' })}
          </Button>
        </div>
      </form>
    </div>
  );
}
