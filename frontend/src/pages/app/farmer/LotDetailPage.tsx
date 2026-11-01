import { useState } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Check, Handshake, Plus, Truck, X } from 'lucide-react';

import { Badge, Button, Card, EmptyState, Skeleton, toast } from '@/components/ui';
import {
  ConfirmDialog,
  GradeBadge,
  JourneyTimeline,
  LotMembersTable,
  OfferCard,
  PageHeader,
  Quantity,
  QueryState,
  SectionCard,
  StatusBadge,
} from '@/components/domain';
import {
  useErrorToast,
  useLot,
  useLotConsent,
  useLotTimeline,
  useMyHarvests,
  useOffers,
  useTransportRequest,
} from '@/features/farmer/hooks';
import { awaitingMyLotConsent, isJoinable, myMember } from '@/features/farmer/lib';
import { FARMER_BASE, Fact, FillMeter, JoinLotDialog } from '@/features/farmer-deals/shared';
import { formatDate, formatKg } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { Lot } from '@/types/api';

const DELIVERED: readonly Lot['status'][] = ['delivered', 'settled'];

export default function LotDetailPage() {
  const { lotId = '' } = useParams();
  const { t } = useTranslation('farmerDeals');
  const lot = useLot(lotId);
  return (
    <div className="flex flex-col gap-8">
      <Seo
        title={t('lot.seoTitle', { defaultValue: 'Lot' })}
        description={t('lot.seoBody', { defaultValue: 'Who is in this pool, its offers, pickup and every step so far.' })}
        path={`${FARMER_BASE}/lots/${lotId}`}
        noindex
      />
      <QueryState query={lot} skeleton="detail" errorTitle={t('lot.loadError', { defaultValue: 'We could not open this lot' })}>
        {(data) => <LotDetail lot={data} />}
      </QueryState>
    </div>
  );
}

