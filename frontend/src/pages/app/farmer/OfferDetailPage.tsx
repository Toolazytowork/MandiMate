import { useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Check, CircleSlash, Hourglass, MessageSquareReply, PartyPopper, X } from 'lucide-react';

import { Badge, Button, Card, Dialog, Field, Input, LinkButton, Skeleton, Textarea, toast } from '@/components/ui';
import {
  AwaitingBadge,
  BuyerTrust,
  CertaintyBadge,
  ConfirmDialog,
  ConsentPanel,
  GradeBadge,
  Money,
  NegotiationThread,
  NetProceedsCard,
  PageHeader,
  Quantity,
  QueryState,
  SectionCard,
  StatusBadge,
  ValidityCountdown,
  consentFromOffer,
  tallyConsents,
} from '@/components/domain';
import {
  useAcceptOffer,
  useCounterOffer,
  useErrorToast,
  useOffer,
  useOfferBreakdown,
  useOfferConsent,
  useRejectOffer,
} from '@/features/farmer/hooks';
import { canRespondToOffer, estimateNetAtPrice, myConsent, needsMyConsent } from '@/features/farmer/lib';
import { FARMER_BASE, Fact } from '@/features/farmer-deals/shared';
import { isApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatINR, formatKg, formatPerKg } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { NetProceeds, Offer } from '@/types/api';

export default function OfferDetailPage() {
  const { offerId = '' } = useParams();
  const { t } = useTranslation('farmerDeals');
  const offer = useOffer(offerId);
  return (
    <div className="flex flex-col gap-8">
      <Seo
        title={t('offer.seoTitle', { defaultValue: 'Offer' })}
        description={t('offer.seoBody', { defaultValue: 'One offer, explained in what you take home.' })}
        path={`${FARMER_BASE}/offers/${offerId}`}
        noindex
      />
      <QueryState query={offer} skeleton="detail" errorTitle={t('offer.loadError', { defaultValue: 'We could not open this offer' })}>
        {(data) => <OfferDetail offer={data} />}
      </QueryState>
    </div>
  );
}

