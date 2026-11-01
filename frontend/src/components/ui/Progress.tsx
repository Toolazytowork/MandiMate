import { cn } from '@/lib/cn';

const TONES = {
  forest: 'bg-forest-600',
  gold: 'bg-gold-700',
  warning: 'bg-warning',
  danger: 'bg-danger',
} as const;

const SIZES = {
  sm: 'h-px',
  md: 'h-0.5',
} as const;

export interface ProgressProps {
  /** Omit for an indeterminate bar. */
  value?: number;
  max?: number;
  tone?: keyof typeof TONES;
  size?: keyof typeof SIZES;
  /** Accessible name (required when no visible label references the bar). */
  label: string;
  /** Human-readable value, e.g. "640 of 1,000 kg". */
  valueText?: string;
  className?: string;
}

export function Progress({ value, max = 100, tone = 'forest', size = 'md', label, valueText, className }: ProgressProps) {
  const indeterminate = value === undefined;
  const percent = indeterminate ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={indeterminate ? undefined : 0}
      aria-valuemax={indeterminate ? undefined : max}
      aria-valuenow={indeterminate ? undefined : value}
      aria-valuetext={valueText}
      className={cn('relative w-full overflow-hidden rounded-full bg-ink/10', SIZES[size], className)}
    >
      {indeterminate ? (
        <div className={cn('absolute inset-y-0 start-0 w-1/3 animate-indeterminate rounded-full', TONES[tone])} />
      ) : (
        <div
          className={cn('h-full rounded-full transition-[width] duration-700 ease-luxe', TONES[tone])}
          style={{ width: `${percent}%` }}
        />
      )}
    </div>
  );
}
