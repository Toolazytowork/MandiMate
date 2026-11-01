import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const BADGE_TONES = {
  neutral: { badge: 'border-transparent bg-ink/[0.06] text-ink-2', dot: 'bg-muted' },
  forest: { badge: 'border-transparent bg-forest-100 text-forest-700', dot: 'bg-forest-600' },
  gold: { badge: 'border-transparent bg-gold-100 text-gold-700', dot: 'bg-gold-500' },
  success: { badge: 'border-transparent bg-success/[0.12] text-success-ink', dot: 'bg-success' },
  warning: { badge: 'border-transparent bg-warning/[0.14] text-warning-ink', dot: 'bg-warning' },
  danger: { badge: 'border-transparent bg-danger/[0.1] text-danger-ink', dot: 'bg-danger' },
  info: { badge: 'border-transparent bg-info/[0.1] text-info-ink', dot: 'bg-info' },
  /** For dark surfaces. */
  glass: { badge: 'border-white/15 bg-white/[0.08] text-ivory', dot: 'bg-gold-400' },
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

const SIZES = {
  sm: "h-6 gap-1.5 px-2.5 text-[12px] [&_svg:not([class*='size-'])]:size-3",
  md: "h-7 gap-1.5 px-3 text-[13px] [&_svg:not([class*='size-'])]:size-3.5",
} as const;

export interface BadgeProps extends ComponentProps<'span'> {
  tone?: BadgeTone;
  size?: keyof typeof SIZES;
  /** Leading status dot. */
  dot?: boolean;
  icon?: ReactNode;
}

export function Badge({ tone = 'neutral', size = 'md', dot = false, icon, className, children, ...props }: BadgeProps) {
  const styles = BADGE_TONES[tone];
  return (
    <span
      className={cn(
        'inline-flex max-w-full shrink-0 items-center whitespace-nowrap rounded-full border font-semibold leading-none [&_svg]:shrink-0',
        styles.badge,
        SIZES[size],
        className,
      )}
      {...props}
    >
      {dot ? <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', styles.dot)} /> : null}
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}
