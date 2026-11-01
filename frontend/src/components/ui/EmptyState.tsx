import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** Plain muted icon above a hairline (ignored when `illustration` is given). */
  icon?: ReactNode;
  /** Custom artwork slot, e.g. an art component. */
  illustration?: ReactNode;
  /** Primary and secondary actions. */
  action?: ReactNode;
  size?: 'md' | 'sm';
  /** Draw the hairline container. Turn off inside cards. */
  framed?: boolean;
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon,
  illustration,
  action,
  size = 'md',
  framed = true,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'relative flex flex-col items-center text-center',
        size === 'md' ? 'gap-5 px-6 py-14 sm:py-16' : 'gap-4 px-5 py-10',
        framed && 'rounded-card border border-line bg-paper',
        className,
      )}
    >
      {illustration ?? (icon ? <Medallion size={size}>{icon}</Medallion> : null)}
      <div className="flex max-w-md flex-col gap-2">
        <h3 className={cn('font-display font-bold', size === 'md' ? 'text-h2' : 'text-h3')}>{title}</h3>
        {description ? <p className="text-sm leading-relaxed text-(--fg-muted)">{description}</p> : null}
      </div>
      {action ? <div className="flex flex-wrap items-center justify-center gap-3">{action}</div> : null}
    </div>
  );
}

function Medallion({ children, size }: { children: ReactNode; size: 'md' | 'sm' }) {
  return (
    <span aria-hidden="true" className="flex flex-col items-center gap-4 text-muted">
      <span className={cn('[&_svg]:stroke-[1.25]', size === 'md' ? '[&_svg]:size-7' : '[&_svg]:size-6')}>{children}</span>
      <span className="h-px w-10 bg-gold-500/60" />
    </span>
  );
}
