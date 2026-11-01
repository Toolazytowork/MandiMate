import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { Layers, Sprout } from 'lucide-react';

import {
  ConfirmDialog,
  CropGlyph,
  GradeBadge,
  LotCard,
  Money,
  PageHeader,
  Quantity,
  QueryState,
  SectionCard,
  StatusBadge,
  SupplyCard,
} from '@/components/domain';
import { Button, EmptyState, LinkButton, Skeleton, toast } from '@/components/ui';
import { offerPath } from '@/features/buyer/sourcing';
import { useCancelDemand, useDemand, useLots, useSupply } from '@/features/buyer/sourcingHooks';
import { apiErrorMessage } from '@/features/shared/forms';
import { formatDate, formatPct } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { Demand } from '@/types/api';

function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="border-t border-line pt-4">
      <dt className="text-[13px] font-semibold text-muted">{label}</dt>
      <dd className="mt-2 text-body text-ink">{children}</dd>
    </div>
  );
}

function LinkedLots({ demand }: { demand: Demand }) {
  const { t } = useTranslation('buyer');
  const lots = useLots(demand.lot_ids);
  if (demand.lot_ids.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon={<Layers strokeWidth={1.25} className="size-5" />}
        title={t('demand.lots.emptyTitle', { defaultValue: 'No lots pooled yet' })}
        description={t('demand.lots.emptyBody', {
          defaultValue: 'Coordinators link lots here as they gather harvests that meet your specification.',
        })}
      />
    );
  }
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {lots.map((q, i) =>
        q.data ? (
          <LotCard
            key={q.data.id}
            lot={q.data}
            actions={
              q.data.status === 'open_for_offers' ? (
                <LinkButton size="sm" variant="secondary" to={offerPath({ kind: 'lot', id: q.data.id }, demand.id)}>
                  {t('supply.makeOffer', { defaultValue: 'Make offer' })}
                </LinkButton>
              ) : undefined
            }
          />
        ) : q.isError ? (
          <p key={demand.lot_ids[i]} className="rounded-card border border-line bg-paper p-6 text-small text-muted">
            {t('demand.lots.unavailable', { defaultValue: 'This lot is no longer visible to you.' })}
          </p>
        ) : (
          <Skeleton key={demand.lot_ids[i]} className="h-56 rounded-card" />
        ),
      )}
    </div>
  );
}

function MatchingSupply({ demand }: { demand: Demand }) {
  const { t } = useTranslation('buyer');
  const supply = useSupply({ crop_id: demand.crop_id, grade: demand.grade_required === 'ungraded' ? null : demand.grade_required, limit: 12 });
  return (
    <QueryState
      query={supply}
      skeleton="cards"
      empty={{
        icon: <Sprout strokeWidth={1.25} className="size-5" />,
        title: t('demand.supply.emptyTitle', { defaultValue: 'No open supply matches right now' }),
        description: t('demand.supply.emptyBody', { defaultValue: 'New harvests are listed daily — check back, or widen the grade.' }),
      }}
    >
      {(items) => (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {items
            .filter((item) => !demand.lot_ids.includes(item.id))
            .map((item) => (
              <SupplyCard
                key={`${item.kind}-${item.id}`}
                item={item}
                actions={
                  item.my_offer_status ? (
                    <StatusBadge kind="offer" value={item.my_offer_status} size="sm" />
                  ) : (
                    <LinkButton size="sm" variant="secondary" to={offerPath(item, demand.id)}>
                      {t('supply.makeOffer', { defaultValue: 'Make offer' })}
                    </LinkButton>
                  )
                }
              />
            ))}
        </div>
      )}
    </QueryState>
  );
}

