import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useControllableState } from './hooks';

export interface SwitchProps extends Omit<ComponentProps<'button'>, 'onChange' | 'value' | 'defaultValue' | 'children'> {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
}

export function Switch({
  checked,
  defaultChecked = false,
  onCheckedChange,
  label,
  description,
  disabled,
  className,
  id,
  ...props
}: SwitchProps) {
  const generatedId = useId();
  const switchId = id ?? `switch-${generatedId}`;
  const labelId = label ? `${switchId}-label` : undefined;
  const descriptionId = description ? `${switchId}-description` : undefined;
  const [on, setOn] = useControllableState({ value: checked, defaultValue: defaultChecked, onChange: onCheckedChange });

  const control = (
    <button
      id={switchId}
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
      disabled={disabled}
      onClick={() => setOn(!on)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border p-[3px] transition-colors duration-300 ease-luxe',
        on ? 'border-forest-600 bg-forest-600' : 'border-ink/25 bg-parchment',
        'disabled:cursor-not-allowed disabled:opacity-50',
        !label && className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'block size-4 rounded-full bg-paper shadow-[0_0_0_1px_rgba(27,22,17,0.12)] transition-transform duration-300 ease-luxe',
          on ? 'translate-x-5' : 'translate-x-0',
        )}
      >
      </span>
    </button>
  );

  if (!label) return control;

  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <label id={labelId} htmlFor={switchId} className="text-sm font-medium leading-6 text-ink">
          {label}
        </label>
        {description ? (
          <span id={descriptionId} className="text-[13px] leading-5 text-muted">
            {description}
          </span>
        ) : null}
      </div>
      {control}
    </div>
  );
}