function OfferDetail({ offer }: { offer: Offer }) {
  const { t } = useTranslation('farmerDeals');
  const { user } = useAuth();
  const breakdown = useOfferBreakdown(offer.id);
  const isLot = offer.target_type === 'lot';

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t('offers.title', { defaultValue: 'Offers' }), to: `${FARMER_BASE}/offers` }, { label: offer.code }]}
        eyebrow={
          isLot
            ? t('offer.eyebrowLot', { defaultValue: 'Offer for pooled lot {{code}}', code: offer.lot_code ?? '' })
            : t('offer.eyebrowHarvest', { defaultValue: 'Offer for your harvest' })
        }
        title={t('offer.title', {
          defaultValue: '{{buyer}} offers {{price}} for {{crop}}',
          buyer: offer.buyer_name,
          price: formatPerKg(offer.price_per_kg),
          crop: offer.crop_name,
        })}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="offer" value={offer.status} />
            {offer.awaiting && offer.status !== 'proposed' ? <AwaitingBadge awaiting={offer.awaiting} /> : null}
            <BuyerTrust verified={offer.buyer_verified} reliabilityPct={offer.buyer_reliability_pct} />
            {['pending', 'countered', 'proposed'].includes(offer.status) ? <ValidityCountdown validUntil={offer.valid_until} /> : null}
          </div>
        }
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-8">
          {breakdown.isPending ? (
            <Skeleton className="h-72 w-full rounded-panel" />
          ) : breakdown.data ? (
            <NetProceedsCard
              data={breakdown.data}
              eyebrow={t('offer.shareEyebrow', { defaultValue: 'Your share' })}
              title={t('offer.shareTitle', { defaultValue: 'What you take home from this offer' })}
              defaultExpanded
            />
          ) : (
            <Card className="p-6 text-sm text-muted">
              {t('offer.shareMissing', { defaultValue: 'We could not work out your share right now. Please try again in a moment.' })}{' '}
              <Button variant="ghost" size="sm" onClick={() => void breakdown.refetch()}>
                {t('actions.retry', { defaultValue: 'Try again' })}
              </Button>
            </Card>
          )}

          <SectionCard title={t('offer.terms', { defaultValue: 'What the buyer is asking' })}>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
              <Fact label={t('offer.price', { defaultValue: 'Price' })}>
                <Money value={offer.price_per_kg} perKg />
              </Fact>
              <Fact label={t('offer.quantity', { defaultValue: 'Quantity' })}>
                <Quantity kg={offer.quantity_kg} />
              </Fact>
              <Fact label={t('offer.grade', { defaultValue: 'Grade' })}>
                <GradeBadge grade={offer.grade} size="sm" />
              </Fact>
              <Fact label={t('offer.pickup', { defaultValue: 'Pickup' })}>
                {offer.pickup_terms === 'buyer_pickup'
                  ? t('offer.buyerPickup', { defaultValue: 'Buyer collects and pays transport' })
                  : t('offer.mandimateDelivery', { defaultValue: 'MandiMate delivers; transport shared by the pool' })}
              </Fact>
              <Fact label={t('offer.payment', { defaultValue: 'Payment' })}>
                {t('offer.paymentDays', { defaultValue: 'Within {{days}} days of delivery', days: offer.payment_terms_days })}
              </Fact>
              <Fact label={t('offer.rejection', { defaultValue: 'Rejection allowed' })}>
                {t('offer.upTo', { defaultValue: 'Up to {{pct}}%', pct: offer.max_rejection_pct })}
              </Fact>
              <Fact label={t('offer.deliverTo', { defaultValue: 'Delivered to' })} className="col-span-2 sm:col-span-1">
                {offer.delivery_location}
              </Fact>
              <Fact label={t('offer.validUntil', { defaultValue: 'Open until' })}>{formatDateTime(offer.valid_until)}</Fact>
              {offer.quality_spec ? (
                <Fact label={t('offer.quality', { defaultValue: 'Quality asked' })} className="col-span-2 sm:col-span-3">
                  {offer.quality_spec}
                </Fact>
              ) : null}
            </dl>
          </SectionCard>

          <SectionCard
            title={t('offer.talks', { defaultValue: 'The conversation' })}
            description={t('offer.talksBody', { defaultValue: 'Every price and message, in order.' })}
          >
            <NegotiationThread entries={offer.negotiation} viewerId={user?.id ?? null} />
          </SectionCard>
        </div>

        <aside className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-24">
          <DecisionPanel offer={offer} proceeds={breakdown.data} />
          {isLot && offer.consents.length > 0 ? (
            <ConsentPanel
              consents={offer.consents}
              title={t('offer.poolTitle', { defaultValue: 'Farmers in this deal' })}
              description={t('offer.poolBody', { defaultValue: 'The deal goes ahead only when the farmers agree. Names are shortened for privacy.' })}
            />
          ) : null}
        </aside>
      </div>
    </>
  );
}

/* ───────────────────────────── Decisions ───────────────────────────── */

