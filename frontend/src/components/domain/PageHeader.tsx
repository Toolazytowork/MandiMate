import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface Crumb {
  label: ReactNode;
  /** Omit for the current page. */
  to?: string;
}

export interface PageHeaderProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** Primary and secondary actions; right-aligned on wide screens, below the title on phones. */
  actions?: ReactNode;
  breadcrumbs?: readonly Crumb[];
  /** A row of badges or facts under the description (status, code, dates). */
  meta?: ReactNode;
  /** Hairline under the header. */
  divider?: boolean;
  className?: string;
}

/** The page's single `h1` in the display bold, with eyebrow, description, meta and actions. */
export function PageHeader({ title, eyebrow, description, actions, breadcrumbs, meta, divider = false, className }: PageHeaderProps) {
  const { t } = useTranslation('domain');
  return (
    <header className={cn('flex flex-col gap-5', divider && 'border-b border-line pb-8', className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label={t('common:a11y.breadcrumb')}>
          <ol className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-muted">
            {breadcrumbs.map((crumb, index) => {
              const last = index === breadcrumbs.length - 1;
              return (
                <Fragment key={index}>
                  {index > 0 ? (
                    <li aria-hidden="true" className="text-ink/25">
                      <ChevronRight strokeWidth={1.25} className="size-3" />
                    </li>
                  ) : null}
                  <li className="min-w-0">
                    {crumb.to && !last ? (
                      <Link to={crumb.to} className="link-luxe transition-colors hover:text-ink">
                        {crumb.label}
                      </Link>
                    ) : (
                      <span aria-current={last ? 'page' : undefined} className={cn(last && 'text-ink/80')}>
                        {crumb.label}
                      </span>
                    )}
                  </li>
                </Fragment>
              );
            })}
          </ol>
        </nav>
      ) : null}
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between md:gap-8">
        <div className="flex min-w-0 max-w-3xl flex-col gap-3">
          {eyebrow ? <p className="eyebrow eyebrow-rule">{eyebrow}</p> : null}
          <h1 className="font-display text-h1 font-bold text-ink md:text-display-sm">{title}</h1>
          {description ? <p className="max-w-measure text-body font-normal leading-relaxed text-ink-2">{description}</p> : null}
          {meta ? <div className="flex flex-wrap items-center gap-2.5 pt-1">{meta}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div> : null}
      </div>
    </header>
  );
}
