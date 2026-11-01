import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface DividerProps {
  orientation?: 'horizontal' | 'vertical';
  /** `gold` for editorial accents; `line` follows the surface (ink hairline on light, white on dark). */
  tone?: 'line' | 'gold';
  /** Centered label, e.g. "or". */
  label?: ReactNode;
  className?: string;
}

/** Hairline rule that fades at both ends. */
export function Divider({ orientation = 'horizontal', tone = 'line', label, className }: DividerProps) {
  const rule = tone === 'gold' ? 'hairline-gold' : 'hairline';

  if (orientation === 'vertical') {
    return (
      <div
        role="separator"
        aria-orientation="vertical"
        className={cn('w-px self-stretch bg-(--hairline)', className)}
      />
    );
  }

  if (!label) return <div role="separator" className={cn(rule, 'w-full', className)} />;

  return (
    <div role="separator" className={cn('flex w-full items-center gap-4', className)}>
      <span className={cn(rule, 'flex-1')} />
      <span className="eyebrow shrink-0 [--eyebrow:var(--fg-muted)]">{label}</span>
      <span className={cn(rule, 'flex-1')} />
    </div>
  );
}
