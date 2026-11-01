import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid, Rows3, Sprout } from 'lucide-react';

import {
  CropGlyph,
  DataTable,
  FilterBar,
  GradeBadge,
  PageHeader,
  QualityBadge,
  Quantity,
  QueryState,
  StatusBadge,
  SupplyCard,
} from '@/components/domain';
import type { DataTableColumn } from '@/components/domain';
import { Input, LinkButton, SegmentedControl, Select } from '@/components/ui';
import { GRADES, offerPath } from '@/features/buyer/sourcing';
import { useCrops, useSupply } from '@/features/buyer/sourcingHooks';
import { useDebounce, useLocalStorage } from '@/lib/hooks';
import { formatDate, formatNumber } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { Grade, SupplyItem } from '@/types/api';

type View = 'cards' | 'table';

export default function SupplyPage() {
  const { t } = useTranslation('buyer');
  const crops = useCrops();
  const [cropId, setCropId] = useState('');
  const [grade, setGrade] = useState<Grade | ''>('');
  const [district, setDistrict] = useState('');
  const [view, setView] = useLocalStorage<View>('mandimate.buyer.supplyView', 'cards');
  const debouncedDistrict = useDebounce(district.trim(), 350);

  const params = { crop_id: cropId || null, grade: grade || null, district: debouncedDistrict || null, limit: 100 };
  const supply = useSupply(params);
  const activeCount = [cropId, grade, debouncedDistrict].filter(Boolean).length;

  const action = (item: SupplyItem) =>
    item.my_offer_status ? (
      <StatusBadge kind="offer" value={item.my_offer_status} size="sm" />
    ) : (
      <LinkButton size="sm" variant="secondary" to={offerPath(item)}>
        {t('supply.makeOffer', { defaultValue: 'Make offer' })}
      </LinkButton>
    );

  const columns = useMemo<DataTableColumn<SupplyItem>[]>(
    () => [
      {
        id: 'crop',
        header: t('supply.col.supply', { defaultValue: 'Supply' }),
        sortValue: (i) => i.crop_name,
        cell: (i) => (
          <div className="flex items-center gap-3">
            <CropGlyph name={i.crop_name} lotCode={i.code} size="sm" />
            <div className="min-w-0">
              <p className="font-medium text-ink">
                {i.crop_name}
                {i.code && <span className="ms-2 font-mono text-micro text-muted">{i.code}</span>}
              </p>
              <p className="mt-1 text-[13px] font-semibold text-muted">
                {i.kind === 'lot'
                  ? t('supply.pooled', { count: i.member_count, defaultValue: 'Pooled · {{count}} farmers' })
                  : t('supply.single', { defaultValue: 'Single harvest' })}
              </p>
            </div>
          </div>
        ),
      },
      { id: 'grade', header: t('supply.col.grade', { defaultValue: 'Grade' }), cell: (i) => <GradeBadge grade={i.grade} size="sm" /> },
      {
        id: 'quality',
        header: t('supply.col.quality', { defaultValue: 'Quality' }),
        hideBelow: 'md',
        cell: (i) => <QualityBadge status={i.quality_status} />,
      },
      {
        id: 'qty',
        header: t('supply.col.quantity', { defaultValue: 'Quantity' }),
        numeric: true,
        sortValue: (i) => i.quantity_kg,
        sortFirst: 'desc',
        cell: (i) => <Quantity kg={i.quantity_kg} />,
      },
      {
        id: 'where',
        header: t('supply.col.where', { defaultValue: 'Origin' }),
        hideBelow: 'lg',
        sortValue: (i) => i.distance_km,
        cell: (i) => (
          <span>
            {[i.village, i.district].filter(Boolean).join(', ') || '—'}
            {i.distance_km !== null && (
              <span className="block text-micro text-muted">{t('supply.km', { km: formatNumber(i.distance_km), defaultValue: '{{km}} km away' })}</span>
            )}
          </span>
        ),
      },
      {
        id: 'from',
        header: t('supply.col.available', { defaultValue: 'Available' }),
        hideBelow: 'lg',
        sortValue: (i) => i.available_from,
        cell: (i) => (
          <span>
            {formatDate(i.available_from)}
            <span className="block text-micro text-muted">
              {t('supply.sellBy', { date: formatDate(i.sell_by), defaultValue: 'Sell by {{date}}' })}
            </span>
          </span>
        ),
      },
      { id: 'action', header: <span className="sr-only">{t('supply.col.action', { defaultValue: 'Action' })}</span>, align: 'right', cell: action },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );

  return (
    <div className="space-y-8">
      <Seo
        title={t('supply.title', { defaultValue: 'Available supply' })}
        description={t('supply.description', { defaultValue: 'Pooled lots and harvests open for offers.' })}
        path="/app/buyer/supply"
        noindex
      />
      <PageHeader
        eyebrow={t('demands.eyebrow', { defaultValue: 'Sourcing' })}
        title={t('supply.title', { defaultValue: 'Available supply' })}
        description={t('supply.lede', {
          defaultValue: 'Pooled lots from farmer groups and single harvests, open for offers. Inspected grades are checked by a coordinator.',
        })}
        actions={
          <SegmentedControl
            label={t('supply.view', { defaultValue: 'View' })}
            value={view}
            onValueChange={setView}
            size="sm"
            options={[
              { value: 'cards', label: t('supply.cards', { defaultValue: 'Cards' }), icon: <LayoutGrid strokeWidth={1.25} className="size-4" /> },
              { value: 'table', label: t('supply.table', { defaultValue: 'Table' }), icon: <Rows3 strokeWidth={1.25} className="size-4" /> },
            ]}
          />
        }
      />

      <FilterBar
        activeCount={activeCount}
        onClear={() => {
          setCropId('');
          setGrade('');
          setDistrict('');
        }}
        resultLabel={
          supply.data ? (
            <span className="text-[13px] font-semibold text-muted tabular-nums">{t('supply.count', { count: supply.data.length, defaultValue: '{{count}} open' })}</span>
          ) : undefined
        }
      >
        <Select
          aria-label={t('form.crop', { defaultValue: 'Crop' })}
          value={cropId}
          onChange={(e) => setCropId(e.target.value)}
          size="sm"
          wrapperClassName="min-w-40"
        >
          <option value="">{t('supply.allCrops', { defaultValue: 'All crops' })}</option>
          {crops.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('supply.col.grade', { defaultValue: 'Grade' })}
          value={grade}
          onChange={(e) => setGrade(e.target.value as Grade | '')}
          size="sm"
          wrapperClassName="min-w-32"
        >
          <option value="">{t('supply.allGrades', { defaultValue: 'All grades' })}</option>
          {GRADES.map((g) => (
            <option key={g} value={g}>
              {t(`common:enums.grade.${g}`, { defaultValue: g })}
            </option>
          ))}
        </Select>
        <Input
          aria-label={t('form.district', { defaultValue: 'District' })}
          placeholder={t('supply.district', { defaultValue: 'District' })}
          value={district}
          onChange={(e) => setDistrict(e.target.value)}
          wrapperClassName="w-40 [&_input]:h-10"
        />
      </FilterBar>

      {view === 'table' ? (
        supply.isError ? (
          <QueryState query={supply}>{() => null}</QueryState>
        ) : (
          <DataTable
            label={t('supply.title', { defaultValue: 'Available supply' })}
            columns={columns}
            rows={supply.data}
            loading={supply.isPending}
            getRowId={(i) => `${i.kind}-${i.id}`}
            defaultSort={{ columnId: 'qty', direction: 'desc' }}
            emptyTitle={t('supply.emptyTitle', { defaultValue: 'No open supply matches' })}
            emptyDescription={t('supply.emptyBody', { defaultValue: 'Try another crop or district, or post a requirement so coordinators pool towards it.' })}
          />
        )
      ) : (
        <QueryState
          query={supply}
          skeleton="cards"
          empty={{
            icon: <Sprout strokeWidth={1.25} className="size-5" />,
            title: t('supply.emptyTitle', { defaultValue: 'No open supply matches' }),
            description: t('supply.emptyBody', {
              defaultValue: 'Try another crop or district, or post a requirement so coordinators pool towards it.',
            }),
            action: (
              <LinkButton to="/app/buyer/demands/new" variant="secondary">
                {t('home.newDemand', { defaultValue: 'Post a requirement' })}
              </LinkButton>
            ),
          }}
        >
          {(items) => (
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => (
                <SupplyCard key={`${item.kind}-${item.id}`} item={item} actions={action(item)} />
              ))}
            </div>
          )}
        </QueryState>
      )}
    </div>
  );
}
