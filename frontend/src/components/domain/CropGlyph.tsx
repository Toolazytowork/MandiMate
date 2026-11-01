import { useId, type ReactNode } from 'react';
import { round, smoothPath, type Point } from '@/components/art/geometry';
import { cn } from '@/lib/cn';
import { resolveCropCode, type CropCode } from './crops';

/** A pointed leaf from (x, y) towards `angle` degrees (SVG y-down), `width` sets its fullness. */
function leaf(x: number, y: number, angle: number, length: number, width: number): string {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const midX = x + dx * length * 0.45;
  const midY = y + dy * length * 0.45;
  const px = -dy * width;
  const py = dx * width;
  return `M${round(x)} ${round(y)}Q${round(midX + px)} ${round(midY + py)} ${round(x + dx * length)} ${round(y + dy * length)}Q${round(midX - px)} ${round(midY - py)} ${round(x)} ${round(y)}Z`;
}

/** Wavy closed outline around (cx, cy) — the loose outer leaves of a cabbage. */
function ruffle(cx: number, cy: number, radius: number, wave: number, lobes: number): string {
  const points: Point[] = Array.from({ length: lobes * 2 }, (_, index) => {
    const angle = (index / (lobes * 2)) * Math.PI * 2;
    const r = radius + (index % 2 === 0 ? wave : -wave);
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
  });
  return smoothPath(points, true);
}

/** Secondary detail lines sit a step quieter than the outline. */
const DETAIL = { strokeOpacity: 0.5 } as const;

/**
 * Renders one line drawing in `currentColor` (single weight, no fills); `a` is a unique id for clip
 * paths. Stroke width is applied once on the parent and kept at 1.25 px by `vector-effect`.
 */
type GlyphArt = (ids: { a: string; b: string }) => ReactNode;

