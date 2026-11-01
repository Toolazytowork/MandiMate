import { useTranslation } from 'react-i18next';
import { FlaskConical } from 'lucide-react';
import { Tooltip } from '@/components/ui';
import { cn } from '@/lib/cn';

export interface DemoDataNoticeProps {
  /** Render only when true — pass `is_illustrative` / `is_demo_data` straight through. */
  show: boolean;
  /** What is illustrative: seeded market `prices`, pilot `stats`, or generic `data`. */
  kind?: 'prices' | 'stats' | 'data';
  /** `banner` above a section, `inline` chip next to a figure. */
  variant?: 'banner' | 'inline';
  /** For dark editorial surfaces. */
  tone?: 'light' | 'dark';
  className?: string;
}

/** Honest labelling for seeded or illustrative figures so no one mistakes them for live data. */
export function DemoDataNotice({ show, kind = 'data', variant = 'banner', tone = 'light', className }: DemoDataNoticeProps) {
  const { t } = useTranslation('domain');
  if (!show) return null;
  const dark = tone === 'dark';

  if (variant === 'inline') {
    return (
      <Tooltip content={t(`demo.${kind}.body`)}>
        <button
          type="button"
          className={cn(
            'inline-flex h-6 cursor-help items-center gap-1.5 rounded-sm border px-2 text-[13px] font-semibold',
            dark ? 'border-white/20 text-ivory/80' : 'border-gold-300 text-gold-700',
            className,
          )}
        >
          <FlaskConical aria-hidden="true" strokeWidth={1.25} className="size-3" />
          {t(`demo.${kind}.label`)}
        </button>
      </Tooltip>
    );
  }

  return (
    <div
      role="note"
      className={cn(
        'flex items-start gap-3 rounded-sm border-s px-4 py-3 text-sm',
        dark ? 'border-gold-400/60 text-ivory/85' : 'border-gold-500/70 bg-paper text-ink-2',
        className,
      )}
    >
      <FlaskConical aria-hidden="true" strokeWidth={1.25} className={cn('mt-0.5 size-4 shrink-0', dark ? 'text-gold-400' : 'text-gold-700')} />
      <p className="leading-relaxed">
        <span className="me-1 text-[13px] font-semibold">{t(`demo.${kind}.label`)}.</span> {t(`demo.${kind}.body`)}
      </p>
    </div>
  );
}
