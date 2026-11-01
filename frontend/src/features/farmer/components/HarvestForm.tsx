import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';

import { Button, Field, Input, SegmentedControl, Skeleton, Textarea, toast } from '@/components/ui';
import { CropGlyph, useUiLanguage } from '@/components/domain';
import { isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { todayIST } from '@/lib/format';
import type { Crop, Grade, HarvestCreateRequest, HarvestDraft } from '@/types/api';

import { useCrops } from '../hooks';
import { addDays, fromKg, isIsoDate, localCropName, parseAmount, toKg, type QuantityUnit } from '../lib';

const GRADES: readonly Grade[] = ['A', 'B', 'C', 'ungraded'];

const schema = z
  .object({
    crop_id: z.string().min(1, 'crop'),
    variety: z.string().max(80, 'tooLong'),
    quantity: z.string().refine((v) => (parseAmount(v) ?? 0) > 0, 'quantity'),
    unit: z.enum(['kg', 'quintal']),
    grade: z.enum(['A', 'B', 'C', 'ungraded']),
    harvest_date: z.string().refine(isIsoDate, 'date'),
    available_from: z.string().refine(isIsoDate, 'date'),
    sell_by: z.string().refine(isIsoDate, 'date'),
    min_price: z.string().refine((v) => v.trim() === '' || (parseAmount(v) ?? 0) > 0, 'price'),
    quality_notes: z.string().max(500, 'tooLong'),
  })
  .refine((v) => v.sell_by >= v.available_from, { path: ['sell_by'], message: 'sellBy' });

export type HarvestFormValues = z.infer<typeof schema>;
export type HarvestFormField = keyof HarvestFormValues;
type FormField = HarvestFormField;

export type HarvestFormRequest = Omit<HarvestCreateRequest, 'source' | 'status' | 'farmer_id'>;

/** Maps API field names (and voice-draft keys) onto the form's own fields. */
const API_TO_FORM: Record<string, FormField> = {
  crop_id: 'crop_id',
  crop_name: 'crop_id',
  variety: 'variety',
  quantity_kg: 'quantity',
  grade: 'grade',
  harvest_date: 'harvest_date',
  available_from: 'available_from',
  sell_by: 'sell_by',
  min_price_per_kg: 'min_price',
  quality_notes: 'quality_notes',
};

export function formFieldFor(apiField: string): FormField | undefined {
  return API_TO_FORM[apiField];
}

export function emptyHarvestValues(today = todayIST()): HarvestFormValues {
  return {
    crop_id: '',
    variety: '',
    quantity: '',
    unit: 'kg',
    grade: 'ungraded',
    harvest_date: today,
    available_from: today,
    sell_by: addDays(today, 5),
    min_price: '',
    quality_notes: '',
  };
}

/** Pre-fills the form from a voice draft; anything the AI did not catch keeps its default. */
export function valuesFromDraft(draft: HarvestDraft, today = todayIST()): HarvestFormValues {
  const base = emptyHarvestValues(today);
  const available = draft.available_from ?? draft.harvest_date ?? base.available_from;
  return {
    ...base,
    crop_id: draft.crop_id ?? '',
    variety: draft.variety ?? '',
    quantity: draft.quantity_kg ? String(draft.quantity_kg) : '',
    grade: draft.grade ?? 'ungraded',
    harvest_date: draft.harvest_date ?? base.harvest_date,
    available_from: available,
    sell_by: draft.sell_by ?? addDays(available, 5),
    min_price: draft.min_price_per_kg ? String(draft.min_price_per_kg) : '',
    quality_notes: draft.quality_notes ?? '',
  };
}

export function toHarvestRequest(values: HarvestFormValues): HarvestFormRequest {
  const minPrice = parseAmount(values.min_price);
  return {
    crop_id: values.crop_id,
    variety: values.variety.trim() || null,
    quantity_kg: Math.round(toKg(parseAmount(values.quantity) ?? 0, values.unit) * 10) / 10,
    grade: values.grade,
    quality_notes: values.quality_notes.trim() || null,
    harvest_date: values.harvest_date,
    available_from: values.available_from,
    sell_by: values.sell_by,
    min_price_per_kg: minPrice && minPrice > 0 ? minPrice : null,
  };
}

export interface HarvestFormProps {
  defaultValues: HarvestFormValues;
  /** Fields to draw attention to (e.g. what the voice assistant could not hear). */
  highlight?: readonly FormField[];
  /** Called with the request and whether it should be saved as a draft. */
  onSubmit: (req: HarvestFormRequest, asDraft: boolean) => Promise<unknown>;
  submitLabel: string;
  /** Shows a quiet "Save as draft" button next to submit. */
  allowDraft?: boolean;
  /** Locks the crop (editing an existing harvest). */
  cropLocked?: boolean;
}

/** The harvest form: big crop tiles, kg/quintal helper, grade, date presets, private minimum price. */
export function HarvestForm({ defaultValues, highlight = [], onSubmit, submitLabel, allowDraft = false, cropLocked = false }: HarvestFormProps) {
  const { t } = useTranslation('farmer');
  const lang = useUiLanguage();
  const crops = useCrops();
  const [asDraft, setAsDraft] = useState(false);
  const today = todayIST();

  const form = useForm<HarvestFormValues>({ resolver: zodResolver(schema), defaultValues, mode: 'onTouched' });
  const { register, control, setValue, handleSubmit, setError, formState } = form;
  const { errors, isSubmitting } = formState;

  const [cropId, quantity, unit, availableFrom, grade] = useWatch({ control, name: ['crop_id', 'quantity', 'unit', 'available_from', 'grade'] });
  const crop: Crop | undefined = useMemo(() => crops.data?.find((c) => c.id === cropId), [crops.data, cropId]);
  const grades = crop && crop.grades.length > 0 ? GRADES.filter((g) => g === 'ungraded' || crop.grades.includes(g)) : GRADES;

  useEffect(() => {
    if (crop && grade !== 'ungraded' && !crop.grades.includes(grade)) setValue('grade', 'ungraded');
  }, [crop, grade, setValue]);

  const flagged = new Set(highlight);
  const errorText = (field: FormField) => {
    const message = errors[field]?.message;
    if (!message) return flagged.has(field) ? t('form.check', { defaultValue: 'Please check this — we could not hear it clearly.' }) : undefined;
    return t(`form.errors.${message}`, { defaultValue: message });
  };
  const ring = (field: FormField) => (flagged.has(field) && !errors[field] ? 'rounded-sm outline outline-1 outline-offset-8 outline-gold-400' : undefined);

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(toHarvestRequest(values), asDraft);
    } catch (error) {
      if (isApiError(error) && Object.keys(error.fieldErrors).length > 0) {
        for (const [path, message] of Object.entries(error.fieldErrors)) {
          const field = formFieldFor(path.split('.')[0] ?? path);
          if (field) setError(field, { type: 'server', message });
        }
        toast.error(error.detail);
      } else if (isApiError(error)) {
        toast.error(error.detail);
      } else {
        toast.error(t('common:errors.generic'));
      }
    }
  });

  const parsedQty = parseAmount(quantity);
  const otherUnit: QuantityUnit = unit === 'kg' ? 'quintal' : 'kg';
  const converted = parsedQty && parsedQty > 0 ? fromKg(toKg(parsedQty, unit), otherUnit) : null;
  const perishDays = crop?.perishability_days;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-9">
      {/* Crop */}
      <fieldset className={cn('flex flex-col gap-3', ring('crop_id'))}>
        <legend className="mb-3 font-display text-2xl font-bold text-ink">{t('form.crop', { defaultValue: 'What did you harvest?' })}</legend>
        {crops.isPending ? (
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
            {Array.from({ length: 10 }, (_, i) => (
              <Skeleton key={i} className="h-24 rounded-sm" />
            ))}
          </div>
        ) : (
          <div role="radiogroup" aria-label={t('form.crop', { defaultValue: 'What did you harvest?' })} className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
            {(crops.data ?? []).map((c) => {
              const selected = c.id === cropId;
              return (
                <label
                  key={c.id}
                  className={cn(
                    'group relative flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-sm border bg-paper px-2 py-3 text-center transition-colors duration-300 ease-luxe',
                    'has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gold-700',
                    selected ? 'border-ink bg-parchment' : 'border-line hover:border-forest-400',
                    cropLocked && !selected && 'pointer-events-none opacity-40',
                  )}
                >
                  <input type="radio" value={c.id} disabled={cropLocked && !selected} className="sr-only" {...register('crop_id')} />
                  <CropGlyph code={c.code} name={c.name} size="md" />
                  <span className="text-[13px] font-medium leading-tight text-ink">{localCropName(c, lang)}</span>
                  {lang !== 'en' ? <span className="text-[11px] leading-none text-muted">{c.name}</span> : null}
                </label>
              );
            })}
          </div>
        )}
        {errorText('crop_id') ? (
          <p className={cn('text-sm', errors.crop_id ? 'text-danger-ink' : 'text-gold-700')} role={errors.crop_id ? 'alert' : undefined}>
            {errorText('crop_id')}
          </p>
        ) : null}
        <Field label={t('form.variety', { defaultValue: 'Variety' })} optional error={errors.variety ? errorText('variety') : undefined} className="max-w-sm">
          <Input placeholder={t('form.varietyHint', { defaultValue: 'e.g. Hybrid, Desi' })} {...register('variety')} />
        </Field>
      </fieldset>

      {/* Quantity */}
      <div className={cn('flex flex-col gap-3', ring('quantity'))}>
        <h3 className="font-display text-2xl font-bold text-ink">{t('form.howMuch', { defaultValue: 'How much?' })}</h3>
        <div className="flex flex-wrap items-start gap-3">
          <Field label={t('form.quantity', { defaultValue: 'Quantity' })} required error={errorText('quantity')} className="min-w-0 flex-1 basis-40">
            <Input inputMode="decimal" size="lg" placeholder={unit === 'kg' ? '400' : '4'} trailing={unit === 'kg' ? 'kg' : t('form.quintal', { defaultValue: 'quintal' })} {...register('quantity')} />
          </Field>
          <Controller
            control={control}
            name="unit"
            render={({ field }) => (
              <SegmentedControl<QuantityUnit>
                label={t('form.unit', { defaultValue: 'Unit' })}
                value={field.value}
                onValueChange={(next) => {
                  const current = parseAmount(quantity);
                  if (current && current > 0) setValue('quantity', String(Math.round(fromKg(toKg(current, field.value), next) * 100) / 100));
                  field.onChange(next);
                }}
                options={[
                  { value: 'kg', label: 'kg' },
                  { value: 'quintal', label: t('form.quintal', { defaultValue: 'quintal' }) },
                ]}
                className="mt-7"
              />
            )}
          />
        </div>
        <p className="text-sm text-muted" aria-live="polite">
          {converted !== null
            ? t('form.converted', { defaultValue: '= {{value}} {{unit}}', value: Math.round(converted * 100) / 100, unit: otherUnit === 'kg' ? 'kg' : t('form.quintal', { defaultValue: 'quintal' }) })
            : t('form.quintalHelp', { defaultValue: '1 quintal = 100 kg' })}
        </p>
      </div>

      {/* Grade */}
      <Controller
        control={control}
        name="grade"
        render={({ field }) => (
          <fieldset className={cn('flex flex-col gap-3', ring('grade'))}>
            <legend className="mb-1 font-display text-2xl font-bold text-ink">{t('form.grade', { defaultValue: 'Quality grade' })}</legend>
            <p className="text-sm text-muted">{t('form.gradeHelp', { defaultValue: 'Not sure? Choose “Not sure yet”. A coordinator checks it at pickup.' })}</p>
            <div role="radiogroup" aria-label={t('form.grade', { defaultValue: 'Quality grade' })} className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {grades.map((g) => (
                <button
                  key={g}
                  type="button"
                  role="radio"
                  aria-checked={field.value === g}
                  onClick={() => field.onChange(g)}
                  className={cn(
                    'min-h-12 rounded-sm border px-3 text-[13px] font-semibold transition-colors duration-300 ease-luxe focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-gold-700',
                    field.value === g ? 'border-forest-600 bg-forest-600 text-white' : 'border-line bg-paper text-ink hover:border-forest-400',
                  )}
                >
                  {g === 'ungraded' ? t('form.notSure', { defaultValue: 'Not sure yet' }) : t(`common:enums.grade.${g}`)}
                </button>
              ))}
            </div>
          </fieldset>
        )}
      />

      {/* Dates */}
      <div className="flex flex-col gap-5">
        <h3 className="font-display text-2xl font-bold text-ink">{t('form.when', { defaultValue: 'When can it be picked up?' })}</h3>
        <DateField
          label={t('form.availableFrom', { defaultValue: 'Ready for pickup from' })}
          error={errorText('available_from')}
          className={ring('available_from')}
          presets={[
            { label: t('form.today', { defaultValue: 'Today' }), value: today },
            { label: t('form.tomorrow', { defaultValue: 'Tomorrow' }), value: addDays(today, 1) },
          ]}
          value={availableFrom}
          onPreset={(value) => {
            setValue('available_from', value, { shouldValidate: true });
            setValue('harvest_date', value <= today ? value : today);
            if (perishDays) setValue('sell_by', addDays(value, Math.max(1, perishDays - 1)), { shouldValidate: true });
          }}
          input={<Input type="date" min={addDays(today, -30)} {...register('available_from')} />}
        />
        <Controller
          control={control}
          name="sell_by"
          render={({ field }) => (
            <DateField
              label={t('form.sellBy', { defaultValue: 'Must be sold by' })}
              hint={perishDays ? t('form.sellByHint', { defaultValue: '{{crop}} usually keeps about {{count}} days.', crop: crop ? localCropName(crop, lang) : '', count: perishDays }) : undefined}
              error={errorText('sell_by')}
              className={ring('sell_by')}
              presets={[
                { label: t('form.in3Days', { defaultValue: 'In 3 days' }), value: addDays(availableFrom || today, 3) },
                { label: t('form.inAWeek', { defaultValue: 'In a week' }), value: addDays(availableFrom || today, 7) },
              ]}
              value={field.value}
              onPreset={(value) => field.onChange(value)}
              input={<Input type="date" min={availableFrom || today} value={field.value} onChange={(e) => field.onChange(e.target.value)} onBlur={field.onBlur} name={field.name} />}
            />
          )}
        />
        <Field label={t('form.harvestDate', { defaultValue: 'Harvested on' })} error={errorText('harvest_date')} className="max-w-xs">
          <Input type="date" max={today} {...register('harvest_date')} />
        </Field>
      </div>

      {/* Minimum price */}
      <div className={cn('flex flex-col gap-3 border-t border-line pt-8', ring('min_price'))}>
        <h3 className="flex items-center gap-2.5 font-display text-2xl font-bold text-ink">
          <Lock aria-hidden="true" strokeWidth={1.25} className="size-4 text-muted" />
          {t('form.minPrice', { defaultValue: 'Your lowest price (private)' })}
        </h3>
        <Field
          label={t('form.minPriceLabel', { defaultValue: 'Minimum you will take home per kg' })}
          optional
          hint={t('form.minPriceHint', { defaultValue: 'Buyers never see this. We mark offers that leave you less than this, after all costs.' })}
          error={errors.min_price ? errorText('min_price') : undefined}
        >
          <Input inputMode="decimal" leading="₹" trailing="/kg" placeholder="22" {...register('min_price')} />
        </Field>
      </div>

      {/* Notes */}
      <Field label={t('form.notes', { defaultValue: 'Anything buyers should know?' })} optional error={errors.quality_notes ? errorText('quality_notes') : undefined}>
        <Textarea rows={3} placeholder={t('form.notesHint', { defaultValue: 'e.g. Firm, bright red, sorted by size' })} {...register('quality_notes')} />
      </Field>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col-reverse gap-2 border-t border-line bg-ivory px-4 py-4 sm:static sm:mx-0 sm:flex-row sm:justify-end sm:border-0 sm:bg-transparent sm:p-0">
        {allowDraft ? (
          <Button type="submit" variant="ghost" size="lg" disabled={isSubmitting} loading={isSubmitting && asDraft} onClick={() => setAsDraft(true)}>
            {t('form.saveDraft', { defaultValue: 'Save as draft' })}
          </Button>
        ) : null}
        <Button type="submit" size="lg" loading={isSubmitting && !asDraft} disabled={isSubmitting} onClick={() => setAsDraft(false)}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

interface DateFieldProps {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  presets: { label: string; value: string }[];
  value: string;
  onPreset: (value: string) => void;
  input: ReactNode;
}

function DateField({ label, hint, error, className, presets, value, onPreset, input }: DateFieldProps) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
          {presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              aria-pressed={value === preset.value}
              onClick={() => onPreset(preset.value)}
              className={cn(
                'min-h-12 rounded-sm border px-5 text-[13px] font-semibold transition-colors duration-300 ease-luxe focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-gold-700',
                value === preset.value ? 'border-forest-600 bg-forest-600 text-white' : 'border-line bg-paper text-ink hover:border-forest-400',
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="max-w-xs">{input}</div>
      </div>
    </Field>
  );
}
