import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CalendarClock, Layers, Lock, MapPin, Pencil, Scale, Sprout, XCircle } from 'lucide-react';

import { Button, Card, LinkButton, Sheet, toast } from '@/components/ui';
import {
  ConfirmDialog,
  CropGlyph,
  GradeBadge,
  JourneyTimeline,
  Money,
  PageHeader,
  PhotoUploader,
  QualityBadge,
  QueryState,
  Quantity,
  SectionCard,
  SellingOptionsCompare,
  StatusBadge,
} from '@/components/domain';
import { formatDate } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { Harvest } from '@/types/api';

import { DealAdvicePanel } from '@/features/farmer/components/DealAdvicePanel';
import { HarvestForm, emptyHarvestValues, type HarvestFormValues } from '@/features/farmer/components/HarvestForm';
import { OptionActions } from '@/features/farmer/components/OptionActions';
import { PhotoNotes } from '@/features/farmer/components/PhotoNotes';
import { Fact, SectionHeading } from '@/features/farmer/components/Surfaces';
import {
  useCancelHarvest,
  useDeleteHarvestPhoto,
  useErrorToast,
  useHarvest,
  useHarvestOptions,
  useHarvestTimeline,
  useUpdateHarvest,
  useUploadHarvestPhoto,
} from '@/features/farmer/hooks';
import { CANCELLABLE_HARVEST_STATUSES, EDITABLE_HARVEST_STATUSES, committedKg } from '@/features/farmer/lib';
import { useHarvestWords } from '@/features/farmer/useHarvestWords';

function valuesFromHarvest(harvest: Harvest): HarvestFormValues {
  return {
    ...emptyHarvestValues(),
    crop_id: harvest.crop_id,
    variety: harvest.variety ?? '',
    quantity: String(harvest.quantity_kg),
    unit: 'kg',
    grade: harvest.grade,
    harvest_date: harvest.harvest_date,
    available_from: harvest.available_from,
    sell_by: harvest.sell_by,
    min_price: harvest.min_price_per_kg ? String(harvest.min_price_per_kg) : '',
    quality_notes: harvest.quality_notes ?? '',
  };
}

export default function HarvestDetailPage() {
  const { harvestId = '' } = useParams();
  const { t } = useTranslation('farmer');
  const harvest = useHarvest(harvestId);
  const words = useHarvestWords();

  return (
    <div className="flex flex-col gap-10">
      <Seo
        title={harvest.data ? words.title(harvest.data) : t('detail.seoTitle', { defaultValue: 'Harvest' })}
        description={t('detail.seoDescription', { defaultValue: 'Selling options compared by what you take home, and where this harvest is in its journey.' })}
        path={`/app/farmer/harvests/${harvestId}`}
        noindex
      />
      <QueryState query={harvest} skeleton="detail" errorTitle={t('detail.error', { defaultValue: 'This harvest could not load' })}>
        {(data) => <HarvestDetail harvest={data} />}
      </QueryState>
    </div>
  );
}