function DemandBody({ demand }: { demand: Demand }) {
  const { t } = useTranslation('buyer');
  const [confirm, setConfirm] = useState(false);
  const cancel = useCancelDemand(demand.id);
  const cancellable = demand.status === 'open' || demand.status === 'matched';

  const onCancel = async () => {
    try {
      await cancel.mutateAsync();
      toast.success(t('demand.cancelled', { defaultValue: 'Requirement cancelled' }));
      setConfirm(false);
    } catch (error) {
      toast.error(apiErrorMessage(error, t));
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumbs={[
          { label: t('demands.title', { defaultValue: 'Requirements' }), to: '/app/buyer/demands' },
          { label: demand.crop_name },
        ]}
        eyebrow={t('demand.eyebrow', { defaultValue: 'Requirement' })}
        title={
          <span className="flex items-center gap-4">
            <CropGlyph name={demand.crop_name} size="lg" framed />
            <span>
              <Quantity kg={demand.quantity_kg} /> {demand.crop_name}
            </span>
          </span>
        }
        description={t('demand.lede', {
          location: demand.delivery_location,
          date: formatDate(demand.needed_by),
          defaultValue: 'Delivered to {{location}} by {{date}}.',
        })}
        meta={
          <>
            <StatusBadge kind="demand" value={demand.status} />
            <GradeBadge grade={demand.grade_required} size="sm" />
          </>
        }
        actions={
          <>
            {cancellable && (
              <Button variant="ghost" onClick={() => setConfirm(true)}>
                {t('demand.cancel', { defaultValue: 'Cancel requirement' })}
              </Button>
            )}
            <LinkButton to="/app/buyer/supply" variant="secondary">
              {t('home.browseSupply', { defaultValue: 'Browse supply' })}
            </LinkButton>
          </>
        }
        divider
      />

      <SectionCard title={t('demand.spec', { defaultValue: 'Specification' })}>
        <dl className="grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label={t('form.quantity', { defaultValue: 'Quantity (kg)' })}>
            <Quantity kg={demand.quantity_kg} />
            {demand.min_quantity_kg > 0 && demand.min_quantity_kg < demand.quantity_kg && (
              <span className="block text-small text-muted">
                {t('demand.minLot', { defaultValue: 'Lots from' })} <Quantity kg={demand.min_quantity_kg} />
              </span>
            )}
          </Fact>
          <Fact label={t('form.targetPrice', { defaultValue: 'Target price (₹/kg)' })}>
            {demand.target_price_per_kg === null ? '—' : <Money value={demand.target_price_per_kg} perKg />}
          </Fact>
          <Fact label={t('form.paymentDays', { defaultValue: 'Payment within (days)' })}>
            {t('demand.days', { count: demand.payment_terms_days, defaultValue: '{{count}} days' })}
          </Fact>
          <Fact label={t('form.maxRejection', { defaultValue: 'Maximum rejection' })}>{formatPct(demand.max_rejection_pct)}</Fact>
          <Fact label={t('form.deliveryLocation', { defaultValue: 'Delivery location' })}>
            {demand.delivery_location}
            {(demand.delivery_district || demand.delivery_state) && (
              <span className="block text-small text-muted">
                {[demand.delivery_district, demand.delivery_state].filter(Boolean).join(', ')}
              </span>
            )}
          </Fact>
          <Fact label={t('form.neededBy', { defaultValue: 'Needed by' })}>{formatDate(demand.needed_by)}</Fact>
          <Fact label={t('form.qualitySpec', { defaultValue: 'Quality specification' })}>{demand.quality_spec ?? '—'}</Fact>
          <Fact label={t('form.notes', { defaultValue: 'Notes' })}>{demand.notes ?? '—'}</Fact>
        </dl>
      </SectionCard>

      <SectionCard
        title={t('demand.lots.title', { defaultValue: 'Lots pooled for you' })}
        description={t('demand.lots.description', { defaultValue: 'Farmer groups assembled against this requirement.' })}
        variant="flat"
      >
        <LinkedLots demand={demand} />
      </SectionCard>

      {cancellable && (
        <SectionCard
          title={t('demand.supply.title', { defaultValue: 'Matching supply' })}
          description={t('demand.supply.description', { defaultValue: 'Open lots and harvests of this crop and grade.' })}
          variant="flat"
        >
          <MatchingSupply demand={demand} />
        </SectionCard>
      )}

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        tone="danger"
        title={t('demand.cancelTitle', { defaultValue: 'Cancel this requirement?' })}
        description={t('demand.cancelBody', {
          defaultValue: 'Coordinators will stop pooling towards it. Offers you already made stay as they are.',
        })}
        confirmLabel={t('demand.cancel', { defaultValue: 'Cancel requirement' })}
        cancelLabel={t('demand.keep', { defaultValue: 'Keep it' })}
        loading={cancel.isPending}
        onConfirm={onCancel}
      />
    </div>
  );
}

export default function DemandDetailPage() {
  const { t } = useTranslation('buyer');
  const { demandId = '' } = useParams();
  const demand = useDemand(demandId);

  return (
    <>
      <Seo
        title={demand.data ? `${demand.data.crop_name} · ${t('demand.eyebrow', { defaultValue: 'Requirement' })}` : t('demand.eyebrow', { defaultValue: 'Requirement' })}
        description={t('demand.seo', { defaultValue: 'Specification, status and the lots matched to this requirement.' })}
        path={`/app/buyer/demands/${demandId}`}
        noindex
      />
      <QueryState query={demand} skeleton="detail" isEmpty={() => false} errorTitle={t('demand.error', { defaultValue: 'Could not load this requirement' })}>
        {(data) => <DemandBody demand={data} />}
      </QueryState>
    </>
  );
}
