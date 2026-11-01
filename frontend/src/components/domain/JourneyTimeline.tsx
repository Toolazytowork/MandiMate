import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import type { JourneyKey, JourneyStep, JourneyStepStatus } from '@/types/api';
import { useUiLanguage } from './hooks';

/** The eight steps of every MandiMate deal, in order (DOMAIN_RULES §7). */
export const JOURNEY_KEYS: readonly JourneyKey[] = [
  'listed',
  'grouped',
  'offers',
  'compared',
  'consent',
  'transport',
  'delivered',
  'settled',
];

const isReached = (status: JourneyStepStatus) => status === 'complete' || status === 'skipped';

export interface JourneyTimelineProps {
  steps: readonly JourneyStep[];
  /** `responsive` (default): vertical on phones, horizontal from the `md` breakpoint. */
  orientation?: 'responsive' | 'vertical' | 'horizontal';
  /** Show each step's date and detail line (default true). */
  showDetails?: boolean;
  className?: string;
}

/**
 * The eight-step journey from listing to settlement, numbered "01"–"08" in not-italic bold: complete
 * steps in field green, the current step in green, upcoming steps muted and skipped steps struck
 * through. A thin green line traces the progress so far.
 */
export function JourneyTimeline({ steps, orientation = 'responsive', showDetails = true, className }: JourneyTimelineProps) {
  const { t } = useTranslation('domain');
  const locale = useUiLanguage();
  const ordered = [...steps].sort((a, b) => a.step - b.step);
  const current = ordered.find((step) => step.status === 'current');
  const horizontal = orientation === 'horizontal';
  const responsive = orientation === 'responsive';

  return (
    <div className={className}>
      <p className="sr-only">
        {current
          ? t('journey.progress', {
              step: current.step,
              total: ordered.length,
              label: t(`common:enums.journeyKey.${current.key}`, { defaultValue: current.label }),
            })
          : t('journey.complete')}
      </p>
      <ol
        aria-label={t('journey.label')}
        className={cn('relative flex', horizontal ? 'flex-row items-start' : 'flex-col', responsive && 'md:flex-row md:items-start')}
      >
        {ordered.map((step, index) => {
          const next = ordered[index + 1];
          const traced = isReached(step.status) && next !== undefined && next.status !== 'upcoming';
          const label = t(`common:enums.journeyKey.${step.key}`, { defaultValue: step.label });
          return (
            <li
              key={step.key}
              aria-current={step.status === 'current' ? 'step' : undefined}
              className={cn(
                'relative flex min-w-0',
                horizontal ? 'flex-1 flex-col items-center gap-3 text-center' : 'gap-4 pb-7 last:pb-0',
                responsive && 'md:flex-1 md:flex-col md:items-center md:gap-3 md:pb-0 md:text-center',
              )}
            >
              {next ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute',
                    horizontal
                      ? 'start-[calc(50%+24px)] end-[calc(-50%+24px)] top-4 h-px'
                      : 'bottom-2 start-4 top-[40px] w-px',
                    responsive &&
                      'md:bottom-auto md:start-[calc(50%+24px)] md:end-[calc(-50%+24px)] md:top-4 md:h-px md:w-auto',
                    traced ? 'bg-gold-500' : 'bg-line',
                  )}
                />
              ) : null}
              <StepNode status={step.status} number={step.step} />
              <div className={cn('flex min-w-0 flex-col gap-1 pt-1.5', horizontal && 'items-center px-1', responsive && 'md:items-center md:px-1')}>
                <span
                  className={cn(
                    'text-[13px] font-medium leading-snug ',
                    step.status === 'upcoming' || step.status === 'skipped' ? 'text-muted' : 'text-ink',
                    step.status === 'current' && 'text-gold-700',
                  )}
                >
                  {label}
                </span>
                <span
                  className={cn(
                    'text-xs',
                    step.status === 'current' ? 'text-ink-2' : 'text-muted',
                  )}
                >
                  {t(`common:enums.journeyStepStatus.${step.status}`)}
                  {step.at ? (
                    <>
                      {' · '}
                      <time dateTime={step.at}>{formatDate(step.at, { locale })}</time>
                    </>
                  ) : null}
                </span>
                {showDetails && step.detail ? (
                  <span
                    className={cn(
                      'mt-0.5 text-xs leading-snug text-muted',
                      horizontal && 'line-clamp-2 max-w-40',
                      responsive && 'md:line-clamp-2 md:max-w-40 md:max-lg:hidden',
                    )}
                  >
                    {step.detail}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StepNode({ status, number }: { status: JourneyStepStatus; number: number }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative z-[1] grid size-8 shrink-0 place-items-center font-display text-[19px] font-bold not-italic leading-none tabular-nums',
        status === 'complete' && 'text-forest-700',
        status === 'current' && 'text-gold-700',
        status === 'upcoming' && 'text-muted/70',
        status === 'skipped' && 'text-muted/60 line-through decoration-1',
      )}
    >
      {String(number).padStart(2, '0')}
      {status === 'current' ? <span className="absolute -bottom-0.5 left-1/2 h-px w-5 -translate-x-1/2 bg-gold-500" /> : null}
    </span>
  );
}

export interface JourneyMeterProps {
  /** Current journey step, 1..8 (`Lot.journey_step`); 8 with `settled` means complete. */
  step: number;
  /** Mark every segment complete (a settled lot). */
  complete?: boolean;
  showLabel?: boolean;
  className?: string;
}

/** Compact eight-segment progress bar for cards and tables: "Step 4 of 8 · Offers compared". */
export function JourneyMeter({ step, complete = false, showLabel = true, className }: JourneyMeterProps) {
  const { t } = useTranslation('domain');
  const total = JOURNEY_KEYS.length;
  const currentIndex = Math.min(Math.max(Math.round(step), 1), total) - 1;
  const key = JOURNEY_KEYS[currentIndex] ?? 'listed';
  const label = t(`common:enums.journeyKey.${key}`);
  const text = complete ? t('journey.complete') : t('journey.progress', { step: currentIndex + 1, total, label });

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div role="img" aria-label={text} className="flex gap-[3px]">
        {JOURNEY_KEYS.map((journeyKey, index) => (
          <span
            key={journeyKey}
            className={cn(
              'h-0.5 flex-1',
              complete || index < currentIndex
                ? 'bg-forest-600'
                : index === currentIndex
                  ? 'bg-gold-500'
                  : 'bg-ink/10',
            )}
          />
        ))}
      </div>
      {showLabel ? (
        <p aria-hidden="true" className="text-[13px] font-semibold text-muted">
          {text}
        </p>
      ) : null}
    </div>
  );
}
