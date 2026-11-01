import { useId, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { Contours, FieldLines } from '@/components/art';
import { cn } from '@/lib/cn';

export interface PageHeroProps {
  /** Breadcrumb label of this page (the trail is always Home › this page). */
  crumb: string;
  eyebrow?: ReactNode;
  /** The page's only h1. */
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  /** Visual beside the copy on wide screens, below it on phones. */
  aside?: ReactNode;
  /** Small print under the actions (promises, notes). */
  footnote?: ReactNode;
  /** `dark`: full-bleed deep-green (role pages). `light`: ivory editorial (reference pages). */
  tone?: 'dark' | 'light';
  /** `lg` for landing-style pages, `md` for reference pages (FAQ, legal). */
  size?: 'lg' | 'md';
  /** Furrow art along the bottom of a dark hero. */
  furrows?: boolean;
  className?: string;
}

/** CSS-only entrance (no JS needed, so prerendered content is never stuck hidden). */
function enter(delayMs: number): CSSProperties {
  return { animationDelay: `${delayMs}ms` };
}

/** Sub-page hero: breadcrumb, eyebrow, display h1, lead, actions and an optional visual. */
export function PageHero({
  crumb,
  eyebrow,
  title,
  lead,
  actions,
  aside,
  footnote,
  tone = 'dark',
  size = 'lg',
  furrows = false,
  className,
}: PageHeroProps) {
  const { t } = useTranslation('marketing');
  const titleId = useId();
  const dark = tone === 'dark';

  const copy = (
    <div className={cn('flex min-w-0 flex-col', aside ? 'lg:col-span-7' : 'lg:col-span-10')}>
      <nav aria-label={t('pageHero.breadcrumb', { defaultValue: 'Breadcrumb' })} className="animate-fade-in">
        <ol
          className={cn(
            'flex flex-wrap items-center gap-2 text-[13px] font-semibold',
            dark ? 'text-ivory/55' : 'text-muted',
          )}
        >
          <li>
            <Link to="/" className={cn('link-luxe transition-colors', dark ? 'hover:text-ivory' : 'hover:text-ink')}>
              {t('pageHero.home', { defaultValue: 'Home' })}
            </Link>
          </li>
          <li aria-hidden="true" className={dark ? 'text-ivory/30' : 'text-ink/25'}>
            <ChevronRight strokeWidth={1.25} className="size-3" />
          </li>
          <li>
            <span aria-current="page" className={dark ? 'text-ivory/80' : 'text-ink/80'}>
              {crumb}
            </span>
          </li>
        </ol>
      </nav>

      {eyebrow ? (
        <p className="eyebrow eyebrow-rule mt-10 animate-fade-up md:mt-14" style={enter(40)}>
          {eyebrow}
        </p>
      ) : null}
      <h1
        id={titleId}
        className={cn(
          'animate-fade-up font-display font-bold tracking-[-0.025em]',
          eyebrow ? 'mt-5' : 'mt-10 md:mt-14',
          size === 'lg'
            ? 'text-[2.75rem] leading-[1.02] sm:text-display-lg lg:text-display-xl'
            : 'text-[2.5rem] leading-[1.05] sm:text-display-md lg:text-display-lg',
        )}
        style={enter(100)}
      >
        {title}
      </h1>
      {lead ? (
        <p
          className={cn(
            'mt-6 max-w-[40rem] animate-fade-up text-[17px] font-normal leading-relaxed md:mt-7 md:text-lg md:leading-relaxed',
            dark ? 'text-ivory/72' : 'text-ink-2',
          )}
          style={enter(180)}
        >
          {lead}
        </p>
      ) : null}
      {actions ? (
        <div className="mt-9 flex animate-fade-up flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center" style={enter(260)}>
          {actions}
        </div>
      ) : null}
      {footnote ? (
        <div className="mt-8 animate-fade-up" style={enter(320)}>
          {footnote}
        </div>
      ) : null}
    </div>
  );

  const visual = aside ? (
    <div className="animate-fade-up lg:col-span-5" style={enter(220)}>
      {aside}
    </div>
  ) : null;

  if (dark) {
    return (
      <section
        aria-labelledby={titleId}
        className={cn('surface-dark relative isolate overflow-hidden bg-forest-900 text-ivory', className)}
      >
        <Contours variant="ridge" className="text-white/[0.045]" />
        {furrows ? <FieldLines className="top-auto h-[45%] text-gold-400/[0.06]" /> : null}
        <div
          className={cn(
            'content-container relative grid gap-14 pt-10 lg:grid-cols-12 lg:items-center lg:gap-10',
            size === 'lg' ? 'pb-20 md:pb-28 lg:pb-32' : 'pb-16 md:pb-24',
          )}
        >
          {copy}
          {visual}
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby={titleId} className={cn('relative isolate overflow-clip bg-ivory', className)}>
      <Contours variant="valley" className="text-forest-900/[0.04]" />
      <div
        className={cn(
          'content-container relative grid gap-14 pt-8 lg:grid-cols-12 lg:items-end lg:gap-10',
          size === 'lg' ? 'pb-16 md:pb-24' : 'pb-12 md:pb-16',
        )}
      >
        {copy}
        {visual}
      </div>
      <span aria-hidden="true" className="hairline content-container relative" />
    </section>
  );
}