function DecisionPanel({ offer, proceeds }: { offer: Offer; proceeds: NetProceeds | undefined }) {
  const { t } = useTranslation('farmerDeals');
  const [dialog, setDialog] = useState<null | 'accept' | 'counter' | 'reject' | 'agree' | 'decline'>(null);
  const [note, setNote] = useState('');
  const accept = useAcceptOffer();
  const reject = useRejectOffer();
  const consent = useOfferConsent();
  const onError = useErrorToast();
  const mine = myConsent(offer);
  const tally = tallyConsents(offer.consents.map(consentFromOffer));

  const close = () => {
    setDialog(null);
    setNote('');
  };

  const netLine = proceeds ? (
    <div className="flex flex-col gap-2 border-s border-gold-400 py-1 ps-4">
      <p className="text-sm text-ink">
        {t('decision.youGet', { defaultValue: 'You will get about {{net}} net', net: formatINR(proceeds.net_amount) })}
      </p>
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
        {t('decision.perKg', {
          defaultValue: '{{perKg}} for {{kg}}, after transport, handling, commission, rejection and the payment wait.',
          perKg: formatPerKg(proceeds.net_per_kg),
          kg: formatKg(proceeds.quantity_kg),
        })}
        <CertaintyBadge certainty={proceeds.confidence} size="sm" />
      </p>
    </div>
  ) : null;

  let body: ReactNode;
  if (canRespondToOffer(offer)) {
    body = (
      <>
        <PanelLead
          icon={<Hourglass strokeWidth={1.25} />}
          title={t('decision.yourAnswer', { defaultValue: 'Your answer is needed' })}
          text={t('decision.yourAnswerBody', { defaultValue: 'Accept, ask for a better price, or say no. Nothing is final until you accept.' })}
        />
        {netLine}
        <div className="grid gap-2">
          <Button leadingIcon={<Check strokeWidth={1.25} />} onClick={() => setDialog('accept')}>
            {t('decision.accept', { defaultValue: 'Accept offer' })}
          </Button>
          <Button variant="secondary" leadingIcon={<MessageSquareReply strokeWidth={1.25} />} onClick={() => setDialog('counter')}>
            {t('decision.counter', { defaultValue: 'Ask for a better price' })}
          </Button>
          <Button variant="ghost" leadingIcon={<X strokeWidth={1.25} />} onClick={() => setDialog('reject')}>
            {t('decision.reject', { defaultValue: 'Say no' })}
          </Button>
        </div>
      </>
    );
  } else if (needsMyConsent(offer)) {
    body = (
      <>
        <PanelLead
          icon={<Hourglass strokeWidth={1.25} />}
          title={t('decision.consentTitle', { defaultValue: 'Do you agree to this deal?' })}
          text={t('decision.consentBody', {
            defaultValue: 'Your coordinator found this buyer for the pool. Your {{kg}} goes in only if you say yes.',
            kg: formatKg(mine?.quantity_kg ?? 0),
          })}
        />
        {netLine}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
          <Button leadingIcon={<Check strokeWidth={1.25} />} onClick={() => setDialog('agree')}>
            {t('decision.agree', { defaultValue: 'Yes, I agree' })}
          </Button>
          <Button variant="ghost" leadingIcon={<X strokeWidth={1.25} />} onClick={() => setDialog('decline')}>
            {t('decision.decline', { defaultValue: 'No, leave me out' })}
          </Button>
        </div>
      </>
    );
  } else {
    body = <StatusLead offer={offer} agreed={tally.accepted} total={tally.total} mineDecision={mine?.decision ?? null} />;
  }

  return (
    <Card variant="default" className="flex flex-col gap-6 p-6 sm:p-8">
      {body}

      <ConfirmDialog
        open={dialog === 'accept'}
        onOpenChange={(open) => (open ? setDialog('accept') : close())}
        title={t('decision.acceptTitle', { defaultValue: 'Accept {{price}} from {{buyer}}?', price: formatPerKg(offer.price_per_kg), buyer: offer.buyer_name })}
        description={t('decision.acceptBody', { defaultValue: 'This is a promise to sell. Pickup gets arranged next.' })}
        confirmLabel={t('decision.accept', { defaultValue: 'Accept offer' })}
        loading={accept.isPending}
        onConfirm={() =>
          accept.mutate(
            { offerId: offer.id },
            {
              onSuccess: () => {
                toast.success(t('decision.accepted', { defaultValue: 'Offer accepted. We will arrange pickup.' }));
                close();
              },
              onError,
            },
          )
        }
      >
        {netLine}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'reject'}
        onOpenChange={(open) => (open ? setDialog('reject') : close())}
        tone="danger"
        title={t('decision.rejectTitle', { defaultValue: 'Say no to this offer?' })}
        description={t('decision.rejectBody', { defaultValue: 'The buyer will be told. Your harvest stays listed for other buyers.' })}
        confirmLabel={t('decision.reject', { defaultValue: 'Say no' })}
        loading={reject.isPending}
        onConfirm={() =>
          reject.mutate(
            { offerId: offer.id, message: note.trim() || null },
            {
              onSuccess: () => {
                toast.success(t('decision.rejected', { defaultValue: 'You said no to this offer.' }));
                close();
              },
              onError,
            },
          )
        }
      >
        <Field label={t('decision.reason', { defaultValue: 'Reason (optional)' })} optional>
          <Textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'agree'}
        onOpenChange={(open) => (open ? setDialog('agree') : close())}
        title={t('decision.agreeTitle', { defaultValue: 'Agree to sell to {{buyer}}?', buyer: offer.buyer_name })}
        description={t('decision.agreeBody', {
          defaultValue: '{{kg}} of your {{crop}} at {{price}}.',
          kg: formatKg(mine?.quantity_kg ?? 0),
          crop: offer.crop_name,
          price: formatPerKg(offer.price_per_kg),
        })}
        confirmLabel={t('decision.agree', { defaultValue: 'Yes, I agree' })}
        loading={consent.isPending}
        onConfirm={() =>
          consent.mutate(
            { offerId: offer.id, req: { decision: 'accepted' } },
            {
              onSuccess: () => {
                toast.success(t('decision.agreed', { defaultValue: 'Thank you. You agreed to this deal.' }));
                close();
              },
              onError,
            },
          )
        }
      >
        {netLine}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'decline'}
        onOpenChange={(open) => (open ? setDialog('decline') : close())}
        tone="danger"
        title={t('decision.declineTitle', { defaultValue: 'Leave your produce out of this deal?' })}
        description={t('decision.declineBody', { defaultValue: 'The others may still sell. Your harvest stays yours to sell another way.' })}
        confirmLabel={t('decision.decline', { defaultValue: 'No, leave me out' })}
        loading={consent.isPending}
        onConfirm={() =>
          consent.mutate(
            { offerId: offer.id, req: { decision: 'declined', note: note.trim() || null } },
            {
              onSuccess: () => {
                toast.success(t('decision.declined', { defaultValue: 'Noted. You are out of this deal.' }));
                close();
              },
              onError,
            },
          )
        }
      >
        <Field label={t('decision.reason', { defaultValue: 'Reason (optional)' })} optional>
          <Textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} />
        </Field>
      </ConfirmDialog>

      {dialog === 'counter' ? <CounterDialog offer={offer} proceeds={proceeds} onClose={close} /> : null}
    </Card>
  );
}

