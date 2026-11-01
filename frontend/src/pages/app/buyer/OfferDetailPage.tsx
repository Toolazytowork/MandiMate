import { ArrowRight, Check, CornerUpLeft, Undo2, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import {
  AwaitingBadge,
  ConfirmDialog,
  ConsentPanel,
  GradeBadge,
  Money,
  NegotiationThread,
  PageHeader,
  QueryState,
  Quantity,
  SectionCard,
  StatusBadge,
  ValidityCountdown,
} from '@/components/domain';
import { Reveal } from '@/components/motion';
import { Button, LinkButton, Progress, Textarea, Field, toast } from '@/components/ui';
import { buyerOfferActions, landedCost, lastBuyerPrice } from '@/features/buyer/utils';
import { CounterDialog } from '@/features/buyer-orders/components/CounterDialog';
import { useBuyerOffer, useOfferAction, type OfferAction } from '@/features/buyer-orders/hooks';
import { apiErrorMessage } from '@/features/shared/forms';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatPct, formatPerKg } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { Offer } from '@/types/api';

function Term({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line pt-4">
      <dt className="text-[13px] font-semibold text-muted">{label}</dt>
      <dd className="mt-2 text-body text-ink">{children}</dd>
    </div>
  );
}

function OfferBody({ offer }: { offer: Offer }) {
  const { t } = useTranslation('buyerOrders');
  const { user } = useAuth();
  const actions = buyerOfferActions(offer);
  const action = useOfferAction(offer.id);
  const [counterOpen, setCounterOpen] = useState(false);
  const [confirm, setConfirm] = useState<OfferAction | null>(null);
  const [note, setNote] = useState('');
  const cost = landedCost({ pricePerKg: offer.price_per_kg, quantityKg: offer.quantity_kg, maxRejectionPct: offer.max_rejection_pct });
  const previous = lastBuyerPrice(offer);
  const consented = offer.consents.filter((c) => c.decision === 'accepted').length;
  const consentPct = offer.consents.length > 0 ? (consented / offer.consents.length) * 100 : 0;
  const showConsent = offer.target_type === 'lot' && offer.consents.length > 0;
  const anyAction = actions.acceptCounter || actions.counter || actions.reject || actions.withdraw;

  const copy: Record<OfferAction, { title: string; body: string; label: string; done: string; tone: 'primary' | 'danger' | 'gold' }> = {
    accept: {
      title: t('detail.acceptTitle', { defaultValue: 'Accept the seller’s terms?' }),
      body: t('detail.acceptBody', {
        defaultValue: 'You commit to buy {{kg}} kg at {{price}}, paid within {{days}} days of delivery.',
        kg: offer.quantity_kg.toLocaleString('en-IN'),
        price: formatPerKg(offer.price_per_kg),
        days: offer.payment_terms_days,
      }),
      label: t('detail.accept', { defaultValue: 'Accept terms' }),
      done: t('detail.accepted', { defaultValue: 'Terms accepted' }),
      tone: 'primary',
    },
    reject: {
      title: t('detail.rejectTitle', { defaultValue: 'Reject this counter-offer?' }),
      body: t('detail.rejectBody', { defaultValue: 'The negotiation ends. You can make a fresh offer later.' }),
      label: t('detail.reject', { defaultValue: 'Reject' }),
      done: t('detail.rejected', { defaultValue: 'Counter-offer rejected' }),
      tone: 'danger',
    },
    withdraw: {
      title: t('detail.withdrawTitle', { defaultValue: 'Withdraw your offer?' }),
      body: t('detail.withdrawBody', { defaultValue: 'The seller and any consenting farmers are told the offer is off the table.' }),
      label: t('detail.withdraw', { defaultValue: 'Withdraw offer' }),
      done: t('detail.withdrawn', { defaultValue: 'Offer withdrawn' }),
      tone: 'danger',
    },
  };

  const run = async () => {
    if (!confirm) return;
    try {
      await action.mutateAsync({ action: confirm, req: { message: note.trim() || null } });
      toast.success(copy[confirm].done);
      setConfirm(null);
      setNote('');
    } catch (error) {
      toast.error(t('detail.actionFailed', { defaultValue: 'That did not go through' }), { description: apiErrorMessage(error, t) });
    }
  };

  return (
    <div className="space-y-10">
      <PageHeader
        breadcrumbs={[{ label: t('offers.title', { defaultValue: 'Offers' }), to: '/app/buyer/offers' }, { label: offer.code }]}
        eyebrow={`${offer.code} · ${offer.target_type === 'lot' ? (offer.lot_code ?? t('detail.lot', { defaultValue: 'Pooled lot' })) : t('detail.harvest', { defaultValue: 'Single harvest' })}`}
        title={
          <span className="flex flex-wrap items-baseline gap-x-3">
            {offer.crop_name}
            <GradeBadge grade={offer.grade} />
          </span>
        }
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="offer" value={offer.status} />
            {offer.awaiting ? <AwaitingBadge awaiting={offer.awaiting} /> : null}
            {actions.withdraw ? <ValidityCountdown validUntil={offer.valid_until} /> : null}
          </div>
        }
        actions={
          offer.status === 'accepted' && offer.lot_id ? (
            <LinkButton to={`/app/buyer/orders/${offer.lot_id}`} trailingIcon={<ArrowRight strokeWidth={1.25} aria-hidden />}>
              {t('detail.viewOrder', { defaultValue: 'View order' })}
            </LinkButton>
          ) : null
        }
      />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-8">
          <Reveal>
            <SectionCard
              eyebrow={t('detail.termsEyebrow', { defaultValue: 'Current terms' })}
              title={
                <span className="flex flex-wrap items-baseline gap-3">
                  <Money value={offer.price_per_kg} perKg size="xl" />
                  {previous !== null && Math.abs(previous - offer.price_per_kg) > 0.001 ? (
                    <span className="text-small text-muted">
                      {t('detail.yourLast', { defaultValue: 'your last: {{price}}', price: formatPerKg(previous) })}
                    </span>
                  ) : null}
                </span>
              }
            >
              <dl className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
                <Term label={t('detail.quantity', { defaultValue: 'Quantity' })}>
                  <Quantity kg={offer.quantity_kg} />
                </Term>
                <Term label={t('detail.orderValue', { defaultValue: 'Order value' })}>
                  <Money value={cost.orderValue} />
                  {cost.floorValue !== null ? (
                    <span className="mt-0.5 block text-small text-muted">
                      {t('detail.floor', { defaultValue: 'Floor after max rejection:' })}{' '}
                      <Money value={cost.floorValue} size="sm" />
                    </span>
                  ) : null}
                </Term>
                <Term label={t('detail.pickup', { defaultValue: 'Pickup' })}>
                  {t(`common:enums.pickupTerms.${offer.pickup_terms}`, {
                    defaultValue: offer.pickup_terms === 'buyer_pickup' ? 'Buyer collects' : 'MandiMate delivers',
                  })}
                </Term>
                <Term label={t('detail.payment', { defaultValue: 'Payment' })}>
                  {t('detail.paymentDays', { defaultValue: 'Within {{days}} days of delivery', days: offer.payment_terms_days })}
                </Term>
                <Term label={t('detail.rejection', { defaultValue: 'Max rejection' })}>{formatPct(offer.max_rejection_pct)}</Term>
                <Term label={t('detail.deliverTo', { defaultValue: 'Deliver to' })}>{offer.delivery_location}</Term>
                <Term label={t('detail.handling', { defaultValue: 'Handling charge' })}>{formatPerKg(offer.handling_charge_per_kg)}</Term>
                <Term label={t('detail.validUntil', { defaultValue: 'Valid until' })}>{formatDateTime(offer.valid_until)}</Term>
                {offer.quality_spec ? (
                  <div className="sm:col-span-2">
                    <Term label={t('detail.quality', { defaultValue: 'Quality specification' })}>{offer.quality_spec}</Term>
                  </div>
                ) : null}
              </dl>
            </SectionCard>
          </Reveal>

          <SectionCard
            eyebrow={t('detail.historyEyebrow', { defaultValue: 'Negotiation' })}
            title={t('detail.history', { defaultValue: 'Every move, in order' })}
          >
            <NegotiationThread entries={offer.negotiation} viewerId={user?.id ?? null} />
          </SectionCard>
        </div>

        <aside className="space-y-8 lg:sticky lg:top-24 lg:self-start">
          <SectionCard
            variant={actions.counter ? 'parchment' : undefined}
            eyebrow={t('detail.nextEyebrow', { defaultValue: 'Next step' })}
            title={
              actions.counter
                ? t('detail.yourMove', { defaultValue: 'The seller countered — your move' })
                : offer.awaiting === 'farmers'
                  ? t('detail.farmersMove', { defaultValue: 'Farmers are reviewing your offer' })
                  : offer.awaiting === 'seller'
                    ? t('detail.sellerMove', { defaultValue: 'Waiting on the seller' })
                    : t('detail.closed', { defaultValue: 'This negotiation is closed' })
            }
            description={
              offer.awaiting === 'farmers'
                ? t('detail.farmersBody', {
                    defaultValue: 'Each farmer in the lot sees their own net earnings from your price before consenting.',
                  })
                : undefined
            }
          >
            {anyAction ? (
              <div className="flex flex-col gap-3">
                {actions.acceptCounter ? (
                  <Button variant="primary" fullWidth leadingIcon={<Check strokeWidth={1.25} aria-hidden />} onClick={() => setConfirm('accept')}>
                    {t('detail.acceptCounter', { defaultValue: 'Accept counter at {{price}}', price: formatPerKg(offer.price_per_kg) })}
                  </Button>
                ) : null}
                {actions.counter ? (
                  <Button variant="secondary" fullWidth leadingIcon={<CornerUpLeft strokeWidth={1.25} aria-hidden />} onClick={() => setCounterOpen(true)}>
                    {t('detail.counterBack', { defaultValue: 'Counter back' })}
                  </Button>
                ) : null}
                {actions.reject ? (
                  <Button variant="ghost" fullWidth leadingIcon={<X strokeWidth={1.25} aria-hidden />} onClick={() => setConfirm('reject')}>
                    {t('detail.reject', { defaultValue: 'Reject' })}
                  </Button>
                ) : null}
                {actions.withdraw && !actions.reject ? (
                  <Button variant="ghost" fullWidth leadingIcon={<Undo2 strokeWidth={1.25} aria-hidden />} onClick={() => setConfirm('withdraw')}>
                    {t('detail.withdraw', { defaultValue: 'Withdraw offer' })}
                  </Button>
                ) : null}
                {actions.withdraw && actions.reject ? (
                  <button type="button" className="mx-auto mt-2 inline-flex items-center gap-2 border-b border-ink/30 pb-1 text-[13px] font-semibold text-muted transition-colors hover:border-ink hover:text-ink" onClick={() => setConfirm('withdraw')}>
                    {t('detail.withdraw', { defaultValue: 'Withdraw offer' })}
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="text-small text-muted">
                {offer.status === 'accepted'
                  ? t('detail.acceptedBody', { defaultValue: 'Deal agreed. Track pickup, delivery and payment from the order.' })
                  : t('detail.closedBody', { defaultValue: 'No further action is possible on this offer.' })}
              </p>
            )}
          </SectionCard>

          {showConsent ? (
            <SectionCard eyebrow={t('detail.consentEyebrow', { defaultValue: 'Farmer consent' })} title={t('detail.consentTitle', { defaultValue: '{{n}} of {{total}} farmers agreed', n: consented, total: offer.consents.length })}>
              <Progress
                value={consentPct}
                tone="gold"
                label={t('detail.consentProgress', { defaultValue: 'Consent progress' })}
                valueText={`${consented}/${offer.consents.length}`}
                className="mb-5"
              />
              <ConsentPanel consents={offer.consents} />
            </SectionCard>
          ) : null}
        </aside>
      </div>

      <CounterDialog offer={offer} open={counterOpen} onOpenChange={setCounterOpen} />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm ? copy[confirm].title : ''}
        description={confirm ? copy[confirm].body : undefined}
        confirmLabel={confirm ? copy[confirm].label : undefined}
        tone={confirm ? copy[confirm].tone : 'primary'}
        loading={action.isPending}
        onConfirm={run}
      >
        <Field label={t('detail.note', { defaultValue: 'Message to the seller' })} optional>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </div>
  );
}

export default function OfferDetailPage() {
  const { offerId = '' } = useParams();
  const { t } = useTranslation('buyerOrders');
  const query = useBuyerOffer(offerId);
  return (
    <>
      <Seo
        title={query.data ? `${query.data.code} · ${query.data.crop_name}` : t('detail.seoTitle', { defaultValue: 'Offer' })}
        description={t('detail.seoDescription', { defaultValue: 'Terms, status and the full negotiation history of this offer.' })}
        path={`/app/buyer/offers/${offerId}`}
        noindex
      />
      <QueryState query={query} skeleton="detail" errorTitle={t('detail.error', { defaultValue: 'We could not load this offer' })}>
        {(offer) => <OfferBody offer={offer} />}
      </QueryState>
    </>
  );
}