const ART: Record<CropCode | 'leaf', GlyphArt> = {
  TOM: () => (
    <>
      <path d="M32 21c-10 0-19.5 6.6-19.5 17 0 10 8.6 16.4 19.5 16.4S51.5 48 51.5 38C51.5 27.6 42 21 32 21Z" />
      <path d="M25.2 23.2c-2.2 3.8-2.6 8.4-1.2 12.6M38.8 23.2c2.2 3.8 2.6 8.4 1.2 12.6" {...DETAIL} />
      {[-168, -126, -54, -12].map((angle) => (
        <path key={angle} d={leaf(32, 23.4, angle, 8.5, 2.6)} />
      ))}
      <path d="M32 23.4c0-3 .9-5.6 3-7.6" />
    </>
  ),
  ONI: () => (
    <>
      <path d="M32 15c1.2 5.6 5.4 8.6 10.6 12.5 4.6 3.4 7.4 7.8 7.4 13.3 0 8.4-7.8 13.9-18 13.9s-18-5.5-18-13.9c0-5.5 2.8-9.9 7.4-13.3C26.6 23.6 30.8 20.6 32 15Z" />
      <path d="M32 19c-4.2 8-6.2 17-5.6 35.4M32 19c4.2 8 6.2 17 5.6 35.4" {...DETAIL} />
      <path d="M32 15c-.5-3.2.4-6.4 2.4-9" />
      <path d="M29.2 55l-1.6 3.2M32 55.4V59M34.8 55l1.6 3.2" {...DETAIL} />
    </>
  ),
  CHI: () => (
    <>
      <path d="M20.5 19.5C27 22 33 33 41 39.5c4 3.2 7.5 5 10.5 7.3-4 2-10.5 1.8-16.5-.6-9-3.7-16.5-12.2-19-20.7-.8-3.1 1.4-5.9 4.5-6Z" />
      <path d="M21.4 26.6c3.8 5.6 9 9.8 15.6 12.2" {...DETAIL} />
      <path d="M14.6 23c.5-3.6 3.6-6 7.2-5.4 1.8.3 3 1.6 3.4 3-2.8-1.3-6.3-.6-8.3 1.6-.8.9-1.6 1.2-2.3.8Z" />
      <path d="M19.6 17.4c-.6-3.5.8-6.8 3.8-8.7" />
    </>
  ),
  POT: () => (
    <>
      <path d="M14.5 36c-1.6-8.6 5-16 15.2-17.4 10.6-1.4 21 3.4 21.8 12.2.8 8.8-6.2 15.6-17.2 16.6-10.8 1-18.2-3.4-19.8-11.4Z" />
      <path d="M24.4 29c1 .6 2 .6 3 0M37.2 26c.9.7 2 .8 3 .2M30.6 38.6c1 .5 2 .4 2.8-.3M42.6 36.6c.8.6 1.8.6 2.6 0" {...DETAIL} />
    </>
  ),
  MNG: () => (
    <>
      <path d="M23.5 20.5c8.2-5.4 21.6-3.2 25.6 7.4 4 10.6-1.4 22.4-12.6 25.4-9.6 2.6-19.6-1.8-21.6-10.6-1.2-5.4 1.8-9 3.4-12 1.4-2.6 2.6-7 5.2-10.2Z" />
      <path d="M44.6 30.6c1.6 6.4-1.8 13.4-8.6 16" {...DETAIL} />
      <path d="M33 18.6c.2-2.6 1.4-4.6 3.4-6" />
      <path d={leaf(36.2, 12.8, -18, 16, 4.8)} />
      <path d="M36.2 12.8l14.4-4.6" {...DETAIL} />
    </>
  ),
  GNT: ({ a }) => {
    const shell =
      'M32 11.5c6.2 0 10 4.6 10 10.4 0 3.4-1.6 5.6-1.6 8.4 0 2.8 2.6 5 2.6 10 0 7-5 11.2-11 11.2s-11-4.2-11-11.2c0-5 2.6-7.2 2.6-10 0-2.8-1.6-5-1.6-8.4 0-5.8 3.8-10.4 10-10.4Z';
    return (
      <g transform="rotate(-28 32 32)">
        <defs>
          <clipPath id={a}>
            <path d={shell} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${a})`} strokeOpacity={0.35}>
          <path d="M20 18h24M20 24h24M20 36h24M20 42h24M20 48h24" />
          <path d="M28 10v22M33 10v22M38 10v22M27 32v22M32 32v22M37 32v22" />
        </g>
        <path d={shell} />
      </g>
    );
  },
  OKR: () => (
    <g transform="rotate(38 32 34)">
      <path d="M32 15c4.6 0 7 3 7 6.5 0 9-2.6 20-6 30.5-.4 1.2-1.6 1.2-2 0-3.4-10.5-6-21.5-6-30.5 0-3.5 2.4-6.5 7-6.5Z" />
      <path d="M28.8 19c.5 10 1.6 20 3 31M35.2 19c-.5 10-1.6 20-3 31" {...DETAIL} />
      <path d="M25.6 17.6c1-3 3.6-4.6 6.4-4.6s5.4 1.6 6.4 4.6c-2-.8-4.2-1.2-6.4-1.2s-4.4.4-6.4 1.2Z" />
      <path d="M32 13c0-2.6.8-4.6 2.6-6" />
    </g>
  ),
  BRN: () => (
    <g transform="rotate(-20 32 36)">
      <path d="M32 21c5.2 0 8.6 3.6 9.6 8.6 1 4.8 4 7.4 4 13.4 0 7.6-6.2 12.6-13.6 12.6S18.4 50.6 18.4 43c0-6 3-8.6 4-13.4 1-5 4.4-8.6 9.6-8.6Z" />
      <path d="M41.4 41.5c.4 5.6-2.8 9.6-7.6 11" {...DETAIL} />
      {[118, 62].map((angle) => (
        <path key={angle} d={leaf(32, 22, angle, 8, 2.8)} />
      ))}
      <path d="M25.4 22.6c1.6-2.6 4-3.8 6.6-3.8s5 1.2 6.6 3.8c-2.2-.6-4.4-.9-6.6-.9s-4.4.3-6.6.9Z" />
      <path d="M32 19c0-3.6 1.2-6.4 3.6-8.4" />
    </g>
  ),
  CAB: () => (
    <>
      <path d={ruffle(32, 35, 19.5, 1.6, 7)} />
      <circle cx="32" cy="34.5" r="13.5" />
      <path d="M21.6 31c4-5.4 12.4-7.4 18.8-3.4M23.6 39c5 3.4 12.6 3.4 16.8-1M27.4 23.2c-1.8 4.4-1.4 9.6 1.4 13.4" {...DETAIL} />
    </>
  ),
  BAN: () => {
    const finger =
      'M15 27c5.6 13.4 17.6 21 33.4 19.4 1.6-.2 2.4 1.6 1 2.4-15.2 8-33.6-1-38-18.6-.4-1.6 1.6-3.6 3.6-3.2Z';
    return (
      <>
        {['rotate(-14 16 26) translate(0 -1)', 'rotate(-4 16 26) translate(1 2)', 'rotate(7 16 26) translate(1 4)'].map((transform) => (
          <path key={transform} d={finger} transform={transform} />
        ))}
        <path d="M10.4 25.4c-1-3.4.2-6.8 3.2-9l2.8 2.2c-1.8 1.4-2.6 3.6-2 6Z" />
      </>
    );
  },
  leaf: () => (
    <>
      <path d="M14 50c0-20 14-34 36-36 0 22-14 36-36 36Z" />
      <path d="M15.5 48.5L44 20" />
      <path d="M22 42l-1-8M22 42l8 1M29 35l-1-9M29 35l9 1M36 28l-1-7M36 28l7 1" {...DETAIL} />
    </>
  ),
};

const SIZES = {
  xs: 'size-6',
  sm: 'size-8',
  md: 'size-11',
  lg: 'size-14',
  xl: 'size-20',
} as const;

export interface CropGlyphProps {
  /** Catalogue crop code ("TOM"). */
  code?: string | null;
  /** Crop name in any UI language, used when no code is known. */
  name?: string | null;
  /** Lot code ("MM-TOM-0007"), another way to find the crop. */
  lotCode?: string | null;
  size?: keyof typeof SIZES;
  /** Draw inside a small paper square with a hairline border. */
  framed?: boolean;
  /** Accessible name; without it the glyph is decorative. */
  title?: string;
  className?: string;
}

/** Fine single-weight line drawing (currentColor) for ten pilot crops (tomato, onion, green chilli, …) with a leaf fallback. */
export function CropGlyph({ code, name, lotCode, size = 'md', framed = false, title, className }: CropGlyphProps) {
  const rawId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const resolved = resolveCropCode({ code, name, lotCode });
  const art = ART[resolved ?? 'leaf']({ a: `crop-${rawId}-a`, b: `crop-${rawId}-b` });
  const svg = (
    <svg
      viewBox="0 0 64 64"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        framed ? 'size-[72%]' : cn(SIZES[size], className),
        'shrink-0 [&_circle]:[vector-effect:non-scaling-stroke] [&_path]:[vector-effect:non-scaling-stroke]',
      )}
    >
      {art}
    </svg>
  );

  if (!framed) return svg;
  return (
    <span
      className={cn(
        'relative inline-grid shrink-0 place-items-center rounded-sm border border-line bg-paper text-ink-2',
        SIZES[size],
        className,
      )}
    >
      {svg}
    </span>
  );
}
