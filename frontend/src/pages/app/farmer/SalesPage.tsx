import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, PackageCheck, Truck, Wallet } from 'lucide-react';

import { Card, EmptyState, LinkButton, SegmentedControl, Skeleton } from '@/components/ui';
import {
  CropGlyph,
  JourneyMeter,
  JourneyTimeline,
  KpiStrip,
  Money,
  PageHeader,
  Quantity,
  QueryState,
  StatusBadge,
} from '@/components/domain';
import { StaggerGroup, StaggerItem } from '@/components/motion';
import { useLotTimeline, useLots, useMySettlements } from '@/features/farmer/hooks';
import { ACTIVE_SALE_LOT_STATUSES, SALE_LOT_STATUSES, myMember, myPayout } from '@/features/farmer/lib';
import { FARMER_BASE, Fact } from '@/features/farmer-deals/shared';
import { useAuth } from '@/lib/auth';
import { formatDate, formatINR, formatKg } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { Lot, Settlement } from '@/types/api';

type View = 'active' | 'done';

export default function SalesPage() {
  const { t } = useTranslation('farmerDeals');
  const lots = useLots({ mine: true });
  const settlements = useMySettlements();
  const [view, setView] = useState<View>('active');

  return (
    <div className="flex flex-col gap-10">
      <Seo
        title={t('sales.seoTitle', { defaultValue: 'Sales' })}
        description={t('sales.description', { defaultValue: 'Your agreed deals: pickup, delivery results and payment, step by step.' })}
        path={`${FARMER_BASE}/sales`}
        noindex
      />
      <PageHeader
        eyebrow={t('sales.eyebrow', { defaultValue: 'From field to payment' })}
        title={t('sales.title', { defaultValue: 'Sales' })}
        description={t('sales.description', { defaultValue: 'Your agreed deals: pickup, delivery results and payment, step by step.' })}
        actions={
          <SegmentedControl<View>
            label={t('sales.viewLabel', { defaultValue: 'Show' })}
            value={view}
            onValueChange={setView}
            options={[
              { value: 'active', label: t('sales.active', { defaultValue: 'In progress' }) },
              { value: 'done', label: t('sales.done', { defaultValue: 'Paid & closed' }) },
            ]}
          />
        }
      />
      <QueryState
        query={lots}
        skeleton="cards"
        isEmpty={(data) => data.filter((lot) => SALE_LOT_STATUSES.includes(lot.status)).length === 0}
        empty={{
          icon: <PackageCheck strokeWidth={1.25} />,
          title: t('sales.empty', { defaultValue: 'No sales yet' }),
          description: t('sales.emptyBody', { defaultValue: 'Once you agree to an offer, the sale is tracked here from pickup to payment.' }),
          action: (
            <LinkButton to={`${FARMER_BASE}/offers`} variant="primary">
              {t('sales.seeOffers', { defaultValue: 'See your offers' })}
            </LinkButton>
          ),
        }}
      >
        {(data) => <SalesList lots={data} settlements={settlements.data ?? []} settlementsLoading={settlements.isPending} view={view} />}
      </QueryState>
    </div>
  );
}

function SalesList({ lots, settlements, settlementsLoading, view }: { lots: Lot[]; settlements: Settlement[]; settlementsLoading: boolean; view: View }) {
  const { t } = useTranslation('farmerDeals');
  const { user } = useAuth();
  const sales = useMemo(() => lots.filter((lot) => SALE_LOT_STATUSES.includes(lot.status)), [lots]);
  const byLot = useMemo(() => new Map(settlements.map((settlement) => [settlement.lot_id, settlement])), [settlements]);
  const active = sales.filter((lot) => ACTIVE_SALE_LOT_STATUSES.includes(lot.status));
  const done = sales.filter((lot) => !ACTIVE_SALE_LOT_STATUSES.includes(lot.status));
  const shown = view === 'active' ? active : done;

  const onTheWayKg = active.reduce((sum, lot) => sum + (myMember(lot)?.quantity_kg ?? 0), 0);
  const awaitingPay = settlements.reduce((sum, settlement) => {
    const payout = myPayout(settlement, user?.id);
    return payout && payout.status === 'pending' ? sum + payout.net_amount : sum;
  }, 0);

  return (
    <div className="flex flex-col gap-10">
      <KpiStrip
        columns={3}
        loading={settlementsLoading}
        items={[
          { id: 'active', icon: <Truck strokeWidth={1.25} />, label: t('sales.kpiActive', { defaultValue: 'Deals in progress' }), value: active.length },
          { id: 'kg', icon: <PackageCheck strokeWidth={1.25} />, label: t('sales.kpiKg', { defaultValue: 'Your produce on the way' }), value: formatKg(onTheWayKg) },
          { id: 'pay', icon: <Wallet strokeWidth={1.25} />, label: t('sales.kpiPay', { defaultValue: 'Payment still to come' }), value: formatINR(awaitingPay) },
        ]}
      />
      {shown.length === 0 ? (
        <EmptyState
          framed
          size="sm"
          title={
            view === 'active'
              ? t('sales.noneActive', { defaultValue: 'No deals on the way right now' })
              : t('sales.noneDone', { defaultValue: 'No finished sales yet' })
          }
        />
      ) : (
        <StaggerGroup className="flex flex-col gap-6">
          {shown.map((lot) => (
            <StaggerItem key={lot.id}>
              <SaleCard lot={lot} settlement={byLot.get(lot.id)} userId={user?.id ?? null} />
            </StaggerItem>
          ))}
        </StaggerGroup>
      )}
    </div>
  );
}

