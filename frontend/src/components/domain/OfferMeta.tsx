import { useTranslation } from 'react-i18next';
import { BadgeCheck, CircleCheck, Hourglass, Lock, ShieldAlert, Timer, TriangleAlert } from 'lucide-react';
import { Badge, Tooltip } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDateTime, formatPct } from '@/lib/format';
import type { Awaiting, ISODateTime } from '@/types/api';
import { useNow, useUiLanguage } from './hooks';
import { Money } from './Money';
import { deadlineUrgency, durationParts } from './schedule';

/** "3 hours" / "2 days" in the UI language, from a duration in milliseconds. */
export function useDurationLabel(): (ms: number) => string {
  const { t } = useTranslation('domain');
  return (ms) => {
    const { unit, count } = durationParts(ms);
    return t(`common:time.${unit}`, { count });
  };
}

export interface ValidityCountdownProps {
  validUntil: ISODateTime;
  className?: string;
}

/** "Expires in 2 days" — gold within three days, rust within a day, muted once expired. Updates every minute. */
export function ValidityCountdown({ validUntil, className }: ValidityCountdownProps) {
  const { t } = useTranslation('domain');
  const now = useNow();
  const locale = useUiLanguage();
  const duration = useDurationLabel();
  const urgency = deadlineUrgency(validUntil, now);
  const remaining = new Date(validUntil).getTime() - now.getTime();
  const tone = {
    expired: 'text-muted',
    urgent: 'text-danger-ink',
    soon: 'text-gold-700',
    normal: 'text-muted',
  }[urgency];

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[13px] font-semibold', tone, className)}>
      <Timer aria-hidden="true" strokeWidth={1.25} className="size-3.5 shrink-0" />
      <time dateTime={validUntil} title={formatDateTime(validUntil, { locale })}>
        {urgency === 'expired' ? t('common:time.expired') : t('validity.expiresIn', { time: duration(remaining) })}
      </time>
    </span>
  );
}

export interface BuyerTrustProps {
  verified: boolean;
  /** 0..100 on-time payment share; `null` for a buyer with no settlement history yet. */
  reliabilityPct?: number | null;
  size?: 'sm' | 'md';
  className?: string;
}

/** Verified / not-verified buyer chip, with on-time payment history when known. */
export function BuyerTrust({ verified, reliabilityPct, size = 'sm', className }: BuyerTrustProps) {
  const { t } = useTranslation('domain');
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1.5', className)}>
      {verified ? (
        <Badge tone="forest" size={size} icon={<BadgeCheck aria-hidden="true" strokeWidth={1.25} />} className='rounded-sm bg-transparent text-[13px] font-semibold'>
          {t('buyer.verified')}
        </Badge>
      ) : (
        <Tooltip content={t('buyer.unverifiedHint')}>
          <button type="button" className="inline-flex cursor-help rounded-sm">
            <Badge tone="warning" size={size} icon={<ShieldAlert aria-hidden="true" strokeWidth={1.25} />} className='rounded-sm bg-transparent text-[13px] font-semibold'>
              {t('buyer.unverified')}
            </Badge>
          </button>
        </Tooltip>
      )}
      {reliabilityPct === undefined ? null : (
        <span className="text-xs text-muted">
          {reliabilityPct === null ? t('buyer.noHistory') : t('buyer.reliability', { pct: formatPct(reliabilityPct, { decimals: 0 }) })}
        </span>
      )}
    </span>
  );
}

export interface AwaitingBadgeProps {
  awaiting: Awaiting;
  size?: 'sm' | 'md';
  className?: string;
}

/** Who must act next on an offer. */
export function AwaitingBadge({ awaiting, size = 'sm', className }: AwaitingBadgeProps) {
  const { t } = useTranslation('domain');
  return (
    <Badge
      tone="neutral"
      size={size}
      icon={<Hourglass aria-hidden="true" strokeWidth={1.25} />}
      className={cn('rounded-sm bg-transparent text-[13px] font-semibold', className)}
    >
      {t(`common:enums.awaiting.${awaiting}`)}
    </Badge>
  );
}

export interface MinPriceIndicatorProps {
  /** `null` when the farmer set no minimum — nothing renders. */
  meets: boolean | null;
  /** The farmer's private minimum (net ₹/kg), shown in the tooltip when given. */
  minPricePerKg?: number | null;
  className?: string;
}

/** ✓ Meets your minimum price / ⚠ Below your minimum price (the minimum is a private net floor). */
export function MinPriceIndicator({ meets, minPricePerKg, className }: MinPriceIndicatorProps) {
  const { t } = useTranslation('domain');
  if (meets === null) return null;
  const Icon = meets ? CircleCheck : TriangleAlert;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[13px] font-medium',
        meets ? 'text-success-ink' : 'text-warning-ink',
        className,
      )}
    >
      <Icon aria-hidden="true" strokeWidth={1.25} className="size-4 shrink-0" />
      {meets ? t('common:money.meetsMinimum') : t('common:money.belowMinimum')}
      {typeof minPricePerKg === 'number' ? (
        <span className="inline-flex items-center gap-1 font-normal text-muted">
          <Lock aria-hidden="true" strokeWidth={1.25} className="size-3" />
          <Money value={minPricePerKg} perKg size="sm" className="font-normal" />
        </span>
      ) : null}
    </span>
  );
}
