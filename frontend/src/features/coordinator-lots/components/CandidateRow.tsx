import { CalendarClock, MapPin } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { GradeBadge, QualityBadge, Quantity } from '@/components/domain';
import { Badge, Checkbox, Input } from '@/components/ui';
import type { CandidateAllocation } from '@/features/coordinator/utils';
import { cn } from '@/lib/cn';
import { formatDate, formatNumber } from '@/lib/format';
import type { MatchCandidate } from '@/types/api';

export interface CandidateRowProps {
  candidate: MatchCandidate;
  entry: CandidateAllocation | undefined;
  onToggle: (included: boolean) => void;
  onKgChange: (kg: number) => void;
  /** 1-based order in the pickup route, when it is part of the lot. */
  stopNumber?: number;
}

function scorePct(score: number): number {
  const pct = score <= 1 ? score * 100 : score;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export function CandidateRow({ candidate, entry, onToggle, onKgChange, stopNumber }: CandidateRowProps) {
  const { t } = useTranslation('coordinatorLots');
  const included = Boolean(entry?.included);
  const kg = entry?.kg ?? 0;
  const [draft, setDraft] = useState(String(kg));
  useEffect(() => setDraft(String(kg)), [kg]);
  const score = scorePct(candidate.score);
  const overLimit = Number(draft) > candidate.available_kg;

  const commit = () => {
    const value = Number(draft.replace(/,/g, ''));
    if (!Number.isFinite(value)) {
      setDraft(String(kg));
      return;
    }
    onKgChange(value);
  };

  return (
    <li
      className={cn(
        'grid gap-4 rounded-card border p-4 transition-colors sm:grid-cols-[minmax(0,1fr)_auto] sm:p-5',
        included ? 'border-forest-600/40 bg-paper' : 'border-line bg-paper/60',
      )}
    >
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <Checkbox
            checked={included}
            onChange={(event) => onToggle(event.target.checked)}
            label={<span className="font-display text-h3 font-bold text-ink">{candidate.farmer_name}</span>}
            aria-label={t('builder.includeFarmer', { defaultValue: 'Include {{name}}', name: candidate.farmer_name })}
          />
          {stopNumber ? (
            <Badge tone="forest" size="sm">
              {t('builder.stop', { defaultValue: 'Stop {{n}}', n: stopNumber })}
            </Badge>
          ) : null}
          <GradeBadge grade={candidate.grade} size="sm" />
          <QualityBadge status={candidate.quality_status} size="sm" />
        </div>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-muted">
          <span className="inline-flex items-center gap-1.5">
            <MapPin aria-hidden="true" strokeWidth={1.25} className="size-3.5" />
            {candidate.village ?? t('builder.unknownVillage', { defaultValue: 'Village not given' })} ·{' '}
            {t('builder.km', { defaultValue: '{{km}} km away', km: formatNumber(candidate.distance_km, { maxDecimals: 1 }) })}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock aria-hidden="true" strokeWidth={1.25} className="size-3.5" />
            {t('builder.sellBy', { defaultValue: 'Sell by {{date}}', date: formatDate(candidate.sell_by) })}
          </span>
        </p>
        {candidate.reasons.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label={t('builder.reasons', { defaultValue: 'Why this farm' })}>
            {candidate.reasons.map((reason) => (
              <li key={reason} className="rounded-sm border border-line px-2 py-0.5 text-[13px] font-semibold text-ink-2">
                {reason}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="flex flex-row items-end justify-between gap-4 sm:flex-col sm:items-end">
        <div className="text-end">
          <p className="text-[13px] font-semibold text-muted">{t('builder.score', { defaultValue: 'Match score' })}</p>
          <p className="font-display text-h2 font-bold tabular-nums text-ink">{score}</p>
          <div className="mt-1 h-1 w-20 overflow-hidden rounded-full bg-line" aria-hidden="true">
            <div className="h-full rounded-full bg-gold-700" style={{ width: `${score}%` }} />
          </div>
        </div>
        <div className="w-36">
          <label className="sr-only" htmlFor={`kg-${candidate.harvest_id}`}>
            {t('builder.kgFor', { defaultValue: 'Kilograms from {{name}}', name: candidate.farmer_name })}
          </label>
          <Input
            id={`kg-${candidate.harvest_id}`}

            inputMode="decimal"
            trailing="kg"
            disabled={!included}
            value={included ? draft : ''}
            placeholder="—"
            aria-invalid={overLimit || undefined}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commit();
              }
            }}
          />
          <p className={cn('mt-1 text-end text-micro', overLimit ? 'text-danger-ink' : 'text-muted')}>
            {t('builder.ofAvailable', { defaultValue: 'of' })} <Quantity kg={candidate.available_kg} size="sm" />
          </p>
        </div>
      </div>
    </li>
  );
}
