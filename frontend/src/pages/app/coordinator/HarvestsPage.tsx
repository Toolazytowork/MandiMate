import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, ClipboardCheck, MapPin, Mic, ShieldCheck } from 'lucide-react';
import { Badge, Button, Card, Dialog, EmptyState, Field, LinkButton, SegmentedControl, Select, Skeleton, Textarea, toast } from '@/components/ui';
import {
  CropGlyph,
  DataTable,
  FilterBar,
  GradeBadge,
  Money,
  PageHeader,
  QualityBadge,
  Quantity,
  QueryState,
  SectionCard,
  StatusBadge,
  type DataTableColumn,
} from '@/components/domain';
import { Reveal, StaggerGroup, StaggerItem } from '@/components/motion';
import { useDeleteHarvestPhoto, useHarvestList, useUploadHarvestPhoto, useVerifyHarvest } from '@/features/coordinator/hooks';
import { daysFromToday, errorMessage, matchesSearch, needsVerification } from '@/features/coordinator/utils';
import { PhotoUploader } from '@/components/domain';
import { useDebounce } from '@/lib/hooks';
import { formatDate, formatRelative } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { Grade, Harvest, HarvestStatus, UUID } from '@/types/api';

const GRADES: readonly Grade[] = ['A', 'B', 'C', 'ungraded'];
const STATUS_FILTERS: readonly (HarvestStatus | 'all')[] = ['all', 'draft', 'listed', 'pooled', 'committed', 'picked_up', 'delivered', 'settled', 'cancelled', 'expired'];

