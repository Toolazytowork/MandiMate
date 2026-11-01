import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';
import { round } from './geometry';

const CENTER = 200;
const CORE_RADIUS = 52;

/** Individual harvests: [angle°, distance, radius]. Sizes differ like real farm quantities. */
const HARVESTS: readonly (readonly [number, number, number])[] = [
  [-152, 150, 12],
  [-112, 172, 8],
  [-70, 144, 15],
  [-28, 168, 9],
  [14, 150, 12],
  [56, 172, 8],
  [98, 146, 16],
  [140, 168, 9],
  [184, 156, 11],
];

const NODES = HARVESTS.map(([angle, distance, radius], index) => {
  const radians = (angle * Math.PI) / 180;
  const x = CENTER + distance * Math.cos(radians);
  const y = CENTER + distance * Math.sin(radians);
  const travel = distance - CORE_RADIUS * 0.4;
  return {
    x: round(x),
    y: round(y),
    r: radius,
    dx: round(-Math.cos(radians) * travel),
    dy: round(-Math.sin(radians) * travel),
    delay: index * 0.62,
    // Spoke ends on the core's rim.
    ex: round(CENTER + CORE_RADIUS * Math.cos(radians)),
    ey: round(CENTER + CORE_RADIUS * Math.sin(radians)),
  };
});

const TONES = {
  dark: { spoke: 'text-ivory/20', node: 'fill-transparent stroke-ivory/45', halo: 'stroke-gold-400/35', core: 'stroke-gold-400/80' },
  light: { spoke: 'text-ink/20', node: 'fill-transparent stroke-ink/40', halo: 'stroke-gold-500/40', core: 'stroke-gold-700/80' },
} as const;

export interface PoolingMotifProps {
  tone?: keyof typeof TONES;
  /** Harvests drift into the shared lot, one after another. */
  animated?: boolean;
  className?: string;
}

/**
 * Small harvests converging into one lot — MandiMate's pooling idea as a quiet, looping diagram.
 * Decorative (aria-hidden); motion stops under reduced-motion preferences.
 */
export function PoolingMotif({ tone = 'dark', animated = true, className }: PoolingMotifProps) {
  const palette = TONES[tone];

  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 400 400" fill="none" className={cn('h-auto w-full', className)}>
      <g className={palette.spoke} stroke="currentColor" strokeWidth="1" strokeDasharray="1 6" strokeLinecap="round">
        {NODES.map((node, index) => (
          <line key={index} x1={node.x} y1={node.y} x2={node.ex} y2={node.ey} />
        ))}
      </g>

      <circle cx={CENTER} cy={CENTER} r={CORE_RADIUS + 22} className={palette.halo} strokeWidth="1" strokeDasharray="1 5" strokeLinecap="round" />
      <circle cx={CENTER} cy={CENTER} r={CORE_RADIUS} className={palette.core} strokeWidth="1" />
      <circle cx={CENTER} cy={CENTER} r={CORE_RADIUS - 6} className={palette.halo} strokeWidth="0.75" />

      {NODES.map((node, index) => (
        <circle
          key={index}
          cx={node.x}
          cy={node.y}
          r={node.r}
          strokeWidth="1"
          className={cn(palette.node, 'origin-center [transform-box:fill-box]', animated && 'animate-converge')}
          style={
            animated
              ? ({ '--dx': `${node.dx}px`, '--dy': `${node.dy}px`, animationDelay: `${node.delay}s` } as CSSProperties)
              : undefined
          }
        />
      ))}
    </svg>
  );
}
