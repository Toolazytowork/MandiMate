import type { ReactNode } from 'react';
import { CircleAlert, Info, ShieldAlert, WifiOff, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/cn';

const TONES = {
  danger: {
    box: 'border-danger/30 border-s-danger',
    icon: 'text-danger-ink',
    title: 'text-danger-ink',
  },
  warning: {
    box: 'border-warning/30 border-s-warning',
    icon: 'text-warning-ink',
    title: 'text-warning-ink',
  },
  info: {
    box: 'border-line border-s-gold-700',
    icon: 'text-gold-700',
    title: 'text-ink',
  },
} as const;

const ICONS: Record<'danger' | 'warning' | 'info' | 'network', LucideIcon> = {
  danger: CircleAlert,
  warning: ShieldAlert,
  info: Info,
  network: WifiOff,
};

export interface FormAlertProps {
  tone?: keyof typeof TONES;
  /** `network` swaps the icon for an offline glyph. */
  icon?: keyof typeof ICONS;
  title: ReactNode;
  children?: ReactNode;
  /** Announce immediately (errors). Info notes stay polite. */
  live?: boolean;
  className?: string;
}

/** A calm, form-level message: what went wrong and what to do next. */
export function FormAlert({ tone = 'danger', icon, title, children, live = true, className }: FormAlertProps) {
  const palette = TONES[tone];
  const Icon = ICONS[icon ?? tone];
  return (
    <div
      role={live ? (tone === 'info' ? 'status' : 'alert') : undefined}
      className={cn('flex animate-fade-in items-start gap-3 rounded-sm border border-s-2 bg-paper px-4 py-3.5', palette.box, className)}
    >
      <Icon aria-hidden="true" strokeWidth={1.25} className={cn('mt-0.5 size-4 shrink-0', palette.icon)} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className={cn('text-sm font-medium leading-snug', palette.title)}>{title}</p>
        {children ? <div className="text-[13px] leading-relaxed text-ink-2">{children}</div> : null}
      </div>
    </div>
  );
}
