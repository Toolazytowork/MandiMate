import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { CircleHelp, Keyboard, Mic, Sprout, UserPlus } from 'lucide-react';
import { Avatar, Badge, Button, Card, EmptyState, Field, Input, LinkButton, SegmentedControl, Select, Skeleton, Textarea, toast } from '@/components/ui';
import { AiSourceBadge, CropGlyph, PageHeader, QueryState, SectionCard, VoiceCapture } from '@/components/domain';
import { Reveal } from '@/components/motion';
import { useCreateHarvest, useCrops, useFarmers, useVoiceListing } from '@/features/coordinator/hooks';
import { addDays, applyFieldErrors, errorMessage } from '@/features/coordinator/utils';
import { formatNumber, formatPct, todayIST } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { Crop, Grade, HarvestCreateRequest, HarvestDraft, Language, VoiceDraft } from '@/types/api';

type Mode = 'voice' | 'form';
const GRADES: readonly Grade[] = ['A', 'B', 'C', 'ungraded'];
const FIELDS = ['crop_id', 'variety', 'quantity_kg', 'grade', 'harvest_date', 'available_from', 'sell_by', 'min_price_per_kg', 'quality_notes'] as const;

function useSchema() {
  const { t } = useTranslation('coordinator');
  const optionalNumber = z
    .string()
    .trim()
    .refine((value) => value === '' || (Number.isFinite(Number(value)) && Number(value) > 0), t('listing.errors.positive', { defaultValue: 'Enter a positive number.' }))
    .transform((value) => (value === '' ? null : Number(value)));
  return z
    .object({
      crop_id: z.string().min(1, t('listing.errors.crop', { defaultValue: 'Choose the crop.' })),
      variety: z.string().trim(),
      quantity_kg: z
        .string()
        .trim()
        .refine((value) => Number.isFinite(Number(value)) && Number(value) >= 10, t('listing.errors.quantity', { defaultValue: 'At least 10 kg.' }))
        .transform(Number),
      grade: z.enum(['A', 'B', 'C', 'ungraded']),
      harvest_date: z.string().min(10, t('listing.errors.date', { defaultValue: 'Pick a date.' })),
      available_from: z.string().min(10, t('listing.errors.date', { defaultValue: 'Pick a date.' })),
      sell_by: z.string().min(10, t('listing.errors.date', { defaultValue: 'Pick a date.' })),
      min_price_per_kg: optionalNumber,
      quality_notes: z.string().trim(),
    })
    .refine((values) => values.sell_by >= values.available_from, {
      path: ['sell_by'],
      message: t('listing.errors.sellBy', { defaultValue: 'Sell-by must be on or after available-from.' }),
    });
}

type FormInput = z.input<ReturnType<typeof useSchema>>;
type FormOutput = z.output<ReturnType<typeof useSchema>>;

function defaults(): FormInput {
  const today = todayIST();
  return {
    crop_id: '',
    variety: '',
    quantity_kg: '',
    grade: 'ungraded',
    harvest_date: today,
    available_from: today,
    sell_by: addDays(today, 5),
    min_price_per_kg: '',
    quality_notes: '',
  };
}

function cropLabel(crop: Crop, language: string): string {
  if (language === 'hi' && crop.name_hi) return `${crop.name} · ${crop.name_hi}`;
  if (language === 'te' && crop.name_te) return `${crop.name} · ${crop.name_te}`;
  if (language === 'kn' && crop.name_kn) return `${crop.name} · ${crop.name_kn}`;
  if (language === 'ur' && crop.name_ur) return `${crop.name} · ${crop.name_ur}`;
  return crop.name;
}

