import { createContext, useContext, useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useControllableState } from './hooks';

interface RadioCardGroupContextValue {
  name: string;
  value: string | undefined;
  setValue: (value: string) => void;
  disabled: boolean;
  invalid: boolean;
}

const RadioCardGroupContext = createContext<RadioCardGroupContextValue | null>(null);

const COLUMNS = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
} as const;

export interface RadioCardGroupProps {
  /** Visible group label (rendered as the fieldset legend). */
  label: ReactNode;
  hideLabel?: boolean;
  description?: ReactNode;
  error?: ReactNode;
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  columns?: keyof typeof COLUMNS;
  className?: string;
  children: ReactNode;
}

/** Large, tappable radio options (e.g. role on sign-up, pickup terms). Native radios underneath. */
export function RadioCardGroup({
  label,
  hideLabel = false,
  description,
  error,
  name,
  value,
  defaultValue,
  onValueChange,
  disabled = false,
  required = false,
  columns = 2,
  className,
  children,
}: RadioCardGroupProps) {
  const generatedId = useId();
  const groupName = name ?? `radio-${generatedId}`;
  const descriptionId = `${groupName}-description`;
  const errorId = `${groupName}-error`;
  const [current, setCurrent] = useControllableState<string | undefined>({
    value,
    defaultValue,
    onChange: (next) => {
      if (next !== undefined) onValueChange?.(next);
    },
  });
  const invalid = Boolean(error);

  return (
    <fieldset
      className={cn('min-w-0', className)}
      aria-describedby={[description ? descriptionId : null, invalid ? errorId : null].filter(Boolean).join(' ') || undefined}
      aria-required={required || undefined}
      aria-invalid={invalid || undefined}
      disabled={disabled}
    >
      <legend className={cn('mb-1 text-[13px] font-semibold text-ink-2', hideLabel && 'sr-only')}>
        {label}
        {required ? (
          <span aria-hidden="true" className="ms-0.5 text-gold-700">
            *
          </span>
        ) : null}
      </legend>
      {description ? (
        <p id={descriptionId} className="mb-3 text-[13px] text-muted">
          {description}
        </p>
      ) : null}
      <RadioCardGroupContext.Provider value={{ name: groupName, value: current, setValue: setCurrent, disabled, invalid }}>
        <div className={cn('mt-2 grid gap-3', COLUMNS[columns])}>{children}</div>
      </RadioCardGroupContext.Provider>
      {invalid ? (
        <p id={errorId} className="mt-2 text-[13px] text-danger-ink">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

export interface RadioCardProps {
  value: string;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  /** Small right-aligned detail, e.g. a price or "Recommended". */
  meta?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function RadioCard({ value, title, description, icon, meta, disabled = false, className }: RadioCardProps) {
  const group = useContext(RadioCardGroupContext);
  if (!group) throw new Error('RadioCard must be rendered inside a RadioCardGroup.');
  const id = `${group.name}-${value}`;
  const checked = group.value === value;
  const isDisabled = disabled || group.disabled;

  return (
    <label
      htmlFor={id}
      className={cn(
        'group/radio relative flex min-h-16 cursor-pointer items-start gap-3.5 rounded-card border border-line bg-paper p-5 pe-12',
        'transition-[border-color,background-color] duration-300 ease-luxe hover:border-forest-400',
        'has-[:checked]:border-gold-700 has-[:checked]:bg-gold-50/60 has-[:checked]:shadow-[inset_0_0_0_1px_var(--color-gold-700)]',
        'has-[:focus-visible]:[outline:2px_solid_var(--focus-ring)] has-[:focus-visible]:[outline-offset:2px]',
        group.invalid && 'border-danger/50',
        isDisabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      <input
        id={id}
        type="radio"
        name={group.name}
        value={value}
        checked={checked}
        disabled={isDisabled}
        onChange={() => group.setValue(value)}
        className="sr-only"
      />
      {icon ? (
        <span
          aria-hidden="true"
          className="flex shrink-0 items-center pt-0.5 text-muted transition-colors duration-200 group-has-[:checked]/radio:text-forest-600 [&_svg]:size-5"
        >
          {icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-[15px] font-medium text-ink">{title}</span>
          {meta ? <span className="shrink-0 text-[13px] font-semibold text-muted">{meta}</span> : null}
        </span>
        {description ? <span className="text-[13px] leading-5 text-muted">{description}</span> : null}
      </span>
      <span
        aria-hidden="true"
        className="absolute end-5 top-5 grid size-4 place-items-center rounded-full border border-ink/30 bg-paper transition-colors duration-200 group-has-[:checked]/radio:border-forest-600"
      >
        <span className="size-2 rounded-full bg-gold-700 opacity-0 transition-opacity group-has-[:checked]/radio:opacity-100" />
      </span>
    </label>
  );
}
