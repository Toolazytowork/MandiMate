import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight } from 'lucide-react';
import { Card, Skeleton, Stat, type StatDelta } from '@/components/ui';
import { cn } from '@/lib/cn';

function StatSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

export interface StatCardProps {
  label: ReactNode;
  /** Pre-formatted value or a `<Money>` / `<Quantity>`. */
  value: ReactNode;
  icon?: ReactNode;
  delta?: StatDelta;
  hint?: ReactNode;
  /** In-app path; the whole card becomes a link. */
  to?: string;
  loading?: boolean;
  /** `dark` for a forest hero card (use once per screen). */
  tone?: 'light' | 'dark';
  size?: 'md' | 'lg';
  className?: string;
}

/** One headline number in a card: eyebrow label, bold value, optional delta and hint. */
export function StatCard({ label, value, icon, delta, hint, to, loading = false, tone = 'light', size = 'md', className }: StatCardProps) {
  const dark = tone === 'dark';
  const body = loading ? <StatSkeleton /> : <Stat label={label} value={value} delta={delta} hint={hint} icon={icon} size={size} />;

  return (
    <Card
      variant={dark ? 'dark' : 'default'}
      interactive={Boolean(to)}
      className={cn('flex flex-col p-6 sm:p-8', dark && 'bg-forest-900', className)}
    >
      {to ? (
        <Link to={to} className="flex flex-col after:absolute after:inset-0 after:rounded-card after:content-['']">
          {body}
          <ArrowUpRight
            aria-hidden="true"
            strokeWidth={1.25}
            className={cn('absolute end-6 top-6 size-4', dark ? 'text-ivory/40' : 'text-ink/30')}
          />
        </Link>
      ) : (
        body
      )}
    </Card>
  );
}

export interface KpiItem {
  id: string;
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  delta?: StatDelta;
  hint?: ReactNode;
}

export interface KpiStripProps {
  items: readonly KpiItem[];
  loading?: boolean;
  /** Columns on wide screens (two on phones). */
  columns?: 2 | 3 | 4;
  className?: string;
}

const COLUMNS = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
} as const;

/** An editorial strip of key numbers separated by hairlines — one card, many figures. */
export function KpiStrip({ items, loading = false, columns = 4, className }: KpiStripProps) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <ul className={cn('-mb-px -me-px grid grid-cols-2', COLUMNS[columns])}>
        {items.map((item) => (
          <li key={item.id} className="flex min-w-0 flex-col border-b border-e border-line px-5 py-6 sm:px-8 sm:py-7">
            {loading ? (
              <StatSkeleton />
            ) : (
              <Stat label={item.label} value={item.value} icon={item.icon} delta={item.delta} hint={item.hint} size="md" />
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
