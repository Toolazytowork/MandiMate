import { MessagesSquare, Scale } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import {
  AiSourceBadge,
  AwaitingBadge,
  BuyerTrust,
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
} from '@/components/domain';
import { Button, Field, Select, Skeleton, toast } from '@/components/ui';
import { useCounterSuggestion, useLot, useOffer, useOfferBreakdown, useOfferConsent } from '@/features/coordinator/hooks';
import { errorMessage } from '@/features/coordinator/utils';
import { AssistedConsent } from '@/features/coordinator-lots/components/AssistedConsent';
import { OfferSellerActions, canSellerAct } from '@/features/coordinator-lots/components/OfferSellerActions';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatPct } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { Offer } from '@/types/api';

export default function OfferDetailPage() {
  const { offerId = '' } = useParams();
  const { t } = useTranslation('coordinatorLots');
  const offer = useOffer(offerId);

  return (
    <div className="space-y-8">
      <Seo
        title={offer.data ? `${offer.data.code} · ${offer.data.buyer_name}` : t('offer.seoTitle', { defaultValue: 'Offer' })}
        description={t('offer.seoDescription', { defaultValue: 'Negotiation, net proceeds per farmer and the next step on a lot offer.' })}
        path={`/app/coordinator/offers/${offerId}`}
        noindex
      />
      <QueryState query={offer} skeleton="detail" errorTitle={t('offer.error', { defaultValue: 'This offer could not be loaded' })}>
        {(data) => <OfferDetail offer={data} />}
      </QueryState>
    </div>
  );
}

