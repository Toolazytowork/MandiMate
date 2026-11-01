import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { Button, Dialog, Field, Input, Textarea, toast } from '@/components/ui';
import { parseAmount } from '@/features/buyer/utils';
import { apiErrorMessage, applyFieldErrors } from '@/features/shared/forms';
import { formatPerKg } from '@/lib/format';
import type { Offer } from '@/types/api';

import { useCounterOffer } from '../hooks';

const positive = (value: string) => {
  const parsed = parseAmount(value);
  return parsed !== null && parsed > 0;
};

const schema = z.object({
  price_per_kg: z.string().refine(positive, { message: 'Enter a price above zero.' }),
  quantity_kg: z.string().refine((v) => v.trim() === '' || positive(v), { message: 'Enter a quantity above zero.' }),
  payment_terms_days: z
    .string()
    .refine((v) => v.trim() === '' || (parseAmount(v) !== null && (parseAmount(v) ?? -1) >= 0 && (parseAmount(v) ?? 0) <= 90), {
      message: 'Use 0–90 days.',
    }),
  message: z.string().max(500, { message: 'Keep the note under 500 characters.' }),
});

type Values = z.infer<typeof schema>;

export interface CounterDialogProps {
  offer: Offer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CounterDialog({ offer, open, onOpenChange }: CounterDialogProps) {
  const { t } = useTranslation('buyerOrders');
  const counter = useCounterOffer(offer.id);
  const defaults = (): Values => ({
    price_per_kg: String(offer.price_per_kg),
    quantity_kg: String(offer.quantity_kg),
    payment_terms_days: String(offer.payment_terms_days),
    message: '',
  });
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults() });

  useEffect(() => {
    if (open) reset(defaults());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, offer.id, offer.updated_at]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await counter.mutateAsync({
        price_per_kg: parseAmount(values.price_per_kg) ?? offer.price_per_kg,
        quantity_kg: values.quantity_kg.trim() ? parseAmount(values.quantity_kg) : null,
        payment_terms_days: values.payment_terms_days.trim() ? parseAmount(values.payment_terms_days) : null,
        message: values.message.trim() || null,
      });
      toast.success(t('counter.sent', { defaultValue: 'Counter-offer sent' }), {
        description: t('counter.sentBody', { defaultValue: 'The seller has been notified and can accept or reply.' }),
      });
      onOpenChange(false);
    } catch (error) {
      const placed = applyFieldErrors(error, setError, {
        fields: ['price_per_kg', 'quantity_kg', 'payment_terms_days', 'message'],
      });
      if (placed.length === 0) {
        toast.error(t('counter.failed', { defaultValue: 'Could not send the counter-offer' }), {
          description: apiErrorMessage(error, t),
        });
      }
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('counter.title', { defaultValue: 'Counter with new terms' })}
      description={t('counter.description', {
        defaultValue: 'Current terms: {{price}} for {{kg}} kg. Change what you need — the seller replies next.',
        price: formatPerKg(offer.price_per_kg),
        kg: offer.quantity_kg.toLocaleString('en-IN'),
      })}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={counter.isPending}>
            {t('actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button type="submit" form="buyer-counter-form" loading={counter.isPending}>
            {t('counter.submit', { defaultValue: 'Send counter' })}
          </Button>
        </>
      }
    >
      <form id="buyer-counter-form" onSubmit={onSubmit} className="grid gap-5 sm:grid-cols-2" noValidate>
        <Field label={t('counter.price', { defaultValue: 'Price per kg' })} error={errors.price_per_kg?.message} required className="sm:col-span-2">
          <Input inputMode="decimal" autoComplete="off" leading="₹" trailing="/kg" size="lg" className="font-display font-bold" {...register('price_per_kg')} />
        </Field>
        <Field label={t('counter.quantity', { defaultValue: 'Quantity' })} error={errors.quantity_kg?.message} optional>
          <Input inputMode="decimal" autoComplete="off" trailing="kg" {...register('quantity_kg')} />
        </Field>
        <Field label={t('counter.terms', { defaultValue: 'Payment terms' })} error={errors.payment_terms_days?.message} optional>
          <Input inputMode="numeric" autoComplete="off" trailing={t('units.days', { defaultValue: 'days' })} {...register('payment_terms_days')} />
        </Field>
        <Field label={t('counter.message', { defaultValue: 'Note to the seller' })} error={errors.message?.message} optional className="sm:col-span-2">
          <Textarea rows={3} {...register('message')} />
        </Field>
      </form>
    </Dialog>
  );
}
