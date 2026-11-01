import { cn } from '@/lib/cn';

const SIZES = {
  sm: { mark: 'size-7', word: 'text-[20px]', gap: 'gap-2.5' },
  md: { mark: 'size-9', word: 'text-[25px]', gap: 'gap-3' },
  lg: { mark: 'size-12', word: 'text-[34px]', gap: 'gap-3.5' },
} as const;

export interface LogoProps {
  /** `light` for light backgrounds (forest links, ink wordmark); `dark` for forest surfaces. */
  variant?: 'light' | 'dark';
  size?: keyof typeof SIZES;
  /** Show the "MandiMate" wordmark next to the mark (default). */
  wordmark?: boolean;
  className?: string;
}

/**
 * A leaf-green tile with a sprout whose two leaves meet at one stem (many small lots, one sale),
 * next to a bold wordmark.
 */
export function Logo({ variant = 'light', size = 'md', wordmark = true, className }: LogoProps) {
  const sizing = SIZES[size];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center',
        sizing.gap,
        variant === 'dark' ? 'text-ivory' : 'text-forest-700',
        className,
      )}
    >
      <LogoMark className={sizing.mark} title={wordmark ? undefined : 'MandiMate'} />
      {wordmark ? (
        <span
          className={cn(
            'font-display font-extrabold leading-none tracking-[-0.03em]',
            sizing.word,
            variant === 'dark' ? 'text-ivory' : 'text-ink',
          )}
        >
          MandiMate
        </span>
      ) : null}
    </span>
  );
}

export interface LogoMarkProps {
  className?: string;
  /** Accessible name; omit when the mark sits next to visible brand text. */
  title?: string;
}

/** The mark alone (favicons, avatars, the collapsed sidebar): a green tile with an amber-and-white sprout. */
export function LogoMark({ className, title }: LogoMarkProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      className={cn('shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <rect width="40" height="40" rx="11" fill="var(--color-forest-600)" />
      <path d="M20 31V19" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M20 20.5c0-5.2-3.6-8.8-9.4-8.8 0 5.6 3.6 8.8 9.4 8.8Z" fill="#fff" />
      <path d="M20 22.5c0-6.4 4-10.6 10.2-10.6 0 6.6-4 10.6-10.2 10.6Z" fill="var(--color-gold-400)" />
    </svg>
  );
}
