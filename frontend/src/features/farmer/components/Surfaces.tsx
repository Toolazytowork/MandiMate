import type { ReactNode } from 'react';
import { Contours, type ContourVariant } from '@/components/art';
import { cn } from '@/lib/cn';

export interface HeroSurfaceProps {
  children: ReactNode;
  contour?: ContourVariant;
  as?: 'section' | 'div' | 'article';
  id?: string;
  'aria-labelledby'?: string;
  'aria-label'?: string;
  className?: string;
}

/**
 * The charcoal panel used once per farmer screen for the figure that matters most: a soft
 * light from the top corner and faint amber field contours.
 */
export function HeroSurface({ children, contour = 'ridge', as = 'section', className, ...rest }: HeroSurfaceProps) {
  const Tag = as as 'section';
  return (
    <Tag
      {...rest}
      className={cn('surface-dark relative isolate overflow-hidden rounded-panel bg-[radial-gradient(120%_140%_at_100%_0%,var(--color-forest-700)_0%,var(--color-forest-900)_55%,var(--color-forest-950)_100%)] text-ivory shadow-luxe', className)}
    >
      <Contours variant={contour} className="text-gold-300/[0.07]" />
            <div className="relative">{children}</div>
    </Tag>
  );
}

export interface SectionHeadingProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  id?: string;
  className?: string;
}

/** An editorial `h2` for a page section: eyebrow, bold title, one line of plain explanation. */
export function SectionHeading({ title, eyebrow, description, action, id, className }: SectionHeadingProps) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-x-6 gap-y-3', className)}>
      <div className="flex min-w-0 max-w-2xl flex-col gap-3">
        {eyebrow ? <p className="eyebrow eyebrow-rule">{eyebrow}</p> : null}
        <h2 id={id} className="font-display text-h2 font-bold text-ink md:text-[2rem] md:leading-tight">
          {title}
        </h2>
        {description ? <p className="text-[15px] font-normal leading-relaxed text-ink-2">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

export interface FactProps {
  label: ReactNode;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/** One labelled fact in a `<dl>` grid. */
export function Fact({ label, children, icon, className }: FactProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <dt className="flex items-center gap-1.5 text-[13px] font-semibold text-muted">
        {icon ? (
          <span aria-hidden="true" className="text-muted [&_svg]:size-3.5 [&_svg]:stroke-[1.25]">
            {icon}
          </span>
        ) : null}
        {label}
      </dt>
      <dd className="min-w-0 text-[15px] text-ink">{children}</dd>
    </div>
  );
}

/** A quiet dot between inline facts. */
export function Dot({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('inline-block size-1 shrink-0 rounded-full bg-current opacity-30', className)} />;
}
