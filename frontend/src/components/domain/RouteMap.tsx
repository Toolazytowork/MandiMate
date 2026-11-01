import { useId, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Flag } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';
import type { PickupStop } from '@/types/api';
import { useElementWidth } from './hooks';
import { Quantity, useKgFormatter } from './Money';
import { fitProjection, niceScale, placeLabels, polylinePath, type LatLng, type ScreenPoint } from './routeGeometry';
import { StatusBadge } from './StatusBadge';

export type RouteMapStop = Pick<
  PickupStop,
  'id' | 'sequence' | 'farmer_name' | 'village' | 'latitude' | 'longitude' | 'quantity_kg' | 'status'
>;

export interface RouteDestination {
  name: string;
  latitude: number;
  longitude: number;
}

export interface RouteMapProps {
  stops: readonly RouteMapStop[];
  destination: RouteDestination;
  /** Ordered `[lat, lng]` route (e.g. `TransportPlan.route`); defaults to stops by sequence, then the destination. */
  route?: readonly LatLng[];
  /** Total road distance for the accessible summary and the caption. */
  totalDistanceKm?: number | null;
  /** Ordered list of stops under the map (default true). */
  showLegend?: boolean;
  className?: string;
}

const FALLBACK_WIDTH = 720;
const COMPACT_WIDTH = 520;
const LABEL_HEIGHT = 34;
/** Strip along the bottom edge reserved for the scale bar and north arrow, so pins never cover them. */
const FOOTER_STRIP = 30;

/** Approximate rendered width of a label line in px (Inter at 12 / 11 px). */
function labelWidth(title: string, subtitle: string): number {
  return Math.ceil(Math.max(title.length * 6.9, subtitle.length * 6.1)) + 20;
}

/**
 * Pickup route drawn in pure SVG: an equirectangular projection fitted to the stops, small numbered
 * green markers in pickup order, a thin dashed route to a flagged destination, a faint survey grid
 * with a scale bar and north arrow. Labels collapse into the list below on narrow screens.
 */
