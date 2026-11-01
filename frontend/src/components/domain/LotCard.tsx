import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { CalendarDays, ChevronRight, HandCoins, MapPin, Users } from 'lucide-react';
import { Card, Progress } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDate, formatRelative } from '@/lib/format';
import type { Lot, LotSummary } from '@/types/api';
import { CropGlyph } from './CropGlyph';
import { GradeBadge } from './GradeBadge';
import { useNow, useUiLanguage } from './hooks';
import { JourneyMeter } from './JourneyTimeline';
import { Money, Quantity, useKgFormatter } from './Money';
import { StatusBadge } from './StatusBadge';

function isFullLot(lot: Lot | LotSummary): lot is Lot {
  return 'members' in lot;
}

export interface LotCardProps {
  lot: Lot | LotSummary;
  /** In-app path to the lot; the whole card becomes a link. */
  to?: string;
  /** Buttons at the bottom (kept clickable above the card link). */
  actions?: ReactNode;
  /** Show the eight-step journey meter (default true). */
  showJourney?: boolean;
  className?: string;
}

/**
 * A pooled lot at a glance: crop and grade, code and status, how full it is against the target,
 * how many farmers, pickup date, the agreed buyer and price, and where it is in the journey.
 */
export function LotCard({ lot, to, actions, showJourney = true, className }: LotCardProps) {
  const { t } = useTranslation('domain');
  const locale = useUiLanguage();
  const now = useNow();
  const formatKg = useKgFormatter();
  const full = isFullLot(lot) ? lot : null;
  const target = full?.target_quantity_kg ?? null;

  return (
    <Card as="article" interactive={Boolean(to)} className={cn('flex flex-col', className)}>
      <div className="flex flex-col gap-6 p-6 sm:p-8">
        <header className="flex items-start gap-4">
          <CropGlyph lotCode={lot.code} name={lot.crop_name} size="lg" framed />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-muted">
              <span className="tabular-nums">{lot.code}</span>
              {full?.is_solo ? <span>· {t('lot.solo')}</span> : null}
            </p>
            <h3 className="font-display text-h3 font-bold leading-snug text-ink">
              {to ? (
                <Link to={to} className="after:absolute after:inset-0 after:rounded-card after:content-['']">
                  {lot.crop_name}
                </Link>
              ) : (
                lot.crop_name
              )}
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <GradeBadge grade={lot.grade} size="sm" />
              <StatusBadge kind="lot" value={lot.status} size="sm" />
            </div>
          </div>
          {to ? <ChevronRight aria-hidden="true" strokeWidth={1.25} className="mt-1 size-5 shrink-0 text-ink/30" /> : null}
        </header>

        <div className="flex flex-col gap-2.5">
          <div className="flex items-end justify-between gap-4">
            <Quantity kg={lot.total_quantity_kg} size="xl" className="text-ink" />
            {target ? (
              <span className="pb-1 text-[13px] font-semibold text-muted">{t('lot.ofTarget', { target: formatKg(target) })}</span>
            ) : null}
          </div>
          {target ? (
            <Progress
              value={Math.min(lot.total_quantity_kg, target)}
              max={target}
              size="sm"
              tone={lot.total_quantity_kg >= target ? 'forest' : 'gold'}
              label={t('lot.fillLabel')}
              valueText={t('lot.fillValue', { total: formatKg(lot.total_quantity_kg), target: formatKg(target) })}
            />
          ) : null}
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5 text-sm">
          <Meta icon={<Users />} label={t('common:labels.farmers')}>
            {t('common:units.farmers', { count: lot.member_count })}
          </Meta>
          <Meta icon={<CalendarDays />} label={t('common:labels.pickupDate')}>
            <time dateTime={lot.pickup_date} title={formatRelative(lot.pickup_date, { now, locale })}>
              {formatDate(lot.pickup_date, { locale })}
            </time>
          </Meta>
          {full ? (
            <Meta icon={<MapPin />} label={t('lot.collectionPoint')} className="col-span-2">
              {full.collection_point_name}
              {full.district ? <span className="text-muted"> · {full.district}</span> : null}
            </Meta>
          ) : null}
          {lot.buyer_name ? (
            <Meta icon={<HandCoins />} label={t('common:labels.buyer')} className="col-span-2">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span>{lot.buyer_name}</span>
                {lot.price_per_kg !== null ? <Money value={lot.price_per_kg} perKg size="sm" className="text-ink" /> : null}
              </span>
            </Meta>
          ) : null}
        </dl>

        {showJourney ? <JourneyMeter step={lot.journey_step} complete={lot.status === 'settled'} /> : null}
      </div>

      {actions ? (
        <footer className="relative z-[1] mt-auto flex flex-wrap items-center gap-3 border-t border-line px-6 py-4 sm:px-8">{actions}</footer>
      ) : null}
    </Card>
  );
}

function Meta({ icon, label, children, className }: { icon: ReactNode; label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5', className)}>
      <dt className="flex items-center gap-1.5 text-[13px] font-semibold text-muted">
        <span aria-hidden="true" className="text-muted [&_svg]:size-3.5 [&_svg]:stroke-[1.25]">
          {icon}
        </span>
        {label}
      </dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  );
}
