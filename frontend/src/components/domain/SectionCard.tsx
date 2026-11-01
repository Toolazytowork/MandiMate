import { useId, type ReactNode } from 'react';
import { Card, type CardVariant } from '@/components/ui';
import { cn } from '@/lib/cn';

export interface SectionCardProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** Right-aligned header slot: a link, button or badge. */
  action?: ReactNode;
  children: ReactNode;
  /** Actions row pinned to the bottom. */
  footer?: ReactNode;
  variant?: CardVariant;
  /** Remove the body padding (for full-bleed tables and lists). */
  flush?: boolean;
  id?: string;
  className?: string;
  bodyClassName?: string;
}

/** A titled section of a page: `h2` header with eyebrow, description and action, then the body. */
export function SectionCard({
  title,
  eyebrow,
  description,
  action,
  children,
  footer,
  variant = 'default',
  flush = false,
  id,
  className,
  bodyClassName,
}: SectionCardProps) {
  const headingId = useId();
  return (
    <Card as="section" variant={variant} id={id} aria-labelledby={headingId} className={cn('flex flex-col', className)}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 pt-6 sm:px-8 sm:pt-8">
        <div className="flex min-w-0 flex-col gap-2">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2 id={headingId} className="font-display text-h3 font-bold text-ink">
            {title}
          </h2>
          {description ? <p className="max-w-measure text-sm font-normal leading-relaxed text-ink-2">{description}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
      </header>
      <div className={cn('flex-1', flush ? 'pt-5' : 'px-5 py-6 sm:px-8', bodyClassName)}>{children}</div>
      {footer ? (
        <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-5 py-4 sm:px-8">{footer}</footer>
      ) : null}
    </Card>
  );
}