function PanelLead({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className="mt-1.5 shrink-0 text-muted [&_svg]:size-4 [&_svg]:stroke-[1.25]">
        {icon}
      </span>
      <div className="flex flex-col gap-1.5">
        <h2 className="font-display text-h3 font-bold text-ink">{title}</h2>
        <p className="text-sm font-normal leading-relaxed text-ink-2">{text}</p>
      </div>
    </div>
  );
}

function StatusLead({
  offer,
  agreed,
  total,
  mineDecision,
}: {
  offer: Offer;
  agreed: number;
  total: number;
  mineDecision: 'pending' | 'accepted' | 'declined' | null;
}) {
  const { t } = useTranslation('farmerDeals');
  if (offer.status === 'accepted') {
    return (
      <>
        <PanelLead
          icon={<PartyPopper strokeWidth={1.25} />}
          title={t('decision.dealDone', { defaultValue: 'Deal agreed' })}
          text={t('decision.dealDoneBody', { defaultValue: 'Pickup is being arranged. You can follow every step in Sales.' })}
        />
        <div className="flex flex-wrap gap-2">
          <LinkButton to={`${FARMER_BASE}/sales`} size="sm">
            {t('decision.followSale', { defaultValue: 'Follow the sale' })}
          </LinkButton>
          {offer.lot_id ? (
            <LinkButton to={`${FARMER_BASE}/lots/${offer.lot_id}`} size="sm" variant="secondary">
              {t('decision.openLot', { defaultValue: 'Open the lot' })}
            </LinkButton>
          ) : null}
        </div>
      </>
    );
  }
  if (offer.status === 'rejected' || offer.status === 'withdrawn' || offer.status === 'expired') {
    const text =
      offer.status === 'rejected'
        ? t('decision.closedRejected', { defaultValue: 'This offer was turned down.' })
        : offer.status === 'withdrawn'
          ? t('decision.closedWithdrawn', { defaultValue: 'The buyer took this offer back.' })
          : t('decision.closedExpired', { defaultValue: 'This offer ran out of time.' });
    return <PanelLead icon={<CircleSlash strokeWidth={1.25} />} title={t('decision.closed', { defaultValue: 'This offer is closed' })} text={text} />;
  }
  if (offer.status === 'proposed') {
    return (
      <>
        <PanelLead
          icon={mineDecision === 'declined' ? <CircleSlash strokeWidth={1.25} /> : <Check strokeWidth={1.25} />}
          title={
            mineDecision === 'declined'
              ? t('decision.youDeclined', { defaultValue: 'You said no' })
              : t('decision.youAgreed', { defaultValue: 'You agreed' })
          }
          text={
            mineDecision === 'declined'
              ? t('decision.youDeclinedBody', { defaultValue: 'Your produce stays out of this deal.' })
              : t('decision.waitingOthers', { defaultValue: 'Waiting for the other farmers to answer.' })
          }
        />
        <Badge tone="forest">{t('decision.tally', { defaultValue: '{{agreed}} of {{total}} farmers agreed', agreed, total })}</Badge>
      </>
    );
  }
  if (offer.awaiting === 'buyer') {
    return (
      <PanelLead
        icon={<Hourglass strokeWidth={1.25} />}
        title={t('decision.waitingBuyer', { defaultValue: 'Waiting for the buyer' })}
        text={t('decision.waitingBuyerBody', { defaultValue: 'We will tell you as soon as the buyer replies.' })}
      />
    );
  }
  return (
    <PanelLead
      icon={<Hourglass strokeWidth={1.25} />}
      title={t('decision.coordinatorTalks', { defaultValue: 'Your coordinator is talking to the buyer' })}
      text={t('decision.coordinatorTalksBody', { defaultValue: 'For pooled lots the coordinator agrees the price. You will be asked for your yes or no.' })}
    />
  );
}

