import { useTranslation } from 'react-i18next';
import { Tooltip } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { Certainty } from '@/types/api';

export const CERTAINTIES: readonly Certainty[] = ['confirmed', 'estimated', 'unresolved'];

const ICON_COLOURS: Record<Certainty, string> = {
  confirmed: 'text-forest-600 [.surface-dark_&]:text-gold-300',
  estimated: 'text-gold-600 [.surface-dark_&]:text-saffron-400',
  unresolved: 'text-danger [.surface-dark_&]:text-[#ffb4a6]',
};

const BADGE_STYLES: Record<Certainty, string> = {
  confirmed: 'text-forest-700 [.surface-dark_&]:text-gold-300',
  estimated: 'text-gold-700 [.surface-dark_&]:text-saffron-400',
  unresolved: 'text-danger-ink [.surface-dark_&]:text-[#ffb4a6]',
};

export interface CertaintyIconProps {
  certainty: Certainty;
  className?: string;
}

/** ● confirmed · ◐ estimated · ○ unresolved. Decorative — always pair it with the word. */
export function CertaintyIcon({ certainty, className }: CertaintyIconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      className={cn('size-3 shrink-0', ICON_COLOURS[certainty], className)}
    >
      {certainty === 'confirmed' ? <circle cx="8" cy="8" r="4" fill="currentColor" /> : null}
      {certainty === 'estimated' ? (
        <>
          <circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
          <path d="M8 3.5a4.5 4.5 0 0 0 0 9Z" fill="currentColor" />
        </>
      ) : null}
      {certainty === 'unresolved' ? <circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.25" /> : null}
    </svg>
  );
}

const BADGE_SIZES = {
  sm: 'h-5 gap-1.5 text-[12px] [&_svg]:size-2.5',
  md: 'h-6 gap-1.5 text-[13px]',
} as const;

export interface CertaintyBadgeProps {
  certainty: Certainty;
  size?: keyof typeof BADGE_SIZES;
  /** Explain the level on hover/focus (default). Turn off in dense lists to avoid extra tab stops. */
  withTooltip?: boolean;
  className?: string;
}

/** Tiny dot/ring + tracked caps word in muted forest / green / rust, with a plain-language explanation on hover or focus. */
export function CertaintyBadge({ certainty, size = 'md', withTooltip = true, className }: CertaintyBadgeProps) {
  const { t } = useTranslation('domain');
  const label = t(`common:certainty.${certainty}.label`);
  const classes = cn(
    'inline-flex shrink-0 items-center whitespace-nowrap rounded-sm font-semibold leading-none',
    BADGE_SIZES[size],
    BADGE_STYLES[certainty],
    className,
  );
  const content = (
    <>
      <CertaintyIcon certainty={certainty} />
      {label}
    </>
  );

  if (!withTooltip) {
    return (
      <span className={classes} title={t(`common:certainty.${certainty}.description`)}>
        {content}
      </span>
    );
  }

  return (
    <Tooltip content={t(`common:certainty.${certainty}.description`)}>
      <button type="button" className={cn(classes, 'cursor-help underline-offset-4 transition-colors hover:underline')}>
        {content}
      </button>
    </Tooltip>
  );
}

export interface CertaintyLegendProps {
  /** Words only, on one line — for table captions and card footers. */
  compact?: boolean;
  className?: string;
}

/** The key to MandiMate's honesty language: what ●, ◐ and ○ mean. */
export function CertaintyLegend({ compact = false, className }: CertaintyLegendProps) {
  const { t } = useTranslation('domain');
  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <p className={cn('eyebrow', compact && 'sr-only')}>{t('common:certainty.legend')}</p>
      <ul className={cn('flex flex-wrap', compact ? 'gap-x-4 gap-y-1.5 text-xs text-muted' : 'gap-x-6 gap-y-2.5 text-sm')}>
        {CERTAINTIES.map((certainty) => (
          <li key={certainty} className="flex min-w-0 items-start gap-2">
            <CertaintyIcon certainty={certainty} className={compact ? 'mt-0.5' : 'mt-1'} />
            <span className="min-w-0">
              <span className={cn('font-semibold', compact ? 'text-[10.5px] text-ink/80' : 'text-[11px] text-ink')}>
                {t(`common:certainty.${certainty}.label`)}
              </span>
              {compact ? null : <span className="text-muted"> — {t(`common:certainty.${certainty}.description`)}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