function HarvestDetail({ harvest }: { harvest: Harvest }) {
  const { t } = useTranslation('farmer');
  const words = useHarvestWords();
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const update = useUpdateHarvest(harvest.id);
  const cancel = useCancelHarvest(harvest.id);
  const upload = useUploadHarvestPhoto(harvest.id);
  const removePhoto = useDeleteHarvestPhoto(harvest.id);
  const onError = useErrorToast();
  const timeline = useHarvestTimeline(harvest.id);
  const options = useHarvestOptions(harvest.id);

  const editable = EDITABLE_HARVEST_STATUSES.includes(harvest.status);
  const cancellable = CANCELLABLE_HARVEST_STATUSES.includes(harvest.status);
  const closed = harvest.status === 'cancelled' || harvest.status === 'expired';
  const photosOpen = !closed && harvest.status !== 'settled';

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: t('harvests.title', { defaultValue: 'Your harvests' }), to: '/app/farmer/harvests' },
          { label: words.crop(harvest) },
        ]}
        eyebrow={t('detail.eyebrow', { defaultValue: 'Harvest' })}
        title={
          <span className="flex items-center gap-4">
            <CropGlyph name={harvest.crop_name} size="lg" className="hidden sm:inline-flex" />
            {words.title(harvest)}
          </span>
        }
        meta={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="harvest" value={harvest.status} />
            <GradeBadge grade={harvest.grade} size="sm" />
            <QualityBadge status={harvest.quality_status} size="sm" />
          </span>
        }
        actions={
          <>
            {cancellable ? (
              <Button variant="ghost" size="lg" leadingIcon={<XCircle strokeWidth={1.25} className="size-4" />} onClick={() => setCancelling(true)}>
                {t('detail.cancel', { defaultValue: 'Cancel listing' })}
              </Button>
            ) : null}
            {editable ? (
              <Button variant="secondary" size="lg" leadingIcon={<Pencil strokeWidth={1.25} className="size-4" />} onClick={() => setEditing(true)}>
                {t('detail.edit', { defaultValue: 'Edit' })}
              </Button>
            ) : null}
            {harvest.status === 'draft' ? (
              <Button
                size="lg"
                loading={update.isPending}
                onClick={() =>
                  update.mutate(
                    { status: 'listed' },
                    { onSuccess: () => toast.success(t('detail.listedNow', { defaultValue: 'Listed — buyers can see it now.' })), onError },
                  )
                }
              >
                {t('detail.listNow', { defaultValue: 'List it now' })}
              </Button>
            ) : null}
          </>
        }
      />

      {/* Facts */}
      <Card variant="flat" className="p-6 sm:p-10">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-7 sm:grid-cols-3 lg:grid-cols-4">
          <Fact label={t('detail.quantity', { defaultValue: 'Total' })} icon={<Scale strokeWidth={1.25} />}>
            <Quantity kg={harvest.quantity_kg} />
          </Fact>
          <Fact label={t('harvests.available', { defaultValue: 'Free to sell' })} icon={<Sprout strokeWidth={1.25} />}>
            <Quantity kg={harvest.available_kg} />
          </Fact>
          <Fact label={t('harvests.committed', { defaultValue: 'Promised' })} icon={<Layers strokeWidth={1.25} />}>
            <Quantity kg={committedKg(harvest)} />
          </Fact>
          <Fact label={t('detail.ready', { defaultValue: 'Ready from' })} icon={<CalendarClock strokeWidth={1.25} />}>
            {formatDate(harvest.available_from, { locale: words.lang })}
            <span className="block text-xs text-muted">{words.ready(harvest.available_from)}</span>
          </Fact>
          <Fact label={t('detail.sellBy', { defaultValue: 'Sell by' })} icon={<CalendarClock strokeWidth={1.25} />}>
            {formatDate(harvest.sell_by, { locale: words.lang })}
            <span className="block text-xs text-muted">{words.sellBy(harvest.sell_by)}</span>
          </Fact>
          <Fact label={t('detail.minPrice', { defaultValue: 'Your lowest price (private)' })} icon={<Lock strokeWidth={1.25} />}>
            {harvest.min_price_per_kg ? <Money value={harvest.min_price_per_kg} perKg size="md" /> : <span className="text-muted">{t('detail.notSet', { defaultValue: 'Not set' })}</span>}
          </Fact>
          {harvest.village || harvest.district ? (
            <Fact label={t('detail.place', { defaultValue: 'Pickup place' })} icon={<MapPin strokeWidth={1.25} />}>
              {[harvest.village, harvest.district].filter(Boolean).join(', ')}
            </Fact>
          ) : null}
          {harvest.variety ? <Fact label={t('form.variety', { defaultValue: 'Variety' })}>{harvest.variety}</Fact> : null}
        </dl>
        {harvest.quality_notes ? (
          <p className="mt-8 border-t border-line pt-6 text-[15px] font-normal leading-relaxed text-ink-2">
            <span className="me-3 text-[13px] font-semibold text-muted">{t('detail.notes', { defaultValue: 'Notes' })}</span>
            {harvest.quality_notes}
          </p>
        ) : null}
      </Card>

      {/* Journey */}
      <SectionCard
        eyebrow={t('detail.journeyEyebrow', { defaultValue: 'Journey' })}
        title={t('detail.journeyTitle', { defaultValue: 'Where your harvest is now' })}
      >
        <QueryState query={timeline} skeleton="list">
          {(steps) => <JourneyTimeline steps={steps} showDetails />}
        </QueryState>
      </SectionCard>

      {/* Options */}
      {!closed ? (
        <section aria-labelledby="options-heading" className="flex flex-col gap-6">
          <SectionHeading
            id="options-heading"
            eyebrow={t('home.optionsEyebrow', { defaultValue: 'Selling options' })}
            title={t('detail.optionsTitle', { defaultValue: 'What each option leaves in your hand' })}
            description={t('home.optionsBody', {
              defaultValue: 'Compared by what reaches your hand — after transport, loading, commission, rejection and the wait for payment.',
            })}
          />
          <QueryState
            query={options}
            skeleton="cards"
            isEmpty={(data) => data.options.length === 0}
            empty={{
              title: t('detail.noOptions', { defaultValue: 'No offers yet' }),
              description: t('detail.noOptionsBody', { defaultValue: 'We are looking for buyers and nearby farmers to pool with. You will get a message when an offer comes.' }),
            }}
          >
            {(data) => <SellingOptionsCompare data={data} renderActions={(option) => <OptionActions option={option} harvestId={harvest.id} />} />}
          </QueryState>
          {options.data && options.data.options.length > 0 ? <DealAdvicePanel harvestId={harvest.id} /> : null}
        </section>
      ) : null}

      {/* Lots */}
      {harvest.lot_ids.length > 0 ? (
        <SectionCard
          eyebrow={t('detail.lotsEyebrow', { defaultValue: 'Pooled' })}
          title={t('detail.lotsTitle', { defaultValue: 'Lots this harvest is part of' })}
        >
          <ul className="flex flex-col divide-y divide-line">
            {harvest.lot_ids.map((lotId, index) => (
              <li key={lotId}>
                <Link
                  to={`/app/farmer/lots/${lotId}`}
                  className="flex min-h-12 items-center justify-between gap-3 py-3 text-[13px] font-semibold text-ink transition-colors duration-300 hover:text-gold-700 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-gold-700"
                >
                  {t('detail.lotN', { defaultValue: 'Lot {{n}}', n: index + 1 })}
                  <ArrowRight strokeWidth={1.25} aria-hidden="true" className="size-4" />
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {/* Photos */}
      <SectionCard
        id="photos"
        eyebrow={t('detail.photosEyebrow', { defaultValue: 'Photos' })}
        title={t('detail.photosTitle', { defaultValue: 'What buyers see' })}
        description={t('new.photosBody', { defaultValue: 'Buyers trust what they can see. Take 2–3 photos in daylight. You can skip this and add them later.' })}
      >
        <div className="flex flex-col gap-5">
          <PhotoUploader
            photos={harvest.photos}
            maxFiles={6}
            disabled={!photosOpen}
            onUpload={async (file, onProgress) => {
              onProgress(30);
              const photo = await upload.mutateAsync(file);
              onProgress(100);
              return photo;
            }}
            onRemove={editable ? (photo) => removePhoto.mutateAsync(photo.id).catch(onError) : undefined}
          />
          <PhotoNotes photos={harvest.photos} />
        </div>
      </SectionCard>

      {closed ? (
        <div className="flex justify-center">
          <LinkButton to="/app/farmer/harvests/new" size="lg">
            {t('home.list', { defaultValue: 'List a harvest' })}
          </LinkButton>
        </div>
      ) : null}

      <Sheet
        open={editing}
        onOpenChange={setEditing}
        size="lg"
        title={t('detail.editTitle', { defaultValue: 'Edit harvest' })}
        description={t('detail.editBody', { defaultValue: 'Buyers see the change straight away.' })}
      >
        {editing ? (
          <HarvestForm
            defaultValues={valuesFromHarvest(harvest)}
            cropLocked
            submitLabel={t('detail.save', { defaultValue: 'Save changes' })}
            onSubmit={async (req) => {
              const { crop_id: _crop, ...rest } = req;
              await update.mutateAsync(rest);
              toast.success(t('detail.saved', { defaultValue: 'Changes saved.' }));
              setEditing(false);
            }}
          />
        ) : null}
      </Sheet>

      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        tone="danger"
        title={t('detail.cancelTitle', { defaultValue: 'Cancel this listing?' })}
        description={t('detail.cancelBody', {
          defaultValue: 'Buyers will no longer see it, open offers on it close, and it leaves any lot that is still forming. This cannot be undone.',
        })}
        confirmLabel={t('detail.cancelConfirm', { defaultValue: 'Yes, cancel it' })}
        cancelLabel={t('detail.keep', { defaultValue: 'Keep it' })}
        loading={cancel.isPending}
        onConfirm={() =>
          cancel.mutate(undefined, {
            onSuccess: () => {
              toast.success(t('detail.cancelled', { defaultValue: 'Listing cancelled.' }));
              setCancelling(false);
            },
            onError,
          })
        }
      />
    </>
  );
}
