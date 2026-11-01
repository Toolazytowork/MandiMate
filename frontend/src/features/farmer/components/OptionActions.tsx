import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Check, MessagesSquare, X } from 'lucide-react';

import { Button, Dialog, Field, Input, LinkButton, Textarea, toast } from '@/components/ui';
import { AiSourceBadge, CertaintyBadge, ConfirmDialog, Money } from '@/components/domain';
import { isApiError } from '@/lib/api';
import type { SellingOption, UUID } from '@/types/api';

import { useAcceptOffer, useCounterOffer, useCounterSuggestion, useErrorToast, useRejectOffer } from '../hooks';
import { estimateNetAtPrice, parseAmount } from '../lib';

/** A direct offer on the farmer's own harvest that waits for the farmer (offer.awaiting === 'seller'). */
export function canRespondToOption(option: Pick<SellingOption, 'source' | 'offer_status' | 'awaiting'>): boolean {
  return option.source === 'direct_offer' && option.offer_status === 'pending' && option.awaiting === 'seller';
}

export interface OptionActionsProps {
  option: SellingOption;
  harvestId: UUID;
}

/**
 * The buttons under one selling option. Direct offers waiting for the farmer get accept / counter /
 * reject; pooled deals link to the offer (where consent is given) and the lot; the mandi baseline
 * has no action — it is the yardstick.
 */
export function OptionActions({ option, harvestId }: OptionActionsProps) {
  const { t } = useTranslation('farmer');
  const [dialog, setDialog] = useState<'accept' | 'counter' | 'reject' | null>(null);
  const accept = useAcceptOffer();
  const reject = useRejectOffer();
  const onError = useErrorToast();

  if (option.source === 'baseline') {
    return (
      <p className="text-xs leading-relaxed text-muted">
        {t('options.baselineNote', { defaultValue: 'What you would keep selling alone at the mandi — the yardstick for every offer.' })}
      </p>
    );
  }

  const offerLink = `/app/farmer/offers/${option.option_id}`;

  if (option.source === 'pooled_offer') {
    const needsYou = option.offer_status === 'proposed' && option.awaiting === 'farmers';
    return (
      <div className="flex flex-wrap gap-2">
        <LinkButton to={offerLink} variant={needsYou ? 'primary' : 'secondary'} className="h-12" trailingIcon={<ArrowRight strokeWidth={1.25} className="size-4" />}>
          {needsYou
            ? t('options.reviewPooled', { defaultValue: 'Review and decide' })
            : t('options.viewPooled', { defaultValue: 'View pooled deal' })}
        </LinkButton>
        {option.lot_id ? (
          <LinkButton to={`/app/farmer/lots/${option.lot_id}`} variant="ghost" className="h-12">
            {t('options.viewLot', { defaultValue: 'See the lot' })}
          </LinkButton>
        ) : null}
      </div>
    );
  }

  if (!canRespondToOption(option)) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {option.awaiting === 'buyer' && option.offer_status === 'pending' ? (
          <p className="text-sm text-muted">{t('options.waitingBuyer', { defaultValue: 'Waiting for the buyer to reply.' })}</p>
        ) : null}
        <LinkButton to={offerLink} variant="ghost" className="h-12" trailingIcon={<ArrowRight strokeWidth={1.25} className="size-4" />}>
          {t('options.viewOffer', { defaultValue: 'View offer' })}
        </LinkButton>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
        <Button className="h-12" leadingIcon={<Check strokeWidth={1.25} className="size-4" />} onClick={() => setDialog('accept')}>
          {t('options.accept', { defaultValue: 'Accept' })}
        </Button>
        <Button variant="secondary" className="h-12" leadingIcon={<MessagesSquare strokeWidth={1.25} className="size-4" />} onClick={() => setDialog('counter')}>
          {t('options.counter', { defaultValue: 'Counter' })}
        </Button>
        <Button variant="ghost" className="h-12" leadingIcon={<X strokeWidth={1.25} className="size-4" />} onClick={() => setDialog('reject')}>
          {t('options.reject', { defaultValue: 'Reject' })}
        </Button>
      </div>

      <ConfirmDialog
        open={dialog === 'accept'}
        onOpenChange={(open) => setDialog(open ? 'accept' : null)}
        title={t('options.acceptTitle', { defaultValue: 'Accept this offer?' })}
        description={t('options.acceptBody', {
          defaultValue: '{{buyer}} buys at this price. We then arrange pickup and track the payment for you.',
          buyer: option.buyer_name ?? t('options.theBuyer', { defaultValue: 'The buyer' }),
        })}
        confirmLabel={t('options.acceptConfirm', { defaultValue: 'Yes, accept' })}
        loading={accept.isPending}
        onConfirm={() =>
          accept.mutate(
            { offerId: option.option_id },
            {
              onSuccess: () => {
                toast.success(t('options.accepted', { defaultValue: 'Offer accepted. We will plan the pickup next.' }));
                setDialog(null);
              },
              onError,
            },
          )
        }
      >
        <NetSummary option={option} />
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'reject'}
        onOpenChange={(open) => setDialog(open ? 'reject' : null)}
        tone="danger"
        title={t('options.rejectTitle', { defaultValue: 'Reject this offer?' })}
        description={t('options.rejectBody', { defaultValue: 'The buyer is told you said no. Your harvest stays listed for other offers.' })}
        confirmLabel={t('options.rejectConfirm', { defaultValue: 'Yes, reject' })}
        loading={reject.isPending}
        onConfirm={() =>
          reject.mutate(
            { offerId: option.option_id },
            {
              onSuccess: () => {
                toast.success(t('options.rejected', { defaultValue: 'Offer rejected.' }));
                setDialog(null);
              },
              onError,
            },
          )
        }
      />

      {dialog === 'counter' ? (
        <CounterDialog option={option} harvestId={harvestId} onClose={() => setDialog(null)} />
      ) : null}
    </>
  );
}

