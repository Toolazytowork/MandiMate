import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';

const VALUE_SIZES = {
  md: 'text-h1',
  lg: 'text-display-sm md:text-display-md',
  xl: 'text-display-md md:text-display-lg',
} as const;

export interface StatDelta {
  value: ReactNode;
  trend: 'up' | 'down' | 'flat';
  /** Which direction is good news (default `up`). Colours follow it; the arrow follows `trend`. */
  goodWhen?: 'up' | 'down';
  /** Context after the chip, e.g. "vs mandi". */
  label?: ReactNode;
}

export interface StatProps {
  /** Eyebrow label above the value. */
  label: ReactNode;
  /** Pre-formatted value, e.g. `formatINR(1240000)`. */
  value: ReactNode;
  delta?: StatDelta;
  hint?: ReactNode;
  icon?: ReactNode;
  size?: keyof typeof VALUE_SIZES;
  className?: string;
}

/** Eyebrow + bold value + optional delta. Money is the hero: calm, large, tabular. */
export function Stat({ label, value, delta, hint, icon, size = 'lg', className }: StatProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <div className="flex items-center gap-2">
        {icon ? (
          <span aria-hidden="true" className="text-(--eyebrow) [&_svg]:size-4">
            {icon}
          </span>
        ) : null}
        <p className="eyebrow">{label}</p>
      </div>
      <p className={cn('font-display font-bold tabular-nums leading-none tracking-[-0.02em]', VALUE_SIZES[size])}>{value}</p>
      {delta || hint ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-(--fg-muted)">
          {delta ? <DeltaChip {...delta} /> : null}
          {delta?.label ? <span>{delta.label}</span> : null}
          {hint ? <span>{hint}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function DeltaChip({ value, trend, goodWhen = 'up' }: StatDelta) {
  const Icon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : Minus;
  const tone =
    trend === 'flat'
      ? 'text-current'
      : trend === goodWhen
        ? 'text-success-ink'
        : 'text-danger-ink';
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium tabular-nums', tone)}>
      <Icon aria-hidden="true" strokeWidth={1.25} className="size-3.5" />
      {value}
    </span>
  );
}
