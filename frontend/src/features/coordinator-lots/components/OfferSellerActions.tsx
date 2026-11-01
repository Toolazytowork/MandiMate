import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Reply, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { ConfirmDialog, Money, Quantity } from '@/components/domain';
import { Button, Dialog, Field, Input, Textarea, toast } from '@/components/ui';
import { useAcceptOffer, useCounterOffer, useRejectOffer } from '@/features/coordinator/hooks';
import { applyFieldErrors, errorMessage } from '@/features/coordinator/utils';
import type { Offer } from '@/types/api';

/** Seller side (coordinator) may act only while the buyer's offer waits on the seller. */
export function canSellerAct(offer: Offer): boolean {
  return offer.status === 'pending' && offer.awaiting === 'seller';
}

interface CounterValues {
  price_per_kg: string;
  quantity_kg: string;
  payment_terms_days: string;
  message: string;
}

const COUNTER_FIELDS = ['price_per_kg', 'quantity_kg', 'payment_terms_days', 'message'] as const;

function num(value: string): number {
  return Number(value.replace(/,/g, '').trim());
}

export interface CounterOfferDialogProps {
  offer: Offer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPrice?: number | null;
}

export function CounterOfferDialog({ offer, open, onOpenChange, initialPrice }: CounterOfferDialogProps) {
  const { t } = useTranslation('coordinatorLots');
  const counter = useCounterOffer();
  const schema = useMemo(
    () =>
      z.object({
        price_per_kg: z
          .string()
          .trim()
          .min(1, t('counter.priceRequired', { defaultValue: 'Enter your counter price' }))
          .refine((v) => Number.isFinite(num(v)) && num(v) > 0, t('counter.priceInvalid', { defaultValue: 'Price must be above ₹0' })),
        quantity_kg: z
          .string()
          .trim()
          .refine((v) => v === '' || (Number.isFinite(num(v)) && num(v) > 0), t('counter.qtyInvalid', { defaultValue: 'Enter a positive quantity' })),
        payment_terms_days: z
          .string()
          .trim()
          .refine(
            (v) => v === '' || (Number.isInteger(num(v)) && num(v) >= 0 && num(v) <= 120),
            t('counter.termsInvalid', { defaultValue: 'Whole days between 0 and 120' }),
          ),
        message: z.string().max(500, t('counter.messageTooLong', { defaultValue: 'Keep the note under 500 characters' })),
      }),
    [t],
  );

  const defaults = (): CounterValues => ({
    price_per_kg: String(initialPrice ?? offer.price_per_kg),
    quantity_kg: '',
    payment_terms_days: '',
    message: '',
  });

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<CounterValues>({ resolver: zodResolver(schema), defaultValues: defaults() });

  useEffect(() => {
    if (open) reset(defaults());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPrice, offer.id]);

  const onSubmit = handleSubmit((values) => {
    counter.mutate(
      {
        id: offer.id,
        req: {
          price_per_kg: num(values.price_per_kg),
          quantity_kg: values.quantity_kg ? num(values.quantity_kg) : null,
          payment_terms_days: values.payment_terms_days ? num(values.payment_terms_days) : null,
          message: values.message.trim() || null,
        },
      },
      {
        onSuccess: () => {
          toast.success(t('counter.sent', { defaultValue: 'Counter-offer sent to {{buyer}}', buyer: offer.buyer_name }));
          onOpenChange(false);
        },
        onError: (error) => {
          if (!applyFieldErrors(error, setError, COUNTER_FIELDS)) toast.error(errorMessage(error));
        },
      },
    );
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      dismissible={!counter.isPending}
      title={t('counter.title', { defaultValue: 'Counter {{buyer}}', buyer: offer.buyer_name })}
      description={
        <>
          {t('counter.current', { defaultValue: 'Current offer' })}: <Money value={offer.price_per_kg} perKg size="sm" /> ·{' '}
          <Quantity kg={offer.quantity_kg} size="sm" />
        </>
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={counter.isPending}>
            {t('actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button type="submit" form="lot-counter-form" loading={counter.isPending} leadingIcon={<Reply strokeWidth={1.25} aria-hidden="true" />}>
            {t('counter.submit', { defaultValue: 'Send counter' })}
          </Button>
        </>
      }
    >
      <form id="lot-counter-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label={t('counter.price', { defaultValue: 'Price per kg' })} error={errors.price_per_kg?.message} required>
          <Input inputMode="decimal" leading="₹" trailing="/kg" autoComplete="off" {...register('price_per_kg')} />
        </Field>
        <Field
          label={t('counter.quantity', { defaultValue: 'Quantity' })}
          hint={t('counter.quantityHint', { defaultValue: 'Leave blank to keep {{kg}} kg', kg: offer.quantity_kg })}
          error={errors.quantity_kg?.message}
          optional
        >
          <Input inputMode="decimal" trailing="kg" autoComplete="off" {...register('quantity_kg')} />
        </Field>
        <Field
          label={t('counter.terms', { defaultValue: 'Payment within' })}
          hint={t('counter.termsHint', { defaultValue: 'Currently {{days}} days', days: offer.payment_terms_days })}
          error={errors.payment_terms_days?.message}
          optional
        >
          <Input inputMode="numeric" trailing={t('units.days', { defaultValue: 'days' })} autoComplete="off" {...register('payment_terms_days')} />
        </Field>
        <Field label={t('counter.message', { defaultValue: 'Note to buyer' })} error={errors.message?.message} optional className="sm:col-span-2">
          <Textarea rows={3} {...register('message')} />
        </Field>
      </form>
    </Dialog>
  );
}

export interface OfferSellerActionsProps {
  offer: Offer;
  /** Pre-fills the counter dialog (e.g. from the AI counter suggestion). */
  suggestedPrice?: number | null;
  size?: 'sm' | 'md';
  /** Opens the counter dialog from outside (controlled). */
  counterOpen?: boolean;
  onCounterOpenChange?: (open: boolean) => void;
  className?: string;
}

/** Counter / accept / reject for the seller side of a lot offer. Renders nothing when it is not the seller's turn. */
export function OfferSellerActions({ offer, suggestedPrice, size = 'sm', counterOpen, onCounterOpenChange, className }: OfferSellerActionsProps) {
  const { t } = useTranslation('coordinatorLots');
  const [localCounter, setLocalCounter] = useState(false);
  const [confirm, setConfirm] = useState<'accept' | 'reject' | null>(null);
  const [note, setNote] = useState('');
  const accept = useAcceptOffer();
  const reject = useRejectOffer();

  const isCounterOpen = counterOpen ?? localCounter;
  const setCounterOpen = onCounterOpenChange ?? setLocalCounter;

  if (!canSellerAct(offer)) return null;

  const run = (kind: 'accept' | 'reject') => {
    const mutation = kind === 'accept' ? accept : reject;
    return mutation.mutateAsync(
      { id: offer.id, req: { message: note.trim() || null } },
      {
        onSuccess: () => {
          toast.success(
            kind === 'accept'
              ? t('accept.done', { defaultValue: 'Accepted — farmers are now asked to consent' })
              : t('reject.done', { defaultValue: 'Offer rejected' }),
          );
          setConfirm(null);
          setNote('');
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  return (
    <div className={className ?? 'flex flex-wrap items-center gap-2'}>
      <Button size={size} variant="primary" leadingIcon={<Check strokeWidth={1.25} aria-hidden="true" />} onClick={() => setConfirm('accept')}>
        {t('actions.accept', { defaultValue: 'Accept' })}
      </Button>
      <Button size={size} variant="secondary" leadingIcon={<Reply strokeWidth={1.25} aria-hidden="true" />} onClick={() => setCounterOpen(true)}>
        {t('actions.counter', { defaultValue: 'Counter' })}
      </Button>
      <Button size={size} variant="ghost" leadingIcon={<X strokeWidth={1.25} aria-hidden="true" />} onClick={() => setConfirm('reject')}>
        {t('actions.reject', { defaultValue: 'Reject' })}
      </Button>

      <CounterOfferDialog offer={offer} open={isCounterOpen} onOpenChange={setCounterOpen} initialPrice={suggestedPrice} />

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        tone={confirm === 'reject' ? 'danger' : 'primary'}
        title={
          confirm === 'accept'
            ? t('accept.title', { defaultValue: 'Accept {{price}}/kg from {{buyer}}?', price: `₹${offer.price_per_kg}`, buyer: offer.buyer_name })
            : t('reject.title', { defaultValue: 'Reject the offer from {{buyer}}?', buyer: offer.buyer_name })
        }
        description={
          confirm === 'accept'
            ? t('accept.description', {
                defaultValue: 'The deal becomes a proposal. Every member farmer must consent before it is final — you can record consent for farmers who confirm by phone.',
              })
            : t('reject.description', { defaultValue: 'The buyer is told the lot declined. Other offers stay open.' })
        }
        confirmLabel={confirm === 'accept' ? t('actions.accept', { defaultValue: 'Accept' }) : t('actions.reject', { defaultValue: 'Reject' })}
        loading={accept.isPending || reject.isPending}
        onConfirm={() => (confirm ? run(confirm) : undefined)}
      >
        <Field label={t('actions.note', { defaultValue: 'Message to buyer' })} optional>
          <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} />
        </Field>
      </ConfirmDialog>
    </div>
  );
}