export function RouteMap({ stops, destination, route, totalDistanceKm, showLegend = true, className }: RouteMapProps) {
  const { t } = useTranslation('domain');
  const formatKg = useKgFormatter();
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(containerRef, FALLBACK_WIDTH);
  const svgId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const compact = width < COMPACT_WIDTH;

  const ordered = useMemo(() => [...stops].sort((a, b) => a.sequence - b.sequence), [stops]);
  const destinationPoint: LatLng = [destination.latitude, destination.longitude];
  const routePoints: readonly LatLng[] =
    route && route.length > 1 ? route : [...ordered.map((stop): LatLng => [stop.latitude, stop.longitude]), destinationPoint];

  const projection = fitProjection([...routePoints, ...ordered.map((stop): LatLng => [stop.latitude, stop.longitude]), destinationPoint], {
    width,
    padding: compact
      ? { top: 40, right: 28, bottom: 24 + FOOTER_STRIP, left: 28 }
      : { top: 56, right: 56, bottom: 36 + FOOTER_STRIP, left: 56 },
    minAspect: compact ? 0.8 : 0.48,
    maxAspect: compact ? 1.1 : 0.62,
  });
  const { height } = projection;
  const pins = ordered.map((stop) => ({ stop, at: projection.project([stop.latitude, stop.longitude]) }));
  const flag = projection.project(destinationPoint);
  const path = polylinePath(routePoints.map(projection.project));
  const scale = niceScale(projection.pxPerKm, Math.min(140, width * 0.24));
  const gridStep = Math.max(scale.px, 24);

  const labelTexts = [
    ...pins.map(({ stop }) => ({ title: stop.farmer_name, subtitle: [stop.village, formatKg(stop.quantity_kg)].filter(Boolean).join(' · ') })),
    { title: destination.name, subtitle: t('route.destination') },
  ];
  const placements = compact
    ? []
    : placeLabels(
        [...pins.map(({ at }) => at), flag].map((anchor, index) => ({
          anchor,
          width: labelWidth(labelTexts[index]!.title, labelTexts[index]!.subtitle),
          height: LABEL_HEIGHT,
        })),
        { width, height: height - FOOTER_STRIP },
      );

  const summary = t('route.summary', {
    count: ordered.length,
    destination: destination.name,
    distance:
      typeof totalDistanceKm === 'number'
        ? t('common:units.kmValue', { value: formatNumber(totalDistanceKm, { maxDecimals: 1 }) })
        : t('route.distanceUnknown'),
  });

  return (
    <figure className={cn('flex flex-col gap-4', className)}>
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-card border border-line bg-paper"
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-labelledby={`${svgId}-title`}
          className="block h-auto w-full"
          style={{ aspectRatio: `${width} / ${height}` }}
        >
          <title id={`${svgId}-title`}>{summary}</title>
          <defs>
            <pattern id={`${svgId}-grid`} width={gridStep} height={gridStep} patternUnits="userSpaceOnUse" x={width / 2} y={height / 2}>
              <path d={`M${gridStep} 0H0V${gridStep}`} fill="none" stroke="#1B1611" strokeOpacity="0.04" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width={width} height={height} fill={`url(#${svgId}-grid)`} />

          <path d={path} fill="none" stroke="#FBF9F4" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          <path
            d={path}
            fill="none"
            stroke="#1F1913"
            strokeOpacity="0.7"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="4 4"
          />

          <DestinationFlag at={flag} />
          {pins.map(({ stop, at }) => (
            <Pin key={stop.id} at={at} number={stop.sequence} status={stop.status} />
          ))}

          {placements.map((placement, index) => {
            const text = labelTexts[index]!;
            const boxWidth = labelWidth(text.title, text.subtitle);
            return (
              <g key={index} transform={`translate(${placement.x} ${placement.y})`} aria-hidden="true">
                <rect width={boxWidth} height={LABEL_HEIGHT} rx="2" fill="#FBF9F4" fillOpacity="0.96" stroke="#DDD6CA" />
                <text x="10" y="14" style={{ font: '500 12px/1 var(--font-sans)' }} fill="#1B1611">
                  {text.title}
                </text>
                <text x="10" y="27" style={{ font: '400 11px/1 var(--font-sans)' }} fill="#6B6256">
                  {text.subtitle}
                </text>
              </g>
            );
          })}

          <g aria-hidden="true" transform={`translate(18 ${height - 16})`}>
            <path d={`M0 -5V0H${scale.px}V-5`} fill="none" stroke="#1B1611" strokeOpacity="0.5" strokeWidth="1" />
            <text x={scale.px + 8} y="0" style={{ font: '500 10px/1 var(--font-sans)', letterSpacing: '0.12em' }} fill="#6B6256">
              {t('common:units.kmValue', { value: formatNumber(scale.km, { maxDecimals: 2 }) })}
            </text>
          </g>
          <g aria-hidden="true" transform={`translate(${width - 22} ${height - 20})`}>
            <path d="M0 -9 L4 3 L0 0.5 L-4 3 Z" fill="none" stroke="#7C5F31" strokeWidth="1" strokeLinejoin="round" />
            <text y="12" textAnchor="middle" style={{ font: '500 9px/1 var(--font-sans)', letterSpacing: '0.12em' }} fill="#6B6256">
              N
            </text>
          </g>
        </svg>
      </div>

      {showLegend ? (
        <figcaption>
          <ol className="grid gap-x-10 text-sm sm:grid-cols-2">
            {ordered.map((stop) => (
              <li key={stop.id} className="flex min-w-0 items-center gap-3 border-t border-line py-3">
                <span
                  aria-hidden="true"
                  className={cn(
                    'w-7 shrink-0 font-display text-[19px] font-bold not-italic leading-none tabular-nums',
                    stop.status === 'picked_up'
                      ? 'text-forest-700'
                      : stop.status === 'skipped'
                        ? 'text-muted line-through decoration-1'
                        : 'text-gold-700',
                  )}
                >
                  {String(stop.sequence).padStart(2, '0')}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-ink">
                    <span className="sr-only">{t('route.stopNumber', { number: stop.sequence })} </span>
                    {stop.farmer_name}
                  </span>
                  <span className="flex items-center gap-1.5 truncate text-xs text-muted">
                    {stop.village ? <span className="truncate">{stop.village} ·</span> : null}
                    <Quantity kg={stop.quantity_kg} size="sm" className="text-xs font-normal" />
                  </span>
                </span>
                {stop.status !== 'pending' ? <StatusBadge kind="stop" value={stop.status} size="sm" /> : null}
              </li>
            ))}
            <li className="flex min-w-0 items-center gap-3 border-t border-line py-3">
              <span aria-hidden="true" className="w-7 shrink-0 text-gold-700">
                <Flag strokeWidth={1.25} className="size-4" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-ink">{destination.name}</span>
                <span className="text-[13px] font-semibold text-muted">
                  {t('route.destination')}
                  {typeof totalDistanceKm === 'number'
                    ? ` · ${t('common:units.kmValue', { value: formatNumber(totalDistanceKm, { maxDecimals: 1 }) })}`
                    : ''}
                </span>
              </span>
            </li>
          </ol>
        </figcaption>
      ) : null}
    </figure>
  );
}

function Pin({ at: [x, y], number, status }: { at: ScreenPoint; number: number; status: RouteMapStop['status'] }) {
  const palette =
    status === 'picked_up'
      ? { stroke: '#2F6B4B', text: '#2F6B4B', dash: undefined }
      : status === 'skipped'
        ? { stroke: '#6B6256', text: '#6B6256', dash: '2 2' }
        : { stroke: '#7C5F31', text: '#7C5F31', dash: undefined };
  return (
    <g aria-hidden="true">
      <path d={`M${x} ${y}V${y - 9}`} stroke={palette.stroke} strokeWidth="1" />
      <circle cx={x} cy={y} r="1.5" fill={palette.stroke} />
      <circle cx={x} cy={y - 19} r="10" fill="#FBF9F4" stroke={palette.stroke} strokeWidth="1" strokeDasharray={palette.dash} />
      <text
        x={x}
        y={y - 15}
        textAnchor="middle"
        style={{ font: 'not-italic 300 13px/1 var(--font-display)', fontVariantNumeric: 'tabular-nums' }}
        fill={palette.text}
      >
        {number}
      </text>
    </g>
  );
}

function DestinationFlag({ at: [x, y] }: { at: ScreenPoint }) {
  return (
    <g aria-hidden="true">
      <circle cx={x} cy={y} r="12" fill="none" stroke="#7C5F31" strokeOpacity="0.6" strokeDasharray="1 3" strokeLinecap="round" />
      <circle cx={x} cy={y} r="1.5" fill="#1F1913" />
      <path d={`M${x} ${y}V${y - 30}`} stroke="#1F1913" strokeWidth="1" strokeLinecap="round" />
      <path d={`M${x} ${y - 30}h16l-4 5 4 5h-16Z`} fill="none" stroke="#1F1913" strokeWidth="1" strokeLinejoin="round" />
    </g>
  );
}
