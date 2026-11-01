import { ArrowUpRight, Crown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { AwaitingBadge, BuyerTrust, CertaintyBadge, Money, Quantity, StatusBadge, ValidityCountdown } from '@/components/domain';
import { Badge, Skeleton } from '@/components/ui';
import { useOfferBreakdowns } from '@/features/coordinator/hooks';
import { cn } from '@/lib/cn';
import type { Offer } from '@/types/api';

import { OfferSellerActions } from './OfferSellerActions';

const OPEN: ReadonlySet<Offer['status']> = new Set(['pending', 'countered', 'proposed']);

export interface LotOfferComparisonProps {
  offers: readonly Offer[];
}

/** Every buyer offer on a lot, compared on what the farmers actually keep per kg (net), not the headline price. */
export function LotOfferComparison({ offers }: LotOfferComparisonProps) {
  const { t } = useTranslation('coordinatorLots');
  const ordered = [...offers].sort((a, b) => Number(OPEN.has(b.status)) - Number(OPEN.has(a.status)) || b.created_at.localeCompare(a.created_at));
  const breakdowns = useOfferBreakdowns(ordered.map((offer) => offer.id));

  const nets = ordered.map((offer, index) => (OPEN.has(offer.status) ? breakdowns[index]?.data?.net_per_kg ?? null : null));
  const best = nets.reduce<number | null>((max, value) => (value !== null && (max === null || value > max) ? value : max), null);

  return (
    <ul className="space-y-3">
      {ordered.map((offer, index) => {
        const breakdown = breakdowns[index];
        const data = breakdown?.data;
        const isBest = best !== null && nets[index] === best && ordered.filter((o) => OPEN.has(o.status)).length > 1;
        const open = OPEN.has(offer.status);
        return (
          <li
            key={offer.id}
            className={cn(
              'rounded-card border p-5 sm:p-6',
              isBest ? 'border-gold-700/60 bg-paper' : 'border-line bg-paper',
              !open && 'opacity-75',
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/app/coordinator/offers/${offer.id}`} className="link-luxe font-display text-h3 font-bold text-ink">
                    {offer.buyer_name}
                  </Link>
                  <BuyerTrust verified={offer.buyer_verified} reliabilityPct={offer.buyer_reliability_pct} size="sm" />
                  {isBest ? (
                    <Badge tone="gold" size="sm" icon={<Crown aria-hidden="true" strokeWidth={1.25} />}>
                      {t('offers.bestNet', { defaultValue: 'Best for farmers' })}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-small text-muted">
                  {offer.code} · {t(`common:enums.pickupTerms.${offer.pickup_terms}`, { defaultValue: offer.pickup_terms.replace(/_/g, ' ') })} ·{' '}
                  {t('offers.payIn', { defaultValue: 'paid in {{days}} days', days: offer.payment_terms_days })}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge kind="offer" value={offer.status} size="sm" />
                {offer.awaiting && open ? <AwaitingBadge awaiting={offer.awaiting} /> : null}
                {offer.status === 'pending' || offer.status === 'countered' ? <ValidityCountdown validUntil={offer.valid_until} /> : null}
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              <div>
                <dt className="text-[13px] font-semibold text-muted">{t('offers.gross', { defaultValue: 'Offer price' })}</dt>
                <dd>
                  <Money value={offer.price_per_kg} perKg size="md" tone="muted" />
                </dd>
              </div>
              <div>
                <dt className="text-[13px] font-semibold text-forest-700">{t('offers.net', { defaultValue: 'Farmers keep' })}</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  {breakdown?.isPending ? (
                    <Skeleton className="h-6 w-20" />
                  ) : data ? (
                    <>
                      <Money value={data.net_per_kg} perKg size="lg" />
                      <CertaintyBadge certainty={data.confidence} size="sm" withTooltip={false} />
                    </>
                  ) : (
                    <span className="text-small text-muted">{t('offers.netUnavailable', { defaultValue: 'Not available' })}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[13px] font-semibold text-muted">{t('offers.quantity', { defaultValue: 'Quantity' })}</dt>
                <dd>
                  <Quantity kg={offer.quantity_kg} size="md" />
                </dd>
              </div>
              <div>
                <dt className="text-[13px] font-semibold text-muted">{t('offers.netTotal', { defaultValue: 'Net to the pool' })}</dt>
                <dd>{data ? <Money value={data.net_amount} size="md" /> : '—'}</dd>
              </div>
            </dl>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
              <OfferSellerActions offer={offer} />
              {offer.status === 'proposed' ? (
                <p className="text-small text-ink">{t('offers.awaitingFarmers', { defaultValue: 'Accepted — waiting on farmer consent' })}</p>
              ) : null}
              {offer.awaiting === 'buyer' && open ? (
                <p className="text-small text-muted">{t('offers.awaitingBuyer', { defaultValue: 'Your counter is with the buyer' })}</p>
              ) : null}
              <Link to={`/app/coordinator/offers/${offer.id}`} className="link-luxe ms-auto inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                {t('offers.open', { defaultValue: 'Negotiation & breakdown' })}
                <ArrowUpRight aria-hidden="true" strokeWidth={1.25} className="size-3.5" />
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
