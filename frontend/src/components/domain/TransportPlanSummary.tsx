import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IndianRupee, Route, Scale, Truck } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatNumber, formatPct } from '@/lib/format';
import type { TransportPlan } from '@/types/api';
import { Money, useKgFormatter } from './Money';
import { RouteMap } from './RouteMap';

export interface UtilisationGaugeProps {
  /** Load as a percentage of the vehicle capacity across all trips. */
  pct: number;
  /** Caption under the value (defaults to "of the truck filled"). */
  caption?: ReactNode;
  className?: string;
}

/** Half-dial gauge for vehicle utilisation: the fuller the truck, the cheaper every kilogram. */
export function UtilisationGauge({ pct, caption, className }: UtilisationGaugeProps) {
  const { t } = useTranslation('domain');
  const value = Math.min(100, Math.max(0, Number.isFinite(pct) ? pct : 0));
  const arc = 'M10 60a50 50 0 0 1 100 0';
  return (
    <div className={cn('relative flex w-36 flex-col items-center', className)}>
      <svg
        viewBox="0 0 120 66"
        role="img"
        aria-label={t('transport.utilisationLabel', { pct: formatPct(value, { decimals: 0 }) })}
        className="w-full"
      >
        <path d={arc} fill="none" stroke="#DDD6CA" strokeWidth="1" />
        {value > 0 ? (
          <path
            d={arc}
            fill="none"
            stroke="#7C5F31"
            strokeWidth="2.5"
            pathLength={100}
            strokeDasharray={`${value} 100`}
          />
        ) : null}
      </svg>
      <div aria-hidden="true" className="-mt-9 flex flex-col items-center">
        <span className="font-display text-h2 font-bold leading-none tabular-nums text-ink">{formatPct(value, { decimals: 0 })}</span>
        <span className="mt-1.5 text-[13px] font-semibold text-muted">{caption ?? t('transport.filled')}</span>
      </div>
    </div>
  );
}

export interface TransportPlanSummaryProps {
  plan: TransportPlan;
  /** Draw the route map with the stop list (default true). */
  showMap?: boolean;
  className?: string;
}

/**
 * The shared trip behind a pooled lot: suggested vehicle and trips, how full it runs, distance,
 * estimated cost and what it adds per kilogram — plus the pickup route.
 */
export function TransportPlanSummary({ plan, showMap = true, className }: TransportPlanSummaryProps) {
  const { t } = useTranslation('domain');
  const formatKg = useKgFormatter();
  const totalKg = plan.stops.reduce((sum, stop) => sum + stop.quantity_kg, 0);

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <div className="grid items-center gap-6 sm:grid-cols-[auto_1fr]">
        <UtilisationGauge pct={plan.utilization_pct} className="mx-auto sm:mx-0" />
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
          <Fact icon={<Truck />} label={t('common:labels.vehicle')}>
            <span className="font-medium">{t(`common:enums.vehicleType.${plan.suggested_vehicle_type}`)}</span>
            <span className="text-xs text-muted">
              {t('common:units.trips', { count: plan.trips_needed })} ·{' '}
              {t('transport.capacity', { quantity: formatKg(plan.vehicle_capacity_kg) })}
            </span>
          </Fact>
          <Fact icon={<Route />} label={t('common:labels.distance')}>
            <span className="font-medium tabular-nums">
              {t('common:units.kmValue', { value: formatNumber(plan.total_distance_km, { maxDecimals: 1 }) })}
            </span>
            <span className="text-xs text-muted">{t('common:units.stops', { count: plan.stops.length })}</span>
          </Fact>
          <Fact icon={<IndianRupee />} label={t('transport.estimatedCost')}>
            <Money value={plan.estimated_cost} size="lg" />
            <span className="text-xs text-muted">{t('transport.forLoad', { quantity: formatKg(totalKg) })}</span>
          </Fact>
          <Fact icon={<Scale />} label={t('transport.perKg')}>
            <Money value={plan.cost_per_kg} perKg size="lg" className="text-ink" />
            <span className="text-xs text-muted">{t('transport.sharedByWeight')}</span>
          </Fact>
        </dl>
      </div>

      {showMap ? (
        <RouteMap
          stops={plan.stops}
          destination={{ name: plan.destination_name, latitude: plan.destination_latitude, longitude: plan.destination_longitude }}
          route={plan.route}
          totalDistanceKm={plan.total_distance_km}
        />
      ) : null}
    </div>
  );
}

function Fact({ icon, label, children }: { icon: ReactNode; label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="flex items-center gap-1.5 text-[13px] font-semibold text-muted">
        <span aria-hidden="true" className="text-muted [&_svg]:size-3.5 [&_svg]:stroke-[1.25]">
          {icon}
        </span>
        {label}
      </dt>
      <dd className="flex min-w-0 flex-col gap-1 text-ink">{children}</dd>
    </div>
  );
}
