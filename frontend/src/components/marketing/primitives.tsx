import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Info } from 'lucide-react';
import { Contours, type ContourVariant } from '@/components/art';
import { cn } from '@/lib/cn';

/* ─────────────────────────────── Section ─────────────────────────────── */

const TONES = {
  ivory: 'bg-ivory',
  parchment: 'bg-parchment',
  white: 'bg-paper',
  dark: 'surface-dark bg-forest-900 text-ivory',
} as const;

const SPACING = {
  default: 'py-24 md:py-32',
  compact: 'py-16 md:py-24',
  none: '',
} as const;

export type SectionTone = keyof typeof TONES;

export interface SectionProps {
  id?: string;
  tone?: SectionTone;
  /** Id of the section's h2, for `aria-labelledby`. */
  labelledBy?: string;
  spacing?: keyof typeof SPACING;
  /** Topographic contour art behind the content (always on for dark sections). */
  contours?: ContourVariant;
  /** Hairline at the top edge, for two sections of the same tone in a row. */
  rule?: boolean;
  className?: string;
  containerClassName?: string;
  children: ReactNode;
}

/**
 * A marketing section: full-bleed surface, content container, editorial rhythm. Uses
 * `overflow-clip` (not hidden) so sticky children keep working.
 */
export function Section({
  id,
  tone = 'ivory',
  labelledBy,
  spacing = 'default',
  contours,
  rule = false,
  className,
  containerClassName,
  children,
}: SectionProps) {
  const dark = tone === 'dark';
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn('relative isolate overflow-clip', TONES[tone], SPACING[spacing], className)}
    >
      {dark ? (
        <Contours variant={contours ?? 'ridge'} className="text-white/[0.04]" />
      ) : contours ? (
        <Contours variant={contours} className="text-forest-900/[0.045]" />
      ) : null}
      {rule ? <span aria-hidden="true" className="hairline absolute inset-x-0 top-0" /> : null}
      <div className={cn('content-container relative', containerClassName)}>{children}</div>
    </section>
  );
}

/* ──────────────────────────── Section header ──────────────────────────── */

export interface SectionHeaderProps {
  /** Id of the h2 (pair it with `<Section labelledBy>`). */
  id?: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  /** `split` puts the lead beside the title on wide screens. */
  layout?: 'stacked' | 'split' | 'center';
  /** Content under the lead (links, a legend). */
  children?: ReactNode;
  className?: string;
}

/** Eyebrow, display-serif h2 and an editorial lead paragraph. */
export function SectionHeader({ id, eyebrow, title, lead, layout = 'stacked', children, className }: SectionHeaderProps) {
  const heading = (
    <>
      {eyebrow ? <p className="eyebrow eyebrow-rule">{eyebrow}</p> : null}
      <h2
        id={id}
        className={cn(
          'font-display text-[2.125rem] font-bold leading-[1.06] tracking-[-0.022em] sm:text-display-sm md:text-display-md',
          layout === 'center' ? 'mx-auto max-w-3xl' : 'max-w-3xl',
        )}
      >
        {title}
      </h2>
    </>
  );
  const body =
    lead || children ? (
      <div className={cn('flex flex-col gap-6', layout === 'center' && 'items-center')}>
        {lead ? (
          <p
            className={cn(
              'max-w-measure text-[17px] font-normal leading-relaxed text-ink-2 [.surface-dark_&]:text-(--fg-muted) md:text-lg md:leading-relaxed',
              layout === 'center' && 'mx-auto',
            )}
          >
            {lead}
          </p>
        ) : null}
        {children}
      </div>
    ) : null;

  if (layout === 'split') {
    return (
      <div className={cn('grid gap-6 lg:grid-cols-12 lg:items-end lg:gap-10', className)}>
        <div className="flex flex-col gap-5 lg:col-span-7">{heading}</div>
        {body ? <div className="lg:col-span-5 lg:pb-1.5">{body}</div> : null}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-5', layout === 'center' && 'items-center text-center', className)}>
      {heading}
      {body}
    </div>
  );
}

/* ─────────────────────────────── Small parts ─────────────────────────────── */

/** The single emphasised phrase of a headline: amber (brighter amber on dark surfaces). */
export function Em({ children }: { children?: ReactNode }) {
  return <em className="not-italic text-gold-700 [.surface-dark_&]:text-gold-400">{children}</em>;
}

/** Quiet note that a figure is an illustration, not a result. */
export function IllustrativeNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('flex items-start gap-2 text-[13px] leading-relaxed text-(--fg-muted)', className)}>
      <Info aria-hidden="true" strokeWidth={1.25} className="mt-0.5 size-3.5 shrink-0 text-(--eyebrow)" />
      <span>{children}</span>
    </p>
  );
}

/** Small tracked-caps label with a hairline border, e.g. "Illustrative" or "Pilot target". */
export function Tag({
  children,
  tone = 'gold',
  className,
}: {
  children: ReactNode;
  tone?: 'gold' | 'forest' | 'glass' | 'neutral';
  className?: string;
}) {
  const tones = {
    gold: 'border-gold-500/40 text-gold-700',
    forest: 'border-forest-600/35 text-forest-600',
    glass: 'border-white/20 text-gold-400',
    neutral: 'border-line text-muted',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 text-[13px] font-semibold leading-none',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A list with hairline green dashes. */
export function CheckList({ items, className, dense = false }: { items: readonly ReactNode[]; className?: string; dense?: boolean }) {
  return (
    <ul className={cn('flex flex-col', dense ? 'gap-2.5' : 'gap-3.5', className)}>
      {items.map((item, index) => (
        <li key={index} className={cn('flex items-start gap-4 font-normal leading-relaxed', dense ? 'text-sm' : 'text-[15px]')}>
          <span
            aria-hidden="true"
            className="mt-[0.8em] h-px w-4 shrink-0 bg-gold-500 [.surface-dark_&]:bg-gold-400"
          />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** Two-digit editorial numeral ("01"): bold green. */
export function Numeral({ value, className }: { value: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('font-display font-bold not-italic tabular-nums tracking-[-0.02em] text-gold-700 [.surface-dark_&]:text-gold-400', className)}
    >
      {String(value).padStart(2, '0')}
    </span>
  );
}

/** Editorial text CTA: tracked caps, a 1 px underline and a → arrow ("SEE HOW IT WORKS →"). */
export function ArrowLink({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return (
    <Link
      to={to}
      className={cn(
        'group inline-flex items-center gap-2 self-start border-b border-current pb-1.5 text-[13px] font-semibold text-ink transition-colors hover:text-gold-700 [.surface-dark_&]:text-ivory [.surface-dark_&]:hover:text-gold-400',
        className,
      )}
    >
      {children}
      <span aria-hidden="true" className="transition-transform duration-300 ease-luxe group-hover:translate-x-1">
        →
      </span>
    </Link>
  );
}
