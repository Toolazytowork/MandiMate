import { cn } from '@/lib/cn';

const SIZES = {
  xs: 'size-3.5',
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-8',
} as const;

export interface SpinnerProps {
  size?: keyof typeof SIZES;
  /** Announced to screen readers. Omit when the spinner sits inside a labelled control. */
  label?: string;
  className?: string;
}

/** Hairline ring with a gold arc. Keeps spinning under reduced motion (it conveys state). */
export function Spinner({ size = 'md', label, className }: SpinnerProps) {
  const svg = (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      data-motion="essential"
      aria-hidden="true"
      className={cn('animate-spin [animation-duration:900ms]', SIZES[size], className)}
    >
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1.5" />
      <path
        d="M21.5 12a9.5 9.5 0 0 0-9.5-9.5"
        stroke="var(--color-gold-500)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );

  if (!label) return svg;
  return (
    <span role="status" className="inline-flex items-center">
      {svg}
      <span className="sr-only">{label}</span>
    </span>
  );
}