/* ───────────────────────────── Counter ─────────────────────────────── */

function CounterDialog({ offer, proceeds, onClose }: { offer: Offer; proceeds: NetProceeds | undefined; onClose: () => void }) {
  const { t } = useTranslation('farmerDeals');
  const counter = useCounterOffer();
  const onError = useErrorToast();
  const schema = useMemo(
    () =>
      z.object({
        price: z
          .number({ error: t('counter.priceRequired', { defaultValue: 'Enter a price per kg.' }) })
          .positive(t('counter.pricePositive', { defaultValue: 'Enter a price above ₹0.' })),
        message: z.string().max(500).optional(),
      }),
    [t],
  );
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { price: Math.round((offer.price_per_kg + 2) * 100) / 100, message: '' },
  });
  const price = form.watch('price');
  const estimate = proceeds && Number.isFinite(price) ? estimateNetAtPrice(proceeds, price) : null;

  const submit = form.handleSubmit((values) =>
    counter.mutate(
      { offerId: offer.id, req: { price_per_kg: values.price, message: values.message?.trim() || null } },
      {
        onSuccess: () => {
          toast.success(t('counter.sent', { defaultValue: 'Your price was sent to the buyer.' }));
          onClose();
        },
        onError: (error) => {
          if (isApiError(error)) {
            const priceError = error.fieldErrors.price_per_kg;
            if (priceError) form.setError('price', { message: priceError });
            const messageError = error.fieldErrors.message;
            if (messageError) form.setError('message', { message: messageError });
          }
          onError(error);
        },
      },
    ),
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      dismissible={!counter.isPending}
      title={t('counter.title', { defaultValue: 'Ask for a better price' })}
      description={t('counter.body', { defaultValue: 'The buyer offered {{price}}. Tell them your price.', price: formatPerKg(offer.price_per_kg) })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={counter.isPending}>
            {t('actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button type="submit" form="counter-form" loading={counter.isPending}>
            {t('counter.send', { defaultValue: 'Send my price' })}
          </Button>
        </>
      }
    >
      <form id="counter-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-5" noValidate>
        <Field label={t('counter.price', { defaultValue: 'Your price (₹ per kg)' })} error={form.formState.errors.price?.message} required>
          <Input type="number" inputMode="decimal" step="0.5" min={0} {...form.register('price', { valueAsNumber: true })} />
        </Field>
        {estimate ? (
          <div className="border-s border-forest-600 py-1 ps-4 text-sm text-ink" aria-live="polite">
            {t('counter.estimate', {
              defaultValue: 'At this price you would take home about {{net}} ({{perKg}}).',
              net: formatINR(estimate.net),
              perKg: formatPerKg(estimate.netPerKg),
            })}
          </div>
        ) : null}
        <Field label={t('counter.message', { defaultValue: 'Message to the buyer' })} optional error={form.formState.errors.message?.message}>
          <Textarea rows={3} maxLength={500} {...form.register('message')} />
        </Field>
      </form>
    </Dialog>
  );
}