export default function HarvestsPage() {
  const { t } = useTranslation('coordinator');
  const harvests = useHarvestList({ limit: 500 });
  const [verifyId, setVerifyId] = useState<UUID | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<HarvestStatus | 'all'>('all');
  const query = useDebounce(search, 150);

  const all = harvests.data;
  const queue = useMemo(
    () =>
      (all ?? [])
        .filter(needsVerification)
        .sort((a, b) => a.sell_by.localeCompare(b.sell_by)),
    [all],
  );
  const filtered = useMemo(
    () =>
      all?.filter(
        (harvest) =>
          (status === 'all' || harvest.status === status) &&
          matchesSearch(query, harvest.farmer_name, harvest.crop_name, harvest.variety, harvest.village),
      ),
    [all, status, query],
  );
  const selected = verifyId ? all?.find((harvest) => harvest.id === verifyId) ?? null : null;

  const columns: DataTableColumn<Harvest>[] = [
    {
      id: 'crop',
      header: t('harvests.col.crop', { defaultValue: 'Crop' }),
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-3">
          <CropGlyph name={row.crop_name} size="sm" framed />
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{row.crop_name}</p>
            <p className="truncate text-xs text-muted">{row.variety ?? '—'}</p>
          </div>
        </div>
      ),
      sortValue: (row) => row.crop_name,
    },
    {
      id: 'farmer',
      header: t('harvests.col.farmer', { defaultValue: 'Farmer' }),
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-ink">{row.farmer_name}</p>
          <p className="truncate text-xs text-muted">{row.village ?? '—'}</p>
        </div>
      ),
      sortValue: (row) => row.farmer_name,
    },
    {
      id: 'qty',
      header: t('harvests.col.available', { defaultValue: 'Available' }),
      numeric: true,
      cell: (row) => (
        <div className="flex flex-col items-end">
          <Quantity kg={row.available_kg} />
          {row.available_kg !== row.quantity_kg ? (
            <span className="text-xs text-muted">
              {t('harvests.ofTotal', { defaultValue: 'of' })} <Quantity kg={row.quantity_kg} />
            </span>
          ) : null}
        </div>
      ),
      sortValue: (row) => row.available_kg,
      sortFirst: 'desc',
    },
    {
      id: 'quality',
      header: t('harvests.col.quality', { defaultValue: 'Quality' }),
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <GradeBadge grade={row.grade} size="sm" />
          <QualityBadge status={row.quality_status} />
        </div>
      ),
      sortValue: (row) => row.grade,
      hideBelow: 'md',
    },
    {
      id: 'floor',
      header: t('harvests.col.floor', { defaultValue: 'Min price' }),
      numeric: true,
      cell: (row) => (row.min_price_per_kg != null ? <Money value={row.min_price_per_kg} perKg /> : <span className="text-muted">—</span>),
      sortValue: (row) => row.min_price_per_kg,
      hideBelow: 'lg',
    },
    {
      id: 'sellBy',
      header: t('harvests.col.sellBy', { defaultValue: 'Sell by' }),
      cell: (row) => <SellBy date={row.sell_by} />,
      sortValue: (row) => row.sell_by,
      hideBelow: 'sm',
    },
    {
      id: 'status',
      header: t('harvests.col.status', { defaultValue: 'Status' }),
      cell: (row) => <StatusBadge kind="harvest" value={row.status} />,
      sortValue: (row) => row.status,
    },
    {
      id: 'actions',
      header: <span className="sr-only">{t('harvests.col.actions', { defaultValue: 'Actions' })}</span>,
      align: 'right',
      cell: (row) =>
        needsVerification(row) ? (
          <Button size="sm" variant="secondary" onClick={() => setVerifyId(row.id)}>
            {t('harvests.verify', { defaultValue: 'Verify' })}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-8 md:gap-10">
      <Seo
        title={t('harvests.seoTitle', { defaultValue: 'Harvests' })}
        description={t('harvests.seoDescription', { defaultValue: 'Verify quality and track every harvest in your FPO.' })}
        path="/app/coordinator/harvests"
        noindex
      />
      <Reveal>
        <PageHeader
          eyebrow={t('harvests.eyebrow', { defaultValue: 'Supply' })}
          title={t('harvests.title', { defaultValue: 'Harvests' })}
          description={t('harvests.description', {
            defaultValue: 'Inspect what farmers have reported before it is pooled, so buyers get exactly the grade they pay for.',
          })}
          actions={
            <LinkButton to="/app/coordinator/harvests/new" leadingIcon={<Mic aria-hidden="true" strokeWidth={1.25} />}>
              {t('harvests.assisted', { defaultValue: 'Assisted listing' })}
            </LinkButton>
          }
        />
      </Reveal>

      <SectionCard
        eyebrow={t('harvests.queueEyebrow', { defaultValue: 'Verification queue' })}
        title={t('harvests.queueTitle', { defaultValue: 'Waiting for your eye' })}
        description={t('harvests.queueDescription', { defaultValue: 'Self-reported and pending inspection, soonest sell-by first.' })}
        action={queue.length > 0 ? <Badge tone="gold">{queue.length}</Badge> : null}
      >
        {harvests.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-44 rounded-card" />
            ))}
          </div>
        ) : harvests.isError ? (
          <QueryState query={harvests}>{() => null}</QueryState>
        ) : queue.length === 0 ? (
          <EmptyState
            framed={false}
            size="sm"
            icon={<ShieldCheck strokeWidth={1.25} aria-hidden="true" />}
            title={t('harvests.queueEmptyTitle', { defaultValue: 'Every listing is inspected' })}
            description={t('harvests.queueEmptyBody', { defaultValue: 'New self-reported harvests will queue here.' })}
          />
        ) : (
          <StaggerGroup className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {queue.map((harvest) => (
              <StaggerItem key={harvest.id}>
                <QueueCard harvest={harvest} onVerify={() => setVerifyId(harvest.id)} />
              </StaggerItem>
            ))}
          </StaggerGroup>
        )}
      </SectionCard>

      <section aria-labelledby="all-harvests" className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <p className="eyebrow eyebrow-rule">{t('harvests.allEyebrow', { defaultValue: 'Ledger' })}</p>
          <h2 id="all-harvests" className="font-display text-h2 font-bold text-ink">
            {t('harvests.allTitle', { defaultValue: 'All harvests' })}
          </h2>
        </div>
        <FilterBar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={t('harvests.search', { defaultValue: 'Farmer, crop, variety or village' })}
          activeCount={status === 'all' ? 0 : 1}
          onClear={() => {
            setStatus('all');
            setSearch('');
          }}
          resultLabel={filtered ? t('harvests.count', { defaultValue: '{{count}} harvests', count: filtered.length }) : null}
        >
          <Select
            aria-label={t('harvests.statusFilter', { defaultValue: 'Status' })}
            value={status}
            onChange={(event) => setStatus(event.target.value as HarvestStatus | 'all')}
            size="sm"
            wrapperClassName="sm:w-48"
          >
            {STATUS_FILTERS.map((value) => (
              <option key={value} value={value}>
                {value === 'all' ? t('harvests.allStatuses', { defaultValue: 'All statuses' }) : t(`common:enums.harvestStatus.${value}`, { defaultValue: value })}
              </option>
            ))}
          </Select>
        </FilterBar>
        {harvests.isError ? (
          <QueryState query={harvests}>{() => null}</QueryState>
        ) : (
          <DataTable
            label={t('harvests.tableLabel', { defaultValue: 'All harvests' })}
            columns={columns}
            rows={filtered}
            getRowId={(row) => row.id}
            loading={harvests.isPending}
            defaultSort={{ columnId: 'sellBy', direction: 'asc' }}
            emptyTitle={t('harvests.emptyTitle', { defaultValue: 'No harvests match' })}
            emptyDescription={t('harvests.emptyBody', { defaultValue: 'Try another search, or list a harvest for a farmer.' })}
            framed
          />
        )}
      </section>

      {selected ? <VerifyDialog key={selected.id} harvest={selected} onClose={() => setVerifyId(null)} /> : null}
    </div>
  );
}

