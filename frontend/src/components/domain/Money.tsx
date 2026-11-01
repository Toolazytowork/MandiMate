import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { EMPTY_VALUE, formatINR, formatKg, formatNumber } from '@/lib/format';

/* ──────────────────────────────── Money ──────────────────────────────── */

export type MoneySize = 'sm' | 'md' | 'lg' | 'xl' | 'hero';

const MONEY_SIZES: Record<MoneySize, { value: string; symbol: string; fraction: string; suffix: string }> = {
  sm: { value: 'text-sm font-medium', symbol: '', fraction: '', suffix: 'text-[0.85em] font-normal' },
  md: { value: 'text-base font-medium', symbol: '', fraction: '', suffix: 'text-[0.8em] font-normal' },
  lg: {
    value: 'font-display text-h2 font-bold tracking-[-0.01em]',
    symbol: 'me-[0.04em] text-[0.7em]',
    fraction: 'text-[0.6em]',
    suffix: 'ms-0.5 font-sans text-[0.45em] font-normal tracking-normal',
  },
  xl: {
    value: 'font-display text-display-sm font-bold tracking-[-0.02em]',
    symbol: 'me-[0.05em] align-[0.38em] text-[0.55em]',
    fraction: 'text-[0.55em]',
    suffix: 'ms-1 font-sans text-[0.38em] font-normal tracking-normal',
  },
  hero: {
    value: 'font-display text-display-md font-bold tracking-[-0.025em] md:text-display-lg',
    symbol: 'me-[0.06em] align-[0.42em] text-[0.5em]',
    fraction: 'text-[0.5em]',
    suffix: 'ms-1.5 font-sans text-[0.3em] font-normal tracking-normal',
  },
};

/** "−₹12,40,000.50" → sign, digits, fraction and compact unit, so each part can be styled. */
const MONEY_PARTS = /^([+−]?)₹([\d,]+)(\.\d+)?(K|L|Cr)?$/;

export interface MoneyProps {
  value: number | null | undefined;
  size?: MoneySize;
  /** Appends "/kg"; defaults to 2 decimals. */
  perKg?: boolean;
  /** Fixed fraction digits (default: paise only when present; 2 for per-kg). */
  decimals?: number;
  /** Indian short scale: ₹6.4K, ₹12.4L, ₹1.2Cr. */
  compact?: boolean;
  /** Prefix positive amounts with "+". */
  signed?: boolean;
  /** `muted` for "what you would get otherwise" figures. Negative amounts are always muted rust. */
  tone?: 'default' | 'muted';
  className?: string;
}

/**
 * Indian rupees with en-IN grouping (₹12,40,000). `xl` and `hero` are set in the display bold with
 * a raised rupee sign and smaller paise — money is the calm hero of every screen.
 */
export function Money({ value, size = 'md', perKg = false, decimals, compact = false, signed = false, tone = 'default', className }: MoneyProps) {
  const { t } = useTranslation('domain');
  const styles = MONEY_SIZES[size];
  // Drop the RTL isolate marks formatINR adds for Urdu; the span below is itself dir="ltr".
  const formatted = formatINR(value, { decimals: decimals ?? (perKg ? 2 : undefined), compact, signed }).replace(/[\u2066-\u2069]/g, '');
  const parts = MONEY_PARTS.exec(formatted);
  const negative = typeof value === 'number' && parts?.[1] === '−';
  const suffix = perKg ? <span className={cn('text-current/60', styles.suffix)}>{t('common:units.perKg')}</span> : null;

  return (
    <span
      dir="ltr"
      className={cn(
        'inline-block whitespace-nowrap leading-none tabular-nums',
        styles.value,
        tone === 'muted' && 'text-muted',
        negative && 'text-danger/90',
        className,
      )}
    >
      {parts ? (
        <>
          {parts[1]}
          <span className={cn(styles.symbol, styles.symbol && 'text-current/55')}>₹</span>
          {parts[2]}
          {parts[3] ? <span className={cn(styles.fraction, styles.fraction && 'text-current/60')}>{parts[3]}</span> : null}
          {parts[4] ?? null}
        </>
      ) : (
        <span className="text-muted">{formatted}</span>
      )}
      {suffix}
    </span>
  );
}

/* ─────────────────────────────── Quantity ─────────────────────────────── */

const QUANTITY_SIZES = {
  sm: 'text-sm font-medium',
  md: 'text-base font-medium',
  lg: 'font-display text-h2 font-bold',
  xl: 'font-display text-display-sm font-bold tracking-[-0.02em]',
} as const;

