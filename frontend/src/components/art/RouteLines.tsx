import { cn } from '@/lib/cn';
import { smoothPath, type Point } from './geometry';

const STOPS: readonly Point[] = [
  [64, 318],
  [176, 232],
  [292, 274],
  [404, 166],
];
const DESTINATION: Point = [540, 92];
const ROUTE = smoothPath([...STOPS, DESTINATION]);

const TONES = {
  dark: { track: 'text-ivory/15', dots: 'text-gold-400/80', label: 'fill-gold-400', destination: 'stroke-ivory/80', ring: 'stroke-gold-400/50', pin: 'fill-forest-900 stroke-gold-400' },
  light: { track: 'text-ink/15', dots: 'text-gold-700/80', label: 'fill-gold-700', destination: 'stroke-ink/80', ring: 'stroke-gold-500/50', pin: 'fill-paper stroke-gold-700' },
} as const;

export interface RouteLinesProps {
  tone?: keyof typeof TONES;
  /** Dots flow along the route toward the buyer. */
  animated?: boolean;
  className?: string;
}

/** A shared pickup route: numbered green stops at each farm, ending at the buyer. Thin line art; decorative. */
export function RouteLines({ tone = 'dark', animated = true, className }: RouteLinesProps) {
  const palette = TONES[tone];
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 600 400" fill="none" className={cn('h-auto w-full', className)}>
      <path d={ROUTE} className={palette.track} stroke="currentColor" strokeWidth="1" />
      <path
        d={ROUTE}
        className={cn(palette.dots, animated && 'animate-dash')}
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeDasharray="1 7"
      />

      <g>
        <circle cx={DESTINATION[0]} cy={DESTINATION[1]} r="18" className={palette.ring} strokeWidth="1" strokeDasharray="1 4" strokeLinecap="round" />
        <rect
          x={DESTINATION[0] - 7}
          y={DESTINATION[1] - 7}
          width="14"
          height="14"
          strokeWidth="1"
          className={palette.destination}
        />
      </g>

      {STOPS.map(([x, y], index) => (
        <g key={index}>
          <circle cx={x} cy={y} r="4.5" strokeWidth="1" className={palette.pin} />
          <text
            x={x}
            y={y - 14}
            textAnchor="middle"
            className={palette.label}
            style={{ font: '600 13px/1 var(--font-display)', fontVariantNumeric: 'tabular-nums' }}
          >
            {String(index + 1).padStart(2, '0')}
          </text>
        </g>
      ))}
    </svg>
  );
}