export default function AssistedListingPage() {
  const { t } = useTranslation('coordinator');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const farmers = useFarmers();
  const crops = useCrops();
  const voice = useVoiceListing();
  const create = useCreateHarvest();
  const schema = useSchema();
  const [mode, setMode] = useState<Mode>('voice');
  const [draft, setDraft] = useState<VoiceDraft | null>(null);
  const farmerId = params.get('farmer') ?? '';
  const farmer = useMemo(() => farmers.data?.find((entry) => entry.user.id === farmerId) ?? null, [farmers.data, farmerId]);
  const language: Language = farmer?.user.preferred_language ?? 'te';

  const form = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(schema), defaultValues: defaults() });
  const {
    formState: { errors },
  } = form;
  const cropId = form.watch('crop_id');
  const selectedCrop = crops.data?.find((crop) => crop.id === cropId);

  useEffect(() => {
    if (!selectedCrop) return;
    const available = form.getValues('available_from');
    if (available) form.setValue('sell_by', addDays(available, Math.max(1, selectedCrop.perishability_days)), { shouldValidate: false });
  }, [selectedCrop, form]);

  const selectFarmer = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set('farmer', id);
    else next.delete('farmer');
    setParams(next, { replace: true });
    setDraft(null);
  };

  const applyDraft = (value: HarvestDraft) => {
    const set = (key: keyof FormInput, input: string | null | undefined) => {
      if (input !== null && input !== undefined && input !== '') form.setValue(key, input as never, { shouldDirty: true });
    };
    set('crop_id', value.crop_id);
    set('variety', value.variety);
    set('quantity_kg', value.quantity_kg != null ? String(value.quantity_kg) : null);
    set('grade', value.grade);
    set('harvest_date', value.harvest_date);
    set('available_from', value.available_from);
    set('sell_by', value.sell_by);
    set('min_price_per_kg', value.min_price_per_kg != null ? String(value.min_price_per_kg) : null);
    set('quality_notes', value.quality_notes);
  };

  const onTranscript = (transcript: string) => {
    voice.mutate(
      { transcript, language },
      {
        onSuccess: (result) => {
          setDraft(result);
          applyDraft(result.draft);
          setMode('form');
          toast.success(t('listing.draftReady', { defaultValue: 'Draft ready — check it with the farmer' }));
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  const onSubmit = form.handleSubmit((values) => {
    if (!farmer) {
      toast.error(t('listing.pickFarmerFirst', { defaultValue: 'Choose the farmer first.' }));
      return;
    }
    const req: HarvestCreateRequest = {
      ...values,
      variety: values.variety || null,
      quality_notes: values.quality_notes || null,
      farmer_id: farmer.user.id,
      source: draft ? 'voice' : 'assisted',
      status: 'listed',
    };
    create.mutate(req, {
      onSuccess: (harvest) => {
        toast.success(
          t('listing.created', {
            defaultValue: '{{crop}} listed for {{name}}',
            crop: harvest.crop_name,
            name: farmer.user.full_name,
          }),
        );
        navigate('/app/coordinator/harvests');
      },
      onError: (error) => {
        const inline = applyFieldErrors(error, form.setError, FIELDS);
        toast.error(inline ? t('listing.fixFields', { defaultValue: 'Check the highlighted fields.' }) : errorMessage(error));
      },
    });
  });

  return (
    <div className="flex flex-col gap-8 md:gap-10">
      <Seo
        title={t('listing.seoTitle', { defaultValue: 'Assisted listing' })}
        description={t('listing.seoDescription', { defaultValue: 'List a harvest for a farmer you are helping.' })}
        path="/app/coordinator/harvests/new"
        noindex
      />
      <Reveal>
        <PageHeader
          eyebrow={t('listing.eyebrow', { defaultValue: 'Assisted listing' })}
          title={t('listing.title', { defaultValue: 'List a harvest, together' })}
          description={t('listing.description', {
            defaultValue: 'Let the farmer say it in their own words, or type it in. They keep the final say on every price.',
          })}
          breadcrumbs={[
            { label: t('harvests.title', { defaultValue: 'Harvests' }), to: '/app/coordinator/harvests' },
            { label: t('listing.crumb', { defaultValue: 'New listing' }) },
          ]}
          divider
        />
      </Reveal>

      <SectionCard
        eyebrow={t('listing.step1', { defaultValue: 'Step 1' })}
        title={t('listing.farmerTitle', { defaultValue: 'Whose harvest is it?' })}
        action={
          <LinkButton to="/app/coordinator/farmers/new" variant="ghost" size="sm" leadingIcon={<UserPlus aria-hidden="true" strokeWidth={1.25} />}>
            {t('listing.newFarmer', { defaultValue: 'New farmer' })}
          </LinkButton>
        }
      >
        <QueryState
          query={farmers}
          loading={<Skeleton className="h-12 rounded-control" />}
          empty={{
            title: t('listing.noFarmers', { defaultValue: 'No farmers yet' }),
            description: t('listing.noFarmersBody', { defaultValue: 'Register a farmer first, then list their harvest.' }),
          }}
        >
          {(list) => (
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center">
              <Field label={t('listing.farmer', { defaultValue: 'Farmer' })} required>
                <Select value={farmerId} onChange={(event) => selectFarmer(event.target.value)} placeholder={t('listing.pickFarmer', { defaultValue: 'Choose a farmer…' })}>
                  {[...list]
                    .sort((a, b) => a.user.full_name.localeCompare(b.user.full_name))
                    .map((entry) => (
                      <option key={entry.user.id} value={entry.user.id}>
                        {entry.user.full_name}
                        {entry.user.village ? ` — ${entry.user.village}` : ''}
                      </option>
                    ))}
                </Select>
              </Field>
              {farmer ? (
                <div className="flex items-center gap-3 border-y border-line py-3">
                  <Avatar name={farmer.user.full_name} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{farmer.user.full_name}</p>
                    <p className="truncate text-xs text-muted">
                      {[farmer.user.village, farmer.user.district].filter(Boolean).join(', ')} ·{' '}
                      {t('listing.activeCount', { defaultValue: '{{count}} active listings', count: farmer.active_harvests })}
                    </p>
                  </div>
                  <Badge tone="forest">{language.toUpperCase()}</Badge>
                </div>
              ) : null}
            </div>
          )}
        </QueryState>
      </SectionCard>

      {farmer ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <SectionCard
            eyebrow={t('listing.step2', { defaultValue: 'Step 2' })}
            title={t('listing.detailsTitle', { defaultValue: 'Harvest details' })}
            action={
              <SegmentedControl<Mode>
                label={t('listing.modeLabel', { defaultValue: 'How to list' })}
                size="sm"
                value={mode}
                onValueChange={setMode}
                options={[
                  { value: 'voice', label: t('listing.modeVoice', { defaultValue: 'Speak' }), icon: <Mic strokeWidth={1.25} aria-hidden="true" /> },
                  { value: 'form', label: t('listing.modeForm', { defaultValue: 'Type' }), icon: <Keyboard strokeWidth={1.25} aria-hidden="true" /> },
                ]}
              />
            }
          >
            {mode === 'voice' ? (
              <VoiceCapture
                key={farmer.user.id}
                language={language}
                onSubmit={onTranscript}
                submitting={voice.isPending}
                submitLabel={t('listing.makeDraft', { defaultValue: 'Make a draft' })}
                defaultTranscript={draft?.transcript}
              />
            ) : (
              <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label={t('listing.crop', { defaultValue: 'Crop' })} error={errors.crop_id?.message} required>
                    <Select {...form.register('crop_id')} placeholder={t('listing.pickCrop', { defaultValue: 'Choose…' })} disabled={crops.isPending}>
                      {crops.data?.map((crop) => (
                        <option key={crop.id} value={crop.id}>
                          {cropLabel(crop, language)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('listing.variety', { defaultValue: 'Variety' })} error={errors.variety?.message} optional>
                    <Input autoComplete="off" {...form.register('variety')} />
                  </Field>
                  <Field label={t('listing.quantity', { defaultValue: 'Quantity' })} error={errors.quantity_kg?.message} required>
                    <Input inputMode="decimal" autoComplete="off" trailing="kg" {...form.register('quantity_kg')} />
                  </Field>
                  <Field
                    label={t('listing.grade', { defaultValue: 'Grade (farmer’s view)' })}
                    hint={t('listing.gradeHint', { defaultValue: 'Self-reported until you inspect it.' })}
                    error={errors.grade?.message}
                  >
                    <Select {...form.register('grade')}>
                      {GRADES.map((grade) => (
                        <option key={grade} value={grade}>
                          {t(`common:enums.grade.${grade}`, { defaultValue: grade })}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('listing.harvestDate', { defaultValue: 'Harvested on' })} error={errors.harvest_date?.message} required>
                    <Input type="date" {...form.register('harvest_date')} />
                  </Field>
                  <Field label={t('listing.availableFrom', { defaultValue: 'Available from' })} error={errors.available_from?.message} required>
                    <Input type="date" {...form.register('available_from')} />
                  </Field>
                  <Field
                    label={t('listing.sellBy', { defaultValue: 'Sell by' })}
                    hint={
                      selectedCrop
                        ? t('listing.sellByHint', { defaultValue: '{{crop}} keeps about {{count}} days.', crop: selectedCrop.name, count: selectedCrop.perishability_days })
                        : undefined
                    }
                    error={errors.sell_by?.message}
                    required
                  >
                    <Input type="date" {...form.register('sell_by')} />
                  </Field>
                  <Field
                    label={t('listing.minPrice', { defaultValue: 'Lowest net price they accept' })}
                    hint={t('listing.minPriceHint', { defaultValue: 'Private. Offers below this are flagged.' })}
                    error={errors.min_price_per_kg?.message}
                    optional
                  >
                    <Input inputMode="decimal" autoComplete="off" leading="₹" trailing="/kg" {...form.register('min_price_per_kg')} />
                  </Field>
                  <Field label={t('listing.notes', { defaultValue: 'Quality notes' })} error={errors.quality_notes?.message} optional className="sm:col-span-2">
                    <Textarea rows={3} {...form.register('quality_notes')} />
                  </Field>
                </div>
                <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
                  <Button type="button" variant="ghost" onClick={() => setMode('voice')} leadingIcon={<Mic aria-hidden="true" strokeWidth={1.25} />}>
                    {t('listing.backToVoice', { defaultValue: 'Speak again' })}
                  </Button>
                  <Button type="submit" loading={create.isPending} leadingIcon={<Sprout aria-hidden="true" strokeWidth={1.25} />}>
                    {t('listing.submit', { defaultValue: 'List for {{name}}', name: farmer.user.full_name.split(/\s+/)[0] })}
                  </Button>
                </div>
              </form>
            )}
          </SectionCard>

          <aside className="flex flex-col gap-6">
            {voice.isPending ? (
              <Card variant="flat" className="flex flex-col gap-3 p-6">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-16" />
              </Card>
            ) : draft ? (
              <DraftSummary draft={draft} crop={crops.data?.find((crop) => crop.id === draft.draft.crop_id)} />
            ) : (
              <Card variant="parchment" className="flex flex-col gap-4 p-6">
                <p className="eyebrow eyebrow-rule">{t('listing.tipsEyebrow', { defaultValue: 'Say it like this' })}</p>
                <p className="font-display text-xl font-bold not-italic leading-snug text-ink">
                  {t('listing.tipsExample', { defaultValue: '“Twelve quintal tomato, A grade, picked yesterday, can sell till Friday, not below twenty-two rupees.”' })}
                </p>
                <p className="text-sm font-normal leading-relaxed text-ink-2">
                  {t('listing.tipsBody', {
                    defaultValue: 'Crop, quantity, grade, dates and the lowest price — we turn it into a draft. Anything unclear is flagged for you to confirm.',
                  })}
                </p>
              </Card>
            )}
          </aside>
        </div>
      ) : farmers.isSuccess && farmers.data.length > 0 ? (
        <EmptyState
          icon={<Sprout strokeWidth={1.25} aria-hidden="true" />}
          title={t('listing.pickFarmerTitle', { defaultValue: 'Choose the farmer to begin' })}
          description={t('listing.pickFarmerBody', { defaultValue: 'Voice listing uses their preferred language.' })}
        />
      ) : null}
    </div>
  );
}

function DraftSummary({ draft, crop }: { draft: VoiceDraft; crop: Crop | undefined }) {
  const { t } = useTranslation('coordinator');
  return (
    <Card variant="flat" as="section" aria-labelledby="draft-title" className="flex flex-col gap-5 p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">
          {t('listing.draftEyebrow', { defaultValue: 'Voice draft' })}
        </p>
        <AiSourceBadge source={draft.source} />
      </div>
      <div className="flex items-center gap-3">
        {crop || draft.draft.crop_name ? <CropGlyph code={crop?.code} name={draft.draft.crop_name} size="md" framed /> : null}
        <div>
          <h2 id="draft-title" className="font-display text-h3 font-bold text-ink">
            {draft.draft.crop_name ?? t('listing.unknownCrop', { defaultValue: 'Crop not heard' })}
          </h2>
          <p className="text-sm text-muted">
            {draft.draft.quantity_kg != null ? `${formatNumber(draft.draft.quantity_kg)} kg` : '—'}
            {draft.draft.grade ? ` · ${t(`common:enums.grade.${draft.draft.grade}`, { defaultValue: draft.draft.grade })}` : ''}
          </p>
        </div>
      </div>
      <blockquote className="border-s border-gold-700/50 ps-4 font-display text-lg font-bold not-italic leading-relaxed text-ink-2">“{draft.transcript}”</blockquote>
      <p className="text-xs text-muted">
        {t('listing.confidence', { defaultValue: 'Confidence {{value}}', value: formatPct(draft.confidence * 100) })}
      </p>
      {draft.missing_fields.length > 0 ? (
        <div className="flex flex-col gap-3 border-y border-line py-4">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-gold-700">
            <CircleHelp strokeWidth={1.25} aria-hidden="true" className="size-4" />
            {t('listing.askFarmer', { defaultValue: 'Ask the farmer' })}
          </p>
          <p className="text-sm text-ink">{draft.follow_up_question}</p>
          <div className="flex flex-wrap gap-1.5">
            {draft.missing_fields.map((field) => (
              <Badge key={field} tone="gold" size="sm">
                {t(`listing.fields.${field}`, { defaultValue: field.replace(/_/g, ' ') })}
              </Badge>
            ))}
          </div>
        </div>
      ) : (
        <Badge tone="success" className="self-start">
          {t('listing.complete', { defaultValue: 'All details captured — confirm and list' })}
        </Badge>
      )}
    </Card>
  );
}
