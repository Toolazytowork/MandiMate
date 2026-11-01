import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

const VARIANTS = {
  /** Paper card with a hairline — the default container on light surfaces. */
  default: 'border border-line bg-paper shadow-luxe-sm',
  /** Paper, hairline, no shadow — for dense app screens and nested cards. */
  flat: 'border border-line bg-paper',
  /** Soft green fill for secondary groupings. */
  parchment: 'border border-line/80 bg-parchment',
  /** Muted dashed container — baselines, placeholders, "what you'd get otherwise". */
  dashed: 'border border-dashed border-ink/25 bg-transparent',
  /** For dark editorial surfaces. */
  dark: 'border border-ivory/12 bg-forest-900 text-ivory surface-dark',
} as const;

export type CardVariant = keyof typeof VARIANTS;

type CardElement = 'div' | 'article' | 'section' | 'li' | 'aside';

export interface CardProps extends ComponentProps<'div'> {
  variant?: CardVariant;
  /** Warms the border on hover — use for clickable cards. */
  interactive?: boolean;
  as?: CardElement;
}

export function Card({ variant = 'default', interactive = false, as = 'div', className, ...props }: CardProps) {
  // Every allowed element accepts the same attributes; narrow once for JSX.
  const Component = as as 'div';
  return (
    <Component
      className={cn(
        'relative rounded-card',
        VARIANTS[variant],
        interactive &&
          'transition-[border-color,box-shadow] duration-300 ease-luxe hover:border-forest-400 hover:shadow-luxe focus-within:border-forest-400',
        className,
      )}
      {...props}
    />
  );
}

export interface CardHeaderProps extends Omit<ComponentProps<'div'>, 'title'> {
  eyebrow?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  /** Right-aligned slot (button, badge, menu). */
  action?: ReactNode;
}

export function CardHeader({ eyebrow, title, description, action, className, children, ...props }: CardHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-6 pt-6 sm:px-8 sm:pt-7', className)} {...props}>
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        {title ? <CardTitle>{title}</CardTitle> : null}
        {description ? <CardDescription>{description}</CardDescription> : null}
        {children}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function CardTitle({ className, ...props }: ComponentProps<'h3'>) {
  return <h3 className={cn('font-display text-h3 font-normal', className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm leading-relaxed text-(--fg-muted)', className)} {...props} />;
}

export function CardBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('px-6 py-6 sm:px-8', className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-end gap-3 border-t border-(--hairline) px-6 py-4 sm:px-8',
        className,
      )}
      {...props}
    />
  );
}