function LotDetail({ lot }: { lot: Lot }) {
  const { t } = useTranslation('farmerDeals');
  const timeline = useLotTimeline(lot.id);
  const offers = useOffers({ lot_id: lot.id });
  const harvests = useMyHarvests();
  const [joinOpen, setJoinOpen] = useState(false);
  const me = myMember(lot);
  const asks = awaitingMyLotConsent(lot);
  const canJoin = harvests.data ? isJoinable(lot, harvests.data) : false;
  const delivered = DELIVERED.includes(lot.status);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t('lots.title', { defaultValue: 'Lots' }), to: `${FARMER_BASE}/lots` }, { label: lot.code }]}
        eyebrow={t('lot.eyebrow', { defaultValue: 'Pooled lot {{code}}', code: lot.code })}
        title={t('lot.title', { defaultValue: '{{crop}} from {{n}} farmers', crop: lot.crop_name, n: lot.member_count })}
        description={t('lot.description', {
          defaultValue: 'Collected at {{place}} on {{date}}.',
          place: lot.collection_point_name,
          date: formatDate(lot.pickup_date),
        })}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="lot" value={lot.status} />
            <GradeBadge grade={lot.grade} size="sm" />
            {me?.is_mine ? <Badge tone="forest">{t('lot.youAreIn', { defaultValue: 'You are in this lot' })}</Badge> : null}
          </div>
        }
        actions={
          canJoin ? (
            <Button leadingIcon={<Plus strokeWidth={1.25} />} onClick={() => setJoinOpen(true)}>
              {t('join.submit', { defaultValue: 'Join this lot' })}
            </Button>
          ) : undefined
        }
      />

      {asks && me ? <ConsentBanner lot={lot} memberId={me.id} kg={me.quantity_kg} /> : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-8">
          <SectionCard
            title={t('lot.members', { defaultValue: 'Farmers in this lot' })}
            description={t('lot.membersBody', { defaultValue: 'Names are shortened for privacy. Your row is highlighted.' })}
          >
            <div className="flex flex-col gap-6">
              <FillMeter total={lot.total_quantity_kg} target={lot.target_quantity_kg} />
              <LotMembersTable members={lot.members} showConsent showDelivery={delivered} />
            </div>
          </SectionCard>

          <SectionCard
            title={t('lot.offers', { defaultValue: 'Buyer offers for this lot' })}
            description={t('lot.offersBody', { defaultValue: 'Open any offer to see what you would take home.' })}
          >
            <QueryState
              query={offers}
              skeleton="list"
              empty={{
                icon: <Handshake strokeWidth={1.25} />,
                title: t('lot.noOffers', { defaultValue: 'No offers yet' }),
                description: t('lot.noOffersBody', { defaultValue: 'Buyers can see this lot. We will tell you when one makes an offer.' }),
              }}
            >
              {(list) => (
                <div className="grid gap-x-10 border-t border-line md:grid-cols-2">
                  {list.map((offer) => (
                    <OfferCard key={offer.id} offer={offer} to={`${FARMER_BASE}/offers/${offer.id}`} className="rounded-none border-x-0 border-t-0 bg-transparent shadow-none" />
                  ))}
                </div>
              )}
            </QueryState>
          </SectionCard>

          <SectionCard title={t('lot.journey', { defaultValue: 'Every step so far' })}>
            <QueryState query={timeline} skeleton="list">
              {(steps) => <JourneyTimeline steps={steps} orientation="vertical" showDetails />}
            </QueryState>
          </SectionCard>
        </div>

        <aside className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-24">
          <PickupCard lot={lot} />
          {me ? (
            <Card className="flex flex-col gap-5 p-6 sm:p-8">
              <h2 className="font-display text-h3 font-bold text-ink">{t('lot.yourShare', { defaultValue: 'Your share' })}</h2>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                <Fact label={t('lot.youPut', { defaultValue: 'You put in' })}>
                  <Quantity kg={me.quantity_kg} />
                </Fact>
                <Fact label={t('lot.yourAnswer', { defaultValue: 'Your answer' })}>
                  <StatusBadge kind="consent" value={me.consent_status} size="sm" />
                </Fact>
                {me.delivered_kg !== null ? (
                  <Fact label={t('lot.delivered', { defaultValue: 'Delivered' })}>
                    <Quantity kg={me.delivered_kg} />
                  </Fact>
                ) : null}
                {me.accepted_kg !== null ? (
                  <Fact label={t('lot.accepted', { defaultValue: 'Accepted by buyer' })}>
                    <Quantity kg={me.accepted_kg} />
                  </Fact>
                ) : null}
                {me.rejected_kg ? (
                  <Fact label={t('lot.rejected', { defaultValue: 'Not accepted' })} className="col-span-2">
                    <Quantity kg={me.rejected_kg} />
                    {me.rejection_reason ? <span className="block text-sm text-muted">{me.rejection_reason}</span> : null}
                  </Fact>
                ) : null}
              </dl>
            </Card>
          ) : null}
          {lot.match_explanation ? (
            <Card variant="default" className="p-6 text-sm font-normal leading-relaxed text-ink-2 sm:p-8">
              <p className="eyebrow mb-3">{t('lot.whyPooled', { defaultValue: 'Why these farmers were pooled' })}</p>
              {lot.match_explanation}
            </Card>
          ) : null}
        </aside>
      </div>

      {canJoin && harvests.data ? <JoinLotDialog lot={lot} harvests={harvests.data} open={joinOpen} onOpenChange={setJoinOpen} /> : null}
    </>
  );
}

