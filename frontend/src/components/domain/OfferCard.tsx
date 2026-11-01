import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { CalendarClock, ChevronRight, Combine, Percent, Scale, Sprout, Truck } from 'lucide-react';
import { Card } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatPct } from '@/lib/format';
import type { Offer } from '@/types/api';
import { CropGlyph } from './CropGlyph';
import { GradeBadge } from './GradeBadge';
import { Money, Quantity } from './Money';
import { AwaitingBadge, BuyerTrust, ValidityCountdown } from './OfferMeta';
import { OPEN_OFFER_STATUSES } from './schedule';
import { StatusBadge } from './StatusBadge';

export interface OfferCardProps {
  offer: Offer;
  /** In-app path to the offer; the whole card becomes a link. */
  to?: string;
  /** Buttons under the terms (kept clickable above the card link). */
  actions?: ReactNode;
  /** Hide the buyer block (e.g. on the buyer's own offer list). */
  showBuyer?: boolean;
  className?: string;
}

/**
 * One buyer offer: price per kg, quantity and grade, pickup and payment terms, validity countdown,
 * buyer verification and payment reliability, and who must act next.
 */
export function OfferCard({ offer, to, actions, showBuyer = true, className }: OfferCardProps) {
  const { t } = useTranslation('domain');
  const isOpen = OPEN_OFFER_STATUSES.has(offer.status);
  const target = offer.target_type === 'lot' ? offer.lot_code : null;

  return (
    <Card as="article" interactive={Boolean(to)} className={cn('flex flex-col', className)}>
      <div className="flex flex-col gap-6 p-6 sm:p-8">
        <header className="flex items-start gap-4">
          <CropGlyph name={offer.crop_name} lotCode={offer.lot_code} size="md" framed />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] font-semibold text-muted">
              <span className="tabular-nums">{offer.code}</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                {offer.target_type === 'lot' ? (
                  <Combine aria-hidden="true" strokeWidth={1.25} className="size-3.5" />
                ) : (
                  <Sprout aria-hidden="true" strokeWidth={1.25} className="size-3.5" />
                )}
                {target ?? t(`common:enums.offerTargetType.${offer.target_type}`)}
              </span>
            </p>
            <h3 className="font-display text-h3 font-bold leading-snug text-ink">
              {to ? (
                <Link to={to} className="after:absolute after:inset-0 after:rounded-card after:content-['']">
                  {showBuyer ? offer.buyer_name : offer.crop_name}
                </Link>
              ) : showBuyer ? (
                offer.buyer_name
              ) : (
                offer.crop_name
              )}
            </h3>
            {showBuyer ? (
              <BuyerTrust verified={offer.buyer_verified} reliabilityPct={offer.buyer_reliability_pct} className="relative z-[1]" />
            ) : null}
          </div>
          {to ? <ChevronRight aria-hidden="true" strokeWidth={1.25} className="mt-1 size-5 shrink-0 text-ink/30" /> : null}
        </header>

        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="flex flex-col gap-1.5">
            <p className="text-[13px] font-semibold text-muted">{t('offer.price')}</p>
            <Money value={offer.price_per_kg} perKg size="xl" className="text-ink" />
          </div>
          <div className="flex flex-col items-end gap-1.5 text-end">
            <Quantity kg={offer.quantity_kg} size="lg" />
            <GradeBadge grade={offer.grade} size="sm" />
          </div>
        </div>

        <ul className="grid grid-cols-1 gap-x-6 gap-y-3 border-t border-line pt-5 text-sm text-ink-2 sm:grid-cols-2">
          <Term icon={<Truck />}>{t(`common:enums.pickupTerms.${offer.pickup_terms}`)}</Term>
          <Term icon={<CalendarClock />}>{t('common:money.paymentIn', { count: offer.payment_terms_days })}</Term>
          <Term icon={<Scale />}>{t('offer.maxRejection', { pct: formatPct(offer.max_rejection_pct) })}</Term>
          {offer.handling_charge_per_kg > 0 ? (
            <Term icon={<Percent />}>
              {t('offer.handling')} <Money value={offer.handling_charge_per_kg} perKg size="sm" className="font-normal" />
            </Term>
          ) : offer.commission_pct > 0 ? (
            <Term icon={<Percent />}>{t('offer.commission', { pct: formatPct(offer.commission_pct) })}</Term>
          ) : (
            <Term icon={<Percent />}>{t('offer.noCommission')}</Term>
          )}
        </ul>

        {offer.quality_spec ? <p className="text-[13px] font-normal leading-relaxed text-ink-2">{offer.quality_spec}</p> : null}

        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge kind="offer" value={offer.status} size="sm" />
          {offer.awaiting && offer.status !== 'proposed' ? <AwaitingBadge awaiting={offer.awaiting} /> : null}
          {isOpen ? <ValidityCountdown validUntil={offer.valid_until} className="ms-auto" /> : null}
        </div>
      </div>

      {actions ? (
        <footer className="relative z-[1] mt-auto flex flex-wrap items-center gap-3 border-t border-line px-6 py-4 sm:px-8">
          {actions}
        </footer>
      ) : null}
    </Card>
  );
}

function Term({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex min-w-0 items-center gap-2">
      <span aria-hidden="true" className="text-muted [&_svg]:size-4 [&_svg]:stroke-[1.25]">
        {icon}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}
