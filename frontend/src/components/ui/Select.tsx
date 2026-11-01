import type { ComponentProps } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useFieldControl } from './Field';
import { CONTROL_SURFACE } from './Input';

const HEIGHTS = {
  sm: 'h-10 text-sm',
  md: 'h-12',
} as const;

export interface SelectProps extends Omit<ComponentProps<'select'>, 'size'> {
  size?: keyof typeof HEIGHTS;
  /** Rendered as a disabled first option with an empty value. */
  placeholder?: string;
  wrapperClassName?: string;
}

/** Native select (best on mobile and for assistive tech), styled to match the inputs. */
export function Select({ size = 'md', placeholder, wrapperClassName, className, children, ...rest }: SelectProps) {
  const props = useFieldControl(rest);
  // A disabled first option is skipped by the browser's default selection, so start on it explicitly.
  const showPlaceholderByDefault = placeholder !== undefined && props.value === undefined && props.defaultValue === undefined;
  return (
    <div className={cn('relative w-full min-w-0', wrapperClassName)}>
      <select
        defaultValue={showPlaceholderByDefault ? '' : undefined}
        className={cn(
          CONTROL_SURFACE,
          HEIGHTS[size],
          'w-full min-w-0 appearance-none truncate ps-4 pe-11',
          'outline-none focus-visible:outline-none focus:border-ink focus:bg-paper focus:ring-1 focus:ring-ink/10',
          'aria-[invalid=true]:border-danger/70 aria-[invalid=true]:focus:border-danger aria-[invalid=true]:focus:ring-danger/10',
          'disabled:cursor-not-allowed disabled:bg-parchment/70 disabled:text-muted',
          "[&:has(option[value='']:checked)]:text-muted",
          className,
        )}
        {...props}
      >
        {placeholder !== undefined ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        strokeWidth={1.25}
        className="pointer-events-none absolute end-4 top-1/2 size-4 -translate-y-1/2 text-muted"
      />
    </div>
  );
}
