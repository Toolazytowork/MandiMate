import { CheckCircle2, CircleAlert, Receipt } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { Money, PageHeader, Quantity, QueryState, SectionCard, StatusBadge } from '@/components/domain';
import { Reveal } from '@/components/motion';
import { Badge, LinkButton, Progress } from '@/components/ui';
import { PayoutsTable } from '@/features/coordinator-ops/components/PayoutsTable';
import { RecordPaymentForm } from '@/features/coordinator-ops/components/RecordPaymentForm';
import { useSettlement } from '@/features/coordinator-ops/hooks';
import { dueIn, isOverdue, outstanding } from '@/features/coordinator-ops/utils';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, formatINR } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { Settlement } from '@/types/api';

const TOLERANCE = 1;

export default function SettlementDetailPage() {
  const { settlementId = '' } = useParams();
  const { t } = useTranslation('coordinatorOps');
  const settlement = useSettlement(settlementId);
  const title = settlement.data?.code ?? t('settlement.title', { defaultValue: 'Settlement' });

  return (
    <div className="space-y-10">
      <Seo
        title={title}
        description={t('settlement.description', { defaultValue: 'What the buyer owes, what has been paid and each farmer’s payout.' })}
        path={`/app/coordinator/settlements/${settlementId}`}
        noindex
      />
      <PageHeader
        eyebrow={t('settlement.eyebrow', { defaultValue: 'Settlement' })}
        title={title}
        breadcrumbs={[
          { label: t('settlements.title', { defaultValue: 'Settlements' }), to: '/app/coordinator/settlements' },
          { label: title },
        ]}
        description={
          settlement.data
            ? t('settlement.lede', {
                defaultValue: '{{buyer}} · {{crop}} at {{price}}/kg',
                buyer: settlement.data.buyer_name,
                crop: settlement.data.crop_name,
                price: formatINR(settlement.data.price_per_kg, { decimals: 2 }),
              })
            : undefined
        }
        meta={
          settlement.data ? (
            <>
              <StatusBadge kind="payment" value={settlement.data.payment_status} />
              {isOverdue(settlement.data) && settlement.data.payment_status !== 'overdue' ? (
                <StatusBadge kind="payment" value="overdue" />
              ) : null}
              <Badge tone="neutral">{settlement.data.lot_code}</Badge>
            </>
          ) : null
        }
        actions={
          settlement.data ? (
            <LinkButton to={`/app/coordinator/lots/${settlement.data.lot_id}`} variant="secondary">
              {t('settlement.openLot', { defaultValue: 'Open lot' })}
            </LinkButton>
          ) : null
        }
        divider
      />

      <QueryState query={settlement} skeleton="detail" isEmpty={() => false} errorTitle={t('settlement.error', { defaultValue: 'This settlement could not be loaded' })}>
        {(data) => <SettlementBody settlement={data} />}
      </QueryState>
    </div>
  );
}

