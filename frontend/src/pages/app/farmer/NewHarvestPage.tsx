import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Check, ClipboardList, MessageCircleQuestion, Mic, RotateCcw } from 'lucide-react';

import { Button, Card, LinkButton, SegmentedControl, toast } from '@/components/ui';
import {
  AiSourceBadge,
  CropGlyph,
  PageHeader,
  PhotoUploader,
  VoiceCapture,
  useUiLanguage,
} from '@/components/domain';
import { cn } from '@/lib/cn';
import { formatDate, formatINR, formatKg } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { Harvest, HarvestDraft, VoiceDraft } from '@/types/api';

import {
  HarvestForm,
  emptyHarvestValues,
  formFieldFor,
  valuesFromDraft,
  type HarvestFormField,
  type HarvestFormValues,
} from '@/features/farmer/components/HarvestForm';
import { PhotoNotes } from '@/features/farmer/components/PhotoNotes';
import { HeroSurface } from '@/features/farmer/components/Surfaces';
import { useCreateHarvest, useErrorToast, useHarvest, useUploadHarvestPhoto, useVoiceListing } from '@/features/farmer/hooks';
import { useHarvestWords } from '@/features/farmer/useHarvestWords';

type Mode = 'voice' | 'form';
type Step = 'details' | 'photos' | 'done';

