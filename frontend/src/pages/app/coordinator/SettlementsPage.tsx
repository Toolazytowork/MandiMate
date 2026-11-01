import { AlarmClock, IndianRupee, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { DataTable, FilterBar, KpiStrip, Money, PageHeader, Quantity, QueryState, StatusBadge, type DataTableColumn } from '@/components/domain';
import { Select } from '@/components/ui';
import { useSettlements } from '@/features/coordinator-ops/hooks';
import { dueIn, isOverdue, outstanding } from '@/features/coordinator-ops/utils';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { PaymentStatus, Settlement } from '@/types/api';

const STATUSES: readonly PaymentStatus[] = ['pending', 'partially_paid', 'overdue', 'paid', 'disputed'];

export default function SettlementsPage() {
  const { t } = useTranslation('coordinatorOps');
  const navigate = useNavigate();
  const [status, setStatus] = useState<PaymentStatus | ''>('');
  const [search, setSearch] = useState('');
  const settlements = useSettlements({ payment_status: status || null, limit: 200 });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = settlements.data ?? [];
    if (!q) return list;
    return list.filter((s) => [s.code, s.lot_code, s.buyer_name, s.crop_name].some((v) => v.toLowerCase().includes(q)));
  }, [settlements.data, search]);

  const totals = useMemo(() => {
    const list = settlements.data ?? [];
    return {
      outstanding: list.reduce((sum, s) => sum + outstanding(s), 0),
      overdue: list.filter(isOverdue).length,
      dueWeek: list.filter((s) => {
        const d = dueIn(s);
        return d !== null && d >= 0 && d <= 7;
      }).length,
      netToFarmers: list.reduce((sum, s) => sum + s.net_to_farmers, 0),
    };
  }, [settlements.data]);

  const columns: DataTableColumn<Settlement>[] = [
    {
      id: 'code',
      header: t('settlements.col.settlement', { defaultValue: 'Settlement' }),
      cell: (s) => (
        <div className="min-w-0">
          <p className="font-medium text-ink">{s.code}</p>
          <p className="text-micro text-muted">
            {s.lot_code} · {s.crop_name}
          </p>
        </div>
      ),
      sortValue: (s) => s.code,
    },
    {
      id: 'buyer',
      header: t('settlements.col.buyer', { defaultValue: 'Buyer' }),
      cell: (s) => s.buyer_name,
      sortValue: (s) => s.buyer_name,
      hideBelow: 'md',
    },
    {
      id: 'kg',
      header: t('settlements.col.kg', { defaultValue: 'Accepted' }),
      cell: (s) => <Quantity kg={s.total_accepted_kg} />,
      sortValue: (s) => s.total_accepted_kg,
      numeric: true,
      hideBelow: 'lg',
    },
    {
      id: 'gross',
      header: t('settlements.col.gross', { defaultValue: 'Buyer owes' }),
      cell: (s) => <Money value={s.gross_amount} />,
      sortValue: (s) => s.gross_amount,
      sortFirst: 'desc',
      numeric: true,
      hideBelow: 'sm',
    },
    {
      id: 'outstanding',
      header: t('settlements.col.outstanding', { defaultValue: 'Outstanding' }),
      cell: (s) => <Money value={outstanding(s)} className={outstanding(s) > 0 ? 'text-ink' : 'text-muted'} />,
      sortValue: (s) => outstanding(s),
      sortFirst: 'desc',
      numeric: true,
    },
    {
      id: 'due',
      header: t('settlements.col.due', { defaultValue: 'Due' }),
      cell: (s) => {
        const days = dueIn(s);
        const late = isOverdue(s);
        return (
          <div>
            <p className={cn('tabular-nums', late ? 'font-medium text-danger-ink' : 'text-ink')}>{formatDate(s.due_date)}</p>
            {days !== null ? (
              <p className={cn('text-micro', late ? 'text-danger-ink' : 'text-muted')}>
                {late
                  ? t('settlements.lateBy', { defaultValue: '{{count}} days late', count: Math.abs(days) })
                  : days === 0
                    ? t('settlements.dueToday', { defaultValue: 'Due today' })
                    : t('settlements.dueIn', { defaultValue: 'in {{count}} days', count: days })}
              </p>
            ) : null}
          </div>
        );
      },
      sortValue: (s) => s.due_date,
      hideBelow: 'sm',
    },
    {
      id: 'status',
      header: t('settlements.col.status', { defaultValue: 'Status' }),
      cell: (s) => <StatusBadge kind="payment" value={isOverdue(s) && s.payment_status !== 'disputed' ? 'overdue' : s.payment_status} size="sm" />,
      sortValue: (s) => s.payment_status,
    },
  ];

  return (
    <div className="space-y-10">
      <Seo
        title={t('settlements.seoTitle', { defaultValue: 'Settlements' })}
        description={t('settlements.description', { defaultValue: 'Buyer payments, overdue balances and farmer payouts.' })}
        path="/app/coordinator/settlements"
        noindex
      />
      <PageHeader
        eyebrow={t('eyebrow', { defaultValue: 'Back office' })}
        title={t('settlements.title', { defaultValue: 'Settlements' })}
        description={t('settlements.lede', {
          defaultValue: 'What each buyer owes, what has arrived, and what every farmer takes home — reconciled to the rupee.',
        })}
        divider
      />

      <KpiStrip
        loading={settlements.isPending}
        items={[
          { id: 'outstanding', label: t('settlements.kpi.outstanding', { defaultValue: 'Outstanding from buyers' }), value: <Money value={totals.outstanding} compact />, icon: <IndianRupee strokeWidth={1.25} aria-hidden /> },
          { id: 'overdue', label: t('settlements.kpi.overdue', { defaultValue: 'Overdue' }), value: totals.overdue, icon: <AlarmClock strokeWidth={1.25} aria-hidden /> },
          { id: 'week', label: t('settlements.kpi.week', { defaultValue: 'Due in 7 days' }), value: totals.dueWeek },
          { id: 'net', label: t('settlements.kpi.net', { defaultValue: 'Net to farmers' }), value: <Money value={totals.netToFarmers} compact />, icon: <Wallet strokeWidth={1.25} aria-hidden /> },
        ]}
      />

      <div className="space-y-4">
        <FilterBar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={t('settlements.search', { defaultValue: 'Search code, lot, buyer or crop' })}
          activeCount={(status ? 1 : 0) + (search ? 1 : 0)}
          onClear={() => {
            setStatus('');
            setSearch('');
          }}
          resultLabel={t('settlements.count', { defaultValue: '{{count}} settlements', count: rows.length })}
        >
          <Select
            aria-label={t('settlements.filterStatus', { defaultValue: 'Payment status' })}
            value={status}
            onChange={(event) => setStatus(event.target.value as PaymentStatus | '')}
            size="sm"
          >
            <option value="">{t('settlements.allStatuses', { defaultValue: 'All statuses' })}</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`common:enums.paymentStatus.${value}`, { defaultValue: value.replace(/_/g, ' ') })}
              </option>
            ))}
          </Select>
        </FilterBar>

        <QueryState query={settlements} skeleton="table" isEmpty={() => false}>
          {() => (
            <DataTable
              label={t('settlements.tableLabel', { defaultValue: 'Settlements' })}
              columns={columns}
              rows={rows}
              getRowId={(s) => s.id}
              loading={settlements.isFetching && !settlements.data}
              defaultSort={{ columnId: 'due', direction: 'asc' }}
              onRowClick={(s) => navigate(`/app/coordinator/settlements/${s.id}`)}
              rowClassName={(s) => (isOverdue(s) ? 'bg-danger/[0.03]' : undefined)}
              emptyTitle={t('settlements.emptyTitle', { defaultValue: 'No settlements match' })}
              emptyDescription={t('settlements.emptyBody', { defaultValue: 'Settlements open automatically once a lot’s delivery is recorded.' })}
              framed
            />
          )}
        </QueryState>
      </div>
    </div>
  );
}
