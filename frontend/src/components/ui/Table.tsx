import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

const ALIGN = {
  left: 'text-start',
  center: 'text-center',
  right: 'text-end',
} as const;

type Align = keyof typeof ALIGN;

export interface TableProps extends ComponentProps<'table'> {
  /** Classes for the scroll container (e.g. `max-h-[520px]` to enable the sticky header). */
  containerClassName?: string;
  /** Wrap in a bordered card surface. */
  framed?: boolean;
}

export function Table({ containerClassName, framed = true, className, ...props }: TableProps) {
  return (
    <div
      className={cn(
        'relative w-full overflow-auto overscroll-x-contain',
        framed && 'rounded-card border border-line bg-paper',
        containerClassName,
      )}
    >
      <table className={cn('w-full border-separate border-spacing-0 text-sm', className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead className={cn('sticky top-0 z-10', className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody className={cn('[&>tr:last-child>td]:border-b-0', className)} {...props} />;
}

export function TableFooter({ className, ...props }: ComponentProps<'tfoot'>) {
  return (
    <tfoot
      className={cn('bg-parchment/50 font-medium [&>tr>td]:border-b-0 [&>tr>td]:border-t [&>tr>td]:border-line', className)}
      {...props}
    />
  );
}

export interface TableRowProps extends ComponentProps<'tr'> {
  /** Pointer cursor + hover tint for rows that navigate. */
  interactive?: boolean;
  selected?: boolean;
}

export function TableRow({ interactive = false, selected = false, className, ...props }: TableRowProps) {
  return (
    <tr
      aria-selected={selected || undefined}
      className={cn(
        'transition-colors duration-200 hover:bg-ivory/70',
        interactive && 'cursor-pointer',
        selected && 'bg-gold-50/60 hover:bg-gold-50',
        className,
      )}
      {...props}
    />
  );
}

export interface TableHeadProps extends ComponentProps<'th'> {
  align?: Align;
}

export function TableHead({ align = 'left', className, scope = 'col', ...props }: TableHeadProps) {
  return (
    <th
      scope={scope}
      className={cn(
        'whitespace-nowrap border-b border-line bg-paper px-4 py-3.5 text-[13px] font-semibold text-muted first:ps-6 last:pe-6',
        ALIGN[align],
        className,
      )}
      {...props}
    />
  );
}

export interface TableCellProps extends ComponentProps<'td'> {
  align?: Align;
  /** Right-aligned tabular figures for money and quantities. */
  numeric?: boolean;
}

export function TableCell({ align, numeric = false, className, ...props }: TableCellProps) {
  return (
    <td
      className={cn(
        'border-b border-line/80 px-4 py-4 align-middle text-ink first:ps-6 last:pe-6',
        ALIGN[align ?? (numeric ? 'right' : 'left')],
        numeric && 'whitespace-nowrap tabular-nums',
        className,
      )}
      {...props}
    />
  );
}

export function TableCaption({ className, ...props }: ComponentProps<'caption'>) {
  return <caption className={cn('caption-bottom px-5 py-3 text-start text-xs text-muted', className)} {...props} />;
}

export interface TableEmptyProps {
  colSpan: number;
  children: ReactNode;
}

/** Full-width row for "nothing here yet" inside a table body. */
export function TableEmpty({ colSpan, children }: TableEmptyProps) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-12 text-center text-sm text-muted">
        {children}
      </td>
    </tr>
  );
}
