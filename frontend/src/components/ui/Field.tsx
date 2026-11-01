import { createContext, useContext, useId, type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';

interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
  disabled: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

interface ControlAriaProps {
  id?: string;
  required?: boolean;
  disabled?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling';
}

/**
 * Wires a form control to its enclosing `<Field>`: id, describedby, invalid,
 * required and disabled. Explicit props on the control always win.
 */
export function useFieldControl<P extends ControlAriaProps>(props: P): P {
  const field = useContext(FieldContext);
  if (!field) return props;
  const describedBy = [field.describedBy, props['aria-describedby']].filter(Boolean).join(' ') || undefined;
  return {
    ...props,
    id: props.id ?? field.id,
    required: props.required ?? (field.required || undefined),
    disabled: props.disabled ?? (field.disabled || undefined),
    'aria-describedby': describedBy,
    'aria-invalid': props['aria-invalid'] ?? (field.invalid || undefined),
  };
}

export interface LabelProps extends ComponentProps<'label'> {
  required?: boolean;
}

export function Label({ required, className, children, ...props }: LabelProps) {
  return (
    <label className={cn('text-[13px] font-medium leading-5 text-ink-2', className)} {...props}>
      {children}
      {required ? (
        <span aria-hidden="true" className="ms-0.5 text-gold-700">
          *
        </span>
      ) : null}
    </label>
  );
}

export interface FieldProps {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  /** Error message (e.g. react-hook-form `errors.x?.message`). Replaces the hint while present. */
  error?: ReactNode;
  required?: boolean;
  /** Shows a quiet "Optional" tag next to the label. */
  optional?: boolean;
  disabled?: boolean;
  /** Content aligned to the right of the label (e.g. a "Forgot password?" link). */
  labelAside?: ReactNode;
  /** Visually hide the label (it stays available to assistive tech). */
  hideLabel?: boolean;
  /** Id for the control; generated when omitted. */
  id?: string;
  className?: string;
}

export function Field({
  label,
  children,
  hint,
  error,
  required = false,
  optional = false,
  disabled = false,
  labelAside,
  hideLabel = false,
  id,
  className,
}: FieldProps) {
  const { t } = useTranslation('common');
  const generatedId = useId();
  const controlId = id ?? `field-${generatedId}`;
  const messageId = `${controlId}-message`;
  const hasError = error !== undefined && error !== null && error !== false && error !== '';
  const message = hasError ? error : hint;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className={cn('flex items-baseline justify-between gap-3', hideLabel && 'sr-only')}>
        <Label htmlFor={controlId} required={required}>
          {label}
          {optional ? (
            <span className="ms-2 text-[10px] font-normal text-muted">{t('a11y.optional', { defaultValue: 'Optional' })}</span>
          ) : null}
        </Label>
        {labelAside}
      </div>
      <FieldContext.Provider
        value={{
          id: controlId,
          describedBy: message ? messageId : undefined,
          invalid: hasError,
          required,
          disabled,
        }}
      >
        {children}
      </FieldContext.Provider>
      {message ? (
        <p
          id={messageId}
          className={cn(
            'flex items-start gap-1.5 text-[13px] leading-5',
            hasError ? 'text-danger-ink' : 'text-muted',
          )}
        >
          {hasError ? <CircleAlert aria-hidden="true" strokeWidth={1.25} className="mt-0.5 size-3.5 shrink-0" /> : null}
          <span>{message}</span>
        </p>
      ) : null}
    </div>
  );
}
