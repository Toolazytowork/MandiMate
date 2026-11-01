import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FunnelX, Search, X } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { cn } from '@/lib/cn';

export interface FilterBarProps {
  /** Controlled search text; omit `onSearchChange` to hide the search field. */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  /** Accessible name of the search field (defaults to "Search"). */
  searchLabel?: string;
  /** Filter controls: Select, SegmentedControl, Switch… */
  children?: ReactNode;
  /** Number of active filters; with `onClear`, shows "Clear filters". */
  activeCount?: number;
  onClear?: () => void;
  /** Shown at the end, e.g. "12 lots". */
  resultLabel?: ReactNode;
  className?: string;
}

/** Search plus filter controls in one calm strip, with a clear-all action and a result count. */
export function FilterBar({
  searchValue = '',
  onSearchChange,
  searchPlaceholder,
  searchLabel,
  children,
  activeCount = 0,
  onClear,
  resultLabel,
  className,
}: FilterBarProps) {
  const { t } = useTranslation('domain');
  const searchId = useId();
  const canClear = Boolean(onClear) && (activeCount > 0 || searchValue.length > 0);

  return (
    <div
      role="search"
      className={cn(
        'flex flex-col gap-3 border-y border-line py-3 md:flex-row md:flex-wrap md:items-center',
        className,
      )}
    >
      {onSearchChange ? (
        <div className="min-w-0 md:w-72 md:flex-none">
          <label htmlFor={searchId} className="sr-only">
            {searchLabel ?? t('common:actions.search')}
          </label>
          <Input
            id={searchId}
            type="search"
            size="md"
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder ?? t('filters.searchPlaceholder')}
            leading={<Search strokeWidth={1.25} />}
            trailing={
              searchValue ? (
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  aria-label={t('filters.clearSearch')}
                  className="grid size-7 place-items-center rounded-full text-muted transition-colors hover:text-ink"
                >
                  <X aria-hidden="true" strokeWidth={1.25} className="size-4" />
                </button>
              ) : undefined
            }
            className="[&::-webkit-search-cancel-button]:hidden"
          />
        </div>
      ) : null}
      {children ? <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">{children}</div> : <div className="hidden flex-1 md:block" />}
      {resultLabel || canClear ? (
        <div className="flex items-center justify-between gap-3 md:justify-end">
          {resultLabel ? (
            <span aria-live="polite" className="text-[13px] font-semibold text-muted">
              {resultLabel}
            </span>
          ) : null}
          {canClear ? (
            <Button variant="ghost" size="sm" onClick={onClear} leadingIcon={<FunnelX aria-hidden="true" strokeWidth={1.25} />}>
              {t('common:actions.clearFilters')}
              {activeCount > 0 ? <span className="tabular-nums text-muted">({activeCount})</span> : null}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