function SellBy({ date }: { date: string }) {
  const { t } = useTranslation('coordinator');
  const days = daysFromToday(date);
  const tone = days < 0 ? 'text-danger-ink' : days <= 3 ? 'text-warning-ink' : 'text-muted';
  return (
    <div className="flex flex-col">
      <span className="tabular-nums text-ink">{formatDate(date)}</span>
      <span className={`text-xs ${tone}`}>
        {days < 0
          ? t('harvests.overdue', { defaultValue: 'Passed' })
          : days === 0
            ? t('harvests.today', { defaultValue: 'Today' })
            : t('harvests.inDays', { defaultValue: 'in {{count}} d', count: days })}
      </span>
    </div>
  );
}

function QueueCard({ harvest, onVerify }: { harvest: Harvest; onVerify: () => void }) {
  const { t } = useTranslation('coordinator');
  const cover = harvest.photos[0];
  return (
    <Card variant="flat" as="article" className="flex h-full flex-col overflow-hidden">
      <div className="relative h-28 bg-parchment">
        {cover ? (
          <img src={cover.url} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center text-ink/30">
            <CropGlyph name={harvest.crop_name} size="lg" />
          </div>
        )}
        <div className="absolute start-3 top-3 flex gap-1.5">
          <QualityBadge status={harvest.quality_status} />
        </div>
        {harvest.photos.length > 0 ? (
          <span className="absolute bottom-2 end-3 inline-flex items-center gap-1 rounded-sm bg-ink/70 px-2 py-0.5 text-[11px] tabular-nums text-ivory">
            <Camera strokeWidth={1.25} aria-hidden="true" className="size-3" /> {harvest.photos.length}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-display text-xl font-bold text-ink">
              {harvest.crop_name}
              {harvest.variety ? <span className="text-muted"> · {harvest.variety}</span> : null}
            </h3>
            <p className="truncate text-sm text-muted">{harvest.farmer_name}</p>
          </div>
          <GradeBadge grade={harvest.grade} size="sm" />
        </div>
        <dl className="grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm">
          <div>
            <dt className="text-[13px] font-semibold text-muted">{t('harvests.available', { defaultValue: 'Available' })}</dt>
            <dd>
              <Quantity kg={harvest.available_kg} />
            </dd>
          </div>
          <div>
            <dt className="text-[13px] font-semibold text-muted">{t('harvests.sellBy', { defaultValue: 'Sell by' })}</dt>
            <dd>
              <SellBy date={harvest.sell_by} />
            </dd>
          </div>
        </dl>
        {harvest.village ? (
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <MapPin strokeWidth={1.25} aria-hidden="true" className="size-3.5" /> {harvest.village}
            <span aria-hidden="true">·</span> {formatRelative(harvest.created_at)}
          </p>
        ) : null}
        <Button size="sm" className="mt-auto" onClick={onVerify} leadingIcon={<ClipboardCheck aria-hidden="true" strokeWidth={1.25} />}>
          {t('harvests.inspect', { defaultValue: 'Inspect & grade' })}
        </Button>
      </div>
    </Card>
  );
}

function VerifyDialog({ harvest, onClose }: { harvest: Harvest; onClose: () => void }) {
  const { t } = useTranslation('coordinator');
  const verify = useVerifyHarvest();
  const upload = useUploadHarvestPhoto();
  const remove = useDeleteHarvestPhoto();
  const [grade, setGrade] = useState<Grade>(harvest.grade === 'ungraded' ? 'B' : harvest.grade);
  const [notes, setNotes] = useState(harvest.quality_notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    verify.mutate(
      { id: harvest.id, req: { grade, quality_notes: notes.trim() || null } },
      {
        onSuccess: () => {
          toast.success(t('harvests.verified', { defaultValue: '{{crop}} from {{farmer}} is graded {{grade}}', crop: harvest.crop_name, farmer: harvest.farmer_name, grade }));
          onClose();
        },
        onError: (err) => {
          const message = errorMessage(err);
          setError(message);
          toast.error(message);
        },
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? null : onClose())}
      size="lg"
      title={t('harvests.dialogTitle', { defaultValue: 'Inspect {{crop}}', crop: harvest.crop_name })}
      description={t('harvests.dialogDescription', {
        defaultValue: '{{farmer}} · {{village}} — farmer reported grade {{grade}}.',
        farmer: harvest.farmer_name,
        village: harvest.village ?? '—',
        grade: harvest.grade,
      })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('harvests.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button onClick={submit} loading={verify.isPending} leadingIcon={<ShieldCheck aria-hidden="true" strokeWidth={1.25} />}>
            {t('harvests.confirmGrade', { defaultValue: 'Record grade {{grade}}', grade })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-3 gap-3 border-y border-line py-4 text-sm">
          <div>
            <p className="text-[13px] font-semibold text-muted">{t('harvests.quantity', { defaultValue: 'Quantity' })}</p>
            <Quantity kg={harvest.quantity_kg} />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-muted">{t('harvests.harvested', { defaultValue: 'Harvested' })}</p>
            <p className="tabular-nums text-ink">{formatDate(harvest.harvest_date)}</p>
          </div>
          <div>
            <p className="text-[13px] font-semibold text-muted">{t('harvests.sellBy', { defaultValue: 'Sell by' })}</p>
            <p className="tabular-nums text-ink">{formatDate(harvest.sell_by)}</p>
          </div>
        </div>

        <Field label={t('harvests.gradeLabel', { defaultValue: 'Inspected grade' })} hint={t('harvests.gradeHint', { defaultValue: 'Buyers pay against this grade; rejection risk is priced from it.' })} required>
          <SegmentedControl
            label={t('harvests.gradeLabel', { defaultValue: 'Inspected grade' })}
            options={GRADES.map((value) => ({ value, label: t(`common:enums.grade.${value}`, { defaultValue: value }) }))}
            value={grade}
            onValueChange={setGrade}
            fullWidth
          />
        </Field>

        <Field label={t('harvests.notesLabel', { defaultValue: 'Inspection notes' })} optional hint={t('harvests.notesHint', { defaultValue: 'Size, colour, firmness, damage — what a buyer would ask.' })}>
          <Textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>

        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-semibold text-ink">{t('harvests.photos', { defaultValue: 'Photos & preliminary analysis' })}</p>
          <PhotoUploader
            photos={harvest.photos}
            onUpload={(file) => upload.mutateAsync({ id: harvest.id, file })}
            onRemove={(photo) => remove.mutateAsync({ id: harvest.id, photoId: photo.id })}
          />
        </div>

        {error ? (
          <p role="alert" className="rounded-sm border border-danger/30 px-3 py-2 text-sm text-danger-ink">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