export default function NewHarvestPage() {
  const { t } = useTranslation('farmer');
  const [params, setParams] = useSearchParams();
  const lang = useUiLanguage();
  const mode: Mode = params.get('voice') === '1' ? 'voice' : 'form';
  const [step, setStep] = useState<Step>('details');
  const [voiceDraft, setVoiceDraft] = useState<VoiceDraft | null>(null);
  const [defaults, setDefaults] = useState<HarvestFormValues>(() => emptyHarvestValues());
  const [highlight, setHighlight] = useState<HarvestFormField[]>([]);
  const [formKey, setFormKey] = useState(0);
  const [created, setCreated] = useState<Harvest | null>(null);
  const voice = useVoiceListing();
  const create = useCreateHarvest();
  const onError = useErrorToast();

  const setMode = (next: Mode) => {
    const nextParams = new URLSearchParams(params);
    if (next === 'voice') nextParams.set('voice', '1');
    else nextParams.delete('voice');
    setParams(nextParams, { replace: true });
  };

  const applyDraft = (draft: VoiceDraft) => {
    setDefaults(valuesFromDraft(draft.draft));
    setHighlight(draft.missing_fields.map((field) => formFieldFor(field)).filter((field): field is HarvestFormField => Boolean(field)));
    setFormKey((key) => key + 1);
    setMode('form');
  };

  const restart = () => {
    setStep('details');
    setCreated(null);
    setVoiceDraft(null);
    setHighlight([]);
    setDefaults(emptyHarvestValues());
    setFormKey((key) => key + 1);
  };

  const steps: { key: Step; label: string }[] = [
    { key: 'details', label: t('new.stepDetails', { defaultValue: 'Details' }) },
    { key: 'photos', label: t('new.stepPhotos', { defaultValue: 'Photos' }) },
    { key: 'done', label: t('new.stepDone', { defaultValue: 'Listed' }) },
  ];
  const stepIndex = steps.findIndex((s) => s.key === step);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 pb-10">
      <Seo
        title={t('new.seoTitle', { defaultValue: 'List a harvest' })}
        description={t('new.seoDescription', { defaultValue: 'Speak or fill a short form to list your harvest.' })}
        path="/app/farmer/harvests/new"
        noindex
      />
      <PageHeader
        breadcrumbs={[
          { label: t('harvests.title', { defaultValue: 'Your harvests' }), to: '/app/farmer/harvests' },
          { label: t('new.crumb', { defaultValue: 'New' }) },
        ]}
        eyebrow={t('new.eyebrow', { defaultValue: 'New listing' })}
        title={t('new.title', { defaultValue: 'List a harvest' })}
        description={t('new.lede', { defaultValue: 'Say it in your own words, or fill a short form. Nothing is sold until you agree.' })}
      />

      <ol className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line pb-5" aria-label={t('new.progress', { defaultValue: 'Progress' })}>
        {steps.map((s, index) => (
          <li key={s.key} className="flex items-center gap-2.5" aria-current={index === stepIndex ? 'step' : undefined}>
            <span
              className={cn(
                'inline-flex min-w-6 items-center font-display text-lg not-italic leading-none tabular-nums',
                index < stepIndex && 'text-muted',
                index === stepIndex && 'text-gold-700',
                index > stepIndex && 'text-muted/70',
              )}
            >
              {index < stepIndex ? <Check className="size-4" strokeWidth={1.25} aria-hidden="true" /> : String(index + 1).padStart(2, '0')}
            </span>
            <span className={cn('text-[13px] font-semibold', index === stepIndex ? 'text-ink' : 'text-muted')}>{s.label}</span>
            {index < steps.length - 1 ? <span aria-hidden="true" className="mx-1 h-px w-6 bg-line sm:w-12" /> : null}
          </li>
        ))}
      </ol>

      {step === 'details' ? (
        <>
          <SegmentedControl<Mode>
            label={t('new.modeLabel', { defaultValue: 'How do you want to list?' })}
            value={mode}
            onValueChange={setMode}
            fullWidth
            options={[
              { value: 'voice', label: t('new.modeVoice', { defaultValue: 'Speak' }), icon: <Mic strokeWidth={1.25} className="size-4" /> },
              { value: 'form', label: t('new.modeForm', { defaultValue: 'Fill a form' }), icon: <ClipboardList strokeWidth={1.25} className="size-4" /> },
            ]}
          />

          {mode === 'voice' ? (
            <div className="flex flex-col gap-6">
              <Card className="p-6 sm:p-8">
                <p className="mb-5 text-[15px] font-normal leading-relaxed text-ink-2">
                  {t('new.voiceHint', {
                    defaultValue: 'Tap the mic and say what you have — for example: “400 kilo tomatoes, ready tomorrow, good quality, sell within 5 days.”',
                  })}
                </p>
                <VoiceCapture
                  key={voiceDraft?.transcript ?? 'fresh'}
                  language={lang}
                  defaultTranscript={voiceDraft?.transcript}
                  submitting={voice.isPending}
                  submitLabel={t('new.voiceSubmit', { defaultValue: 'Make my listing' })}
                  onSubmit={(transcript) =>
                    voice.mutate({ transcript, language: lang }, { onSuccess: setVoiceDraft, onError })
                  }
                />
              </Card>
              {voiceDraft ? <DraftReview draft={voiceDraft} onUse={() => applyDraft(voiceDraft)} onRetry={() => setVoiceDraft(null)} /> : null}
            </div>
          ) : (
            <Card variant="flat" className="p-6 sm:p-10">
              {highlight.length > 0 ? (
                <p className="mb-8 border-s border-gold-400 py-1 ps-4 text-sm text-ink-2" role="status">
                  {t('new.fromVoice', { defaultValue: 'We filled this in from what you said. Please check the highlighted parts.' })}
                </p>
              ) : null}
              <HarvestForm
                key={formKey}
                defaultValues={defaults}
                highlight={highlight}
                allowDraft
                submitLabel={t('new.submit', { defaultValue: 'List my harvest' })}
                onSubmit={async (req, asDraft) => {
                  const harvest = await create.mutateAsync({
                    ...req,
                    source: voiceDraft ? 'voice' : 'manual',
                    status: asDraft ? 'draft' : 'listed',
                  });
                  toast.success(
                    asDraft
                      ? t('new.savedDraft', { defaultValue: 'Saved as a draft.' })
                      : t('new.listed', { defaultValue: 'Your harvest is listed.' }),
                  );
                  setCreated(harvest);
                  setStep('photos');
                }}
              />
            </Card>
          )}
        </>
      ) : null}

      {step === 'photos' && created ? <PhotosStep harvest={created} onDone={() => setStep('done')} /> : null}
      {step === 'done' && created ? <DoneStep harvestId={created.id} fallback={created} onAnother={restart} /> : null}
    </div>
  );
}

