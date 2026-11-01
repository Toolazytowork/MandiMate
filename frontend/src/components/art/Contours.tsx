import { cn } from '@/lib/cn';
import { seeded, smoothPath, type Point } from './geometry';

const WIDTH = 1200;
const HEIGHT = 800;
const SAMPLES = 56;
const TAU = Math.PI * 2;

interface Peak {
  cx: number;
  cy: number;
  levels: number;
  start: number;
  step: number;
  seed: number;
  /** Horizontal stretch (> 1 widens the hill). */
  stretch: number;
}

const COMPOSITIONS = {
  ridge: [
    { cx: 930, cy: 150, levels: 17, start: 22, step: 33, seed: 7, stretch: 1.3 },
    { cx: 120, cy: 780, levels: 8, start: 26, step: 36, seed: 19, stretch: 1.15 },
  ],
  valley: [
    { cx: 240, cy: 120, levels: 15, start: 24, step: 35, seed: 3, stretch: 1.25 },
    { cx: 1090, cy: 720, levels: 10, start: 28, step: 34, seed: 11, stretch: 1.2 },
  ],
  basin: [{ cx: 600, cy: 430, levels: 19, start: 18, step: 29, seed: 23, stretch: 1.35 }],
} satisfies Record<string, Peak[]>;

export type ContourVariant = keyof typeof COMPOSITIONS;

interface ContourLine {
  d: string;
  major: boolean;
}

function buildLines(peaks: readonly Peak[]): ContourLine[] {
  const lines: ContourLine[] = [];
  for (const peak of peaks) {
    const random = seeded(peak.seed);
    const phases = [random(), random(), random(), random()].map((value) => value * TAU);
    for (let level = 0; level < peak.levels; level += 1) {
      const radius = peak.start + level * peak.step;
      const points: Point[] = [];
      for (let i = 0; i < SAMPLES; i += 1) {
        const theta = (i / SAMPLES) * TAU;
        const wobble =
          0.11 * Math.sin(2 * theta + phases[0] + level * 0.07) +
          0.06 * Math.sin(3 * theta + phases[1] - level * 0.05) +
          0.035 * Math.sin(5 * theta + phases[2] + level * 0.09) +
          0.018 * Math.sin(7 * theta + phases[3]);
        const r = radius * (1 + wobble);
        points.push([peak.cx + r * Math.cos(theta) * peak.stretch, peak.cy + r * Math.sin(theta)]);
      }
      lines.push({ d: smoothPath(points, true), major: level % 5 === 4 });
    }
  }
  return lines;
}

const cache = new Map<ContourVariant, ContourLine[]>();

function linesFor(variant: ContourVariant): ContourLine[] {
  let lines = cache.get(variant);
  if (!lines) {
    lines = buildLines(COMPOSITIONS[variant]);
    cache.set(variant, lines);
  }
  return lines;
}

export interface ContoursProps {
  variant?: ContourVariant;
  /** Colour comes from `currentColor` — set it with a text utility, e.g. `text-white/[0.07]`. */
  className?: string;
}

/**
 * Topographic contour lines. Every fifth line is an index contour drawn a touch stronger,
 * like a survey map. Decorative; fills its positioned parent.
 */
export function Contours({ variant = 'ridge', className }: ContoursProps) {
  const lines = linesFor(variant);
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMid slice"
      className={cn('pointer-events-none absolute inset-0 h-full w-full', className)}
    >
      <g fill="none" stroke="currentColor" strokeLinejoin="round">
        {lines.map((line, index) => (
          <path
            key={index}
            d={line.d}
            strokeWidth={line.major ? 1 : 0.75}
            strokeOpacity={line.major ? 0.9 : 0.55}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
    </svg>
  );
}
