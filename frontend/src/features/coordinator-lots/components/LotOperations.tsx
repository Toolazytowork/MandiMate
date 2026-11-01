import { ArrowUpRight, PackageCheck, Route, Truck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DataTable, Money, Quantity, SectionCard, StatusBadge, TransportPlanSummary, type DataTableColumn } from '@/components/domain';
import { Button, Field, LinkButton, Skeleton, Textarea, toast } from '@/components/ui';
import { DELIVERABLE_LOT_STATUSES } from '@/features/coordinator/constants';
import { useCreateTransportRequest, useLotDelivery, useTransportPlan, useTransportRequest } from '@/features/coordinator/hooks';
import { errorMessage } from '@/features/coordinator/utils';
import { formatDateTime, formatNumber } from '@/lib/format';
import type { DeliveryItem, Lot } from '@/types/api';

const POST_DEAL: ReadonlySet<Lot['status']> = new Set(['offer_accepted', 'transport_booked', 'in_transit', 'delivered', 'settled']);

export function LotTransportSection({ lot }: { lot: Lot }) {
  const { t } = useTranslation('coordinatorLots');
  const [showPlan, setShowPlan] = useState(false);
  const [notes, setNotes] = useState('');
  const plan = useTransportPlan(lot.id, showPlan);
  const request = useTransportRequest(lot.transport_request_id);
  const create = useCreateTransportRequest();
  const canRequest = lot.status === 'offer_accepted' && lot.pickup_terms !== 'buyer_pickup' && !lot.transport_request_id;

  const desk = (
    <LinkButton to="/app/coordinator/transport" variant="ghost" size="sm" trailingIcon={<ArrowUpRight strokeWidth={1.25} aria-hidden="true" />}>
      {t('transport.desk', { defaultValue: 'Transport desk' })}
    </LinkButton>
  );

  let body;
  if (lot.pickup_terms === 'buyer_pickup') {
    body = (
      <p className="text-small text-ink/85">
        {t('transport.buyerPickup', {
          defaultValue: 'The buyer collects from {{point}} and pays for transport — no truck to arrange. Delivery can be recorded straight away.',
          point: lot.collection_point_name,
        })}
      </p>
    );
  } else if (lot.transport_request_id) {
    body = request.isPending ? (
      <Skeleton className="h-24 w-full" />
    ) : request.data ? (
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-small">
        <dt className="text-muted">{t('transport.status', { defaultValue: 'Request' })}</dt>
        <dd className="text-end">
          <StatusBadge kind="transport" value={request.data.status} size="sm" />
        </dd>
        <dt className="text-muted">{t('transport.transporter', { defaultValue: 'Transporter' })}</dt>
        <dd className="text-end text-ink">{request.data.transporter_name ?? t('transport.notBooked', { defaultValue: 'Not booked yet' })}</dd>
        <dt className="text-muted">{t('transport.quotes', { defaultValue: 'Quotes' })}</dt>
        <dd className="text-end tabular-nums text-ink">{request.data.quotes.length}</dd>
        <dt className="text-muted">{t('transport.estimate', { defaultValue: 'Estimated cost' })}</dt>
        <dd className="text-end">
          <Money value={request.data.estimated_cost} size="sm" />
        </dd>
        <dt className="text-muted">{t('transport.distance', { defaultValue: 'Route' })}</dt>
        <dd className="text-end tabular-nums text-ink">{formatNumber(request.data.estimated_distance_km, { maxDecimals: 1 })} km</dd>
      </dl>
    ) : (
      <p className="text-small text-muted">{errorMessage(request.error)}</p>
    );
  } else if (!POST_DEAL.has(lot.status)) {
    body = (
      <p className="text-small text-muted">
        {t('transport.afterDeal', { defaultValue: 'Transport is arranged once a buyer’s offer is accepted. You can preview the route now.' })}
      </p>
    );
  } else {
    body = null;
  }

  return (
    <SectionCard
      eyebrow={<Truck strokeWidth={1.25} aria-hidden="true" className="size-4" />}
      title={t('transport.title', { defaultValue: 'Transport' })}
      action={desk}
    >
      <div className="space-y-4">
        {body}
        {lot.pickup_terms !== 'buyer_pickup' && !lot.transport_request_id && lot.status !== 'cancelled' ? (
          <>
            {showPlan ? (
              plan.isPending ? (
                <Skeleton className="h-56 w-full" />
              ) : plan.data ? (
                <TransportPlanSummary plan={plan.data} showMap />
              ) : (
                <p className="text-small text-danger-ink">{errorMessage(plan.error)}</p>
              )
            ) : (
              <Button variant="secondary" size="sm" leadingIcon={<Route strokeWidth={1.25} aria-hidden="true" />} onClick={() => setShowPlan(true)}>
                {t('transport.preview', { defaultValue: 'Preview route & vehicle' })}
              </Button>
            )}
            {canRequest ? (
              <div className="space-y-3 border-t border-line pt-4">
                <Field label={t('transport.notes', { defaultValue: 'Notes for transporters' })} optional>
                  <Textarea rows={2} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} />
                </Field>
                <Button
                  fullWidth
                  loading={create.isPending}
                  leadingIcon={<Truck strokeWidth={1.25} aria-hidden="true" />}
                  onClick={() =>
                    create.mutate(
                      { lotId: lot.id, notes: notes.trim() || null },
                      {
                        onSuccess: () => {
                          toast.success(t('transport.requested', { defaultValue: 'Transport requested — transporters can now quote' }));
                          setNotes('');
                        },
                        onError: (error) => toast.error(errorMessage(error)),
                      },
                    )
                  }
                >
                  {t('transport.request', { defaultValue: 'Request transport' })}
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </SectionCard>
  );
}

export function LotDeliverySection({ lot }: { lot: Lot }) {
  const { t } = useTranslation('coordinatorLots');
  const relevant = DELIVERABLE_LOT_STATUSES.has(lot.status) || lot.status === 'delivered' || lot.status === 'settled';
  const delivery = useLotDelivery(lot.id, relevant);
  if (!relevant) return null;

  const columns: DataTableColumn<DeliveryItem>[] = [
    { id: 'farmer', header: t('delivery.farmer', { defaultValue: 'Farmer' }), cell: (item) => item.farmer_name, sortValue: (item) => item.farmer_name },
    { id: 'dispatched', header: t('delivery.dispatched', { defaultValue: 'Dispatched' }), numeric: true, hideBelow: 'md', cell: (item) => formatNumber(item.dispatched_kg, { maxDecimals: 1 }) },
    { id: 'accepted', header: t('delivery.accepted', { defaultValue: 'Accepted' }), numeric: true, cell: (item) => formatNumber(item.accepted_kg, { maxDecimals: 1 }) },
    { id: 'rejected', header: t('delivery.rejected', { defaultValue: 'Rejected' }), numeric: true, cell: (item) => formatNumber(item.rejected_kg, { maxDecimals: 1 }) },
    { id: 'reason', header: t('delivery.reason', { defaultValue: 'Reason' }), hideBelow: 'lg', cell: (item) => item.rejection_reason ?? '—' },
  ];

  return (
    <SectionCard
      eyebrow={<PackageCheck strokeWidth={1.25} aria-hidden="true" className="size-4" />}
      title={t('delivery.title', { defaultValue: 'Delivery & quality' })}
      action={
        lot.settlement_id ? (
          <LinkButton to={`/app/coordinator/settlements/${lot.settlement_id}`} size="sm" variant="secondary" trailingIcon={<ArrowUpRight strokeWidth={1.25} aria-hidden="true" />}>
            {t('delivery.settlement', { defaultValue: 'Settlement' })}
          </LinkButton>
        ) : undefined
      }
    >
      {delivery.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : delivery.isError ? (
        <p className="text-small text-danger-ink">{errorMessage(delivery.error)}</p>
      ) : !delivery.data ? (
        <div className="space-y-3">
          <p className="text-small text-muted">
            {t('delivery.none', { defaultValue: 'Delivery has not been recorded yet. Weigh and inspect at the buyer, then record it from the transport desk.' })}
          </p>
          <LinkButton to="/app/coordinator/transport" size="sm" variant="secondary">
            {t('transport.desk', { defaultValue: 'Transport desk' })}
          </LinkButton>
        </div>
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {(
              [
                ['dispatched', t('delivery.dispatched', { defaultValue: 'Dispatched' }), delivery.data.total_dispatched_kg],
                ['delivered', t('delivery.delivered', { defaultValue: 'Delivered' }), delivery.data.total_delivered_kg],
                ['accepted', t('delivery.accepted', { defaultValue: 'Accepted' }), delivery.data.total_accepted_kg],
                ['rejected', t('delivery.rejected', { defaultValue: 'Rejected' }), delivery.data.total_rejected_kg],
              ] as const
            ).map(([id, label, kg]) => (
              <div key={id}>
                <dt className="eyebrow text-muted">{label}</dt>
                <dd>
                  <Quantity kg={kg} size="lg" />
                </dd>
              </div>
            ))}
          </dl>
          <DataTable label={t('delivery.table', { defaultValue: 'Delivery by farmer' })} columns={columns} rows={delivery.data.items} getRowId={(item) => item.member_id} />
          <p className="text-micro text-muted">
            {t('delivery.recorded', {
              defaultValue: 'Recorded by {{name}} · {{at}}',
              name: delivery.data.recorded_by_name,
              at: formatDateTime(delivery.data.recorded_at),
            })}
            {delivery.data.inspector_name ? ` · ${t('delivery.inspector', { defaultValue: 'inspected by {{name}}', name: delivery.data.inspector_name })}` : ''}
          </p>
        </div>
      )}
    </SectionCard>
  );
}