function SettlementBody({ settlement }: { settlement: Settlement }) {
  const { t } = useTranslation('coordinatorOps');
  const due = outstanding(settlement);
  const days = dueIn(settlement);
  const late = isOverdue(settlement);
  const paidPct = settlement.gross_amount > 0 ? Math.min(100, (settlement.amount_paid / settlement.gross_amount) * 100) : 0;

  const payoutsNet = settlement.payouts.reduce((n, p) => n + p.net_amount, 0);
  const payoutsGross = settlement.payouts.reduce((n, p) => n + p.gross_amount, 0);
  const paidOut = settlement.payouts.filter((p) => p.status === 'paid').reduce((n, p) => n + p.net_amount, 0);
  const deductions = settlement.transport_cost + settlement.handling_cost + settlement.commission_amount;
  const expectedNet = settlement.gross_amount - deductions;
  const checks = [
    {
      id: 'net',
      label: t('recon.net', { defaultValue: 'Gross − costs = net to farmers' }),
      ok: Math.abs(expectedNet - settlement.net_to_farmers) <= TOLERANCE,
      diff: expectedNet - settlement.net_to_farmers,
    },
    {
      id: 'payouts',
      label: t('recon.payouts', { defaultValue: 'Farmer payouts add up to net' }),
      ok: Math.abs(payoutsNet - settlement.net_to_farmers) <= TOLERANCE,
      diff: payoutsNet - settlement.net_to_farmers,
    },
    {
      id: 'gross',
      label: t('recon.gross', { defaultValue: 'Farmer gross adds up to buyer gross' }),
      ok: Math.abs(payoutsGross - settlement.gross_amount) <= TOLERANCE,
      diff: payoutsGross - settlement.gross_amount,
    },
  ];
  const reconciled = checks.every((c) => c.ok);

  return (
    <div className="space-y-8">
      <Reveal>
        <section
          aria-label={t('settlement.summary', { defaultValue: 'Buyer balance' })}
          className="surface-dark relative overflow-hidden rounded-panel bg-forest-900 p-6 text-ivory sm:p-10"
        >
          <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-end">
            <div className="space-y-4">
              <p className="eyebrow text-gold-400">{t('settlement.owes', { defaultValue: 'Buyer owes' })}</p>
              <Money value={settlement.gross_amount} size="hero" />
              <p className="text-small text-ivory/70">
                <Quantity kg={settlement.total_accepted_kg} /> × {formatINR(settlement.price_per_kg, { decimals: 2 })}/kg
              </p>
              <Progress
                value={paidPct}
                tone="gold"
                label={t('settlement.paidProgress', { defaultValue: 'Share of buyer payment received' })}
                valueText={`${Math.round(paidPct)}%`}
              />
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-t border-ivory/15 pt-6 lg:border-t-0 lg:border-s lg:ps-8 lg:pt-0">
              <div>
                <dt className="eyebrow text-ivory/60">{t('settlement.received', { defaultValue: 'Received' })}</dt>
                <dd className="mt-1"><Money value={settlement.amount_paid} size="lg" /></dd>
              </div>
              <div>
                <dt className="eyebrow text-ivory/60">{t('settlement.outstanding', { defaultValue: 'Outstanding' })}</dt>
                <dd className={cn('mt-1', due > 0 && late ? 'text-[#f4b4a4]' : '')}><Money value={due} size="lg" /></dd>
              </div>
              <div>
                <dt className="eyebrow text-ivory/60">{t('settlement.due', { defaultValue: 'Due' })}</dt>
                <dd className="mt-1 text-ivory">
                  {formatDate(settlement.due_date)}
                  {days !== null ? (
                    <span className={cn('block text-micro', late ? 'text-[#f4b4a4]' : 'text-ivory/60')}>
                      {late
                        ? t('settlements.lateBy', { defaultValue: '{{count}} days late', count: Math.abs(days) })
                        : t('settlements.dueIn', { defaultValue: 'in {{count}} days', count: days })}
                    </span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="eyebrow text-ivory/60">{t('settlement.paidOut', { defaultValue: 'Paid to farmers' })}</dt>
                <dd className="mt-1"><Money value={paidOut} size="lg" /></dd>
              </div>
            </dl>
          </div>
        </section>
      </Reveal>

      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-8">
          <SectionCard
            eyebrow={t('payouts.eyebrow', { defaultValue: 'Farmers' })}
            title={t('payouts.title', { defaultValue: 'Farmer payouts' })}
            description={t('payouts.description', {
              defaultValue: 'Net is after each farmer’s share of transport, handling and commission. Uplift compares with selling alone at the mandi.',
            })}
            flush
          >
            <PayoutsTable settlement={settlement} />
          </SectionCard>

          <SectionCard
            eyebrow={t('recon.eyebrow', { defaultValue: 'Reconciliation' })}
            title={t('recon.title', { defaultValue: 'Does every rupee add up?' })}
            action={
              reconciled ? (
                <Badge tone="success" icon={<CheckCircle2 strokeWidth={1.25} aria-hidden />}>{t('recon.ok', { defaultValue: 'Reconciled' })}</Badge>
              ) : (
                <Badge tone="danger" icon={<CircleAlert strokeWidth={1.25} aria-hidden />}>{t('recon.mismatch', { defaultValue: 'Mismatch' })}</Badge>
              )
            }
          >
            <dl className="divide-y divide-line/70 text-small">
              <ReconRow label={t('recon.grossLabel', { defaultValue: 'Buyer gross' })} value={settlement.gross_amount} strong />
              <ReconRow label={t('recon.transport', { defaultValue: 'Transport' })} value={-settlement.transport_cost} />
              <ReconRow label={t('recon.handling', { defaultValue: 'Handling' })} value={-settlement.handling_cost} />
              <ReconRow label={t('recon.commission', { defaultValue: 'MandiMate commission' })} value={-settlement.commission_amount} />
              <ReconRow label={t('recon.netLabel', { defaultValue: 'Net to farmers' })} value={settlement.net_to_farmers} strong />
            </dl>
            <ul className="mt-5 space-y-2">
              {checks.map((check) => (
                <li key={check.id} className="flex items-center justify-between gap-3 text-small">
                  <span className="inline-flex items-center gap-2 text-ink">
                    {check.ok ? <CheckCircle2 strokeWidth={1.25} className="size-4 text-success" aria-hidden /> : <CircleAlert strokeWidth={1.25} className="size-4 text-danger" aria-hidden />}
                    {check.label}
                  </span>
                  <span className={cn('tabular-nums', check.ok ? 'text-muted' : 'text-danger-ink')}>
                    {check.ok ? t('recon.match', { defaultValue: 'matches' }) : formatINR(check.diff, { signed: true })}
                  </span>
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>

        <aside className="space-y-8">
          <SectionCard
            eyebrow={t('payment.eyebrow', { defaultValue: 'Buyer payment' })}
            title={t('payment.title', { defaultValue: 'Record a payment' })}
          >
            <RecordPaymentForm settlement={settlement} />
          </SectionCard>

          <SectionCard eyebrow={t('history.eyebrow', { defaultValue: 'Ledger' })} title={t('history.title', { defaultValue: 'Payment history' })}>
            {settlement.payments.length === 0 ? (
              <p className="flex items-center gap-2 text-small text-muted">
                <Receipt strokeWidth={1.25} className="size-4" aria-hidden />
                {t('history.empty', { defaultValue: 'No buyer payments recorded yet.' })}
              </p>
            ) : (
              <ol className="relative space-y-5 border-s border-line ps-5">
                {[...settlement.payments]
                  .sort((a, b) => b.paid_at.localeCompare(a.paid_at))
                  .map((payment) => (
                    <li key={payment.id} className="relative">
                      <span aria-hidden className="absolute top-1.5 -start-[24.5px] size-2 rounded-full border border-paper bg-gold-700" />
                      <div className="flex items-baseline justify-between gap-3">
                        <Money value={payment.amount} />
                        <span className="text-micro text-muted">{formatDateTime(payment.paid_at)}</span>
                      </div>
                      <p className="text-micro text-muted">
                        {payment.reference ? `${payment.reference} · ` : ''}
                        {t('history.by', { defaultValue: 'recorded by {{name}}', name: payment.recorded_by_name })}
                      </p>
                    </li>
                  ))}
              </ol>
            )}
          </SectionCard>
        </aside>
      </div>
    </div>
  );
}

function ReconRow({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5">
      <dt className={strong ? 'font-medium text-ink' : 'text-muted'}>{label}</dt>
      <dd className={cn('tabular-nums', strong ? 'font-semibold text-ink' : 'text-muted')}>
        <Money value={value} signed={!strong} tone={strong ? 'default' : 'muted'} />
      </dd>
    </div>
  );
}
