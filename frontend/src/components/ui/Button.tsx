import type { ComponentProps, ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

export const BUTTON_VARIANTS = {
  /** Leaf-green fill, white label — the single primary action on light surfaces. */
  primary: 'bg-forest-600 text-white shadow-button hover:bg-forest-700 active:bg-forest-800',
  /** Harvest amber on dark surfaces — the hero CTA. */
  gold: 'bg-gold-400 text-forest-950 shadow-gold hover:bg-gold-300 active:bg-gold-500',
  /** Green outline on light surfaces. */
  secondary: 'border-[1.5px] border-forest-600/35 bg-paper text-forest-800 hover:border-forest-600 hover:bg-forest-50 active:bg-forest-100',
  /** Text-only; inherits the surrounding text colour, so it works on light and dark. */
  ghost: 'text-current hover:bg-current/[0.06] active:bg-current/[0.1]',
  danger: 'bg-danger text-white hover:bg-danger-ink active:bg-danger-ink',
  /** White fill for dark surfaces. */
  inverse: 'bg-white text-forest-900 hover:bg-forest-50 active:bg-forest-100',
  /** White outline for dark surfaces. */
  glass: 'border-[1.5px] border-white/35 bg-white/[0.04] text-white hover:border-white/70 hover:bg-white/[0.1] active:bg-white/[0.14]',
} as const;

export const BUTTON_SIZES = {
  sm: "h-10 gap-2 px-4 text-[13px] [&_svg:not([class*='size-'])]:size-4",
  md: 'h-12 gap-2 px-6 text-[15px]',
  lg: 'h-13 gap-2.5 px-7 text-[16px]',
} as const;

export type ButtonVariant = keyof typeof BUTTON_VARIANTS;
export type ButtonSize = keyof typeof BUTTON_SIZES;

interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}

/** Class list for anything that should look like a button (e.g. a plain `<a>`). */
export function buttonClasses({ variant = 'primary', size = 'md', fullWidth = false, className }: ButtonStyleOptions = {}) {
  return cn(
    'group/button relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-full font-semibold leading-none tracking-normal',
    'transition-[background-color,border-color,color,opacity,box-shadow] duration-200 ease-luxe',
    'disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45',
    "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size],
    fullWidth && 'w-full',
    className,
  );
}

interface ButtonContentProps {
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  children?: ReactNode;
  size: ButtonSize;
}

function ButtonContent({ loading, leadingIcon, trailingIcon, children, size }: ButtonContentProps) {
  return (
    <>
      {loading ? <Spinner size={size === 'sm' ? 'xs' : 'sm'} /> : leadingIcon}
      {children}
      {trailingIcon ? (
        <span className="inline-flex transition-transform duration-300 ease-luxe group-hover/button:translate-x-0.5">
          {trailingIcon}
        </span>
      ) : null}
    </>
  );
}

export interface ButtonProps extends ComponentProps<'button'>, Omit<ButtonStyleOptions, 'className'> {
  /** Shows a spinner, disables the button and sets `aria-busy`. */
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth,
  loading = false,
  leadingIcon,
  trailingIcon,
  disabled,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, fullWidth, className })}
      {...props}
    >
      <ButtonContent loading={loading} leadingIcon={leadingIcon} trailingIcon={trailingIcon} size={size}>
        {children}
      </ButtonContent>
    </button>
  );
}

export interface LinkButtonProps extends ComponentProps<typeof Link>, Omit<ButtonStyleOptions, 'className'> {
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

/** A react-router `Link` styled as a Button. */
export function LinkButton({
  variant = 'primary',
  size = 'md',
  fullWidth,
  leadingIcon,
  trailingIcon,
  className,
  children,
  ...props
}: LinkButtonProps) {
  return (
    <Link className={buttonClasses({ variant, size, fullWidth, className })} {...props}>
      <ButtonContent leadingIcon={leadingIcon} trailingIcon={trailingIcon} size={size}>
        {children}
      </ButtonContent>
    </Link>
  );
}
