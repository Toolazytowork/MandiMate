import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Info, RefreshCw } from 'lucide-react';
import { Button, SkeletonText, Tooltip } from '@/components/ui';
import { aiApi, keys } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, formatRelative } from '@/lib/format';
import type { AiSource, AiStatus, AiText } from '@/types/api';
import { useNow, useUiLanguage } from './hooks';

export interface AiSourceBadgeProps {
  source: AiSource;
  /** Model name, shown in the tooltip for live answers. */
  model?: string | null;
  className?: string;
}

/** "AI" (green) for a live model answer, "Rules" (ink) for MandiMate's deterministic wording — tracked caps, 1 px border. */
export function AiSourceBadge({ source, model, className }: AiSourceBadgeProps) {
  const { t } = useTranslation('domain');
  const live = source === 'ai';
  return (
    <Tooltip content={live ? t('ai.sourceAiHint', { model: model ?? t('ai.unknownModel') }) : t('ai.sourceRulesHint')}>
      <button
        type="button"
        className={cn(
          'inline-flex h-6 cursor-help items-center rounded-sm border bg-transparent px-2 text-[13px] font-semibold',
          live ? 'border-gold-500/60 text-gold-700' : 'border-ink/25 text-ink-2',
          className,
        )}
      >
        {t(`common:enums.aiSource.${source}`)}
      </button>
    </Tooltip>
  );
}

export interface AiPanelProps {
  /** The generated text; `null`/`undefined` while nothing has been generated yet. */
  ai: AiText | null | undefined;
  title?: ReactNode;
  eyebrow?: ReactNode;
  /** Shows a "Explain again" button. */
  onRegenerate?: () => void;
  /** A request is in flight: skeleton on first load, dimmed text while regenerating. */
  loading?: boolean;
  /** Extra content under the text, e.g. a counter-offer suggestion. */
  children?: ReactNode;
  className?: string;
}

/**
 * Plain-language explanation from the deal assistant. The source badge says whether a model wrote
 * it ("AI") or MandiMate's rules did ("Rules"); the disclaimer is always visible. New text fades in —
 * no typewriter effect — and is announced politely to screen readers.
 */
export function AiPanel({ ai, title, eyebrow, onRegenerate, loading = false, children, className }: AiPanelProps) {
  const { t } = useTranslation('domain');
  const now = useNow();
  const locale = useUiLanguage();
  const paragraphs = ai ? ai.text.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean) : [];

  return (
    <section
      aria-busy={loading || undefined}
      className={cn(
        'relative overflow-hidden rounded-card border border-line border-t-gold-500/70 bg-paper',
        className,
      )}
    >
      <div className="flex flex-col gap-5 p-6 sm:p-8">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <p className="eyebrow">{eyebrow ?? t('ai.eyebrow')}</p>
            <h3 className="font-display text-h3 font-bold text-ink">{title ?? t('ai.title')}</h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {ai ? <AiSourceBadge source={ai.source} model={ai.model} /> : null}
            {onRegenerate ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onRegenerate}
                loading={loading && Boolean(ai)}
                disabled={loading}
                leadingIcon={<RefreshCw aria-hidden="true" strokeWidth={1.25} />}
                className="text-ink"
              >
                {t('ai.regenerate')}
              </Button>
            ) : null}
          </div>
        </header>

        <div aria-live="polite" className="min-h-12">
          {ai ? (
            <div
              key={ai.generated_at}
              className={cn(
                'flex max-w-measure animate-fade-in flex-col gap-3 text-[15px] font-normal leading-relaxed text-ink-2 transition-opacity duration-300',
                loading && 'opacity-50',
              )}
            >
              {paragraphs.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          ) : loading ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted">{t('ai.thinking')}</p>
              <SkeletonText lines={3} />
            </div>
          ) : (
            <p className="text-sm text-muted">{t('ai.empty')}</p>
          )}
        </div>

        {children}

        {ai ? (
          <footer className="flex flex-col gap-2 border-t border-line pt-4 text-xs text-muted sm:flex-row sm:items-start sm:justify-between">
            <p className="flex items-start gap-1.5 leading-relaxed">
              <Info aria-hidden="true" strokeWidth={1.25} className="mt-0.5 size-3.5 shrink-0" />
              <span>{ai.disclaimer}</span>
            </p>
            <p className="shrink-0 tabular-nums">
              {ai.model && ai.source === 'ai' ? <span>{ai.model} · </span> : null}
              <time dateTime={ai.generated_at} title={formatDateTime(ai.generated_at, { locale })}>
                {formatRelative(ai.generated_at, { now, locale })}
              </time>
            </p>
          </footer>
        ) : null}
      </div>
    </section>
  );
}

export interface AiModeNoticeProps {
  /** Pass the status when you already have it; otherwise it is fetched (and cached) from `/ai/status`. */
  status?: AiStatus | null;
  className?: string;
}

/**
 * Explains where explanations come from: a live model, or — without an API key — MandiMate's built-in
 * rules. Either way every number comes from MandiMate's calculations.
 */
export function AiModeNotice({ status, className }: AiModeNoticeProps) {
  const { t } = useTranslation('domain');
  const query = useQuery({
    queryKey: keys.ai.status(),
    queryFn: ({ signal }) => aiApi.status(signal),
    staleTime: 5 * 60_000,
    enabled: status === undefined,
  });
  const resolved = status === undefined ? query.data : status;
  if (!resolved) return null;
  const live = resolved.mode === 'live';

  return (
    <div
      className={cn(
        'flex items-start gap-4 rounded-sm border-s px-4 py-3 text-sm',
        live ? 'border-gold-500/70 bg-paper' : 'border-ink/25 bg-paper',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 shrink-0 text-[13px] font-semibold',
          live ? 'text-gold-700' : 'text-ink-2',
        )}
      >
        {t(`common:enums.aiSource.${live ? 'ai' : 'rules'}`)}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-[13px] font-semibold text-ink">{live ? t('ai.liveTitle') : t('ai.mockTitle')}</p>
        <p className="font-normal leading-relaxed text-ink-2">
          {live ? t('common:layout.ai.liveHint', { model: resolved.model }) : t('common:layout.ai.mockHint')}
        </p>
      </div>
    </div>
  );
}
