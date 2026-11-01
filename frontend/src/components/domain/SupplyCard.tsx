import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { CalendarRange, ChevronRight, Combine, HandCoins, MapPin, Navigation, Sprout, Truck } from 'lucide-react';
import { Card } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDate, formatNumber } from '@/lib/format';
import type { SupplyItem } from '@/types/api';
import { CropGlyph } from './CropGlyph';
import { GradeBadge } from './GradeBadge';
import { useUiLanguage } from './hooks';
import { Quantity } from './Money';
import { QualityBadge } from './QualityBadge';
import { StatusBadge } from './StatusBadge';


export interface SupplyCardProps {
  item: SupplyItem;
  /** In-app path for the item; the whole card becomes a link. */
  to?: string;
  /** e.g. "Make an offer" (kept clickable above the card link). */
  actions?: ReactNode;
  className?: string;
}

/**
 * Buyer-facing supply: a pooled lot or a single listed harvest with quantity, grade, inspection
 * state, the selling window, distance from the buyer and the buyer's own offer status.
 */
export function SupplyCard({ item, to, actions, className }: SupplyCardProps) {
  const { t } = useTranslation('domain');
  const locale = useUiLanguage();
  const pooled = item.kind === 'lot';
  const place = [item.village, item.district].filter(Boolean).join(', ');

  return (
    <Card as="article" interactive={Boolean(to)} className={cn('flex flex-col', className)}>
      <div className="flex flex-col gap-6 p-6 sm:p-8">
        <header className="flex items-start gap-4">
          <CropGlyph name={item.crop_name} lotCode={item.code} size="lg" framed />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] font-semibold text-muted">
              <span className="inline-flex items-center gap-1 text-gold-700">
                {pooled ? (
                  <Combine aria-hidden="true" strokeWidth={1.25} className="size-3.5" />
                ) : (
                  <Sprout aria-hidden="true" strokeWidth={1.25} className="size-3.5" />
                )}
                {pooled ? t('supply.pooled', { count: item.member_count }) : t('supply.single')}
              </span>
              {item.code ? <span className="tabular-nums">· {item.code}</span> : null}
            </p>
            <h3 className="font-display text-h3 font-bold leading-snug text-ink">
              {to ? (
                <Link to={to} className="after:absolute after:inset-0 after:rounded-card after:content-['']">
                  {item.crop_name}
                </Link>
              ) : (
                item.crop_name
              )}
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <GradeBadge grade={item.grade} size="sm" />
              <QualityBadge status={item.quality_status} />
            </div>
          </div>
          {to ? <ChevronRight aria-hidden="true" strokeWidth={1.25} className="mt-1 size-5 shrink-0 text-ink/30" /> : null}
        </header>

        <Quantity kg={item.quantity_kg} size="xl" className="text-ink" />

        <ul className="flex flex-col gap-3 border-t border-line pt-5 text-sm text-ink-2">
          {place ? (
            <Line icon={<MapPin />}>
              {place}
              {item.distance_km !== null ? (
                <span className="ms-1.5 inline-flex items-center gap-1 text-muted">
                  <Navigation aria-hidden="true" strokeWidth={1.25} className="size-3" />
                  {t('supply.away', { km: formatNumber(item.distance_km, { maxDecimals: 1 }) })}
                </span>
              ) : null}
            </Line>
          ) : null}
          <Line icon={<CalendarRange />}>
            {t('supply.window', {
              from: formatDate(item.available_from, { locale }),
              to: formatDate(item.sell_by, { locale }),
            })}
          </Line>
          {item.pickup_date ? (
            <Line icon={<Truck />}>{t('supply.pickup', { date: formatDate(item.pickup_date, { locale }) })}</Line>
          ) : null}
          <Line icon={<HandCoins />}>{t('supply.offers', { count: item.offers_count })}</Line>
        </ul>

        {item.my_offer_status ? (
          <div className="flex flex-wrap items-center gap-2.5 border-t border-line pt-4 text-[13px] font-semibold text-muted">
            {t('supply.yourOffer')}
            <StatusBadge kind="offer" value={item.my_offer_status} size="sm" />
          </div>
        ) : null}
      </div>

      {actions ? (
        <footer className="relative z-[1] mt-auto flex flex-wrap items-center gap-3 border-t border-line px-6 py-4 sm:px-8">{actions}</footer>
      ) : null}
    </Card>
  );
}

function Line({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex min-w-0 items-start gap-2.5">
      <span aria-hidden="true" className="mt-0.5 text-muted [&_svg]:size-4 [&_svg]:stroke-[1.25]">
        {icon}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}