export interface QuantityProps {
  kg: number | null | undefined;
  /** `auto` switches to tonnes from 10,000 kg. */
  unit?: 'auto' | 'kg' | 'tonnes';
  size?: keyof typeof QUANTITY_SIZES;
  className?: string;
}

/** "1,250 kg" → ["1,250", "kg"]; "12.5 t" → ["12.5", "tonnes"] (formatKg switches to tonnes from 10,000 kg). */
function splitKg(kg: number | null | undefined, unit: QuantityProps['unit']): { amount: string; unit: 'kg' | 'tonnes' | null } {
  if (typeof kg !== 'number' || !Number.isFinite(kg)) return { amount: EMPTY_VALUE, unit: null };
  if (unit === 'tonnes') return { amount: formatNumber(kg / 1000, { maxDecimals: 2 }), unit: 'tonnes' };
  if (unit === 'kg') return { amount: formatNumber(kg, { maxDecimals: 1 }), unit: 'kg' };
  const [amount = EMPTY_VALUE, short] = formatKg(kg).split(' ');
  return { amount, unit: short === 't' ? 'tonnes' : 'kg' };
}

/** Formats kilograms as text in the UI language: "1,250 kg", "1,250 किलो", "12.5 t". */
export function useKgFormatter(): (kg: number | null | undefined) => string {
  const { t } = useTranslation('domain');
  return (kg) => {
    const { amount, unit } = splitKg(kg, 'auto');
    if (unit === 'tonnes') return `${amount} ${t('common:units.tonneShort')}`;
    if (unit === 'kg') return t('common:units.kgValue', { value: amount });
    return amount;
  };
}

/** Kilograms or tonnes with Indian grouping; the unit is set smaller and quieter than the number. */
export function Quantity({ kg, unit = 'auto', size = 'md', className }: QuantityProps) {
  const { t } = useTranslation('domain');
  const parts = splitKg(kg, unit);
  const unitLabel = parts.unit === 'tonnes' ? t('common:units.tonneShort') : t('common:units.kg');

  return (
    <span className={cn('inline-block whitespace-nowrap leading-none tabular-nums', QUANTITY_SIZES[size], className)}>
      {parts.amount}
      {parts.unit ? <span className="ms-[0.25em] text-[0.78em] font-normal text-current/60">{unitLabel}</span> : null}
    </span>
  );
}

/* ───────────────────────────────── Delta ───────────────────────────────── */

const DELTA_SIZES = {
  sm: 'h-6 gap-1 px-2 text-xs [&_svg]:size-3',
  md: 'h-7 gap-1.5 px-2.5 text-[13px] [&_svg]:size-3.5',
} as const;

export interface DeltaProps {
  /** Difference in rupees (per kg unless `perKg` is false). Nothing renders for null. */
  value: number | null | undefined;
  perKg?: boolean;
  /** Text after the amount; defaults to "vs mandi". Pass `null` to hide. */
  label?: ReactNode;
  /** Which direction is good news (default `up`). */
  goodWhen?: 'up' | 'down';
  size?: keyof typeof DELTA_SIZES;
  className?: string;
}

/** Uplift chip, e.g. "↗ +₹1.80/kg vs mandi" — green when it is good news, rust when it is not. */
export function Delta({ value, perKg = true, label, goodWhen = 'up', size = 'sm', className }: DeltaProps) {
  const { t } = useTranslation('domain');
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value * 100) / 100;
  const trend = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat';
  const Icon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : Minus;
  const tone =
    trend === 'flat'
      ? 'bg-ink/[0.06] text-ink-2 [.surface-dark_&]:bg-white/10 [.surface-dark_&]:text-ivory'
      : trend === goodWhen
        ? 'bg-success/[0.12] text-success-ink [.surface-dark_&]:bg-gold-400/20 [.surface-dark_&]:text-gold-300'
        : 'bg-danger/[0.1] text-danger-ink [.surface-dark_&]:bg-tomato-500/25 [.surface-dark_&]:text-[#ffb4a6]';
  const amount = formatINR(rounded, { decimals: 2, signed: true });
  const text = label === undefined ? t('delta.vsMandi') : label;

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-full font-semibold leading-none tabular-nums',
        DELTA_SIZES[size],
        tone,
        className,
      )}
    >
      <Icon aria-hidden="true" strokeWidth={1.25} />
      <span>
        {amount}
        {perKg ? t('common:units.perKg') : null}
      </span>
      {text ? <span className="text-[0.85em] font-normal opacity-75">{text}</span> : null}
    </span>
  );
}
