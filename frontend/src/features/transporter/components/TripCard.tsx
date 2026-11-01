import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ArrowUpRight, CalendarDays, Flag } from 'lucide-react';

import { CropGlyph, Money, StatusBadge, useKgFormatter, useNow, useUiLanguage } from '@/components/domain';
import { Card, Progress } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDate, formatRelative } from '@/lib/format';
import type { TransportQuote, TransportRequest } from '@/types/api';

import { tripProgress } from '../requests';

export interface TripCardProps {
  trip: TransportRequest;
  quote: TransportQuote | null;
  compact?: boolean;
  className?: string;
}

/** A booked trip: pickup day, how many farms are done, kilograms on board and what it pays. */
export function TripCard({ trip, quote, compact = false, className }: TripCardProps) {
  const { t } = useTranslation('transporter');
  const locale = useUiLanguage();
  const now = useNow();
  const formatKg = useKgFormatter();
  const progress = tripProgress(trip);
  const done = trip.status === 'completed';

  return (
    <Card as="article" interactive className={cn('flex flex-col gap-5 overflow-hidden p-5 sm:p-6', className)}>
      <div className="flex items-start gap-4">
        <CropGlyph name={trip.crop_name} lotCode={trip.lot_code} framed size={compact ? 'md' : 'lg'} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="eyebrow">{trip.lot_code}</p>
          <h3 className="font-display font-bold text-h3 leading-tight text-ink">
            <Link
              to={`/app/transporter/trips/${trip.id}`}
              className="outline-none after:absolute after:inset-0 after:z-[1] after:rounded-card after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-gold-400"
            >
              {t('trip.title', { crop: trip.crop_name, destination: trip.destination_name })}
            </Link>
          </h3>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays aria-hidden="true" strokeWidth={1.25} className="size-3.5 text-muted" />
              <span className="first-letter:uppercase">{formatRelative(trip.pickup_date, { now, locale })}</span>
              <span className="text-ink/30">·</span>
              {formatDate(trip.pickup_date, { locale })}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Flag aria-hidden="true" strokeWidth={1.25} className="size-3.5 text-muted" />
              {t('common:units.stops', { count: progress.total })}
            </span>
          </p>
        </div>
        <ArrowUpRight aria-hidden="true" strokeWidth={1.25} className="size-4 shrink-0 text-ink/30" />
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-ink/80">
            {done
              ? t('trip.collectedOf', { picked: formatKg(progress.pickedKg), planned: formatKg(progress.plannedKg) })
              : t('trip.stopsDone', { done: progress.picked + progress.skipped, total: progress.total })}
          </span>
          <StatusBadge kind="transport" value={trip.status} size="sm" />
        </div>
        <Progress
          value={progress.pct}
          tone={done ? 'forest' : 'gold'}
          size="sm"
          label={t('trip.progressLabel')}
          valueText={t('trip.stopsDone', { done: progress.picked + progress.skipped, total: progress.total })}
        />
      </div>

      {quote ? (
        <div className="-mx-5 -mb-5 flex items-center justify-between gap-3 border-t border-line/80 bg-parchment/50 px-5 py-3.5 sm:-mx-6 sm:-mb-6 sm:px-6">
          <span className="text-[13px] font-semibold text-muted">{done ? t('trip.earned') : t('trip.pays')}</span>
          <span className="flex items-baseline gap-2">
            <Money value={quote.price_total} size="lg" />
            <span className="text-xs text-muted">{t(`common:enums.vehicleType.${quote.vehicle_type}`)}</span>
          </span>
        </div>
      ) : null}
    </Card>
  );
}
