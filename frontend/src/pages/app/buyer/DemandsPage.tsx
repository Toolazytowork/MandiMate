import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { ClipboardList, Plus } from 'lucide-react';

import { CropGlyph, DataTable, FilterBar, GradeBadge, Money, PageHeader, Quantity, StatusBadge } from '@/components/domain';
import type { DataTableColumn } from '@/components/domain';
import { EmptyState, LinkButton, SegmentedControl } from '@/components/ui';
import { useDemands } from '@/features/buyer/sourcingHooks';
import { formatDate } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { Demand, DemandStatus } from '@/types/api';

type Filter = 'active' | 'all' | DemandStatus;

export default function DemandsPage() {
  const { t } = useTranslation('buyer');
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('active');
  const [search, setSearch] = useState('');
  const demands = useDemands({ limit: 200 });

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (demands.data ?? []).filter((demand) => {
      if (filter === 'active' && !(demand.status === 'open' || demand.status === 'matched')) return false;
      if (filter !== 'active' && filter !== 'all' && demand.status !== filter) return false;
      if (!needle) return true;
      return [demand.crop_name, demand.delivery_location, demand.delivery_district ?? ''].some((v) => v.toLowerCase().includes(needle));
    });
  }, [demands.data, filter, search]);

  const columns: DataTableColumn<Demand>[] = [
    {
      id: 'crop',
      header: t('demands.col.crop', { defaultValue: 'Crop' }),
      sortValue: (d) => d.crop_name,
      cell: (d) => (
        <div className="flex items-center gap-3">
          <CropGlyph name={d.crop_name} size="sm" />
          <div className="min-w-0">
            <p className="font-medium text-ink">{d.crop_name}</p>
            <p className="truncate text-micro text-muted">{d.delivery_location}</p>
          </div>
        </div>
      ),
    },
    {
      id: 'grade',
      header: t('demands.col.grade', { defaultValue: 'Grade' }),
      cell: (d) => <GradeBadge grade={d.grade_required} size="sm" />,
      hideBelow: 'sm',
    },
    {
      id: 'qty',
      header: t('demands.col.quantity', { defaultValue: 'Quantity' }),
      numeric: true,
      sortValue: (d) => d.quantity_kg,
      sortFirst: 'desc',
      cell: (d) => <Quantity kg={d.quantity_kg} />,
    },
    {
      id: 'price',
      header: t('demands.col.target', { defaultValue: 'Target price' }),
      numeric: true,
      hideBelow: 'md',
      sortValue: (d) => d.target_price_per_kg,
      cell: (d) => (d.target_price_per_kg === null ? <span className="text-muted">—</span> : <Money value={d.target_price_per_kg} perKg />),
    },
    {
      id: 'needed',
      header: t('demands.col.neededBy', { defaultValue: 'Needed by' }),
      sortValue: (d) => d.needed_by,
      hideBelow: 'md',
      cell: (d) => formatDate(d.needed_by),
    },
    {
      id: 'lots',
      header: t('demands.col.lots', { defaultValue: 'Lots' }),
      numeric: true,
      hideBelow: 'lg',
      cell: (d) => d.lot_ids.length,
    },
    {
      id: 'status',
      header: t('demands.col.status', { defaultValue: 'Status' }),
      cell: (d) => <StatusBadge kind="demand" value={d.status} size="sm" />,
    },
  ];

  const filters: { value: Filter; label: string }[] = [
    { value: 'active', label: t('demands.filter.active', { defaultValue: 'Active' }) },
    { value: 'fulfilled', label: t('demands.filter.fulfilled', { defaultValue: 'Fulfilled' }) },
    { value: 'all', label: t('demands.filter.all', { defaultValue: 'All' }) },
  ];

  const hasAny = (demands.data?.length ?? 0) > 0;

  return (
    <div className="space-y-8">
      <Seo
        title={t('demands.title', { defaultValue: 'Requirements' })}
        description={t('demands.description', { defaultValue: 'What you need, where and by when.' })}
        path="/app/buyer/demands"
        noindex
      />
      <PageHeader
        eyebrow={t('demands.eyebrow', { defaultValue: 'Sourcing' })}
        title={t('demands.title', { defaultValue: 'Requirements' })}
        description={t('demands.lede', {
          defaultValue: 'Post what you need. Coordinators pool nearby harvests into lots that meet your grade, quantity and date.',
        })}
        actions={
          <LinkButton to="/app/buyer/demands/new" leadingIcon={<Plus strokeWidth={1.25} className="size-4" />}>
            {t('demands.new', { defaultValue: 'Post a requirement' })}
          </LinkButton>
        }
      />

      {demands.isSuccess && !hasAny ? (
        <EmptyState
          framed
          icon={<ClipboardList strokeWidth={1.25} className="size-5" />}
          title={t('demands.emptyTitle', { defaultValue: 'No requirements yet' })}
          description={t('demands.emptyBody', {
            defaultValue: 'A requirement tells coordinators what to pool for you — crop, grade, quantity and delivery date.',
          })}
          action={
            <LinkButton to="/app/buyer/demands/new" leadingIcon={<Plus strokeWidth={1.25} className="size-4" />}>
              {t('demands.new', { defaultValue: 'Post a requirement' })}
            </LinkButton>
          }
        />
      ) : (
        <>
          <FilterBar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder={t('demands.search', { defaultValue: 'Search crop or location' })}
            resultLabel={t('demands.count', { count: rows.length, defaultValue: '{{count}} requirements' })}
          >
            <SegmentedControl
              label={t('demands.filter.label', { defaultValue: 'Status' })}
              options={filters}
              value={filter}
              onValueChange={setFilter}
              size="sm"
            />
          </FilterBar>
          {demands.isError ? (
            <EmptyState
              framed
              title={t('demands.error', { defaultValue: 'Could not load requirements' })}
              description={demands.error.message}
              action={
                <button type="button" className="inline-flex items-center gap-2 border-b border-ink/30 pb-1 text-[13px] font-semibold text-ink transition-colors hover:border-gold-700 hover:text-gold-700" onClick={() => void demands.refetch()}>
                  {t('common:actions.retry', { defaultValue: 'Try again' })}
                </button>
              }
            />
          ) : (
            <DataTable
              label={t('demands.title', { defaultValue: 'Requirements' })}
              columns={columns}
              rows={demands.data ? rows : undefined}
              loading={demands.isPending}
              getRowId={(d) => d.id}
              onRowClick={(d) => navigate(`/app/buyer/demands/${d.id}`)}
              defaultSort={{ columnId: 'needed', direction: 'asc' }}
              emptyTitle={t('demands.filteredEmpty', { defaultValue: 'Nothing matches these filters' })}
            />
          )}
        </>
      )}
    </div>
  );
}
