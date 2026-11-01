import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useFieldControl } from './Field';

/** Shared surface for text-like controls (Input, Textarea, Select, adorned wrappers). */
export const CONTROL_SURFACE = cn(
  'rounded-sm border border-line bg-paper text-[15px] text-ink',
  'transition-[border-color,box-shadow,background-color] duration-300 ease-luxe',
  'hover:border-ink/30',
);

const FOCUS = 'outline-none focus-visible:outline-none focus:border-ink focus:bg-paper focus:ring-1 focus:ring-ink/10';
const FOCUS_WITHIN =
  'focus-within:border-ink focus-within:bg-paper focus-within:ring-1 focus-within:ring-ink/10';
const INVALID =
  'aria-[invalid=true]:border-danger/70 aria-[invalid=true]:focus:border-danger aria-[invalid=true]:focus:ring-danger/10';
const INVALID_WITHIN =
  'has-[[aria-invalid=true]]:border-danger/70 has-[[aria-invalid=true]]:focus-within:border-danger has-[[aria-invalid=true]]:focus-within:ring-danger/10';
const DISABLED = 'disabled:cursor-not-allowed disabled:border-line disabled:bg-parchment/60 disabled:text-muted';

const HEIGHTS = {
  md: 'h-12',
  lg: 'h-14 text-base',
} as const;

export interface InputProps extends Omit<ComponentProps<'input'>, 'size'> {
  size?: keyof typeof HEIGHTS;
  /** Icon or text before the value (e.g. "₹"). */
  leading?: ReactNode;
  /** Icon or text after the value (e.g. "kg", "/kg"). */
  trailing?: ReactNode;
  /** Class for the outer wrapper when `leading`/`trailing` are used. */
  wrapperClassName?: string;
}

/** 48 px tall by default — comfortable for thumbs and farmer screens. */
export function Input({
  size = 'md',
  leading,
  trailing,
  wrapperClassName,
  className,
  type = 'text',
  ...rest
}: InputProps) {
  const props = useFieldControl(rest);
  const numeric = type === 'number' || props.inputMode === 'decimal' || props.inputMode === 'numeric';

  if (!leading && !trailing) {
    return (
      <input
        type={type}
        className={cn(
          CONTROL_SURFACE,
          FOCUS,
          INVALID,
          DISABLED,
          HEIGHTS[size],
          'w-full min-w-0 px-4',
          numeric && 'tabular-nums',
          className,
        )}
        {...props}
      />
    );
  }

  return (
    <div
      className={cn(
        CONTROL_SURFACE,
        FOCUS_WITHIN,
        INVALID_WITHIN,
        HEIGHTS[size],
        'flex w-full min-w-0 items-center gap-2.5 px-4',
        'has-[:disabled]:cursor-not-allowed has-[:disabled]:bg-parchment/70 has-[:disabled]:text-muted',
        wrapperClassName,
      )}
    >
      {leading ? (
        <span className="flex shrink-0 items-center text-muted [&_svg]:size-4" aria-hidden="true">
          {leading}
        </span>
      ) : null}
      <input
        type={type}
        className={cn(
          'h-full w-full min-w-0 flex-1 bg-transparent outline-none focus-visible:outline-none disabled:cursor-not-allowed',
          numeric && 'tabular-nums',
          className,
        )}
        {...props}
      />
      {trailing ? (
        <span className="flex shrink-0 items-center text-sm text-muted [&_svg]:size-[18px]">{trailing}</span>
      ) : null}
    </div>
  );
}