const DRAFT_ROWS: (keyof HarvestDraft)[] = ['crop_name', 'quantity_kg', 'grade', 'available_from', 'sell_by', 'min_price_per_kg', 'quality_notes'];

function DraftReview({ draft, onUse, onRetry }: { draft: VoiceDraft; onUse: () => void; onRetry: () => void }) {
  const { t } = useTranslation('farmer');
  const lang = useUiLanguage();
  const missing = new Set<string>(draft.missing_fields);
  if (missing.has('crop_id')) missing.add('crop_name');

  const labels: Record<string, string> = {
    crop_name: t('draft.crop', { defaultValue: 'Crop' }),
    quantity_kg: t('draft.quantity', { defaultValue: 'Quantity' }),
    grade: t('draft.grade', { defaultValue: 'Grade' }),
    available_from: t('draft.ready', { defaultValue: 'Ready from' }),
    sell_by: t('draft.sellBy', { defaultValue: 'Sell by' }),
    min_price_per_kg: t('draft.minPrice', { defaultValue: 'Lowest price' }),
    quality_notes: t('draft.notes', { defaultValue: 'Notes' }),
  };

  const show = (key: keyof HarvestDraft): string | null => {
    const value = draft.draft[key];
    if (value === null || value === undefined || value === '') return null;
    if (key === 'quantity_kg') return formatKg(value as number);
    if (key === 'min_price_per_kg') return `${formatINR(value as number)}/kg`;
    if (key === 'grade') return value === 'ungraded' ? t('form.notSure', { defaultValue: 'Not sure yet' }) : t(`common:enums.grade.${String(value)}`);
    if (key === 'available_from' || key === 'sell_by') return formatDate(value as string, { locale: lang });
    return String(value);
  };

  return (
    <Card className="flex flex-col gap-6 p-6 sm:p-8" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <CropGlyph name={draft.draft.crop_name} size="md" />
          <div>
            <p className="eyebrow">{t('draft.eyebrow', { defaultValue: 'What we heard' })}</p>
            <h2 className="mt-1 font-display text-h3 font-bold text-ink">{t('draft.title', { defaultValue: 'Check your listing' })}</h2>
          </div>
        </div>
        <AiSourceBadge source={draft.source} />
      </div>

      <dl className="grid gap-x-8 border-t border-line sm:grid-cols-2">
        {DRAFT_ROWS.map((key) => {
          const value = show(key);
          const isMissing = missing.has(key) || value === null;
          return (
            <div key={key} className={cn('flex flex-col gap-1 border-b border-line py-3.5', isMissing && 'border-b-gold-400')}>
              <dt className="text-[13px] font-semibold text-muted">{labels[key]}</dt>
              <dd className={cn('text-[15px]', isMissing ? 'font-medium text-gold-700' : 'text-ink')}>
                {value ?? t('draft.missing', { defaultValue: 'Not heard — please add' })}
              </dd>
            </div>
          );
        })}
      </dl>

      {draft.follow_up_question ? (
        <p className="flex gap-3 border-s border-gold-400 py-1 ps-4 text-[15px] text-ink">
          <MessageCircleQuestion aria-hidden="true" strokeWidth={1.25} className="mt-0.5 size-5 shrink-0 text-gold-700" />
          {draft.follow_up_question}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" size="lg" leadingIcon={<RotateCcw strokeWidth={1.25} className="size-4" />} onClick={onRetry}>
          {t('draft.retry', { defaultValue: 'Say it again' })}
        </Button>
        <Button size="lg" trailingIcon={<ArrowRight strokeWidth={1.25} className="size-4" />} onClick={onUse}>
          {t('draft.use', { defaultValue: 'Looks right — continue' })}
        </Button>
      </div>
    </Card>
  );
}

function PhotosStep({ harvest, onDone }: { harvest: Harvest; onDone: () => void }) {
  const { t } = useTranslation('farmer');
  const live = useHarvest(harvest.id);
  const upload = useUploadHarvestPhoto(harvest.id);
  const photos = live.data?.photos ?? harvest.photos;

  return (
    <Card className="flex flex-col gap-6 p-6 sm:p-10">
      <div>
        <h2 className="font-display text-h2 font-bold text-ink">{t('new.photosTitle', { defaultValue: 'Add a few photos' })}</h2>
        <p className="mt-2 text-[15px] font-normal leading-relaxed text-ink-2">
          {t('new.photosBody', { defaultValue: 'Buyers trust what they can see. Take 2–3 photos in daylight. You can skip this and add them later.' })}
        </p>
      </div>
      <PhotoUploader
        photos={photos}
        maxFiles={6}
        onUpload={async (file, onProgress) => {
          onProgress(30);
          const photo = await upload.mutateAsync(file);
          onProgress(100);
          return photo;
        }}
      />
      <PhotoNotes photos={photos} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {photos.length === 0 ? (
          <Button variant="ghost" size="lg" onClick={onDone}>
            {t('new.skip', { defaultValue: 'Skip for now' })}
          </Button>
        ) : null}
        <Button size="lg" onClick={onDone} disabled={upload.isPending} trailingIcon={<ArrowRight strokeWidth={1.25} className="size-4" />}>
          {t('new.finish', { defaultValue: 'Finish' })}
        </Button>
      </div>
    </Card>
  );
}

function DoneStep({ harvestId, fallback, onAnother }: { harvestId: string; fallback: Harvest; onAnother: () => void }) {
  const { t } = useTranslation('farmer');
  const words = useHarvestWords();
  const live = useHarvest(harvestId);
  const harvest = live.data ?? fallback;
  const isDraft = harvest.status === 'draft';

  return (
    <HeroSurface className="p-6 sm:p-10 md:p-12" aria-labelledby="done-title">
      <div className="flex flex-col gap-6">
        <CropGlyph name={harvest.crop_name} size="lg" />
        <p className="eyebrow eyebrow-rule">
          {isDraft ? t('done.draftEyebrow', { defaultValue: 'Saved as draft' }) : t('done.eyebrow', { defaultValue: 'Listed' })}
        </p>
        <h2 id="done-title" className="font-display text-display-sm font-bold text-ivory">
          {isDraft
            ? t('done.draftTitle', { defaultValue: '{{harvest}} is saved', harvest: words.title(harvest) })
            : t('done.title', { defaultValue: '{{harvest}} is now on MandiMate', harvest: words.title(harvest) })}
        </h2>
        <p className="max-w-xl text-[15px] font-normal leading-relaxed text-ivory/75">
          {isDraft
            ? t('done.draftBody', { defaultValue: 'Buyers cannot see a draft. Open it and list it when you are ready.' })
            : t('done.body', { defaultValue: 'We are matching it with buyers and nearby farmers now. Every offer will show what you take home, compared with selling alone at the mandi.' })}
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          <LinkButton to={`/app/farmer/harvests/${harvest.id}`} variant="inverse" size="lg" trailingIcon={<ArrowRight strokeWidth={1.25} className="size-4" />}>
            {t('done.open', { defaultValue: 'See selling options' })}
          </LinkButton>
          <Button variant="glass" size="lg" onClick={onAnother}>
            {t('done.another', { defaultValue: 'List another harvest' })}
          </Button>
          <LinkButton to="/app/farmer" variant="ghost" size="lg" className="text-ivory">
            {t('done.home', { defaultValue: 'Back to home' })}
          </LinkButton>
        </div>
      </div>
    </HeroSurface>
  );
}
