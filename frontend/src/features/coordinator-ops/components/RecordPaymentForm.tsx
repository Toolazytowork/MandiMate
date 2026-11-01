import { zodResolver } from '@hookform/resolvers/zod';
import { IndianRupee } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { Button, Field, Input, toast } from '@/components/ui';
import { formatINR, todayIST } from '@/lib/format';
import type { Settlement } from '@/types/api';

import { useRecordPayment } from '../hooks';
import { applyFieldErrors, errorMessage, outstanding } from '../utils';

type Values = { amount: number; reference: string; paid_at: string };
const FIELDS = ['amount', 'reference', 'paid_at'] as const;

/** Records money received from the buyer against a settlement. */
export function RecordPaymentForm({ settlement }: { settlement: Settlement }) {
  const { t } = useTranslation('coordinatorOps');
  const record = useRecordPayment(settlement.id);
  const due = outstanding(settlement);
  const today = todayIST();

  const schema = z.object({
    amount: z
      .number({ error: t('payment.amountRequired', { defaultValue: 'Enter the amount received' }) })
      .positive(t('payment.amountPositive', { defaultValue: 'Amount must be more than zero' }))
      .max(due > 0 ? due : Number.MAX_SAFE_INTEGER, t('payment.amountMax', { defaultValue: 'More than the outstanding {{due}}', due: formatINR(due) })),
    reference: z.string().trim().max(120),
    paid_at: z.string().min(1, t('payment.dateRequired', { defaultValue: 'Pick the date received' })).refine((v) => v <= today, {
      message: t('payment.dateFuture', { defaultValue: 'Date cannot be in the future' }),
    }),
  });

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { amount: due || undefined, reference: '', paid_at: today },
  });
  const { register, handleSubmit, formState, setError, reset } = form;

  const onSubmit = handleSubmit((values) =>
    record
      .mutateAsync({
        amount: values.amount,
        reference: values.reference.trim() || null,
        paid_at: `${values.paid_at}T12:00:00+05:30`,
      })
      .then((next) => {
        toast.success(t('payment.recorded', { defaultValue: '{{amount}} recorded from {{buyer}}', amount: formatINR(values.amount), buyer: settlement.buyer_name }));
        reset({ amount: outstanding(next) || undefined, reference: '', paid_at: today });
      })
      .catch((error: unknown) => {
        if (!applyFieldErrors(error, setError, FIELDS)) toast.error(errorMessage(error));
      }),
  );

  if (due <= 0) {
    return (
      <p className="rounded-card border border-line bg-parchment/50 p-4 text-small text-forest-700">
        {t('payment.settled', { defaultValue: 'The buyer has paid in full.' })}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <Field label={t('payment.amount', { defaultValue: 'Amount received' })} error={formState.errors.amount?.message} required>
        <Input type="number" inputMode="decimal" step="0.01" min={0} leading={<IndianRupee strokeWidth={1.25} className="size-4" aria-hidden />} {...register('amount', { valueAsNumber: true })} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('payment.date', { defaultValue: 'Received on' })} error={formState.errors.paid_at?.message} required>
          <Input type="date" max={today} {...register('paid_at')} />
        </Field>
        <Field label={t('payment.reference', { defaultValue: 'UTR / reference' })} error={formState.errors.reference?.message} optional>
          <Input autoComplete="off" {...register('reference')} />
        </Field>
      </div>
      <Button type="submit" loading={record.isPending} fullWidth>
        {t('payment.submit', { defaultValue: 'Record buyer payment' })}
      </Button>
    </form>
  );
}