function ConsentBanner({ lot, memberId, kg }: { lot: Lot; memberId: string; kg: number }) {
  const { t } = useTranslation('farmerDeals');
  const consent = useLotConsent();
  const onError = useErrorToast();
  const [declineOpen, setDeclineOpen] = useState(false);

  const decide = (decision: 'accepted' | 'declined') =>
    consent.mutate(
      { lotId: lot.id, memberId, req: { decision } },
      {
        onSuccess: () => {
          toast.success(
            decision === 'accepted'
              ? t('lot.joined', { defaultValue: 'You are in. We will bring you the offers.' })
              : t('lot.left', { defaultValue: 'You are out of this lot.' }),
          );
          setDeclineOpen(false);
        },
        onError,
      },
    );

  return (
    <Card className="flex flex-col gap-6 border-s-2 border-s-gold-400 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
      <div className="flex max-w-2xl flex-col gap-2">
        <p className="eyebrow eyebrow-rule">{t('lot.askEyebrow', { defaultValue: 'Your answer is needed' })}</p>
        <h2 className="font-display text-h2 font-bold text-ink">
          {t('lot.askTitle', { defaultValue: 'Pool your {{kg}} of {{crop}} in this lot?', kg: formatKg(kg), crop: lot.crop_name })}
        </h2>
        <p className="text-sm font-normal leading-relaxed text-ink-2">
          {t('lot.askBody', { defaultValue: 'Selling together brings bigger buyers and shared transport. You will still say yes or no to each deal.' })}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button leadingIcon={<Check strokeWidth={1.25} />} loading={consent.isPending && consent.variables?.req.decision === 'accepted'} onClick={() => decide('accepted')}>
          {t('lot.yes', { defaultValue: 'Yes, pool it' })}
        </Button>
        <Button variant="ghost" leadingIcon={<X strokeWidth={1.25} />} onClick={() => setDeclineOpen(true)} disabled={consent.isPending}>
          {t('lot.no', { defaultValue: 'No thanks' })}
        </Button>
      </div>
      <ConfirmDialog
        open={declineOpen}
        onOpenChange={setDeclineOpen}
        tone="danger"
        title={t('lot.noTitle', { defaultValue: 'Leave this lot?' })}
        description={t('lot.noBody', { defaultValue: 'Your harvest stays listed and you can sell it another way.' })}
        confirmLabel={t('lot.no', { defaultValue: 'No thanks' })}
        loading={consent.isPending}
        onConfirm={() => decide('declined')}
      />
    </Card>
  );
}

function PickupCard({ lot }: { lot: Lot }) {
  const { t } = useTranslation('farmerDeals');
  const transport = useTransportRequest(lot.transport_request_id);
  return (
    <Card className="flex flex-col gap-5 p-6 sm:p-8">
      <div className="flex items-center gap-2.5">
        <Truck aria-hidden="true" strokeWidth={1.25} className="size-4 text-muted" />
        <h2 className="font-display text-h3 font-bold text-ink">{t('lot.pickup', { defaultValue: 'Pickup' })}</h2>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
        <Fact label={t('lot.place', { defaultValue: 'Collection point' })} className="col-span-2">
          {lot.collection_point_name}
        </Fact>
        <Fact label={t('lot.date', { defaultValue: 'Pickup date' })}>{formatDate(lot.pickup_date)}</Fact>
        <Fact label={t('lot.buyer', { defaultValue: 'Buyer' })}>{lot.buyer_name ?? t('lot.noBuyer', { defaultValue: 'Not yet' })}</Fact>
        {lot.pickup_terms ? (
          <Fact label={t('lot.terms', { defaultValue: 'Transport' })} className="col-span-2">
            {lot.pickup_terms === 'buyer_pickup'
              ? t('offer.buyerPickup', { defaultValue: 'Buyer collects and pays transport' })
              : t('offer.mandimateDelivery', { defaultValue: 'MandiMate delivers; transport shared by the pool' })}
          </Fact>
        ) : null}
        {lot.coordinator_name ? (
          <Fact label={t('lot.coordinator', { defaultValue: 'Coordinator' })}>{lot.coordinator_name}</Fact>
        ) : null}
      </dl>
      {lot.transport_request_id ? (
        transport.isPending ? (
          <Skeleton className="h-16 w-full rounded-sm" />
        ) : transport.data ? (
          <div className="flex flex-col gap-2 border-t border-line pt-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-ink">{transport.data.transporter_name ?? t('lot.truckSoon', { defaultValue: 'Truck being booked' })}</span>
              <StatusBadge kind="transport" value={transport.data.status} size="sm" />
            </div>
            <p className="text-muted">
              {t('lot.route', {
                defaultValue: 'To {{place}}, about {{km}} km',
                place: transport.data.destination_name,
                km: Math.round(transport.data.estimated_distance_km),
              })}
            </p>
          </div>
        ) : null
      ) : (
        <EmptyState
          size="sm"
          icon={<Truck strokeWidth={1.25} />}
          title={t('lot.noTruck', { defaultValue: 'No truck yet' })}
          description={t('lot.noTruckBody', { defaultValue: 'Transport is booked once a buyer’s offer is agreed.' })}
        />
      )}
    </Card>
  );
}