function OfferDetail({ offer }: { offer: Offer }) {
  const { t } = useTranslation('coordinatorLots');
  const { user } = useAuth();
  const lot = useLot(offer.lot_id ?? '');
  const [harvestId, setHarvestId] = useState<string>('');
  const breakdown = useOfferBreakdown(offer.id, harvestId || null);
  const [askSuggestion, setAskSuggestion] = useState(false);
  const suggestion = useCounterSuggestion(offer.id, harvestId || null, askSuggestion);
  const [counterOpen, setCounterOpen] = useState(false);
  const consent = useOfferConsent();
  const sellerTurn = canSellerAct(offer);
  const member = lot.data?.members.find((item) => item.harvest_id === harvestId);

  const terms: [string, ReactNode][] = [
    [t('offer.terms.price', { defaultValue: 'Price' }), <Money key="p" value={offer.price_per_kg} perKg size="md" />],
    [t('offer.terms.quantity', { defaultValue: 'Quantity' }), <Quantity key="q" kg={offer.quantity_kg} size="md" />],
    [t('offer.terms.pickup', { defaultValue: 'Pickup' }), t(`common:enums.pickupTerms.${offer.pickup_terms}`, { defaultValue: offer.pickup_terms.replace(/_/g, ' ') })],
    [t('offer.terms.delivery', { defaultValue: 'Deliver to' }), offer.delivery_location],
    [t('offer.terms.payment', { defaultValue: 'Payment' }), t('offers.payIn', { defaultValue: 'paid in {{days}} days', days: offer.payment_terms_days })],
    [t('offer.terms.rejection', { defaultValue: 'Max rejection' }), formatPct(offer.max_rejection_pct)],
    [t('offer.terms.handling', { defaultValue: 'Handling' }), <Money key="h" value={offer.handling_charge_per_kg} perKg size="sm" />],
    [t('offer.terms.commission', { defaultValue: 'Commission' }), formatPct(offer.commission_pct)],
    [t('offer.terms.validUntil', { defaultValue: 'Valid until' }), formatDateTime(offer.valid_until)],
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: t('crumbs.lots', { defaultValue: 'Lots' }), to: '/app/coordinator/lots' },
          ...(offer.lot_id ? [{ label: offer.lot_code ?? t('crumbs.lot', { defaultValue: 'Lot' }), to: `/app/coordinator/lots/${offer.lot_id}` }] : []),
          { label: offer.code },
        ]}
        eyebrow={
          <span className="inline-flex items-center gap-2">
            {offer.crop_name} <GradeBadge grade={offer.grade} size="sm" />
          </span>
        }
        title={offer.buyer_name}
        meta={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="offer" value={offer.status} />
            {offer.awaiting ? <AwaitingBadge awaiting={offer.awaiting} size="md" /> : null}
            <BuyerTrust verified={offer.buyer_verified} reliabilityPct={offer.buyer_reliability_pct} />
            {offer.status === 'pending' || offer.status === 'countered' ? <ValidityCountdown validUntil={offer.valid_until} /> : null}
          </span>
        }
        actions={
          <OfferSellerActions offer={offer} size="md" suggestedPrice={suggestion.data?.suggested_price_per_kg} counterOpen={counterOpen} onCounterOpenChange={setCounterOpen} />
        }
      />

      {offer.status === 'proposed' ? (
        <ConsentPanel
          consents={offer.consents}
          title={t('offer.consentTitle', { defaultValue: 'Farmer consent' })}
          description={t('offer.consentBody', { defaultValue: 'The deal is final once every member has answered. Record consent only for farmers who told you directly.' })}
          renderAction={(entry) => (
            <AssistedConsent
              entry={entry}
              subject={t('cockpit.dealSubject', { defaultValue: '{{buyer}}’s offer on {{code}}', buyer: offer.buyer_name, code: offer.lot_code ?? offer.code })}
              busy={consent.isPending}
              onRecord={(req) =>
                consent.mutateAsync(
                  { id: offer.id, memberId: entry.memberId, req },
                  {
                    onSuccess: () => toast.success(t('consent.recorded', { defaultValue: 'Consent recorded for {{name}}', name: entry.farmerName })),
                    onError: (error) => toast.error(errorMessage(error)),
                  },
                )
              }
            />
          )}
        />
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="min-w-0 space-y-8">
          <SectionCard
            title={t('offer.breakdown', { defaultValue: 'What the farmers keep' })}
            description={t('offer.breakdownBody', { defaultValue: 'Gross price less transport, handling, commission, expected rejection and payment delay.' })}
            action={
              offer.lot_id ? (
                <Field label={t('offer.view', { defaultValue: 'View for' })} hideLabel className="w-full sm:w-64">
                  <Select value={harvestId} onChange={(event) => setHarvestId(event.target.value)} disabled={lot.isPending}>
                    <option value="">{t('offer.wholeLot', { defaultValue: 'Whole lot' })}</option>
                    {lot.data?.members.map((item) => (
                      <option key={item.id} value={item.harvest_id}>
                        {item.farmer_name} · {item.quantity_kg} kg
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : undefined
            }
          >
            {breakdown.isPending ? (
              <Skeleton className="h-72 w-full" />
            ) : breakdown.data ? (
              <NetProceedsCard
                data={breakdown.data}
                eyebrow={member ? member.farmer_name : t('offer.wholeLot', { defaultValue: 'Whole lot' })}
                title={member ? t('offer.memberNet', { defaultValue: 'Net for this farmer' }) : t('offer.lotNet', { defaultValue: 'Net to the pool' })}
                defaultExpanded
              />
            ) : (
              <p className="text-small text-danger-ink">{errorMessage(breakdown.error)}</p>
            )}
          </SectionCard>

          <SectionCard
            eyebrow={<MessagesSquare strokeWidth={1.25} aria-hidden="true" className="size-4" />}
            title={t('offer.thread', { defaultValue: 'Negotiation' })}
            description={offer.notes ?? undefined}
          >
            <NegotiationThread entries={offer.negotiation} viewerId={user?.id} />
          </SectionCard>
        </div>

        <aside className="min-w-0 space-y-8">
          <SectionCard
            eyebrow={<Scale strokeWidth={1.25} aria-hidden="true" className="size-4" />}
            title={t('offer.suggest', { defaultValue: 'Counter suggestion' })}
            description={t('offer.suggestBody', { defaultValue: 'A rules-based price from mandi rates and the farmers’ floors, worded by AI.' })}
            variant="parchment"
          >
            {!askSuggestion ? (
              <Button variant="secondary" size="sm" onClick={() => setAskSuggestion(true)} disabled={!sellerTurn}>
                {t('offer.suggestCta', { defaultValue: 'Suggest a counter price' })}
              </Button>
            ) : suggestion.isPending ? (
              <Skeleton className="h-32 w-full" />
            ) : suggestion.data ? (
              <div className="space-y-4">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="eyebrow text-muted">{t('offer.suggested', { defaultValue: 'Suggested' })}</p>
                    <Money value={suggestion.data.suggested_price_per_kg} perKg size="xl" />
                  </div>
                  <AiSourceBadge source={suggestion.data.source} />
                </div>
                <dl className="grid grid-cols-2 border-b border-line text-small [&>*]:border-t [&>*]:border-line [&>*]:py-2.5">
                  <dt className="text-[13px] font-semibold text-muted">{t('offer.currentPrice', { defaultValue: 'Current offer' })}</dt>
                  <dd className="text-end">
                    <Money value={suggestion.data.current_price_per_kg} perKg size="sm" />
                  </dd>
                  {suggestion.data.floor_price_per_kg !== null ? (
                    <>
                      <dt className="text-[13px] font-semibold text-muted">{t('offer.floor', { defaultValue: 'Farmers’ floor' })}</dt>
                      <dd className="text-end">
                        <Money value={suggestion.data.floor_price_per_kg} perKg size="sm" />
                      </dd>
                    </>
                  ) : null}
                  {suggestion.data.market_reference_per_kg !== null ? (
                    <>
                      <dt className="text-[13px] font-semibold text-muted">{t('offer.market', { defaultValue: 'Mandi reference' })}</dt>
                      <dd className="text-end">
                        <Money value={suggestion.data.market_reference_per_kg} perKg size="sm" />
                      </dd>
                    </>
                  ) : null}
                </dl>
                <p className="text-small font-normal leading-relaxed text-ink-2">{suggestion.data.rationale}</p>
                {sellerTurn ? (
                  <Button size="sm" onClick={() => setCounterOpen(true)}>
                    {t('offer.useSuggestion', { defaultValue: 'Counter at this price' })}
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="text-small text-danger-ink">{errorMessage(suggestion.error)}</p>
            )}
            {!sellerTurn && !askSuggestion ? (
              <p className="mt-3 text-micro text-muted">{t('offer.suggestOnlySeller', { defaultValue: 'Available while the offer waits on you.' })}</p>
            ) : null}
          </SectionCard>

          <SectionCard title={t('offer.termsTitle', { defaultValue: 'Terms' })} variant="flat">
            <dl className="divide-y divide-line text-small">
              {terms.map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-4 py-3">
                  <dt className="text-[13px] font-semibold text-muted">{label}</dt>
                  <dd className="text-end text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            {offer.quality_spec ? <p className="mt-4 text-small font-normal leading-relaxed text-ink-2">{offer.quality_spec}</p> : null}
          </SectionCard>
        </aside>
      </div>
    </>
  );
}
