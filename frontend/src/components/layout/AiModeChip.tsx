import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@/components/ui';
import { aiApi, keys } from '@/lib/api';
import { cn } from '@/lib/cn';

/**
 * "AI · Live" when the deal assistant runs on the configured model, "AI · Demo mode" when the API
 * has no key and answers with deterministic rules. Numbers never come from AI either way.
 */
export function AiModeChip({ className }: { className?: string }) {
  const { t } = useTranslation('common');
  const { data } = useQuery({
    queryKey: keys.ai.status(),
    queryFn: ({ signal }) => aiApi.status(signal),
    staleTime: 5 * 60_000,
  });

  if (!data) return null;
  const live = data.mode === 'live';
  const label = live
    ? t('enums.aiMode.live', { defaultValue: 'AI · Live' })
    : t('enums.aiMode.mock', { defaultValue: 'AI · Demo mode' });
  const hint = live
    ? t('layout.ai.liveHint', {
        defaultValue: 'Explanations by {{model}}. Prices, costs and earnings always come from MandiMate’s calculations.',
        model: data.model,
      })
    : t('layout.ai.mockHint', {
        defaultValue: 'No AI key is configured, so explanations use MandiMate’s built-in rules. All numbers are unaffected.',
      });

  return (
    <Tooltip content={hint} placement="bottom">
      <button
        type="button"
        className={cn(
          'inline-flex h-8 items-center gap-2 rounded-sm border px-3 text-[13px] font-semibold transition-colors duration-300',
          live
            ? 'border-gold-500/50 text-gold-700 hover:border-gold-700'
            : 'border-line text-muted hover:border-ink/30 hover:text-ink',
          className,
        )}
      >
        <span className="relative grid size-2 place-items-center" aria-hidden="true">
          <span className={cn('size-1.5 rounded-full', live ? 'bg-gold-500' : 'border border-current')} />
        </span>
        {label}
      </button>
    </Tooltip>
  );
}
