import { AlertTriangle, IndianRupee, Scale } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import {
  DataTable,
  KpiStrip,
  Money,
  PageHeader,
  QueryState,
  Quantity,
  SectionCard,
  StatusBadge,
  type DataTableColumn,
} from '@/components/domain';
import { Button, LinkButton, SegmentedControl } from '@/components/ui';
import { daysUntil, isOverdue, isSettled, outstandingAmount, paymentSummary } from '@/features/buyer/utils';
import { RecordPaymentDialog } from '@/features/buyer-orders/components/RecordPaymentDialog';
import { useBuyerSettlements } from '@/features/buyer-orders/hooks';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { PaymentRecord, Settlement } from '@/types/api';

type View = 'owed' | 'paid';

export default function PaymentsPage() {
  const { t } = useTranslation('buyerOrders');
  const query = useBuyerSettlements();
  const [view, setView] = useState<View>('owed');
  const [paying, setPaying] = useState<Settlement | null>(null);
  const settlements = useMemo(() => query.data ?? [], [query.data]);
  const summary = useMemo(() => paymentSummary(settlements), [settlements]);
  const owed = settlements.filter((s) => !isSettled(s));
  const paid = settlements.filter((s) => isSettled(s));
  const history = useMemo(
    () =>
      settlements
        .flatMap((s) => s.payments.map((p) => ({ ...p, settlement: s })))
        .sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime()),
    [settlements],
  );

  const dueLabel = (s: Settlement) => {
    if (isSettled(s)) return s.paid_at ? t('payments.paidOn', { defaultValue: 'Paid {{date}}', date: formatDate(s.paid_at) }) : '—';
    const days = daysUntil(s.due_date);
    if (days < 0) return t('payments.overdueBy', { defaultValue: '{{count}} days overdue', count: -days });
    if (days === 0) return t('payments.dueToday', { defaultValue: 'Due today' });
    return t('payments.dueIn', { defaultValue: 'Due in {{count}} days', count: days });
  };

  const columns: DataTableColumn<Settlement>[] = [
    {
      id: 'code',
      header: t('payments.settlement', { defaultValue: 'Settlement' }),
      cell: (s) => (
        <div className="min-w-0">
          <p className="font-medium text-ink">{s.crop_name}</p>
          <p className="mt-1 text-[13px] font-semibold text-muted">
            {s.code} ·{' '}
            <Link to={`/app/buyer/orders/${s.lot_id}`} className="underline-offset-4 hover:text-ink hover:underline" onClick={(e) => e.stopPropagation()}>
              {s.lot_code}
            </Link>
          </p>
        </div>
      ),
      sortValue: (s) => s.code,
    },
    {
      id: 'kg',
      header: t('payments.acceptedKg', { defaultValue: 'Accepted' }),
      cell: (s) => <Quantity kg={s.total_accepted_kg} />,
      sortValue: (s) => s.total_accepted_kg,
      numeric: true,
      align: 'right',
      hideBelow: 'lg',
    },
    {
      id: 'gross',
      header: t('payments.gross', { defaultValue: 'Invoice' }),
      cell: (s) => <Money value={s.gross_amount} size="sm" />,
      sortValue: (s) => s.gross_amount,
      numeric: true,
      align: 'right',
      hideBelow: 'md',
    },
    {
      id: 'outstanding',
      header: view === 'owed' ? t('payments.outstanding', { defaultValue: 'Outstanding' }) : t('payments.paid', { defaultValue: 'Paid' }),
      cell: (s) => <Money value={view === 'owed' ? outstandingAmount(s) : s.amount_paid} size="sm" />,
      sortValue: (s) => (view === 'owed' ? outstandingAmount(s) : s.amount_paid),
      numeric: true,
      align: 'right',
    },
    {
      id: 'due',
      header: t('payments.due', { defaultValue: 'Due' }),
      cell: (s) => (
        <div>
          <p className={cn('tabular-nums', isOverdue(s) ? 'font-medium text-danger-ink' : 'text-ink')}>{formatDate(s.due_date)}</p>
          <p className={cn('text-micro', isOverdue(s) ? 'text-danger-ink' : 'text-muted')}>{dueLabel(s)}</p>
        </div>
      ),
      sortValue: (s) => s.due_date,
      hideBelow: 'sm',
    },
    {
      id: 'status',
      header: t('payments.status', { defaultValue: 'Status' }),
      cell: (s) => <StatusBadge kind="payment" value={isOverdue(s) && s.payment_status !== 'disputed' ? 'overdue' : s.payment_status} size="sm" />,
      sortValue: (s) => s.payment_status,
    },
    {
      id: 'action',
      header: <span className="sr-only">{t('payments.actions', { defaultValue: 'Actions' })}</span>,
      cell: (s) =>
        !isSettled(s) && s.payment_status !== 'disputed' ? (
          <Button
            size="sm"
            variant={isOverdue(s) ? 'primary' : 'secondary'}
            onClick={(e) => {
              e.stopPropagation();
              setPaying(s);
            }}
          >
            {t('payments.record', { defaultValue: 'Record payment' })}
          </Button>
        ) : null,
      align: 'right',
    },
  ];

  return (
    <>
      <Seo
        title={t('payments.seoTitle', { defaultValue: 'Payments' })}
        description={t('payments.seoDescription', { defaultValue: 'Settlements you owe, payments recorded and due dates.' })}
        path="/app/buyer/payments"
        noindex
      />
      <div className="space-y-10">
        <PageHeader
          eyebrow={t('payments.eyebrow', { defaultValue: 'Settlement' })}
          title={t('payments.title', { defaultValue: 'Payments' })}
          description={t('payments.description', {
            defaultValue: 'What you owe for accepted weight, when it is due, and every transfer you have recorded. Paying on time lifts your reliability score with farmers.',
          })}
          actions={
            <LinkButton to="/app/disputes" variant="secondary" leadingIcon={<Scale strokeWidth={1.25} aria-hidden />}>
              {t('payments.disputes', { defaultValue: 'Disputes' })}
            </LinkButton>
          }
        />

        <KpiStrip
          loading={query.isPending}
          columns={4}
          items={[
            { id: 'outstanding', label: t('payments.kpiOutstanding', { defaultValue: 'Outstanding' }), value: <Money value={summary.outstanding} />, icon: <IndianRupee strokeWidth={1.25} aria-hidden /> },
            {
              id: 'overdue',
              label: t('payments.kpiOverdue', { defaultValue: 'Overdue' }),
              value: <Money value={summary.overdue} />,
              hint: t('payments.kpiOverdueHint', { defaultValue: '{{count}} settlements', count: summary.overdueCount }),
              icon: <AlertTriangle strokeWidth={1.25} aria-hidden />,
            },
            {
              id: 'next',
              label: t('payments.kpiNext', { defaultValue: 'Next due' }),
              value: summary.nextDue ? formatDate(summary.nextDue.due_date) : '—',
              hint: summary.nextDue ? summary.nextDue.code : undefined,
            },
            { id: 'paid', label: t('payments.kpiPaid', { defaultValue: 'Paid to date' }), value: <Money value={summary.paidTotal} /> },
          ]}
        />

        <QueryState query={query} skeleton="table">
          {() => (
            <div className="space-y-6">
              <SegmentedControl<View>
                label={t('payments.view', { defaultValue: 'Show settlements' })}
                value={view}
                onValueChange={setView}
                options={[
                  { value: 'owed', label: `${t('payments.owed', { defaultValue: 'Owed' })} · ${owed.length}` },
                  { value: 'paid', label: `${t('payments.settled', { defaultValue: 'Settled' })} · ${paid.length}` },
                ]}
              />
              <DataTable
                label={t('payments.tableLabel', { defaultValue: 'Settlements' })}
                rows={view === 'owed' ? owed : paid}
                columns={columns}
                getRowId={(s) => s.id}
                defaultSort={{ columnId: 'due', direction: view === 'owed' ? 'asc' : 'desc' }}
                rowClassName={(s) => (isOverdue(s) ? 'bg-danger/[0.03]' : undefined)}
                emptyTitle={
                  view === 'owed'
                    ? t('payments.emptyOwed', { defaultValue: 'Nothing outstanding' })
                    : t('payments.emptyPaid', { defaultValue: 'No settled payments yet' })
                }
                emptyDescription={t('payments.emptyBody', {
                  defaultValue: 'A settlement is created when you record delivery and quality for an order.',
                })}
                framed
              />
            </div>
          )}
        </QueryState>

        <SectionCard
          eyebrow={t('payments.historyEyebrow', { defaultValue: 'Ledger' })}
          title={t('payments.history', { defaultValue: 'Payment history' })}
          description={t('payments.historyBody', {
            defaultValue: 'If a record does not match, raise a dispute and a coordinator will review it.',
          })}
          action={
            <Link
              to="/app/disputes"
              className="inline-flex items-center gap-2 border-b border-ink/30 pb-1 text-[13px] font-semibold text-ink transition-colors hover:border-gold-700 hover:text-gold-700"
            >
              {t('payments.raise', { defaultValue: 'Raise a dispute' })}
              <span aria-hidden="true">→</span>
            </Link>
          }
          flush
        >
          <DataTable<PaymentRecord & { settlement: Settlement }>
            label={t('payments.historyLabel', { defaultValue: 'Recorded payments' })}
            rows={query.isPending ? undefined : history}
            loading={query.isPending}
            getRowId={(p) => p.id}
            emptyTitle={t('payments.emptyHistory', { defaultValue: 'No payments recorded yet' })}
            columns={[
              { id: 'date', header: t('payments.date', { defaultValue: 'Paid on' }), cell: (p) => <span className="tabular-nums">{formatDateTime(p.paid_at)}</span>, sortValue: (p) => p.paid_at },
              {
                id: 'settlement',
                header: t('payments.settlement', { defaultValue: 'Settlement' }),
                cell: (p) => (
                  <span>
                    {p.settlement.code} <span className="text-muted">· {p.settlement.crop_name}</span>
                  </span>
                ),
              },
              { id: 'ref', header: t('payments.reference', { defaultValue: 'Reference' }), cell: (p) => p.reference ?? '—', hideBelow: 'md' },
              { id: 'by', header: t('payments.recordedBy', { defaultValue: 'Recorded by' }), cell: (p) => p.recorded_by_name, hideBelow: 'lg' },
              { id: 'amount', header: t('payments.amount', { defaultValue: 'Amount' }), cell: (p) => <Money value={p.amount} size="sm" />, sortValue: (p) => p.amount, numeric: true, align: 'right' },
            ]}
            defaultSort={{ columnId: 'date', direction: 'desc' }}
          />
        </SectionCard>
      </div>

      <RecordPaymentDialog settlement={paying} onOpenChange={(open) => !open && setPaying(null)} />
    </>
  );
}
