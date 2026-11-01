import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ChevronLeft, ChevronRight, Users } from 'lucide-react';
import { IconButton, Skeleton } from '@/components/ui';
import { CropGlyph, GradeBadge, JOURNEY_KEYS, Money, Quantity, useNow, useUiLanguage } from '@/components/domain';
import { cn } from '@/lib/cn';
import { formatDate, formatKg, formatRelative } from '@/lib/format';
import type { LotSummary, PipelineColumn } from '@/types/api';

export interface PipelineBoardProps {
  columns: readonly PipelineColumn[] | undefined;
  loading?: boolean;
  className?: string;
}

const COLUMN_WIDTH = 'w-[17rem] sm:w-[16.5rem]';

/**
 * The deal pipeline as eight editorial columns — one per journey step — each holding the lots that
 * are at that step. Scrolls sideways (snap, arrow buttons, keyboard) when the screen is narrower
 * than the board.
 */
export function PipelineBoard({ columns, loading = false, className }: PipelineBoardProps) {
  const { t } = useTranslation('coordinator');
  const scrollerRef = useRef<HTMLDivElement>(null);

  const scrollBy = (direction: 1 | -1) => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollBy({ left: direction * Math.max(node.clientWidth * 0.8, 264), behavior: 'smooth' });
  };

  const byKey = new Map((columns ?? []).map((column) => [column.key, column]));
  const ordered: PipelineColumn[] = JOURNEY_KEYS.map(
    (key, index) => byKey.get(key) ?? { step: index + 1, key, label: key, lots: [] },
  );

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex items-center justify-between gap-3 px-5 sm:px-6">
        <p className="text-sm font-normal text-ink-2">
          {t('pipeline.hint', { defaultValue: 'Every lot, by the step it has reached. Open a card to work on it.' })}
        </p>
        <div className="flex shrink-0 gap-1.5">
          <IconButton
            variant="secondary"
            size="sm"
            label={t('pipeline.scrollBack', { defaultValue: 'Scroll the pipeline back' })}
            icon={<ChevronLeft strokeWidth={1.25} />}
            onClick={() => scrollBy(-1)}
          />
          <IconButton
            variant="secondary"
            size="sm"
            label={t('pipeline.scrollForward', { defaultValue: 'Scroll the pipeline forward' })}
            icon={<ChevronRight strokeWidth={1.25} />}
            onClick={() => scrollBy(1)}
          />
        </div>
      </div>

      <div
        ref={scrollerRef}
        role="region"
        tabIndex={0}
        aria-label={t('pipeline.label', { defaultValue: 'Deal pipeline' })}
        className="no-scrollbar flex snap-x snap-mandatory scroll-px-5 overflow-x-auto px-5 pb-6 sm:scroll-px-6 sm:px-6 focus-visible:outline-offset-[-2px]"
      >
        {ordered.map((column) => (
          <PipelineLane key={column.key} column={column} loading={loading} />
        ))}
      </div>
    </div>
  );
}

function PipelineLane({ column, loading }: { column: PipelineColumn; loading: boolean }) {
  const { t } = useTranslation('coordinator');
  const label = t(`common:enums.journeyKey.${column.key}`, { defaultValue: column.label });
  const totalKg = column.lots.reduce((sum, lot) => sum + lot.total_quantity_kg, 0);
  const filled = column.lots.length > 0;
  const headingId = `pipeline-${column.key}`;

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        COLUMN_WIDTH,
        'relative flex shrink-0 snap-start flex-col border-y border-s border-line bg-paper/40 last:border-e',
      )}
    >
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 pb-4 pt-5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span
            aria-hidden="true"
            className={cn('font-display text-xl font-bold not-italic leading-none tabular-nums', filled ? 'text-gold-700' : 'text-muted')}
          >
            {String(column.step).padStart(2, '0')}
          </span>
          <h3 id={headingId} className="truncate text-[13px] font-semibold text-ink">
            {label}
          </h3>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="font-display text-h3 font-bold leading-none tabular-nums text-ink">{loading ? '·' : column.lots.length}</span>
          {totalKg > 0 ? <span className="text-[11px] tabular-nums text-muted">{formatKg(totalKg)}</span> : null}
        </div>
      </header>
      <div className="flex min-h-40 flex-1 flex-col gap-3 px-3 py-3">
        {loading ? (
          <>
            <Skeleton className="h-28 rounded-card" />
            <Skeleton className="h-28 rounded-card opacity-60" />
          </>
        ) : filled ? (
          <ul className="flex flex-col gap-3">
            {column.lots.map((lot) => (
              <li key={lot.id}>
                <PipelineCard lot={lot} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-auto max-w-[12rem] px-2 py-6 text-center text-xs leading-relaxed text-muted">
            {t('pipeline.emptyColumn', { defaultValue: 'No lots at this step right now.' })}
          </p>
        )}
      </div>
    </section>
  );
}

function PipelineCard({ lot }: { lot: LotSummary }) {
  const { t } = useTranslation('coordinator');
  const now = useNow();
  const locale = useUiLanguage();
  return (
    <Link
      to={`/app/coordinator/lots/${lot.id}`}
      className="group flex flex-col gap-3 rounded-card border border-line bg-paper p-4 transition-colors duration-300 ease-luxe hover:border-ink/30 focus-visible:border-gold-700"
    >
      <div className="flex items-start gap-3">
        <CropGlyph lotCode={lot.code} name={lot.crop_name} size="sm" framed />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-mono text-[11px] tracking-tight text-muted">{lot.code}</span>
          <span className="flex items-center gap-1.5 truncate font-display text-lg font-normal leading-tight text-ink">
            {lot.crop_name}
            <GradeBadge grade={lot.grade} size="sm" sealOnly />
          </span>
        </div>
      </div>
      <div className="flex items-end justify-between gap-2">
        <Quantity kg={lot.total_quantity_kg} size="lg" className="text-ink" />
        <span className="inline-flex items-center gap-1 pb-0.5 text-xs text-muted">
          <Users aria-hidden="true" strokeWidth={1.25} className="size-3.5" />
          {lot.member_count}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-line pt-3 text-xs text-muted">
        <span>
          {t('pipeline.pickup', { defaultValue: 'Pickup' })}{' '}
          <time dateTime={lot.pickup_date} title={formatDate(lot.pickup_date, { locale })} className="text-ink/80">
            {formatRelative(lot.pickup_date, { now, locale })}
          </time>
        </span>
        {lot.price_per_kg !== null ? <Money value={lot.price_per_kg} perKg size="sm" className="text-ink" /> : null}
      </div>
      {lot.buyer_name ? <p className="-mt-1 truncate text-xs text-ink-2">{lot.buyer_name}</p> : null}
    </Link>
  );
}
