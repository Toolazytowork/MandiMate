import { cn } from '@/lib/cn';

/** Monochrome fractal-noise tile (SVG feTurbulence) used as a film-grain overlay. */
export const GRAIN_TEXTURE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E\")";

export interface GrainProps {
  /** 0–1; the design system uses ~0.025. */
  opacity?: number;
  className?: string;
}

/** Absolutely positioned film grain. Place inside a `relative` container. */
export function Grain({ opacity = 0.025, className }: GrainProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 mix-blend-overlay [border-radius:inherit]', className)}
      style={{ opacity, backgroundImage: GRAIN_TEXTURE, backgroundSize: '180px 180px' }}
    />
  );
}
