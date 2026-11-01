import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { roleHome } from '@/lib/auth';
import type { Role } from '@/types/api';
import { breadcrumbsFor } from './navigation';

/** Path-derived breadcrumbs; on phones the current page title with a link back to its parent. */
export function Breadcrumbs({ role }: { role: Role }) {
  const { t } = useTranslation('common');
  const { pathname } = useLocation();
  const crumbs = breadcrumbsFor(pathname, role, roleHome(role));
  if (crumbs.length === 0) return null;
  const current = crumbs[crumbs.length - 1];
  const parent = crumbs.length > 2 ? crumbs[crumbs.length - 2] : undefined;

  return (
    <nav aria-label={t('a11y.breadcrumb', { defaultValue: 'Breadcrumb' })} className="min-w-0">
      <div className="flex min-w-0 flex-col sm:hidden">
        {parent?.to ? (
          <Link to={parent.to} className="-ms-0.5 inline-flex items-center gap-0.5 self-start text-xs text-muted">
            <ChevronLeft aria-hidden="true" strokeWidth={1.25} className="size-3.5" />
            {t(parent.labelKey, { defaultValue: parent.label })}
          </Link>
        ) : null}
        <p aria-current="page" className="truncate font-display text-[20px] font-normal leading-tight text-ink">
          {t(current.labelKey, { defaultValue: current.label })}
        </p>
      </div>
      <ol className="hidden min-w-0 items-center gap-2 text-[13px] font-semibold sm:flex">
        {crumbs.map((crumb, index) => {
          const label = t(crumb.labelKey, { defaultValue: crumb.label });
          const isLast = index === crumbs.length - 1;
          return (
            <Fragment key={`${crumb.labelKey}-${index}`}>
              {index > 0 ? (
                <li aria-hidden="true" className="text-ink/25">
                  <ChevronRight strokeWidth={1.25} className="size-3.5" />
                </li>
              ) : null}
              <li className="min-w-0">
                {isLast ? (
                  <span aria-current="page" className="block truncate text-ink">
                    {label}
                  </span>
                ) : crumb.to ? (
                  <Link to={crumb.to} className="block truncate text-muted transition-colors hover:text-ink">
                    {label}
                  </Link>
                ) : (
                  <span className="block truncate text-muted">{label}</span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
