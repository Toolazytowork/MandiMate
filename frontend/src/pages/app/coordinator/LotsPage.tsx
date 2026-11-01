import { Boxes, LayoutGrid, Plus, Rows3 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import {
  DataTable,
  FilterBar,
  GradeBadge,
  JourneyMeter,
  LotCard,
  Money,
  PageHeader,
  Quantity,
  QueryState,
  StatusBadge,
  type DataTableColumn,
} from '@/components/domain';
import { LinkButton, SegmentedControl, Select } from '@/components/ui';
import { StaggerGroup, StaggerItem } from '@/components/motion';
import { LOT_STATUSES } from '@/features/coordinator/constants';
import { useCrops, useLots } from '@/features/coordinator/hooks';
import { matchesSearch } from '@/features/coordinator/utils';
import { formatDate } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { Lot, LotStatus } from '@/types/api';

type View = 'grid' | 'table';
const VIEW_KEY = 'mandimate.coordinatorLots.view';

function readView(): View {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'grid';
  } catch {
    return 'grid';
  }
}

export default function LotsPage() {
  const { t } = useTranslation('coordinatorLots');
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') as LotStatus | null) || null;
  const cropId = params.get('crop') || null;
  const [search, setSearch] = useState('');
  const [view, setViewState] = useState<View>(readView);
  const crops = useCrops();
  const lots = useLots({ status, crop_id: cropId, limit: 200 });

  const setView = (next: View) => {
    setViewState(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* private mode */
    }
  };

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const filtered = useMemo(
    () => (lots.data ?? []).filter((lot) => matchesSearch(search, lot.code, lot.crop_name, lot.buyer_name, lot.collection_point_name)),
    [lots.data, search],
  );

  const columns: DataTableColumn<Lot>[] = [
    {
      id: 'code',
      header: t('list.lot', { defaultValue: 'Lot' }),
      cell: (lot) => (
        <Link to={`/app/coordinator/lots/${lot.id}`} className="link-luxe font-medium text-ink">
          {lot.code}
        </Link>
      ),
      sortValue: (lot) => lot.code,
    },
    {
      id: 'crop',
      header: t('list.crop', { defaultValue: 'Crop' }),
      cell: (lot) => (
        <span className="inline-flex items-center gap-2">
          {lot.crop_name} <GradeBadge grade={lot.grade} size="sm" />
        </span>
      ),
      sortValue: (lot) => lot.crop_name,
    },
    {
      id: 'qty',
      header: t('list.quantity', { defaultValue: 'Pooled' }),
      numeric: true,
      cell: (lot) => <Quantity kg={lot.total_quantity_kg} size="sm" />,
      sortValue: (lot) => lot.total_quantity_kg,
    },
    { id: 'members', header: t('list.farmers', { defaultValue: 'Farmers' }), numeric: true, hideBelow: 'md', cell: (lot) => lot.member_count, sortValue: (lot) => lot.member_count },
    {
      id: 'buyer',
      header: t('list.buyer', { defaultValue: 'Buyer · price' }),
      hideBelow: 'lg',
      cell: (lot) =>
        lot.buyer_name ? (
          <span>
            {lot.buyer_name} · <Money value={lot.price_per_kg} perKg size="sm" />
          </span>
        ) : (
          <span className="text-muted">{t('list.offersCount', { defaultValue: '{{count}} offers', count: lot.offers_count })}</span>
        ),
    },
    { id: 'pickup', header: t('list.pickup', { defaultValue: 'Pickup' }), hideBelow: 'md', cell: (lot) => formatDate(lot.pickup_date), sortValue: (lot) => lot.pickup_date },
    { id: 'journey', header: t('list.journey', { defaultValue: 'Journey' }), hideBelow: 'lg', cell: (lot) => <JourneyMeter step={lot.journey_step} complete={lot.status === 'settled'} /> },
    { id: 'status', header: t('list.status', { defaultValue: 'Status' }), cell: (lot) => <StatusBadge kind="lot" value={lot.status} size="sm" />, sortValue: (lot) => lot.status },
  ];

  const activeCount = (status ? 1 : 0) + (cropId ? 1 : 0) + (search ? 1 : 0);

  return (
    <div className="space-y-8">
      <Seo
        title={t('list.seoTitle', { defaultValue: 'Lots' })}
        description={t('list.seoDescription', { defaultValue: 'Every pooled lot, from forming to settled.' })}
        path="/app/coordinator/lots"
        noindex
      />
      <PageHeader
        eyebrow={t('list.eyebrow', { defaultValue: 'Pooled lots' })}
        title={t('list.title', { defaultValue: 'Lots' })}
        description={t('list.description', { defaultValue: 'Each lot gathers small harvests into one buyer-ready consignment. Track consent, offers and delivery from here.' })}
        actions={
          <LinkButton to="/app/coordinator/lot-builder" leadingIcon={<Plus strokeWidth={1.25} aria-hidden="true" />}>
            {t('list.build', { defaultValue: 'Build a lot' })}
          </LinkButton>
        }
      />

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchLabel={t('list.search', { defaultValue: 'Search lots' })}
        searchPlaceholder={t('list.searchPlaceholder', { defaultValue: 'Code, crop, buyer or collection point' })}
        activeCount={activeCount}
        onClear={() => {
          setSearch('');
          setParams(new URLSearchParams(), { replace: true });
        }}
        resultLabel={lots.data ? t('list.results', { defaultValue: '{{count}} lots', count: filtered.length }) : null}
      >
        <Select aria-label={t('list.statusFilter', { defaultValue: 'Status' })} value={status ?? ''} onChange={(event) => setParam('status', event.target.value)}>
          <option value="">{t('list.allStatuses', { defaultValue: 'All statuses' })}</option>
          {LOT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`common:enums.lotStatus.${value}`, { defaultValue: value.replace(/_/g, ' ') })}
            </option>
          ))}
        </Select>
        <Select aria-label={t('list.cropFilter', { defaultValue: 'Crop' })} value={cropId ?? ''} onChange={(event) => setParam('crop', event.target.value)}>
          <option value="">{t('list.allCrops', { defaultValue: 'All crops' })}</option>
          {crops.data?.map((crop) => (
            <option key={crop.id} value={crop.id}>
              {crop.name}
            </option>
          ))}
        </Select>
        <SegmentedControl<View>
          label={t('list.view', { defaultValue: 'View' })}
          value={view}
          onValueChange={setView}
          options={[
            { value: 'grid', label: t('list.grid', { defaultValue: 'Cards' }), icon: <LayoutGrid strokeWidth={1.25} aria-hidden="true" /> },
            { value: 'table', label: t('list.table', { defaultValue: 'Table' }), icon: <Rows3 strokeWidth={1.25} aria-hidden="true" /> },
          ]}
        />
      </FilterBar>

      <QueryState
        query={lots}
        skeleton={view === 'grid' ? 'cards' : 'table'}
        isEmpty={(data) => data.length === 0}
        empty={{
          icon: <Boxes strokeWidth={1.25} aria-hidden="true" />,
          title: activeCount ? t('list.emptyFiltered', { defaultValue: 'No lots match these filters' }) : t('list.empty', { defaultValue: 'No lots yet' }),
          description: t('list.emptyBody', { defaultValue: 'Pool listed harvests in the lot builder to create the first one.' }),
          action: (
            <LinkButton to="/app/coordinator/lot-builder" variant="secondary">
              {t('list.build', { defaultValue: 'Build a lot' })}
            </LinkButton>
          ),
        }}
      >
        {() =>
          view === 'grid' ? (
            filtered.length === 0 ? (
              <p className="text-body text-muted">{t('list.noSearch', { defaultValue: 'Nothing matches “{{q}}”.', q: search })}</p>
            ) : (
              <StaggerGroup className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
                {filtered.map((lot) => (
                  <StaggerItem key={lot.id}>
                    <LotCard lot={lot} to={`/app/coordinator/lots/${lot.id}`} showJourney />
                  </StaggerItem>
                ))}
              </StaggerGroup>
            )
          ) : (
            <DataTable
              label={t('list.tableLabel', { defaultValue: 'Lots' })}
              columns={columns}
              rows={filtered}
              getRowId={(lot) => lot.id}
              defaultSort={{ columnId: 'pickup', direction: 'desc' }}
              emptyTitle={t('list.noSearch', { defaultValue: 'Nothing matches “{{q}}”.', q: search })}
            />
          )
        }
      </QueryState>
    </div>
  );
}
