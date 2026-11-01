import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ArrowUpRight, CalendarDays, MapPin, Snowflake, Truck } from 'lucide-react';

import { CropGlyph, Money, StatusBadge, useKgFormatter, useNow, useUiLanguage } from '@/components/domain';
import { Badge, Card } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDate, formatNumber, formatRelative } from '@/lib/format';
import type { TransportQuote, TransportRequest } from '@/types/api';

import { daysUntil } from '../requests';

export interface RequestCardProps {
  request: TransportRequest;
  /** Where the card leads (request detail, or the trip when booked). */
  to: string;
  /** The viewer's latest quote on this request, if any. */
  myQuote?: TransportQuote | null;
  /** One of the viewer's active vehicles can carry the load in one run. */
  fits?: boolean;
  className?: string;
}

/** An open pickup request at a glance: load, stops, destination, pickup day and MandiMate's estimate. */
export function RequestCard({ request, to, myQuote, fits = false, className }: RequestCardProps) {
  const { t } = useTranslation('transporter');
  const locale = useUiLanguage();
  const now = useNow();
  const formatKg = useKgFormatter();
  const days = daysUntil(request.pickup_date);
  const soon = days >= 0 && days <= 1;
  const perKg = request.total_quantity_kg > 0 ? request.estimated_cost / request.total_quantity_kg : null;

  return (
    <Card as="article" interactive className={cn('flex flex-col overflow-hidden', className)}>
      <div className="flex items-start gap-4 px-5 pt-5 sm:px-6 sm:pt-6">
        <CropGlyph name={request.crop_name} lotCode={request.lot_code} framed size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="eyebrow">{request.lot_code}</p>
          <h3 className="font-display font-bold text-h3 leading-tight text-ink">
            <Link
              to={to}
              className="outline-none after:absolute after:inset-0 after:z-[1] after:rounded-card after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-gold-400"
            >
              {t('request.title', { quantity: formatKg(request.total_quantity_kg), crop: request.crop_name })}
            </Link>
          </h3>
          <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted">
            <MapPin aria-hidden="true" strokeWidth={1.25} className="size-3.5 shrink-0 text-muted" />
            <span className="truncate">
              {t('request.route', { count: request.stops.length, destination: request.destination_name })}
            </span>
          </p>
        </div>
        <ArrowUpRight aria-hidden="true" strokeWidth={1.25} className="size-4 shrink-0 text-ink/30" />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-5 pt-4 sm:px-6">
        <StatusBadge kind="transport" value={request.status} size="sm" />
        {request.requires_refrigeration ? (
          <Badge tone="info" size="sm" icon={<Snowflake aria-hidden="true" strokeWidth={1.25} />}>
            {t('request.refrigerated')}
          </Badge>
        ) : null}
        {fits ? (
          <Badge tone="success" size="sm" icon={<Truck aria-hidden="true" strokeWidth={1.25} />}>
            {t('request.fitsFleet')}
          </Badge>
        ) : null}
        {myQuote ? (
          <Badge tone={myQuote.status === 'submitted' ? 'gold' : myQuote.status === 'accepted' ? 'success' : 'neutral'} size="sm">
            {t(`request.myQuote.${myQuote.status}`)}
          </Badge>
        ) : null}
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-px border-t border-line/80 bg-line/60 text-sm sm:grid-cols-4">
        <Fact label={t('request.pickup')} icon={<CalendarDays strokeWidth={1.25} />}>
          <span className={cn('font-medium', soon && 'text-gold-700')}>{formatRelative(request.pickup_date, { now, locale })}</span>
          <span className="text-xs text-muted">{formatDate(request.pickup_date, { locale })}</span>
        </Fact>
        <Fact label={t('request.distance')}>
          <span className="font-medium tabular-nums">
            {t('common:units.kmValue', { value: formatNumber(request.estimated_distance_km, { maxDecimals: 1 }) })}
          </span>
          <span className="text-xs text-muted">{t('common:units.stops', { count: request.stops.length })}</span>
        </Fact>
        <Fact label={t('request.suggested')}>
          <span className="font-medium">{t(`common:enums.vehicleType.${request.suggested_vehicle_type}`)}</span>
          <span className="text-xs text-muted">{t('request.mandimatePick')}</span>
        </Fact>
        <Fact label={t('request.estimate')}>
          <Money value={request.estimated_cost} size="md" />
          <span className="text-xs text-muted">
            {perKg !== null ? <Money value={perKg} perKg size="sm" className="text-xs font-normal text-muted" /> : null}
          </span>
        </Fact>
      </dl>

      {myQuote && myQuote.status === 'submitted' ? (
        <div className="flex items-center justify-between gap-3 border-t border-line bg-parchment/60 px-5 py-3 text-sm sm:px-6">
          <span className="text-[13px] font-semibold text-gold-700">{t('request.yourPrice')}</span>
          <span className="flex items-baseline gap-2">
            <Money value={myQuote.price_total} size="md" />
            <Money value={myQuote.price_per_kg} perKg size="sm" className="text-xs font-normal text-muted" />
          </span>
        </div>
      ) : null}
    </Card>
  );
}

function Fact({ label, icon, children }: { label: ReactNode; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-paper px-5 py-3.5 sm:px-6">
      <dt className="flex items-center gap-1.5 text-[13px] font-semibold text-muted">
        {icon ? (
          <span aria-hidden="true" className="text-muted [&_svg]:size-3 [&_svg]:stroke-[1.25]">
            {icon}
          </span>
        ) : null}
        {label}
      </dt>
      <dd className="flex min-w-0 flex-col gap-0.5 text-ink">{children}</dd>
    </div>
  );
}
