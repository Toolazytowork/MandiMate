import { useId, type KeyboardEvent, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { DURATION, EASE_LUXE } from '@/components/motion/tokens';
import { useControllableState } from './hooks';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

const SIZES = {
  sm: 'h-9 px-3 text-[10px]',
  md: 'h-11 px-4 text-[11px]',
} as const;

const TONES = {
  light: {
    track: 'border-line bg-paper',
    idle: 'text-muted hover:text-ink',
    active: 'text-ivory',
    thumb: 'border-forest-600 bg-forest-600',
  },
  dark: {
    track: 'border-ivory/20 bg-transparent',
    idle: 'text-ivory/65 hover:text-ivory',
    active: 'text-ink',
    thumb: 'border-transparent bg-ivory',
  },
} as const;

export interface SegmentedControlProps<T extends string> {
  /** Accessible name of the group. */
  label: string;
  options: readonly SegmentedOption<T>[];
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: T) => void;
  size?: keyof typeof SIZES;
  /** `dark` for forest surfaces. */
  tone?: keyof typeof TONES;
  fullWidth?: boolean;
  className?: string;
}

/** Single-choice segmented switcher (radiogroup semantics) with a sliding deep-green thumb. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  defaultValue,
  onValueChange,
  size = 'md',
  tone = 'light',
  fullWidth = false,
  className,
}: SegmentedControlProps<T>) {
  const id = useId();
  const palette = TONES[tone];
  const [current, setCurrent] = useControllableState<T>({
    value,
    defaultValue: defaultValue ?? options[0].value,
    onChange: onValueChange,
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const enabled = options.filter((option) => !option.disabled);
    const index = enabled.findIndex((option) => option.value === current);
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0 || enabled.length === 0) return;
    event.preventDefault();
    const next = enabled[(index + step + enabled.length) % enabled.length];
    setCurrent(next.value);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        'relative inline-flex items-center gap-0.5 rounded-sm border p-0.5',
        palette.track,
        fullWidth && 'flex w-full',
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === current;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-value={option.value}
            tabIndex={selected ? 0 : -1}
            disabled={option.disabled}
            onClick={() => setCurrent(option.value)}
            className={cn(
              'relative inline-flex min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold transition-colors duration-300',
              "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
              SIZES[size],
              fullWidth && 'flex-1',
              selected ? palette.active : palette.idle,
              'disabled:pointer-events-none disabled:opacity-40',
            )}
          >
            {selected ? (
              <motion.span
                layoutId={`${id}-thumb`}
                aria-hidden="true"
                className={cn('absolute inset-0 rounded-md border', palette.thumb)}
                transition={{ duration: DURATION.ui + 0.08, ease: EASE_LUXE }}
              />
            ) : null}
            <span className="relative inline-flex items-center gap-2">
              {option.icon}
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
