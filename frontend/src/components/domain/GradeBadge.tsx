import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import type { Grade } from '@/types/api';

const SEAL: Record<Grade, string> = {
  A: 'border border-gold-500 text-gold-700',
  B: 'border border-forest-600/60 text-forest-700',
  C: 'border border-ink/30 text-ink-2',
  ungraded: 'border border-dashed border-ink/30 text-muted',
};

const SIZES = {
  sm: { badge: 'h-6 gap-1.5 ps-0.5 pe-2 text-[10px]', seal: 'size-5 text-[13px]' },
  md: { badge: 'h-7 gap-2 ps-0.5 pe-2.5 text-[10.5px]', seal: 'size-6 text-sm' },
} as const;

export interface GradeBadgeProps {
  grade: Grade;
  size?: keyof typeof SIZES;
  /** Seal only; the grade stays readable to assistive tech. */
  sealOnly?: boolean;
  className?: string;
}

/** Produce grade as a small square seal — green A, forest B, ink C, dashed when not yet graded. */
export function GradeBadge({ grade, size = 'md', sealOnly = false, className }: GradeBadgeProps) {
  const { t } = useTranslation('domain');
  const label = t(`common:enums.grade.${grade}`);
  const styles = SIZES[size];
  const seal = (
    <span
      aria-hidden="true"
      className={cn('grid shrink-0 place-items-center rounded-sm font-display font-normal not-italic leading-none', styles.seal, SEAL[grade])}
    >
      {grade === 'ungraded' ? '?' : grade}
    </span>
  );

  if (sealOnly) {
    return (
      <span className={cn('inline-flex', className)} title={label}>
        {seal}
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-sm border border-line bg-transparent font-semibold leading-none text-ink-2',
        styles.badge,
        className,
      )}
    >
      {seal}
      {label}
    </span>
  );
}
