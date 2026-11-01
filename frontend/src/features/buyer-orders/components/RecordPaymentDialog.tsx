import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { Button, Dialog, Field, Input, toast } from '@/components/ui';
import { outstandingAmount, paidAtFromDate, parseAmount, round2 } from '@/features/buyer/utils';
import { apiErrorMessage, applyFieldErrors } from '@/features/shared/forms';
import { formatINR, todayIST } from '@/lib/format';
import type { Settlement } from '@/types/api';

import { useRecordPayment } from '../hooks';

export interface RecordPaymentDialogProps {
  settlement: Settlement | null;
  onOpenChange: (open: boolean) => void;
}

function buildSchema(max: number, today: string) {
  return z.object({
    amount: z.string().refine(
      (v) => {
        const n = parseAmount(v);
        return n !== null && n > 0 && n <= max + 0.01;
      },
      { message: `Enter an amount between ₹1 and ${formatINR(max)}.` },
    ),
    reference: z.string().max(80, { message: 'Keep the reference under 80 characters.' }),
    paid_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Pick the payment date.' })
      .refine((v) => v <= today, { message: 'The payment date cannot be in the future.' }),
  });
}

type Values = { amount: string; reference: string; paid_on: string };

export function RecordPaymentDialog({ settlement, onOpenChange }: RecordPaymentDialogProps) {
  const { t } = useTranslation('buyerOrders');
  const record = useRecordPayment();
  const today = todayIST();
  const owed = settlement ? outstandingAmount(settlement) : 0;
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(buildSchema(owed, today)),
    defaultValues: { amount: '', reference: '', paid_on: today },
  });

  useEffect(() => {
    if (settlement) reset({ amount: String(outstandingAmount(settlement)), reference: '', paid_on: today });
  }, [settlement, reset, today]);

  const onSubmit = handleSubmit(async (values) => {
    if (!settlement) return;
    try {
      await record.mutateAsync({
        id: settlement.id,
        req: {
          amount: round2(parseAmount(values.amount) ?? 0),
          reference: values.reference.trim() || null,
          paid_at: paidAtFromDate(values.paid_on, today),
        },
      });
      toast.success(t('payments.recorded', { defaultValue: 'Payment recorded' }), {
        description: t('payments.recordedBody', {
          defaultValue: '{{amount}} logged against {{code}}. Farmers see the update immediately.',
          amount: formatINR(parseAmount(values.amount)),
          code: settlement.code,
        }),
      });
      onOpenChange(false);
    } catch (error) {
      const placed = applyFieldErrors(error, setError, {
        fields: ['amount', 'reference'],
        aliases: { paid_at: 'paid_on' },
      });
      if (placed.length === 0) {
        toast.error(t('payments.failed', { defaultValue: 'Could not record the payment' }), {
          description: apiErrorMessage(error, t),
        });
      }
    }
  });

  return (
    <Dialog
      open={settlement !== null}
      onOpenChange={onOpenChange}
      title={t('payments.recordTitle', { defaultValue: 'Record a payment' })}
      description={
        settlement
          ? t('payments.recordDescription', {
              defaultValue: '{{code}} · {{lot}} — {{owed}} outstanding of {{gross}}.',
              code: settlement.code,
              lot: settlement.lot_code,
              owed: formatINR(owed),
              gross: formatINR(settlement.gross_amount),
            })
          : undefined
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={record.isPending}>
            {t('actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button type="submit" form="buyer-payment-form" loading={record.isPending}>
            {t('payments.recordSubmit', { defaultValue: 'Record payment' })}
          </Button>
        </>
      }
    >
      <form id="buyer-payment-form" onSubmit={onSubmit} className="grid gap-5 sm:grid-cols-2" noValidate>
        <Field label={t('payments.amount', { defaultValue: 'Amount paid' })} error={errors.amount?.message} required className="sm:col-span-2">
          <Input inputMode="decimal" autoComplete="off" leading="₹" size="lg" className="font-display font-bold" {...register('amount')} />
        </Field>
        <Field
          label={t('payments.reference', { defaultValue: 'Bank / UTR reference' })}
          hint={t('payments.referenceHint', { defaultValue: 'Helps farmers and coordinators match the transfer.' })}
          error={errors.reference?.message}
          optional
        >
          <Input autoComplete="off" {...register('reference')} />
        </Field>
        <Field label={t('payments.date', { defaultValue: 'Paid on' })} error={errors.paid_on?.message} required>
          <Input type="date" max={today} {...register('paid_on')} />
        </Field>
      </form>
    </Dialog>
  );
}
