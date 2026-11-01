import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, ArrowUpDown, Inbox } from 'lucide-react';
import {
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableEmpty,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { sortRows, type SortDirection, type SortValue } from './tableSort';

const HIDE_BELOW = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
} as const;

export interface DataTableColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  /** Makes the column sortable by this value. */
  sortValue?: (row: T) => SortValue;
  /** First direction when the column is sorted (default `asc`; numbers usually want `desc`). */
  sortFirst?: SortDirection;
  align?: 'left' | 'center' | 'right';
  /** Right-aligned tabular figures. */
  numeric?: boolean;
  /** Hide the column on narrow screens. */
  hideBelow?: keyof typeof HIDE_BELOW;
  /** Footer cell content (e.g. a total); the footer row renders when any column has one. */
  footer?: ReactNode;
  className?: string;
  headerClassName?: string;
}

export interface DataTableProps<T> {
  columns: readonly DataTableColumn<T>[];
  /** `undefined` while the first page is loading. */
  rows: readonly T[] | undefined;
  getRowId: (row: T) => string;
  /** Accessible name for the table. */
  label: string;
  loading?: boolean;
  loadingRows?: number;
  /** Replaces the default empty state. */
  empty?: ReactNode;
  emptyTitle?: ReactNode;
  emptyDescription?: ReactNode;
  defaultSort?: { columnId: string; direction: SortDirection };
  /** Makes rows clickable and keyboard-activatable (Enter / Space). */
  onRowClick?: (row: T) => void;
  isRowSelected?: (row: T) => boolean;
  rowClassName?: (row: T) => string | undefined;
  caption?: ReactNode;
  framed?: boolean;
  containerClassName?: string;
  className?: string;
}

/**
 * Typed table on the design-system Table: sortable columns (`aria-sort`), skeleton rows while
 * loading, an empty state, optional footer totals, responsive column hiding and clickable rows.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  label,
  loading = false,
  loadingRows = 5,
  empty,
  emptyTitle,
  emptyDescription,
  defaultSort,
  onRowClick,
  isRowSelected,
  rowClassName,
  caption,
  framed = true,
  containerClassName,
  className,
}: DataTableProps<T>) {
  const { t } = useTranslation('domain');
  const [sort, setSort] = useState(defaultSort ?? null);

  const sorted = useMemo(() => {
    if (!rows) return [];
    const column = sort ? columns.find((candidate) => candidate.id === sort.columnId) : undefined;
    if (!sort || !column?.sortValue) return [...rows];
    return sortRows(rows, column.sortValue, sort.direction);
  }, [rows, columns, sort]);

  const toggleSort = (column: DataTableColumn<T>) => {
    setSort((current) => {
      if (current?.columnId === column.id) {
        return { columnId: column.id, direction: current.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { columnId: column.id, direction: column.sortFirst ?? 'asc' };
    });
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, row: T) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRowClick?.(row);
    }
  };

  const showSkeleton = loading || rows === undefined;
  const hasFooter = columns.some((column) => column.footer !== undefined);
  const cellClass = (column: DataTableColumn<T>) => cn(column.hideBelow && HIDE_BELOW[column.hideBelow], column.className);

  return (
    <Table aria-label={label} aria-busy={showSkeleton || undefined} framed={framed} containerClassName={containerClassName} className={className}>
      {caption ? <TableCaption>{caption}</TableCaption> : null}
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {columns.map((column) => {
            const active = sort?.columnId === column.id;
            const align = column.align ?? (column.numeric ? 'right' : 'left');
            return (
              <TableHead
                key={column.id}
                align={align}
                aria-sort={column.sortValue ? (active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                className={cn(column.hideBelow && HIDE_BELOW[column.hideBelow], column.headerClassName)}
              >
                {column.sortValue ? (
                  <button
                    type="button"
                    onClick={() => toggleSort(column)}
                    className={cn(
                      'group/sort -mx-1.5 inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[13px] font-semibold transition-colors hover:text-ink',
                      active && 'text-ink',
                      align === 'right' && 'flex-row-reverse',
                    )}
                  >
                    {column.header}
                    {active ? (
                      sort.direction === 'asc' ? (
                        <ArrowUp aria-hidden="true" strokeWidth={1.25} className="size-3" />
                      ) : (
                        <ArrowDown aria-hidden="true" strokeWidth={1.25} className="size-3" />
                      )
                    ) : (
                      <ArrowUpDown aria-hidden="true" strokeWidth={1.25} className="size-3 opacity-40 group-hover/sort:opacity-80" />
                    )}
                    <span className="sr-only">{t('table.sortBy')}</span>
                  </button>
                ) : (
                  column.header
                )}
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {showSkeleton
          ? Array.from({ length: loadingRows }, (_, rowIndex) => (
              <TableRow key={`skeleton-${rowIndex}`} className="hover:bg-transparent">
                {columns.map((column, columnIndex) => (
                  <TableCell key={column.id} className={cellClass(column)}>
                    <Skeleton
                      className={cn(
                        'h-3.5',
                        column.numeric ? 'ms-auto w-16' : columnIndex === 0 ? 'w-40 max-w-full' : 'w-24',
                      )}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))
          : null}
        {!showSkeleton && sorted.length === 0 ? (
          <TableEmpty colSpan={columns.length}>
            {empty ?? (
              <EmptyState
                framed={false}
                size="sm"
                icon={<Inbox />}
                title={emptyTitle ?? t('common:states.empty.title')}
                description={emptyDescription ?? t('common:states.empty.body')}
                className="py-2"
              />
            )}
          </TableEmpty>
        ) : null}
        {!showSkeleton
          ? sorted.map((row, index) => (
              <TableRow
                key={getRowId(row)}
                interactive={Boolean(onRowClick)}
                selected={isRowSelected?.(row) ?? false}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? (event) => onRowKeyDown(event, row) : undefined}
                className={cn(onRowClick && 'focus-visible:bg-paper focus-visible:outline-offset-[-2px]', rowClassName?.(row))}
              >
                {columns.map((column) => (
                  <TableCell
                    key={column.id}
                    align={column.align}
                    numeric={column.numeric}
                    className={cellClass(column)}
                  >
                    {column.cell(row, index)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          : null}
      </TableBody>
      {hasFooter && !showSkeleton && sorted.length > 0 ? (
        <TableFooter>
          <TableRow className="hover:bg-transparent">
            {columns.map((column) => (
              <TableCell key={column.id} align={column.align} numeric={column.numeric} className={cellClass(column)}>
                {column.footer}
              </TableCell>
            ))}
          </TableRow>
        </TableFooter>
      ) : null}
    </Table>
  );
}
