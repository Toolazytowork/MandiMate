import { ArrowRight, Truck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import {
  GradeBadge,
  JourneyTimeline,
  KpiStrip,
  LotMembersTable,
  Money,
  PageHeader,
  QualityBadge,
  QueryState,
  Quantity,
  RouteMap,
  SectionCard,
  StatusBadge,
} from '@/components/domain';
import { Reveal } from '@/components/motion';
import { EmptyState, LinkButton, Skeleton } from '@/components/ui';
import { canRecordDelivery, isDelivered, lotQualityStatus } from '@/features/buyer/utils';
import { DeliveryForm } from '@/features/buyer-orders/components/DeliveryForm';
import { DeliveryRecordView } from '@/features/buyer-orders/components/DeliveryRecordView';
import { useLot, useLotDelivery, useLotTimeline, useTransportRequest } from '@/features/buyer-orders/hooks';
import { formatDate } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { Lot } from '@/types/api';

function OrderBody({ lot }: { lot: Lot }) {
  const { t } = useTranslation('buyerOrders');
  const timeline = useLotTimeline(lot.id);
  const request = useTransportRequest(lot.transport_request_id);
  const delivered = isDelivered(lot);
  const delivery = useLotDelivery(lot.id, delivered);
  const canRecord = canRecordDelivery(lot);
  const value = lot.price_per_kg !== null ? lot.price_per_kg * lot.total_quantity_kg : null;

  return (
    <div className="space-y-10">
      <PageHeader
        breadcrumbs={[{ label: t('orders.title', { defaultValue: 'Orders' }), to: '/app/buyer/orders' }, { label: lot.code }]}
        eyebrow={`${lot.code} · ${lot.collection_point_name}`}
        title={
          <span className="flex flex-wrap items-baseline gap-x-3">
            {lot.crop_name}
            <GradeBadge grade={lot.grade} />
          </span>
        }
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="lot" value={lot.status} />
            <QualityBadge status={lotQualityStatus(lot.members)} />
          </div>
        }
        actions={
          lot.accepted_offer_id ? (
            <LinkButton to={`/app/buyer/offers/${lot.accepted_offer_id}`} variant="secondary">
              {t('order.viewOffer', { defaultValue: 'View agreed offer' })}
            </LinkButton>
          ) : null
        }
      />

      <KpiStrip
        columns={4}
        items={[
          { id: 'qty', label: t('order.quantity', { defaultValue: 'Quantity' }), value: <Quantity kg={lot.total_quantity_kg} /> },
          { id: 'price', label: t('order.price', { defaultValue: 'Agreed price' }), value: <Money value={lot.price_per_kg} perKg /> },
          { id: 'value', label: t('order.value', { defaultValue: 'Order value' }), value: <Money value={value} /> },
          { id: 'pickup', label: t('order.pickup', { defaultValue: 'Pickup date' }), value: formatDate(lot.pickup_date) },
        ]}
      />

      <Reveal>
        <SectionCard eyebrow={t('order.journeyEyebrow', { defaultValue: 'Journey' })} title={t('order.journey', { defaultValue: 'From farm gate to settlement' })}>
          <QueryState query={timeline} skeleton="list">
            {(steps) => <JourneyTimeline steps={steps} showDetails />}
          </QueryState>
        </SectionCard>
      </Reveal>

      {lot.transport_request_id ? (
        <SectionCard
          eyebrow={t('order.transportEyebrow', { defaultValue: 'Transport' })}
          title={
            request.data?.transporter_name
              ? t('order.transportBy', { defaultValue: 'Carried by {{name}}', name: request.data.transporter_name })
              : t('order.transport', { defaultValue: 'Pickup route' })
          }
          action={request.data ? <StatusBadge kind="transport" value={request.data.status} /> : null}
        >
          {request.isPending ? (
            <Skeleton className="h-72 w-full rounded-card" />
          ) : request.data ? (
            <div className="space-y-4">
              <RouteMap
                stops={request.data.stops}
                destination={{
                  name: request.data.destination_name,
                  latitude: request.data.destination_latitude,
                  longitude: request.data.destination_longitude,
                }}
                totalDistanceKm={request.data.estimated_distance_km}
                showLegend
              />
              <p className="text-small text-muted">
                {t('order.transportMeta', {
                  defaultValue: '{{stops}} pickup stops · {{km}} km to {{dest}}',
                  stops: request.data.stops.length,
                  km: Math.round(request.data.estimated_distance_km),
                  dest: request.data.destination_name,
                })}
              </p>
            </div>
          ) : (
            <p className="text-small text-muted">{t('order.transportError', { defaultValue: 'Transport details are not available right now.' })}</p>
          )}
        </SectionCard>
      ) : lot.pickup_terms === 'mandimate_delivery' && !delivered ? (
        <SectionCard eyebrow={t('order.transportEyebrow', { defaultValue: 'Transport' })} title={t('order.transportPending', { defaultValue: 'Transport is being arranged' })}>
          <EmptyState
            size="sm"
            icon={<Truck strokeWidth={1.25} aria-hidden />}
            title={t('order.transportPendingTitle', { defaultValue: 'No vehicle booked yet' })}
            description={t('order.transportPendingBody', {
              defaultValue: 'The coordinator books a transporter and plans the pickup route; you will see it here.',
            })}
          />
        </SectionCard>
      ) : null}

      <SectionCard
        id="delivery"
        eyebrow={t('order.deliveryEyebrow', { defaultValue: 'Delivery & quality check' })}
        title={
          delivered
            ? t('order.deliveryRecorded', { defaultValue: 'Weighed and inspected' })
            : canRecord
              ? t('order.deliveryRecord', { defaultValue: 'Record what arrived' })
              : t('order.deliveryWaiting', { defaultValue: 'Awaiting arrival' })
        }
      >
        {delivered ? (
          <QueryState query={delivery} skeleton="table">
            {(record) => <DeliveryRecordView record={record} />}
          </QueryState>
        ) : canRecord ? (
          <DeliveryForm lot={lot} request={request.data ?? null} />
        ) : (
          <p className="text-small text-muted">
            {lot.status === 'cancelled'
              ? t('order.cancelled', { defaultValue: 'This order was cancelled.' })
              : t('order.deliveryLater', {
                  defaultValue: 'Once transport is booked and the produce is on its way, record weights and your quality check here.',
                })}
          </p>
        )}
      </SectionCard>

      <SectionCard eyebrow={t('order.membersEyebrow', { defaultValue: 'Supplying farmers' })} title={t('order.members', { defaultValue: '{{count}} farmers in this lot', count: lot.member_count })} flush>
        <LotMembersTable members={lot.members} showDelivery={delivered} />
      </SectionCard>

      {lot.settlement_id ? (
        <SectionCard
          variant="parchment"
          eyebrow={t('order.settlementEyebrow', { defaultValue: 'Settlement' })}
          title={t('order.settlement', { defaultValue: 'Payment is due on the accepted weight' })}
          action={
            <LinkButton to="/app/buyer/payments" trailingIcon={<ArrowRight strokeWidth={1.25} aria-hidden />}>
              {t('order.toPayments', { defaultValue: 'Go to payments' })}
            </LinkButton>
          }
        >
          <p className="text-small text-muted">
            {t('order.settlementBody', { defaultValue: 'Farmers are paid out as soon as your payment is recorded.' })}
          </p>
        </SectionCard>
      ) : null}
    </div>
  );
}

export default function OrderDetailPage() {
  const { lotId = '' } = useParams();
  const { t } = useTranslation('buyerOrders');
  const query = useLot(lotId);
  return (
    <>
      <Seo
        title={query.data ? `${query.data.code} · ${query.data.crop_name}` : t('order.seoTitle', { defaultValue: 'Order' })}
        description={t('order.seoDescription', { defaultValue: 'Transport, delivery record, quality check and payment for this lot.' })}
        path={`/app/buyer/orders/${lotId}`}
        noindex
      />
      <QueryState query={query} skeleton="detail" errorTitle={t('order.error', { defaultValue: 'Could not load this order' })}>
        {(lot) => <OrderBody lot={lot} />}
      </QueryState>
    </>
  );
}
