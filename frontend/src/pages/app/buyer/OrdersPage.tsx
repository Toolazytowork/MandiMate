import { PackageCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import {
  DataTable,
  GradeBadge,
  JourneyMeter,
  KpiStrip,
  Money,
  PageHeader,
  QueryState,
  Quantity,
  StatusBadge,
  type DataTableColumn,
} from '@/components/domain';
import { LinkButton, SegmentedControl } from '@/components/ui';
import { orderStage, type Order, type OrderStage } from '@/features/buyer/utils';
import { useBuyerOrders } from '@/features/buyer-orders/hooks';
import { formatDate } from '@/lib/format';
import { Seo } from '@/lib/seo';

export default function OrdersPage() {
  const { t } = useTranslation('buyerOrders');
  const navigate = useNavigate();
  const query = useBuyerOrders();
  const [stage, setStage] = useState<OrderStage>('active');

  const counts = useMemo(() => {
    const out: Record<OrderStage, number> = { active: 0, completed: 0, cancelled: 0 };
    for (const order of query.data ?? []) out[orderStage(order.lot)] += 1;
    return out;
  }, [query.data]);
  const inTransit = (query.data ?? []).filter((o) => o.lot.status === 'in_transit').length;
  const toInspect = (query.data ?? []).filter((o) => o.lot.status === 'transport_booked' || o.lot.status === 'in_transit' || (o.lot.status === 'offer_accepted' && o.lot.pickup_terms === 'buyer_pickup')).length;

  const columns: DataTableColumn<Order>[] = [
    {
      id: 'lot',
      header: t('orders.lot', { defaultValue: 'Lot' }),
      cell: ({ lot }) => (
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium text-ink">
            {lot.crop_name} <GradeBadge grade={lot.grade} size="sm" />
          </p>
          <p className="mt-1 text-[13px] font-semibold text-muted">
            {lot.code} · {t('orders.farmers', { defaultValue: '{{count}} farmers', count: lot.member_count })}
          </p>
        </div>
      ),
      sortValue: ({ lot }) => lot.code,
    },
    {
      id: 'qty',
      header: t('orders.quantity', { defaultValue: 'Quantity' }),
      cell: ({ lot }) => <Quantity kg={lot.total_quantity_kg} />,
      sortValue: ({ lot }) => lot.total_quantity_kg,
      numeric: true,
      align: 'right',
    },
    {
      id: 'price',
      header: t('orders.price', { defaultValue: 'Price' }),
      cell: ({ lot, offer }) => <Money value={lot.price_per_kg ?? offer?.price_per_kg ?? null} perKg size="sm" />,
      sortValue: ({ lot }) => lot.price_per_kg ?? 0,
      numeric: true,
      align: 'right',
      hideBelow: 'md',
    },
    {
      id: 'value',
      header: t('orders.value', { defaultValue: 'Value' }),
      cell: ({ lot, offer }) => {
        const price = lot.price_per_kg ?? offer?.price_per_kg ?? null;
        return <Money value={price !== null ? price * lot.total_quantity_kg : null} size="sm" />;
      },
      numeric: true,
      align: 'right',
      hideBelow: 'lg',
    },
    {
      id: 'journey',
      header: t('orders.journey', { defaultValue: 'Journey' }),
      cell: ({ lot }) => <JourneyMeter step={lot.journey_step} complete={lot.status === 'settled'} showLabel className="min-w-40" />,
      sortValue: ({ lot }) => lot.journey_step,
      hideBelow: 'md',
    },
    {
      id: 'status',
      header: t('orders.status', { defaultValue: 'Status' }),
      cell: ({ lot }) => <StatusBadge kind="lot" value={lot.status} size="sm" />,
      sortValue: ({ lot }) => lot.journey_step,
    },
    {
      id: 'pickup',
      header: t('orders.pickup', { defaultValue: 'Pickup' }),
      cell: ({ lot }) => <span className="tabular-nums">{formatDate(lot.pickup_date)}</span>,
      sortValue: ({ lot }) => lot.pickup_date,
      hideBelow: 'sm',
    },
  ];

  const rows = (query.data ?? []).filter((o) => orderStage(o.lot) === stage);

  return (
    <>
      <Seo
        title={t('orders.seoTitle', { defaultValue: 'Orders' })}
        description={t('orders.seoDescription', { defaultValue: 'Accepted deals from pickup through delivery, quality check and settlement.' })}
        path="/app/buyer/orders"
        noindex
      />
      <div className="space-y-10">
        <PageHeader
          eyebrow={t('orders.eyebrow', { defaultValue: 'Fulfilment' })}
          title={t('orders.title', { defaultValue: 'Orders' })}
          description={t('orders.description', {
            defaultValue: 'Every accepted deal from the farm gate to your dock — pickup, transport, weighing, quality check and settlement.',
          })}
          actions={
            <LinkButton to="/app/buyer/payments" variant="secondary">
              {t('orders.toPayments', { defaultValue: 'Payments' })}
            </LinkButton>
          }
        />

        <KpiStrip
          loading={query.isPending}
          columns={3}
          items={[
            { id: 'active', label: t('orders.kpiActive', { defaultValue: 'Active orders' }), value: counts.active },
            { id: 'transit', label: t('orders.kpiTransit', { defaultValue: 'In transit' }), value: inTransit },
            { id: 'inspect', label: t('orders.kpiInspect', { defaultValue: 'Ready to weigh & inspect' }), value: toInspect },
          ]}
        />

        <div className="flex flex-wrap items-center justify-between gap-4">
          <SegmentedControl<OrderStage>
            label={t('orders.filter', { defaultValue: 'Order stage' })}
            value={stage}
            onValueChange={setStage}
            options={[
              { value: 'active', label: `${t('orders.active', { defaultValue: 'Active' })} · ${counts.active}` },
              { value: 'completed', label: `${t('orders.completed', { defaultValue: 'Settled' })} · ${counts.completed}` },
              { value: 'cancelled', label: `${t('orders.cancelled', { defaultValue: 'Cancelled' })} · ${counts.cancelled}` },
            ]}
          />
        </div>

        <QueryState query={query} skeleton="table">
          {() => (
            <DataTable
              label={t('orders.tableLabel', { defaultValue: 'Your orders' })}
              rows={rows}
              columns={columns}
              getRowId={(row) => row.lot.id}
              onRowClick={(row) => navigate(`/app/buyer/orders/${row.lot.id}`)}
              defaultSort={{ columnId: 'pickup', direction: 'desc' }}
              emptyTitle={
                stage === 'active'
                  ? t('orders.emptyActive', { defaultValue: 'No active orders' })
                  : t('orders.emptyOther', { defaultValue: 'Nothing here yet' })
              }
              emptyDescription={t('orders.emptyBody', {
                defaultValue: 'When a seller accepts your offer, the lot becomes an order you can track here.',
              })}
              framed
            />
          )}
        </QueryState>
        <p className="flex items-center gap-2 text-small text-muted">
          <PackageCheck className="size-4" strokeWidth={1.25} aria-hidden />
          {t('orders.footnote', { defaultValue: 'You are invoiced only for weight accepted at your quality check.' })}
        </p>
      </div>
    </>
  );
}
