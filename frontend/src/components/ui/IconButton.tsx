import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

const VARIANTS = {
  ghost: 'text-current hover:bg-current/[0.05] active:bg-current/[0.08]',
  secondary: 'border border-ink/20 bg-transparent text-ink hover:border-ink',
  primary: 'bg-forest-600 text-white hover:bg-forest-700',
  /** Solid cream for dark surfaces (no gradient). */
  gold: 'bg-ivory text-ink hover:bg-paper',
  glass: 'border border-ivory/25 bg-transparent text-ivory hover:border-ivory/60 hover:bg-ivory/[0.04]',
} as const;

const SIZES = {
  sm: "size-9 [&_svg:not([class*='size-'])]:size-4",
  md: "size-11 [&_svg:not([class*='size-'])]:size-[18px]",
  lg: "size-12 [&_svg:not([class*='size-'])]:size-5",
} as const;

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children' | 'aria-label'> {
  /** Accessible name — required because the button has no visible text. */
  label: string;
  icon: ReactNode;
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  loading?: boolean;
}

export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size = 'md',
  loading = false,
  disabled,
  className,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-sm transition-[background-color,border-color,color] duration-300 ease-luxe',
        'disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner size="sm" /> : icon}
    </button>
  );
}
