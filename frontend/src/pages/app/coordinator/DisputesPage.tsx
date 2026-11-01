import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DataTable, FilterBar, KpiStrip, PageHeader, QueryState, StatusBadge, type DataTableColumn } from '@/components/domain';
import { Badge, SegmentedControl, Select } from '@/components/ui';
import { DisputeSheet } from '@/features/coordinator-ops/components/DisputeSheet';
import { useDisputes } from '@/features/coordinator-ops/hooks';
import { formatRelative } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { Dispute, DisputeCategory, DisputeStatus } from '@/types/api';

type StatusFilter = DisputeStatus | 'all';
const CATEGORIES: readonly DisputeCategory[] = ['quantity', 'quality', 'payment', 'transport', 'other'];

export default function DisputesPage() {
  const { t } = useTranslation('coordinatorOps');
  const [status, setStatus] = useState<StatusFilter>('open');
  const [category, setCategory] = useState<DisputeCategory | ''>('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const disputes = useDisputes({ limit: 200 });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (disputes.data ?? []).filter(
      (d) =>
        (status === 'all' || d.status === status) &&
        (!category || d.category === category) &&
        (!q || [d.code, d.lot_code, d.raised_by_name, d.description].some((v) => v.toLowerCase().includes(q))),
    );
  }, [disputes.data, status, category, search]);

  const counts = useMemo(() => {
    const c: Record<DisputeStatus, number> = { open: 0, under_review: 0, resolved: 0, rejected: 0 };
    for (const d of disputes.data ?? []) c[d.status] += 1;
    return c;
  }, [disputes.data]);

  const selected = (disputes.data ?? []).find((d) => d.id === selectedId) ?? null;

  const columns: DataTableColumn<Dispute>[] = [
    {
      id: 'code',
      header: t('disputes.col.dispute', { defaultValue: 'Dispute' }),
      cell: (d) => (
        <div className="min-w-0 max-w-[28rem]">
          <p className="font-medium text-ink">
            {d.code} <span className="font-normal text-muted">· {d.lot_code}</span>
          </p>
          <p className="truncate text-micro text-muted">{d.description}</p>
        </div>
      ),
      sortValue: (d) => d.code,
    },
    {
      id: 'category',
      header: t('disputes.col.category', { defaultValue: 'Category' }),
      cell: (d) => <Badge tone="neutral" size="sm">{t(`common:enums.disputeCategory.${d.category}`, { defaultValue: d.category })}</Badge>,
      sortValue: (d) => d.category,
      hideBelow: 'sm',
    },
    {
      id: 'raised',
      header: t('disputes.col.raisedBy', { defaultValue: 'Raised by' }),
      cell: (d) => (
        <div>
          <p className="text-ink">{d.raised_by_name}</p>
          <p className="text-micro text-muted">{t(`common:enums.role.${d.raised_by_role}`, { defaultValue: d.raised_by_role })}</p>
        </div>
      ),
      sortValue: (d) => d.raised_by_name,
      hideBelow: 'md',
    },
    {
      id: 'age',
      header: t('disputes.col.opened', { defaultValue: 'Opened' }),
      cell: (d) => <span className="text-muted">{formatRelative(d.created_at)}</span>,
      sortValue: (d) => d.created_at,
      sortFirst: 'desc',
      hideBelow: 'lg',
    },
    {
      id: 'status',
      header: t('disputes.col.status', { defaultValue: 'Status' }),
      cell: (d) => <StatusBadge kind="dispute" value={d.status} size="sm" />,
      sortValue: (d) => d.status,
    },
  ];

  return (
    <div className="space-y-10">
      <Seo
        title={t('disputes.seoTitle', { defaultValue: 'Disputes' })}
        description={t('disputes.description', { defaultValue: 'Quantity, quality and payment disputes awaiting a decision.' })}
        path="/app/coordinator/disputes"
        noindex
      />
      <PageHeader
        eyebrow={t('eyebrow', { defaultValue: 'Back office' })}
        title={t('disputes.title', { defaultValue: 'Disputes' })}
        description={t('disputes.lede', {
          defaultValue: 'Hear both sides, decide in writing and record the outcome.',
        })}
        divider
      />

      <KpiStrip
        loading={disputes.isPending}
        items={[
          { id: 'open', label: t('common:enums.disputeStatus.open', { defaultValue: 'Open' }), value: counts.open },
          { id: 'review', label: t('common:enums.disputeStatus.under_review', { defaultValue: 'Under review' }), value: counts.under_review },
          { id: 'resolved', label: t('common:enums.disputeStatus.resolved', { defaultValue: 'Resolved' }), value: counts.resolved },
          { id: 'rejected', label: t('common:enums.disputeStatus.rejected', { defaultValue: 'Rejected' }), value: counts.rejected },
        ]}
      />

      <div className="space-y-4">
        <FilterBar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={t('disputes.search', { defaultValue: 'Search code, lot, person or text' })}
          activeCount={(status !== 'open' ? 1 : 0) + (category ? 1 : 0) + (search ? 1 : 0)}
          onClear={() => {
            setStatus('open');
            setCategory('');
            setSearch('');
          }}
          resultLabel={t('disputes.count', { defaultValue: '{{count}} disputes', count: rows.length })}
        >
          <SegmentedControl<StatusFilter>
            label={t('disputes.filterStatus', { defaultValue: 'Status' })}
            size="sm"
            value={status}
            onValueChange={setStatus}
            options={[
              { value: 'open', label: t('common:enums.disputeStatus.open', { defaultValue: 'Open' }) },
              { value: 'under_review', label: t('common:enums.disputeStatus.under_review', { defaultValue: 'Under review' }) },
              { value: 'resolved', label: t('common:enums.disputeStatus.resolved', { defaultValue: 'Resolved' }) },
              { value: 'rejected', label: t('common:enums.disputeStatus.rejected', { defaultValue: 'Rejected' }) },
              { value: 'all', label: t('disputes.all', { defaultValue: 'All' }) },
            ]}
          />
          <Select
            aria-label={t('disputes.filterCategory', { defaultValue: 'Category' })}
            value={category}
            onChange={(event) => setCategory(event.target.value as DisputeCategory | '')}
            size="sm"
          >
            <option value="">{t('disputes.allCategories', { defaultValue: 'All categories' })}</option>
            {CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {t(`common:enums.disputeCategory.${value}`, { defaultValue: value })}
              </option>
            ))}
          </Select>
        </FilterBar>

        <QueryState query={disputes} skeleton="table" isEmpty={() => false}>
          {() => (
            <DataTable
              label={t('disputes.tableLabel', { defaultValue: 'Disputes' })}
              columns={columns}
              rows={rows}
              getRowId={(d) => d.id}
              defaultSort={{ columnId: 'age', direction: 'desc' }}
              onRowClick={(d) => setSelectedId(d.id)}
              isRowSelected={(d) => d.id === selectedId}
              emptyTitle={t('disputes.emptyTitle', { defaultValue: 'Nothing waiting on you' })}
              emptyDescription={t('disputes.emptyBody', { defaultValue: 'No disputes match these filters.' })}
              framed
            />
          )}
        </QueryState>
      </div>

      <DisputeSheet dispute={selected} onClose={() => setSelectedId(null)} />
    </div>
  );
}
