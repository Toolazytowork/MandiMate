import { CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CertaintyBadge, DataTable, Delta, Money, Quantity, StatusBadge, type DataTableColumn } from '@/components/domain';
import { Button, Dialog, Field, Input, Tooltip, toast } from '@/components/ui';
import { formatDateTime, formatINR } from '@/lib/format';
import type { FarmerPayout, Settlement } from '@/types/api';

import { useMarkPayoutPaid } from '../hooks';
import { errorMessage } from '../utils';

const sum = (rows: readonly FarmerPayout[], pick: (p: FarmerPayout) => number) => rows.reduce((n, p) => n + pick(p), 0);

/** Every farmer's payout: kg, gross, cost shares, net, net/kg against the mandi baseline, and payment. */
export function PayoutsTable({ settlement }: { settlement: Settlement }) {
  const { t } = useTranslation('coordinatorOps');
  const [paying, setPaying] = useState<FarmerPayout | null>(null);
  const rows = settlement.payouts;

  const columns: DataTableColumn<FarmerPayout>[] = [
    {
      id: 'farmer',
      header: t('payouts.farmer', { defaultValue: 'Farmer' }),
      cell: (p) => <span className="font-medium text-ink">{p.farmer_name}</span>,
      sortValue: (p) => p.farmer_name,
      footer: <span className="font-medium">{t('payouts.total', { defaultValue: 'Total' })}</span>,
    },
    {
      id: 'accepted',
      header: t('payouts.accepted', { defaultValue: 'Accepted' }),
      cell: (p) => (
        <div>
          <Quantity kg={p.accepted_kg} />
          {p.rejected_kg > 0 ? (
            <p className="text-micro text-danger-ink">
              {t('payouts.rejected', { defaultValue: '{{kg}} kg rejected', kg: p.rejected_kg })}
            </p>
          ) : null}
        </div>
      ),
      sortValue: (p) => p.accepted_kg,
      numeric: true,
      footer: <Quantity kg={sum(rows, (p) => p.accepted_kg)} />,
    },
    {
      id: 'gross',
      header: t('payouts.gross', { defaultValue: 'Gross' }),
      cell: (p) => <Money value={p.gross_amount} tone="muted" />,
      sortValue: (p) => p.gross_amount,
      numeric: true,
      hideBelow: 'md',
      footer: <Money value={sum(rows, (p) => p.gross_amount)} />,
    },
    {
      id: 'shares',
      header: t('payouts.shares', { defaultValue: 'Costs shared' }),
      cell: (p) => (
        <Tooltip
          content={t('payouts.sharesDetail', {
            defaultValue: 'Transport {{transport}} · Handling {{handling}} · Commission {{commission}}',
            transport: formatINR(p.transport_share),
            handling: formatINR(p.handling_share),
            commission: formatINR(p.commission_share),
          })}
        >
          <span tabIndex={0} className="cursor-help border-b border-dotted border-muted/60">
            −<Money value={p.transport_share + p.handling_share + p.commission_share} tone="muted" />
          </span>
        </Tooltip>
      ),
      numeric: true,
      hideBelow: 'lg',
      footer: <Money value={sum(rows, (p) => p.transport_share + p.handling_share + p.commission_share)} />,
    },
    {
      id: 'net',
      header: t('payouts.net', { defaultValue: 'Net payout' }),
      cell: (p) => (
        <div>
          <Money value={p.net_amount} className="font-semibold text-ink" />
          <p className="text-micro text-muted">
            <Money value={p.net_per_kg} perKg decimals={2} size="sm" tone="muted" />
          </p>
        </div>
      ),
      sortValue: (p) => p.net_amount,
      sortFirst: 'desc',
      numeric: true,
      footer: <Money value={sum(rows, (p) => p.net_amount)} className="font-semibold" />,
    },
    {
      id: 'uplift',
      header: (
        <span className="inline-flex items-center gap-1.5">
          {t('payouts.uplift', { defaultValue: 'vs selling alone' })}
          <CertaintyBadge certainty="estimated" size="sm" withTooltip={false} />
        </span>
      ),
      cell: (p) =>
        p.uplift_per_kg != null ? (
          <div>
            <Delta value={p.uplift_per_kg} perKg />
            {p.baseline_net_per_kg != null ? (
              <p className="text-micro text-muted">
                {t('payouts.baseline', { defaultValue: 'mandi {{value}}/kg', value: formatINR(p.baseline_net_per_kg, { decimals: 2 }) })}
              </p>
            ) : null}
          </div>
        ) : (
          <span className="text-muted">—</span>
        ),
      sortValue: (p) => p.uplift_per_kg ?? null,
      sortFirst: 'desc',
      numeric: true,
      hideBelow: 'sm',
    },
    {
      id: 'status',
      header: t('payouts.status', { defaultValue: 'Payout' }),
      cell: (p) =>
        p.status === 'paid' ? (
          <div className="flex flex-col items-end gap-0.5">
            <StatusBadge kind="payout" value="paid" size="sm" />
            {p.reference ? <span className="text-micro text-muted">{p.reference}</span> : null}
            {p.paid_at ? <span className="text-micro text-muted">{formatDateTime(p.paid_at)}</span> : null}
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setPaying(p)}>
            {t('payouts.markPaid', { defaultValue: 'Mark paid' })}
          </Button>
        ),
      align: 'right',
    },
  ];

  return (
    <>
      <DataTable
        label={t('payouts.label', { defaultValue: 'Farmer payouts' })}
        columns={columns}
        rows={rows}
        getRowId={(p) => p.id}
        defaultSort={{ columnId: 'net', direction: 'desc' }}
        emptyTitle={t('payouts.empty', { defaultValue: 'No payouts yet' })}
      />
      <MarkPaidDialog settlement={settlement} payout={paying} onClose={() => setPaying(null)} />
    </>
  );
}

