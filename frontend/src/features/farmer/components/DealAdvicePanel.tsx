import { useTranslation } from 'react-i18next';

import { AiPanel, Money } from '@/components/domain';
import type { UUID } from '@/types/api';

import { useDealAdvice } from '../hooks';

/** The deal assistant's plain-words explanation of a harvest's options, with regenerate. */
export function DealAdvicePanel({ harvestId, className }: { harvestId: UUID; className?: string }) {
  const { t } = useTranslation('farmer');
  const advice = useDealAdvice(harvestId);
  const counter = advice.data?.counteroffer;

  return (
    <AiPanel
      ai={advice.data?.explanation}
      eyebrow={t('advice.eyebrow', { defaultValue: 'Advice' })}
      title={t('advice.title', { defaultValue: 'Which option should you pick?' })}
      loading={advice.isFetching}
      onRegenerate={() => void advice.refetch()}
      className={className}
    >
      {advice.isError ? (
        <p className="text-sm text-muted">
          {t('advice.error', { defaultValue: 'The explanation could not load. Your options above are still correct.' })}
        </p>
      ) : null}
      {counter ? (
        <p className="text-sm text-muted">
          {t('advice.counter', { defaultValue: 'You could ask for' })}{' '}
          <Money value={counter.suggested_price_per_kg} perKg size="sm" className="text-ink" /> — {counter.rationale}
        </p>
      ) : null}
    </AiPanel>
  );
}