function SaleCard({ lot, settlement, userId }: { lot: Lot; settlement: Settlement | undefined; userId: string | null }) {
  const { t } = useTranslation('farmerDeals');
  const timeline = useLotTimeline(lot.id);
  const me = myMember(lot);
  const payout = myPayout(settlement, userId);
  const delivered = me?.delivered_kg !== null && me?.delivered_kg !== undefined;

  return (
    <Card as="article" className="overflow-hidden">
      <header className="flex flex-wrap items-start gap-4 p-6 sm:p-8">
        <CropGlyph name={lot.crop_name} lotCode={lot.code} size="md" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="text-[13px] font-semibold text-muted tabular-nums">{lot.code}</p>
          <h2 className="font-display text-2xl font-bold text-ink">
            <Link to={`${FARMER_BASE}/lots/${lot.id}`} className="underline-offset-4 hover:underline">
              {t('sales.cardTitle', { defaultValue: '{{crop}} to {{buyer}}', crop: lot.crop_name, buyer: lot.buyer_name ?? '—' })}
            </Link>
          </h2>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <StatusBadge kind="lot" value={lot.status} size="sm" />
            {lot.price_per_kg !== null ? (
              <span className="text-sm text-muted">
                <Money value={lot.price_per_kg} perKg size="sm" />
              </span>
            ) : null}
          </div>
        </div>
        <LinkButton to={`${FARMER_BASE}/lots/${lot.id}`} size="sm" variant="ghost" trailingIcon={<ArrowUpRight strokeWidth={1.25} />}>
          {t('sales.details', { defaultValue: 'Details' })}
        </LinkButton>
      </header>

      <div className="border-y border-line px-6 py-6 sm:px-8">
        {timeline.isPending ? (
          <Skeleton className="h-16 w-full rounded-sm" />
        ) : timeline.data ? (
          <JourneyTimeline steps={timeline.data} orientation="responsive" showDetails={false} />
        ) : (
          <JourneyMeter step={lot.journey_step} complete={lot.status === 'settled'} showLabel />
        )}
      </div>

      <dl className="grid gap-x-8 gap-y-6 p-6 sm:grid-cols-2 sm:p-8 lg:grid-cols-4">
        <Fact label={t('sales.yourKg', { defaultValue: 'Your produce' })}>
          <Quantity kg={me?.quantity_kg ?? 0} />
        </Fact>
        <Fact label={t('sales.pickup', { defaultValue: 'Pickup' })}>
          {formatDate(lot.pickup_date)}
          <span className="block text-sm text-muted">{lot.collection_point_name}</span>
        </Fact>
        <Fact label={t('sales.delivery', { defaultValue: 'Delivery result' })}>
          {delivered && me ? (
            <>
              {t('sales.acceptedOf', {
                defaultValue: '{{accepted}} accepted of {{delivered}}',
                accepted: formatKg(me.accepted_kg ?? 0),
                delivered: formatKg(me.delivered_kg ?? 0),
              })}
              {me.rejected_kg ? (
                <span className="block text-sm text-muted">
                  {t('sales.rejectedKg', { defaultValue: '{{kg}} not accepted', kg: formatKg(me.rejected_kg) })}
                  {me.rejection_reason ? ` · ${me.rejection_reason}` : ''}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-muted">{t('sales.notDelivered', { defaultValue: 'Not delivered yet' })}</span>
          )}
        </Fact>
        <Fact label={t('sales.payment', { defaultValue: 'Your payment' })}>
          {payout ? (
            <div className="flex flex-col gap-1">
              <Money value={payout.net_amount} className="font-display text-xl font-bold text-ink" />
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge kind="payout" value={payout.status} size="sm" />
                {settlement ? <StatusBadge kind="payment" value={settlement.payment_status} size="sm" /> : null}
              </div>
              {payout.paid_at ? (
                <span className="text-xs text-muted">{t('sales.paidOn', { defaultValue: 'Paid on {{date}}', date: formatDate(payout.paid_at) })}</span>
              ) : settlement ? (
                <span className="text-xs text-muted">{t('sales.dueBy', { defaultValue: 'Buyer pays by {{date}}', date: formatDate(settlement.due_date) })}</span>
              ) : null}
            </div>
          ) : (
            <span className="text-muted">{t('sales.afterDelivery', { defaultValue: 'Worked out after delivery' })}</span>
          )}
        </Fact>
      </dl>
    </Card>
  );
}
