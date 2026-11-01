export type SortDirection = 'asc' | 'desc';
export type SortValue = string | number | boolean | Date | null | undefined;

const collator = new Intl.Collator('en-IN', { numeric: true, sensitivity: 'base' });

function isEmpty(value: SortValue): value is null | undefined {
  return value === null || value === undefined || (typeof value === 'number' && Number.isNaN(value));
}

/** Ascending comparison of two cell values: numbers numerically, text naturally ("Lot 2" < "Lot 10"). */
export function compareSortValues(a: Exclude<SortValue, null | undefined>, b: Exclude<SortValue, null | undefined>): number {
  if (a instanceof Date || b instanceof Date) {
    return (a instanceof Date ? a.getTime() : Number(a)) - (b instanceof Date ? b.getTime() : Number(b));
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return collator.compare(String(a), String(b));
}

/**
 * Stable sort by an accessor. Empty values (null, undefined, NaN) always go last, whatever the
 * direction, so "no data yet" never crowds the top of a table.
 */
export function sortRows<T>(rows: readonly T[], accessor: (row: T) => SortValue, direction: SortDirection): T[] {
  const factor = direction === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: accessor(row) }))
    .sort((a, b) => {
      const aEmpty = isEmpty(a.value);
      const bEmpty = isEmpty(b.value);
      if (aEmpty || bEmpty) return aEmpty === bEmpty ? a.index - b.index : aEmpty ? 1 : -1;
      const order = compareSortValues(a.value as Exclude<SortValue, null | undefined>, b.value as Exclude<SortValue, null | undefined>);
      return order === 0 ? a.index - b.index : order * factor;
    })
    .map(({ row }) => row);
}
