import { Ban, Boxes, CalendarDays, HandCoins, MapPin, Megaphone, Scale, Users, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';

import {
  ConfirmDialog,
  ConsentPanel,
  JourneyTimeline,
  KpiStrip,
  LotMembersTable,
  Money,
  PageHeader,
  Quantity,
  QueryState,
  SectionCard,
  StatusBadge,
  consentFromMember,
  tallyConsents,
  type KpiItem,
} from '@/components/domain';
import { Button, EmptyState, LinkButton, Skeleton, toast } from '@/components/ui';
import { CANCELLABLE_LOT_STATUSES, OPENABLE_LOT_STATUSES } from '@/features/coordinator/constants';
import { useCancelLot, useLot, useLotOffers, useLotTimeline, useMemberConsent, useOfferConsent, useOpenLot } from '@/features/coordinator/hooks';
import { errorMessage } from '@/features/coordinator/utils';
import { AssistedConsent } from '@/features/coordinator-lots/components/AssistedConsent';
import { LotOfferComparison } from '@/features/coordinator-lots/components/LotOfferComparison';
import { LotDeliverySection, LotTransportSection } from '@/features/coordinator-lots/components/LotOperations';
import { formatDate, formatNumber } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { Lot } from '@/types/api';

export default function LotCockpitPage() {
  const { lotId = '' } = useParams();
  const { t } = useTranslation('coordinatorLots');
  const lot = useLot(lotId);

  return (
    <div className="space-y-8">
      <Seo
        title={lot.data?.code ?? t('cockpit.seoTitle', { defaultValue: 'Lot cockpit' })}
        description={t('cockpit.seoDescription', { defaultValue: 'Members, consent, offers, transport, delivery and settlement for this lot.' })}
        path={`/app/coordinator/lots/${lotId}`}
        noindex
      />
      <QueryState query={lot} skeleton="detail" errorTitle={t('cockpit.error', { defaultValue: 'This lot could not be loaded' })}>
        {(data) => <Cockpit lot={data} />}
      </QueryState>
    </div>
  );
}

function Cockpit({ lot }: { lot: Lot }) {
  const { t } = useTranslation('coordinatorLots');
  const timeline = useLotTimeline(lot.id);
  const offers = useLotOffers(lot.id);
  const openLot = useOpenLot();
  const cancelLot = useCancelLot();
  const memberConsent = useMemberConsent(lot.id);
  const offerConsent = useOfferConsent();
  const [confirm, setConfirm] = useState<'open' | 'cancel' | null>(null);

  const entries = lot.members.map(consentFromMember);
  const tally = tallyConsents(entries);
  const proposed = offers.data?.find((offer) => offer.status === 'proposed') ?? null;
  const accepted = offers.data?.find((offer) => offer.id === lot.accepted_offer_id) ?? null;
  const consentOpen = lot.status === 'forming' || lot.status === 'awaiting_consent';

  const kpis: KpiItem[] = [
    {
      id: 'qty',
      icon: <Scale strokeWidth={1.25} />,
      label: t('cockpit.kpi.pooled', { defaultValue: 'Pooled' }),
      value: <Quantity kg={lot.total_quantity_kg} size="xl" />,
      hint: t('cockpit.kpi.ofTarget', { defaultValue: 'of {{kg}} kg target', kg: formatNumber(lot.target_quantity_kg) }),
    },
    {
      id: 'farmers',
      icon: <Users strokeWidth={1.25} />,
      label: t('cockpit.kpi.farmers', { defaultValue: 'Farmers agreed' }),
      value: `${tally.accepted}/${tally.total}`,
      hint: tally.pending
        ? t('cockpit.kpi.pending', { defaultValue: '{{count}} still deciding', count: tally.pending })
        : t('cockpit.kpi.allDecided', { defaultValue: 'Everyone has decided' }),
    },
    {
      id: 'offers',
      icon: <HandCoins strokeWidth={1.25} />,
      label: t('cockpit.kpi.offers', { defaultValue: 'Offers' }),
      value: formatNumber(lot.offers_count),
      hint: lot.status === 'open_for_offers' ? t('cockpit.kpi.open', { defaultValue: 'Open to buyers' }) : undefined,
    },
    {
      id: 'deal',
      icon: <Wallet strokeWidth={1.25} />,
      label: t('cockpit.kpi.deal', { defaultValue: 'Agreed price' }),
      value: lot.price_per_kg ? <Money value={lot.price_per_kg} perKg size="xl" /> : '—',
      hint: lot.buyer_name ?? t('cockpit.kpi.noDeal', { defaultValue: 'No deal yet' }),
    },
  ];

  const runLotAction = () => {
    if (!confirm) return;
    const mutation = confirm === 'open' ? openLot : cancelLot;
    return mutation.mutateAsync(lot.id, {
      onSuccess: () =>
        toast.success(
          confirm === 'open'
            ? t('cockpit.opened', { defaultValue: '{{code}} is open for offers', code: lot.code })
            : t('cockpit.cancelled', { defaultValue: '{{code}} cancelled', code: lot.code }),
        ),
      onError: (error) => toast.error(errorMessage(error)),
    });
  };

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t('crumbs.lots', { defaultValue: 'Lots' }), to: '/app/coordinator/lots' }, { label: lot.code }]}
        eyebrow={`${lot.crop_name} · ${t('cockpit.grade', { defaultValue: 'Grade {{grade}}', grade: lot.grade })}${lot.is_solo ? ` · ${t('cockpit.solo', { defaultValue: 'Solo' })}` : ''}`}
        title={lot.code}
        meta={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-2 text-small text-muted">
            <StatusBadge kind="lot" value={lot.status} />
            <span className="inline-flex items-center gap-1.5">
              <MapPin strokeWidth={1.25} aria-hidden="true" className="size-3.5" />
              {lot.collection_point_name}
              {lot.district ? `, ${lot.district}` : ''}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays strokeWidth={1.25} aria-hidden="true" className="size-3.5" />
              {t('cockpit.pickup', { defaultValue: 'Pickup {{date}}', date: formatDate(lot.pickup_date) })}
            </span>
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {OPENABLE_LOT_STATUSES.has(lot.status) ? (
              <Button leadingIcon={<Megaphone strokeWidth={1.25} aria-hidden="true" />} onClick={() => setConfirm('open')} disabled={tally.accepted === 0}>
                {t('cockpit.open', { defaultValue: 'Open for offers' })}
              </Button>
            ) : null}
            {CANCELLABLE_LOT_STATUSES.has(lot.status) ? (
              <Button variant="ghost" leadingIcon={<Ban strokeWidth={1.25} aria-hidden="true" />} onClick={() => setConfirm('cancel')}>
                {t('cockpit.cancel', { defaultValue: 'Cancel lot' })}
              </Button>
            ) : null}
            {lot.settlement_id ? (
              <LinkButton to={`/app/coordinator/settlements/${lot.settlement_id}`} variant="secondary">
                {t('cockpit.settlement', { defaultValue: 'View settlement' })}
              </LinkButton>
            ) : null}
          </div>
        }
      />

      <KpiStrip items={kpis} columns={4} />

      <SectionCard title={t('cockpit.journey', { defaultValue: 'Journey' })}>
        {timeline.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : timeline.data ? (
          <JourneyTimeline steps={timeline.data} showDetails />
        ) : (
          <p className="text-small text-muted">{errorMessage(timeline.error)}</p>
        )}
      </SectionCard>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="min-w-0 space-y-8">
          {proposed ? (
            <ConsentPanel
              consents={proposed.consents}
              title={t('cockpit.dealConsent', { defaultValue: 'Farmers deciding on {{buyer}}’s deal', buyer: proposed.buyer_name })}
              description={t('cockpit.dealConsentBody', {
                defaultValue: 'You accepted {{price}}/kg. The deal is final once every farmer has answered; anyone who declines leaves the lot.',
                price: `₹${proposed.price_per_kg}`,
              })}
              renderAction={(entry) => (
                <AssistedConsent
                  entry={entry}
                  subject={t('cockpit.dealSubject', { defaultValue: '{{buyer}}’s offer on {{code}}', buyer: proposed.buyer_name, code: lot.code })}
                  busy={offerConsent.isPending}
                  onRecord={(req) =>
                    offerConsent.mutateAsync(
                      { id: proposed.id, memberId: entry.memberId, req },
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

          {consentOpen && lot.members.length > 0 ? (
            <ConsentPanel
              members={lot.members}
              title={t('cockpit.joinConsent', { defaultValue: 'Farmers agreeing to pool' })}
              description={t('cockpit.joinConsentBody', {
                defaultValue: 'Each farmer confirms their kilograms join this lot. It opens to buyers automatically once nobody is pending.',
              })}
              renderAction={(entry) => (
                <AssistedConsent
                  entry={entry}
                  subject={t('cockpit.joinSubject', { defaultValue: 'joining {{code}}', code: lot.code })}
                  busy={memberConsent.isPending}
                  onRecord={(req) =>
                    memberConsent.mutateAsync(
                      { memberId: entry.memberId, req },
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

          <SectionCard
            eyebrow={<HandCoins strokeWidth={1.25} aria-hidden="true" className="size-4" />}
            title={t('cockpit.offers', { defaultValue: 'Offers, compared on what farmers keep' })}
            description={t('cockpit.offersBody', {
              defaultValue: 'Net per kg is after transport, handling, commission, expected rejection and payment delay.',
            })}
          >
            {offers.isPending ? (
              <Skeleton className="h-40 w-full" />
            ) : offers.isError ? (
              <p className="text-small text-danger-ink">{errorMessage(offers.error)}</p>
            ) : offers.data && offers.data.length > 0 ? (
              <LotOfferComparison offers={offers.data} />
            ) : (
              <EmptyState
                size="sm"
                icon={<HandCoins strokeWidth={1.25} aria-hidden="true" />}
                title={t('cockpit.noOffers', { defaultValue: 'No offers yet' })}
                description={
                  lot.status === 'open_for_offers'
                    ? t('cockpit.noOffersOpen', { defaultValue: 'Buyers can see this lot now. Offers appear here as they come in.' })
                    : t('cockpit.noOffersClosed', { defaultValue: 'Open the lot for offers once farmers have agreed to pool.' })
                }
              />
            )}
          </SectionCard>

          <SectionCard
            eyebrow={<Boxes strokeWidth={1.25} aria-hidden="true" className="size-4" />}
            title={t('cockpit.members', { defaultValue: 'Members' })}
            description={t('cockpit.membersBody', {
              defaultValue: '{{count}} farms · {{kg}} kg pooled',
              count: lot.member_count,
              kg: formatNumber(lot.total_quantity_kg, { maxDecimals: 1 }),
            })}
            flush
          >
            <LotMembersTable members={lot.members} showConsent showDelivery={lot.status === 'delivered' || lot.status === 'settled'} />
          </SectionCard>

          <LotDeliverySection lot={lot} />
        </div>

        <aside className="min-w-0 space-y-8">
          {accepted ? (
            <SectionCard title={t('cockpit.deal', { defaultValue: 'The deal' })} variant="parchment">
              <dl className="grid grid-cols-2 border-b border-line text-small [&>*]:border-t [&>*]:border-line [&>*]:py-3">
                <dt className="text-[13px] font-semibold text-muted">{t('cockpit.buyer', { defaultValue: 'Buyer' })}</dt>
                <dd className="text-end font-display text-lg text-ink">{accepted.buyer_name}</dd>
                <dt className="text-[13px] font-semibold text-muted">{t('cockpit.price', { defaultValue: 'Price' })}</dt>
                <dd className="text-end">
                  <Money value={accepted.price_per_kg} perKg size="sm" />
                </dd>
                <dt className="text-[13px] font-semibold text-muted">{t('cockpit.quantity', { defaultValue: 'Quantity' })}</dt>
                <dd className="text-end">
                  <Quantity kg={accepted.quantity_kg} size="sm" />
                </dd>
                <dt className="text-[13px] font-semibold text-muted">{t('cockpit.payment', { defaultValue: 'Payment' })}</dt>
                <dd className="text-end text-ink">{t('offers.payIn', { defaultValue: 'paid in {{days}} days', days: accepted.payment_terms_days })}</dd>
              </dl>
              <Link to={`/app/coordinator/offers/${accepted.id}`} className="inline-flex items-center gap-2 border-b border-ink/30 pb-1 text-[13px] font-semibold text-ink transition-colors duration-300 hover:border-ink mt-5">
                {t('cockpit.dealDetail', { defaultValue: 'Breakdown & negotiation' })}
                <span aria-hidden="true">→</span>
              </Link>
            </SectionCard>
          ) : null}

          <LotTransportSection lot={lot} />

          {lot.match_explanation ? (
            <SectionCard title={t('cockpit.why', { defaultValue: 'Why these farms' })} variant="flat">
              <p className="text-small font-normal leading-relaxed text-ink-2">{lot.match_explanation}</p>
            </SectionCard>
          ) : null}

          {lot.coordinator_name ? (
            <p className="text-micro text-muted">
              {t('cockpit.coordinator', { defaultValue: 'Coordinated by {{name}}', name: lot.coordinator_name })}
            </p>
          ) : null}
        </aside>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        tone={confirm === 'cancel' ? 'danger' : 'primary'}
        title={
          confirm === 'open'
            ? t('cockpit.openTitle', { defaultValue: 'Open {{code}} to buyers?', code: lot.code })
            : t('cockpit.cancelTitle', { defaultValue: 'Cancel {{code}}?', code: lot.code })
        }
        description={
          confirm === 'open'
            ? tally.pending > 0
              ? t('cockpit.openPending', {
                  defaultValue: '{{count}} farmers have not answered yet. Buyers will see the {{kg}} kg already agreed.',
                  count: tally.pending,
                  kg: formatNumber(tally.acceptedKg, { maxDecimals: 1 }),
                })
              : t('cockpit.openBody', { defaultValue: 'Verified buyers can now make offers on this lot.' })
            : t('cockpit.cancelBody', { defaultValue: 'Every farmer’s harvest returns to their own listing and open offers are closed. This cannot be undone.' })
        }
        confirmLabel={confirm === 'open' ? t('cockpit.open', { defaultValue: 'Open for offers' }) : t('cockpit.cancel', { defaultValue: 'Cancel lot' })}
        cancelLabel={t('actions.keep', { defaultValue: 'Not now' })}
        loading={openLot.isPending || cancelLot.isPending}
        onConfirm={runLotAction}
      />
    </>
  );
}