function NetSummary({ option }: { option: SellingOption }) {
  const { t } = useTranslation('farmer');
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-y border-line py-5">
      <div>
        <p className="eyebrow">{t('options.youKeep', { defaultValue: 'You take home' })}</p>
        <Money value={option.net_amount} size="xl" className="font-display font-bold text-ink" />
        <p className="mt-1 text-xs text-muted">
          <Money value={option.net_per_kg} perKg size="sm" /> {t('options.net', { defaultValue: 'net' })} ·{' '}
          <Money value={option.gross_price_per_kg} perKg size="sm" tone="muted" /> {t('options.gross', { defaultValue: 'gross' })}
        </p>
      </div>
      <CertaintyBadge certainty={option.confidence} withTooltip />
    </div>
  );
}

function CounterDialog({ option, harvestId, onClose }: { option: SellingOption; harvestId: UUID; onClose: () => void }) {
  const { t } = useTranslation('farmer');
  const suggestion = useCounterSuggestion(option.option_id, harvestId, true);
  const counter = useCounterOffer();
  const onError = useErrorToast();
  const [price, setPrice] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const parsed = parseAmount(price);
  const estimate = parsed !== null && parsed > 0 ? estimateNetAtPrice(option, parsed) : null;
  const tip = suggestion.data;

  const submit = () => {
    if (parsed === null || parsed <= 0) {
      setError(t('counter.priceRequired', { defaultValue: 'Enter the price per kg you want.' }));
      return;
    }
    setError(null);
    counter.mutate(
      { offerId: option.option_id, req: { price_per_kg: parsed, message: message.trim() || null } },
      {
        onSuccess: () => {
          toast.success(t('counter.sent', { defaultValue: 'Counter-offer sent. We will tell you when the buyer replies.' }));
          onClose();
        },
        onError: (err) => {
          if (isApiError(err) && Object.keys(err.fieldErrors).length > 0) {
            setError(err.fieldErrors.price_per_kg ?? err.detail);
          } else onError(err);
        },
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      dismissible={!counter.isPending}
      title={t('counter.title', { defaultValue: 'Ask for a better price' })}
      description={t('counter.body', {
        defaultValue: 'The buyer offered {{price}}/kg. Name your price — we show what you would take home.',
        price: `₹${option.gross_price_per_kg.toFixed(2)}`,
      })}
      footer={
        <>
          <Button variant="ghost" className="h-12" onClick={onClose} disabled={counter.isPending}>
            {t('actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button className="h-12" onClick={submit} loading={counter.isPending}>
            {t('counter.send', { defaultValue: 'Send counter-offer' })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="border-s border-gold-400 py-1 ps-5" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] font-semibold text-gold-700">
              {t('counter.suggested', { defaultValue: 'Suggested counter' })}
            </p>
            {tip ? <AiSourceBadge source={tip.source} /> : null}
          </div>
          {suggestion.isPending ? (
            <p className="mt-2 text-sm text-muted">{t('counter.thinking', { defaultValue: 'Working out a fair price…' })}</p>
          ) : tip ? (
            <>
              <p className="mt-2 font-display text-2xl font-bold text-ink">
                <Money value={tip.suggested_price_per_kg} perKg size="lg" />
              </p>
              <p className="mt-1 text-sm font-normal leading-relaxed text-ink-2">{tip.rationale}</p>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-[13px] font-semibold text-muted">
                {tip.market_reference_per_kg !== null ? (
                  <div>
                    <dt>{t('counter.market', { defaultValue: 'Mandi today' })}</dt>
                    <dd className="mt-1 normal-case tracking-normal text-ink"><Money value={tip.market_reference_per_kg} perKg size="sm" /></dd>
                  </div>
                ) : null}
                {tip.floor_price_per_kg !== null ? (
                  <div>
                    <dt>{t('counter.floor', { defaultValue: 'Your minimum' })}</dt>
                    <dd className="mt-1 normal-case tracking-normal text-ink"><Money value={tip.floor_price_per_kg} perKg size="sm" /></dd>
                  </div>
                ) : null}
              </dl>
              <Button variant="secondary" className="mt-4 h-12" onClick={() => setPrice(String(tip.suggested_price_per_kg))}>
                {t('counter.use', { defaultValue: 'Use this price' })}
              </Button>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">{t('counter.noTip', { defaultValue: 'No suggestion right now. Use the mandi price as your guide.' })}</p>
          )}
        </div>

        <Field label={t('counter.price', { defaultValue: 'Your price per kg' })} error={error} required>
          <Input
            inputMode="decimal"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            leading="₹"
            trailing="/kg"
            placeholder={option.gross_price_per_kg.toFixed(2)}
          />
        </Field>

        {estimate ? (
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-y border-line py-4" aria-live="polite">
            <span className="text-sm text-muted">{t('counter.wouldKeep', { defaultValue: 'You would take home about' })}</span>
            <span className="text-end">
              <Money value={estimate.net} size="lg" className="font-display font-bold text-ink" />
              <span className="block text-xs text-muted">
                <Money value={estimate.netPerKg} perKg size="sm" /> {t('options.net', { defaultValue: 'net' })}
              </span>
            </span>
          </div>
        ) : null}

        <Field label={t('counter.message', { defaultValue: 'Message to the buyer' })} optional>
          <Textarea rows={2} value={message} onChange={(event) => setMessage(event.target.value)} maxLength={300} />
        </Field>
      </div>
    </Dialog>
  );
}
