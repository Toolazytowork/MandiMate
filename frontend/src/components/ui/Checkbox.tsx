import { useEffect, useId, useRef, type ComponentProps, type ReactNode } from 'react';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useFieldControl } from './Field';
import { mergeRefs } from './hooks';

export interface CheckboxProps extends Omit<ComponentProps<'input'>, 'type' | 'size'> {
  label?: ReactNode;
  description?: ReactNode;
  /** Mixed state, e.g. a "select all" box with some rows selected. */
  indeterminate?: boolean;
}

export function Checkbox({ label, description, indeterminate = false, className, ref, id, ...rest }: CheckboxProps) {
  const props = useFieldControl({ id, ...rest });
  const generatedId = useId();
  const inputId = props.id ?? `checkbox-${generatedId}`;
  const descriptionId = description ? `${inputId}-description` : undefined;
  const innerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (innerRef.current) innerRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  const describedBy = [props['aria-describedby'], descriptionId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex items-start gap-3', className)}>
      <span className="relative mt-[3px] grid size-5 shrink-0 place-items-center">
        <input
          ref={mergeRefs(ref, innerRef)}
          type="checkbox"
          {...props}
          id={inputId}
          aria-describedby={describedBy}
          className={cn(
            'peer size-5 appearance-none rounded-sm border border-ink/30 bg-paper',
            'transition-[background-color,border-color] duration-200 ease-luxe',
            'hover:border-ink checked:border-forest-600 checked:bg-forest-600 indeterminate:border-forest-600 indeterminate:bg-forest-600',
            'focus-visible:outline-2 focus-visible:outline-offset-2',
            'aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:opacity-50',
          )}
        />
        <Check
          aria-hidden="true"
          strokeWidth={2}
          className="pointer-events-none absolute size-3.5 text-paper opacity-0 transition-opacity duration-200 ease-luxe peer-checked:opacity-100 peer-indeterminate:opacity-0"
        />
        <Minus
          aria-hidden="true"
          strokeWidth={2}
          className="pointer-events-none absolute size-3.5 text-paper opacity-0 peer-indeterminate:opacity-100"
        />
      </span>
      {label || description ? (
        <span className="flex min-w-0 flex-col gap-0.5">
          {label ? (
            <label htmlFor={inputId} className="text-sm font-medium leading-6 text-ink">
              {label}
            </label>
          ) : null}
          {description ? (
            <span id={descriptionId} className="text-[13px] leading-5 text-muted">
              {description}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
