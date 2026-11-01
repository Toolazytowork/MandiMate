import { useId, type CSSProperties } from 'react';
import { cn } from '@/lib/cn';
import { round } from './geometry';

const WIDTH = 1200;
const HEIGHT = 600;
const HORIZON = 96;
const ROWS = 34;

interface Furrow {
  d: string;
  delay: number;
}

/** Crop rows running to the horizon, bending gently as if over a low hill. */
const FURROWS: Furrow[] = Array.from({ length: ROWS }, (_, index) => {
  const t = index / (ROWS - 1);
  const bottomX = -700 + t * (WIDTH + 1400);
  const topX = WIDTH * 0.56 + (bottomX - WIDTH * 0.5) * 0.1;
  const bend = 170 * Math.sin(Math.PI * (0.25 + t * 0.5));
  const controlX = (bottomX + topX) / 2 + bend;
  const controlY = HEIGHT * 0.52;
  return {
    d: `M${round(bottomX)} ${HEIGHT}Q${round(controlX)} ${round(controlY)} ${round(topX)} ${HORIZON}`,
    delay: Math.abs(t - 0.5) * 900,
  };
});

/** Soft terrace lines near the horizon. */
const TERRACES = [0, 1, 2].map((index) => {
  const y = HORIZON + 28 + index * 34;
  const sag = 18 + index * 10;
  return `M-40 ${y + sag}C${WIDTH * 0.3} ${y - sag} ${WIDTH * 0.7} ${y + sag * 1.6} ${WIDTH + 40} ${y}`;
});

export interface FieldLinesProps {
  /** Draw the rows in when first painted (CSS only; instant under reduced motion). */
  animated?: boolean;
  /** Colour comes from `currentColor`. */
  className?: string;
}

/** Field furrows in perspective, fading toward the horizon. Decorative; fills its positioned parent. */
export function FieldLines({ animated = false, className }: FieldLinesProps) {
  const id = useId();
  const fadeId = `${id}fade`;
  const maskId = `${id}mask`;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMax slice"
      className={cn('pointer-events-none absolute inset-0 h-full w-full', className)}
    >
      <defs>
        <linearGradient id={fadeId} x1="0" y1={HORIZON} x2="0" y2={HEIGHT} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.35" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="1" />
        </linearGradient>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={WIDTH} height={HEIGHT}>
          <rect width={WIDTH} height={HEIGHT} fill={`url(#${fadeId})`} />
        </mask>
      </defs>
      <g fill="none" stroke="currentColor" strokeWidth={0.75} strokeLinecap="round" mask={`url(#${maskId})`}>
        {TERRACES.map((d, index) => (
          <path key={`t${index}`} d={d} strokeOpacity={0.45} vectorEffect="non-scaling-stroke" />
        ))}
        {FURROWS.map((furrow, index) => (
          <path
            key={index}
            d={furrow.d}
            pathLength={1}
            vectorEffect="non-scaling-stroke"
            className={animated ? 'animate-draw [stroke-dasharray:1]' : undefined}
            style={animated ? ({ animationDelay: `${Math.round(furrow.delay)}ms` } as CSSProperties) : undefined}
          />
        ))}
      </g>
    </svg>
  );
}