function MarkPaidDialog({ settlement, payout, onClose }: { settlement: Settlement; payout: FarmerPayout | null; onClose: () => void }) {
  const { t } = useTranslation('coordinatorOps');
  const markPaid = useMarkPayoutPaid(settlement.id);
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReference('');
    setError(null);
  }, [payout?.id]);

  const submit = () => {
    if (!payout) return;
    const ref = reference.trim();
    if (!ref) {
      setError(t('payouts.referenceRequired', { defaultValue: 'Add the UPI or bank reference so the farmer can trace it' }));
      return;
    }
    markPaid.mutate(
      { payoutId: payout.id, req: { reference: ref } },
      {
        onSuccess: () => {
          toast.success(t('payouts.paid', { defaultValue: '{{amount}} paid to {{name}}', amount: formatINR(payout.net_amount), name: payout.farmer_name }));
          onClose();
        },
        onError: (err) => {
          const fieldError = (err as { fieldErrors?: Record<string, string> }).fieldErrors?.reference;
          if (fieldError) setError(fieldError);
          else toast.error(errorMessage(err));
        },
      },
    );
  };

  return (
    <Dialog
      open={payout !== null}
      onOpenChange={(open) => !open && onClose()}
      size="sm"
      dismissible={!markPaid.isPending}
      title={t('payouts.dialogTitle', { defaultValue: 'Pay {{name}}', name: payout?.farmer_name ?? '' })}
      description={t('payouts.dialogBody', { defaultValue: 'Confirm the transfer has been made. The farmer is notified with the reference.' })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={markPaid.isPending}>
            {t('actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button onClick={submit} loading={markPaid.isPending} leadingIcon={<CheckCircle2 strokeWidth={1.25} aria-hidden />}>
            {t('payouts.confirm', { defaultValue: 'Mark as paid' })}
          </Button>
        </>
      }
    >
      {payout ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="flex items-baseline justify-between rounded-card border border-line bg-parchment/50 p-4">
            <span className="text-[13px] font-semibold text-muted">{t('payouts.net', { defaultValue: 'Net payout' })}</span>
            <Money value={payout.net_amount} size="lg" />
          </div>
          <Field label={t('payouts.reference', { defaultValue: 'UPI / bank reference' })} error={error ?? undefined} required>
            <Input
              value={reference}
              onChange={(event) => {
                setReference(event.target.value);
                if (error) setError(null);
              }}
              autoComplete="off"
              maxLength={120}
            />
          </Field>
        </form>
      ) : null}
    </Dialog>
  );
}
