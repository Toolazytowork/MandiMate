import { ClipboardCheck } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Quantity } from '@/components/domain';
import { Button, Field, Input, Textarea, toast } from '@/components/ui';
import {
  activeMembers,
  deliveryLine,
  deliveryTotals,
  dispatchedByMember,
  parseAmount,
  round2,
} from '@/features/buyer/utils';
import { apiErrorMessage } from '@/features/shared/forms';
import { isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatKg } from '@/lib/format';
import type { Lot, TransportRequest } from '@/types/api';

import { useRecordDelivery } from '../hooks';

interface Row {
  delivered: string;
  accepted: string;
  reason: string;
}

export interface DeliveryFormProps {
  lot: Lot;
  request?: TransportRequest | null;
}

export function DeliveryForm({ lot, request }: DeliveryFormProps) {
  const { t } = useTranslation('buyerOrders');
  const record = useRecordDelivery(lot.id);
  const members = useMemo(() => activeMembers(lot.members), [lot.members]);
  const dispatched = useMemo(() => dispatchedByMember(lot.members, request), [lot.members, request]);

  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(members.map((m) => [m.id, { delivered: '', accepted: '', reason: '' }])),
  );
  const [inspector, setInspector] = useState('');
  const [notes, setNotes] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  const lines = members.map((member) => {
    const row = rows[member.id] ?? { delivered: '', accepted: '', reason: '' };
    const line = {
      dispatched: dispatched.get(member.id) ?? member.quantity_kg,
      delivered: parseAmount(row.delivered),
      accepted: parseAmount(row.accepted),
    };
    return { member, row, line, result: deliveryLine(line) };
  });
  const totals = deliveryTotals(lines.map((l) => l.line));

  const rowError = (index: number): Partial<Record<keyof Row, string>> => {
    const { line, row, result } = lines[index]!;
    const errs: Partial<Record<keyof Row, string>> = {};
    const server = (field: string) => serverErrors[`items.${index}.${field}`];
    if (server('delivered_kg')) errs.delivered = server('delivered_kg');
    if (server('accepted_kg')) errs.accepted = server('accepted_kg');
    if (server('rejection_reason')) errs.reason = server('rejection_reason');
    if (!submitted) return errs;
    if (line.delivered === null || line.delivered < 0) errs.delivered ??= t('delivery.errDelivered', { defaultValue: 'Enter the weight received.' });
    else if (result.overLimit)
      errs.delivered ??= t('delivery.errOver', { defaultValue: 'At most {{max}} (2 % scale tolerance).', max: formatKg(result.maxDelivered) });
    if (line.accepted === null || line.accepted < 0) errs.accepted ??= t('delivery.errAccepted', { defaultValue: 'Enter the weight accepted.' });
    else if (result.acceptedAboveDelivered) errs.accepted ??= t('delivery.errAcceptedAbove', { defaultValue: 'Cannot exceed delivered.' });
    if ((result.rejected ?? 0) > 0 && !row.reason.trim())
      errs.reason ??= t('delivery.errReason', { defaultValue: 'Say why produce was rejected.' });
    return errs;
  };

  const update = (id: string, field: keyof Row, value: string) => {
    setRows((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { delivered: '', accepted: '', reason: '' }), [field]: value } }));
  };

  const fillDispatched = () => {
    setRows(
      Object.fromEntries(
        lines.map(({ member, line, row }) => [
          member.id,
          { ...row, delivered: String(line.dispatched), accepted: row.accepted || String(line.dispatched) },
        ]),
      ),
    );
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setServerErrors({});
    const invalid = lines.some((_, index) => Object.keys(rowError(index)).length > 0) || !totals.complete;
    // Re-run validation with `submitted` = true for this tick.
    const hasErrors =
      invalid ||
      lines.some(({ line, row, result }) =>
        line.delivered === null ||
        line.accepted === null ||
        line.delivered < 0 ||
        line.accepted < 0 ||
        result.overLimit ||
        result.acceptedAboveDelivered ||
        ((result.rejected ?? 0) > 0 && !row.reason.trim()),
      );
    if (hasErrors) {
      toast.error(t('delivery.fixErrors', { defaultValue: 'Check the highlighted weights before saving.' }));
      return;
    }
    try {
      await record.mutateAsync({
        items: lines.map(({ member, line, row, result }) => ({
          member_id: member.id,
          delivered_kg: round2(line.delivered ?? 0),
          accepted_kg: round2(line.accepted ?? 0),
          rejection_reason: (result.rejected ?? 0) > 0 ? row.reason.trim() : null,
        })),
        inspector_name: inspector.trim() || null,
        notes: notes.trim() || null,
      });
      toast.success(t('delivery.saved', { defaultValue: 'Delivery and quality check recorded' }), {
        description: t('delivery.savedBody', { defaultValue: 'Settlement is now calculated on the accepted weight.' }),
      });
    } catch (error) {
      if (isApiError(error) && Object.keys(error.fieldErrors).length > 0) setServerErrors(error.fieldErrors);
      toast.error(t('delivery.failed', { defaultValue: 'Could not record the delivery' }), {
        description: apiErrorMessage(error, t),
      });
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-small text-muted">
          {t('delivery.intro', {
            defaultValue:
              'Weigh each farmer’s produce on arrival, then record what passed your quality check. Rejected weight needs a reason — farmers see it.',
          })}
        </p>
        <Button type="button" variant="secondary" size="sm" onClick={fillDispatched}>
          {t('delivery.fill', { defaultValue: 'Fill with dispatched weights' })}
        </Button>
      </div>

      <ul className="divide-y divide-line border-y border-line">
        {lines.map(({ member, row, line, result }, index) => {
          const errs = rowError(index);
          const rejected = result.rejected ?? 0;
          return (
            <li key={member.id} className="grid gap-5 py-6 lg:grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,0.8fr))_minmax(0,1.4fr)] lg:items-start">
              <div className="min-w-0">
                <p className="font-display text-h3 font-normal text-ink">{member.farmer_name}</p>
                <p className="mt-1 text-small text-muted">
                  {member.village ? `${member.village} · ` : ''}
                  {t('delivery.dispatched', { defaultValue: 'Dispatched' })} <Quantity kg={line.dispatched} />
                </p>
                <p className="mt-2 flex flex-wrap gap-x-3 text-micro tabular-nums" aria-live="polite">
                  {result.shortage !== null && result.shortage > 0 ? (
                    <span className="text-warning-ink">
                      {t('delivery.shortage', { defaultValue: 'Short {{kg}}', kg: formatKg(result.shortage) })}
                    </span>
                  ) : null}
                  {rejected > 0 ? (
                    <span className="text-danger-ink">{t('delivery.rejected', { defaultValue: 'Rejected {{kg}}', kg: formatKg(rejected) })}</span>
                  ) : null}
                </p>
              </div>
              <Field label={t('delivery.deliveredKg', { defaultValue: 'Delivered' })} error={errs.delivered} required>
                <Input inputMode="decimal" autoComplete="off" trailing="kg" value={row.delivered} onChange={(e) => update(member.id, 'delivered', e.target.value)} />
              </Field>
              <Field label={t('delivery.acceptedKg', { defaultValue: 'Accepted' })} error={errs.accepted} required>
                <Input inputMode="decimal" autoComplete="off" trailing="kg" value={row.accepted} onChange={(e) => update(member.id, 'accepted', e.target.value)} />
              </Field>
              <Field
                label={t('delivery.reason', { defaultValue: 'Rejection reason' })}
                error={errs.reason}
                optional={rejected <= 0}
                required={rejected > 0}
              >
                <Input
                  autoComplete="off"
                  placeholder={rejected > 0 ? t('delivery.reasonPlaceholder', { defaultValue: 'e.g. bruising, moisture above spec' }) : undefined}
                  value={row.reason}
                  onChange={(e) => update(member.id, 'reason', e.target.value)}
                />
              </Field>
            </li>
          );
        })}
      </ul>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-5" aria-live="polite">
        {(
          [
            ['dispatched', t('delivery.totalDispatched', { defaultValue: 'Dispatched' }), totals.dispatched, ''],
            ['delivered', t('delivery.totalDelivered', { defaultValue: 'Delivered' }), totals.delivered, ''],
            ['accepted', t('delivery.totalAccepted', { defaultValue: 'Accepted' }), totals.accepted, 'text-forest-800'],
            ['rejected', t('delivery.totalRejected', { defaultValue: 'Rejected' }), totals.rejected, totals.rejected > 0 ? 'text-danger-ink' : ''],
            ['shortage', t('delivery.totalShortage', { defaultValue: 'Shortage' }), totals.shortage, totals.shortage > 0 ? 'text-warning-ink' : ''],
          ] as const
        ).map(([id, label, value, tone]) => (
          <div key={id} className={cn('bg-paper px-5 py-5', id === 'shortage' && 'col-span-2 sm:col-span-1')}>
            <dt className="text-[13px] font-semibold text-muted">{label}</dt>
            <dd className={cn('mt-2 font-display text-h3 font-bold tabular-nums text-ink', tone)}>
              <Quantity kg={value} />
            </dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t('delivery.inspector', { defaultValue: 'Quality inspector' })} optional>
          <Input autoComplete="name" value={inspector} onChange={(e) => setInspector(e.target.value)} />
        </Field>
        <Field label={t('delivery.notes', { defaultValue: 'Notes' })} optional className="sm:col-span-2">
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <p className="text-small text-muted">
          {t('delivery.payable', { defaultValue: 'You will be invoiced for accepted weight only.' })}
        </p>
        <Button type="submit" loading={record.isPending} leadingIcon={<ClipboardCheck strokeWidth={1.25} aria-hidden />}>
          {t('delivery.submit', { defaultValue: 'Record delivery' })}
        </Button>
      </div>
    </form>
  );
}
