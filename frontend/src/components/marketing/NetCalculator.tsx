import { useEffect, useId, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Trans, useTranslation } from 'react-i18next';
import { RotateCcw, SlidersHorizontal, TrendingDown, TrendingUp } from 'lucide-react';
import { BreakdownDisclosure, CertaintyBadge, CertaintyLegend, Money } from '@/components/domain';
import { CountUp, EASE_LUXE } from '@/components/motion';
import { LINE_LABELS, LINE_ORDER } from '@/lib/netProceeds';
import { formatINR, formatKg, formatPerKg } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { BreakdownKey, NetProceeds } from '@/types/api';
import {
  compareSale,
  linePerKg,
  localizeSaleComparison,
  WORKED_EXAMPLE,
  type SaleComparison,
  type SaleInputs,
} from './saleComparison';

/* ─────────────────────────────── Inputs ─────────────────────────────── */

type InputKey = keyof SaleInputs;

interface InputSpec {
  key: InputKey;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  /** `netCalculator.units.<unitKey>`. */
  unitKey: 'kg' | 'rupeesPerKg' | 'km' | 'percent' | 'days';
  integer?: boolean;
}

const MAIN_INPUTS: readonly InputSpec[] = [
  { key: 'quantityKg', label: 'Your harvest', hint: 'How much is ready to sell', min: 50, max: 5000, step: 10, unit: 'kg', unitKey: 'kg' },
  { key: 'mandiPrice', label: 'Mandi price', hint: 'What a local trader or the mandi pays', min: 1, max: 150, step: 0.5, unit: '₹/kg', unitKey: 'rupeesPerKg' },
  { key: 'offerPrice', label: 'Pooled offer price', hint: 'A buyer’s price for the pooled lot', min: 1, max: 150, step: 0.5, unit: '₹/kg', unitKey: 'rupeesPerKg' },
  { key: 'mandiDistanceKm', label: 'Distance to the mandi', hint: 'Farm to market, by road', min: 1, max: 150, step: 1, unit: 'km', unitKey: 'km' },
  { key: 'mandiRejectionPct', label: 'Rejection selling alone', hint: 'Share usually refused or sold as waste', min: 0, max: 40, step: 0.5, unit: '%', unitKey: 'percent' },
  { key: 'paymentDays', label: 'Buyer pays after', hint: 'The pooled buyer’s payment terms', min: 0, max: 60, step: 1, unit: 'days', unitKey: 'days', integer: true },
];

const POOL_INPUTS: readonly InputSpec[] = [
  { key: 'lotKg', label: 'Pooled lot size', hint: 'All farmers’ harvests on one truck', min: 100, max: 20000, step: 50, unit: 'kg', unitKey: 'kg' },
  { key: 'routeKm', label: 'Pickup route to the buyer', hint: 'Across the farms, then to the buyer', min: 1, max: 250, step: 1, unit: 'km', unitKey: 'km' },
  { key: 'pooledRejectionPct', label: 'Rejection when pooled', hint: 'Graded, inspected produce', min: 0, max: 40, step: 0.5, unit: '%', unitKey: 'percent' },
];

const ALL_INPUTS = [...MAIN_INPUTS, ...POOL_INPUTS];

function clamp(spec: InputSpec, value: number): number {
  const bounded = Math.min(spec.max, Math.max(spec.min, value));
  return spec.integer ? Math.round(bounded) : bounded;
}

interface NumberSliderProps {
  spec: InputSpec;
  value: number;
  onChange: (value: number) => void;
}

/** A number box and a slider bound to the same value; the box accepts any in-range number. */
function NumberSlider({ spec, value, onChange }: NumberSliderProps) {
  const { t } = useTranslation('marketing');
  const id = useId();
  const label = t(`netCalculator.inputs.${spec.key}.label`, { defaultValue: spec.label });
  const hint = t(`netCalculator.inputs.${spec.key}.hint`, { defaultValue: spec.hint });
  const unit = t(`netCalculator.units.${spec.unitKey}`, { defaultValue: spec.unit });
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft(String(value));
    setInvalid(false);
  }, [value]);

  const commit = (raw: string) => {
    setDraft(raw);
    const parsed = Number(raw);
    const ok = raw.trim() !== '' && Number.isFinite(parsed) && parsed >= spec.min && parsed <= spec.max;
    setInvalid(!ok);
    if (ok) onChange(clamp(spec, parsed));
  };

  const fill = ((value - spec.min) / (spec.max - spec.min)) * 100;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-end justify-between gap-3">
        <label htmlFor={id} className="min-w-0">
          <span className="block text-[13px] font-semibold text-ink">{label}</span>
          <span className="mt-1 block text-[12.5px] font-normal text-muted">{hint}</span>
        </label>
        <div
          className={cn(
            'flex h-11 w-[8.5rem] shrink-0 items-center rounded-sm border bg-paper pe-3 transition-colors focus-within:border-ink',
            invalid ? 'border-danger' : 'border-line',
          )}
        >
          <input
            id={id}
            type="number"
            inputMode="decimal"
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={draft}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${id}-error` : undefined}
            onChange={(event) => commit(event.target.value)}
            onBlur={() => {
              setDraft(String(value));
              setInvalid(false);
            }}
            className="h-full min-w-0 flex-1 bg-transparent ps-3 text-end font-display text-[1.25rem] tabular-nums text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="ps-1.5 text-[12.5px] text-muted">{unit}</span>
        </div>
      </div>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        aria-label={`${label} (${unit})`}
        onChange={(event) => onChange(clamp(spec, Number(event.target.value)))}
        className="h-6 w-full cursor-pointer appearance-none bg-transparent focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-gold-500 [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-ink [&::-moz-range-thumb]:bg-paper [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-ink [&::-webkit-slider-thumb]:bg-paper"
        style={{
          background: `linear-gradient(to right, var(--color-ink) 0%, var(--color-ink) ${fill}%, var(--color-line) ${fill}%, var(--color-line) 100%) center / 100% 1px no-repeat`,
        }}
      />
      {invalid ? (
        <p id={`${id}-error`} className="text-[12.5px] text-danger-ink">
          {t('netCalculator.rangeError', { defaultValue: 'Enter a number from {{min}} to {{max}}.', min: spec.min, max: spec.max })}
        </p>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────── Results ─────────────────────────────── */

const inr = (n: number) => formatINR(n, { decimals: 0 });

function OptionCard({ data, highlight, caption }: { data: NetProceeds; highlight: boolean; caption: string }) {
  const { t } = useTranslation('marketing');
  return (
    <div
      className={cn(
        'flex flex-col border-t py-6',
        highlight ? 'border-ink' : 'border-line',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={cn('text-[13px] font-semibold', highlight ? 'text-ink' : 'text-muted')}>{data.label}</p>
          <p className="mt-1 text-[12.5px] font-normal text-muted">{caption}</p>
        </div>
        <CertaintyBadge certainty={data.confidence} size="sm" />
      </div>
      <p className="mt-6 text-[13px] text-muted">{t('netCalculator.youTakeHome', { defaultValue: 'You take home' })}</p>
      <p className={cn('mt-1 font-display font-bold text-[2.5rem] leading-none tracking-[-0.02em] tabular-nums', highlight ? 'text-ink' : 'text-ink/70')}>
        <CountUp value={data.net_amount} format={inr} duration={0.7} />
      </p>
      <p className="mt-2 text-[13px] tabular-nums text-muted">
        {t('netCalculator.netFromGross', {
          defaultValue: '{{net}} net · from {{gross}} gross',
          net: formatPerKg(data.net_per_kg),
          gross: formatINR(data.gross_amount, { decimals: 0 }),
        })}
      </p>
    </div>
  );
}

function BarCell({ value, scale, pooled }: { value: number; scale: number; pooled: boolean }) {
  const reduceMotion = useReducedMotion();
  const width = scale > 0 ? Math.min(100, (Math.abs(value) / scale) * 100) : 0;
  const negative = value < 0;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Money value={value} perKg size="sm" tone={pooled ? 'default' : 'muted'} className="self-end" />
      <div className="h-px overflow-hidden bg-line">
        <motion.div
          initial={false}
          animate={{ width: `${width}%` }}
          transition={{ duration: reduceMotion ? 0 : 0.6, ease: EASE_LUXE }}
          className={cn(
            'ms-auto h-full',
            negative ? (pooled ? 'bg-danger/70' : 'bg-danger/40') : pooled ? 'bg-ink' : 'bg-ink/35',
          )}
        />
      </div>
    </div>
  );
}

function BreakdownCompare({ comparison }: { comparison: SaleComparison }) {
  const { t } = useTranslation('marketing');
  const { mandi, pooled } = comparison;
  const scale = Math.max(mandi.gross_price_per_kg, pooled.gross_price_per_kg, 1);
  const keys = LINE_ORDER.filter((key: BreakdownKey) => key !== 'gross');

  return (
    <div className="rounded-card border border-line bg-paper">
      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-4 border-b border-line px-5 py-3 text-[13px] font-semibold text-muted sm:px-6">
        <span>{t('netCalculator.compare.perKg', { defaultValue: 'Per kg' })}</span>
        <span className="text-end">{t('netCalculator.compare.alone', { defaultValue: 'Alone' })}</span>
        <span className="text-end text-gold-700">{t('netCalculator.compare.pooled', { defaultValue: 'Pooled' })}</span>
      </div>
      <dl>
        <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] items-end gap-x-4 px-5 py-3.5 sm:px-6">
          <dt className="text-[14px] text-ink">{t('netCalculator.compare.quotedPrice', { defaultValue: 'Quoted price' })}</dt>
          <dd>
            <BarCell value={mandi.gross_price_per_kg} scale={scale} pooled={false} />
          </dd>
          <dd>
            <BarCell value={pooled.gross_price_per_kg} scale={scale} pooled />
          </dd>
        </div>
        {keys.map((key) => (
          <div
            key={key}
            className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] items-end gap-x-4 border-t border-line/60 px-5 py-3 sm:px-6"
          >
            <dt className="text-[13.5px] font-normal leading-snug text-muted">
              {t(`common:enums.breakdownKey.${key}`, { defaultValue: LINE_LABELS[key] })}
            </dt>
            <dd>
              <BarCell value={linePerKg(mandi, key)} scale={scale} pooled={false} />
            </dd>
            <dd>
              <BarCell value={linePerKg(pooled, key)} scale={scale} pooled />
            </dd>
          </div>
        ))}
        <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] items-end gap-x-4 border-t border-ink/60 px-5 py-5 sm:px-6">
          <dt className="font-display text-[1.25rem] font-bold text-ink">
            {t('netCalculator.youTakeHome', { defaultValue: 'You take home' })}
          </dt>
          <dd>
            <BarCell value={mandi.net_per_kg} scale={scale} pooled={false} />
          </dd>
          <dd>
            <BarCell value={pooled.net_per_kg} scale={scale} pooled />
          </dd>
        </div>
      </dl>
    </div>
  );
}

/* ─────────────────────────────── Calculator ─────────────────────────────── */

/** Interactive net-earnings calculator: sell alone at the mandi versus pooled with MandiMate. */
export function NetCalculator({ className }: { className?: string }) {
  const { t } = useTranslation('marketing');
  const [values, setValues] = useState<SaleInputs>(WORKED_EXAMPLE);
  const comparison = useMemo<SaleComparison | null>(() => {
    try {
      return compareSale(values, { hypothetical: true });
    } catch {
      return null;
    }
  }, [values]);
  // Labels, line notes and open items in the visitor's language; the numbers are untouched.
  const localized = comparison ? localizeSaleComparison(comparison, t, { hypothetical: true }) : null;

  const set = (key: InputKey) => (value: number) => setValues((current) => ({ ...current, [key]: value }));
  const changed = ALL_INPUTS.some((spec) => values[spec.key] !== WORKED_EXAMPLE[spec.key]);

  const uplift = comparison?.upliftTotal ?? 0;
  const better = uplift > 0;
  const lotTooSmall = values.lotKg < values.quantityKg;

  return (
    <div className={cn('grid gap-6 lg:grid-cols-12 lg:items-start lg:gap-8', className)}>
      {/* Inputs */}
      <form
        aria-label={t('netCalculator.formLabel', { defaultValue: 'Your harvest and prices' })}
        onSubmit={(event) => event.preventDefault()}
        className="rounded-card border border-line bg-paper p-6 sm:p-9 lg:col-span-5"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-[1.75rem] font-bold tracking-[-0.01em] text-ink">
            {t('netCalculator.yourNumbers', { defaultValue: 'Your numbers' })}
          </h2>
          <button
            type="button"
            onClick={() => setValues(WORKED_EXAMPLE)}
            disabled={!changed}
            className="inline-flex items-center gap-1.5 border-b border-current pb-1 text-[13px] font-semibold text-ink transition-colors hover:text-gold-700 disabled:pointer-events-none disabled:opacity-40"
          >
            <RotateCcw aria-hidden="true" strokeWidth={1.25} className="size-3.5" />
            {t('netCalculator.reset', { defaultValue: 'Reset example' })}
          </button>
        </div>
        <p className="mt-2 text-[13px] font-normal text-muted">
          {t('netCalculator.startsWith', { defaultValue: 'Starts with the worked example: 400 kg of tomatoes.' })}
        </p>

        <fieldset className="mt-8 flex flex-col gap-8 border-t border-line pt-8">
          <legend className="sr-only">
            {t('netCalculator.mainLegend', { defaultValue: 'Your harvest and the two prices' })}
          </legend>
          {MAIN_INPUTS.map((spec) => (
            <NumberSlider key={spec.key} spec={spec} value={values[spec.key]} onChange={set(spec.key)} />
          ))}
        </fieldset>

        <details className="group mt-10 border-y border-line">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-5 text-[13px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2">
              <SlidersHorizontal aria-hidden="true" strokeWidth={1.25} className="size-4 text-muted" />
              {t('netCalculator.poolAssumptions', { defaultValue: 'Pooled lot assumptions' })}
            </span>
            <span className="text-[12.5px] font-normal normal-case tracking-normal text-muted group-open:hidden">
              {t('netCalculator.lotSummary', { defaultValue: '{{lot}} · {{km}} km', lot: formatKg(values.lotKg), km: values.routeKm })}
            </span>
          </summary>
          <fieldset className="flex flex-col gap-8 pb-8 pt-2">
            <legend className="sr-only">{t('netCalculator.poolAssumptions', { defaultValue: 'Pooled lot assumptions' })}</legend>
            {POOL_INPUTS.map((spec) => (
              <NumberSlider key={spec.key} spec={spec} value={values[spec.key]} onChange={set(spec.key)} />
            ))}
            {lotTooSmall ? (
              <p className="text-[12.5px] text-muted">
                {t('netCalculator.lotTooSmall', {
                  defaultValue: 'The lot can’t be smaller than your harvest, so it is counted as {{quantity}}.',
                  quantity: formatKg(values.quantityKg),
                })}
              </p>
            ) : null}
          </fieldset>
        </details>
      </form>

      {/* Results */}
      <section aria-labelledby="calc-results-title" className="flex flex-col gap-5 lg:sticky lg:top-24 lg:col-span-7">
        <h2 id="calc-results-title" className="sr-only">
          {t('netCalculator.resultsTitle', { defaultValue: 'Your estimated net earnings' })}
        </h2>
        {comparison && localized ? (
          <>
            <div className="surface-dark relative isolate overflow-hidden rounded-panel bg-forest-900 p-7 sm:p-10">
              <p className="eyebrow eyebrow-rule">
                {better
                  ? t('netCalculator.eyebrowBetter', { defaultValue: 'Pooling with MandiMate could add' })
                  : t('netCalculator.eyebrowWorse', { defaultValue: 'With these numbers' })}
              </p>
              <div className="mt-4 flex flex-wrap items-end gap-x-5 gap-y-3">
                <p className="flex items-center gap-3 font-display font-bold text-[3rem] leading-none tracking-[-0.03em] tabular-nums sm:text-display-lg">
                  {better ? (
                    <TrendingUp aria-hidden="true" strokeWidth={1.25} className="size-8 text-gold-400" />
                  ) : (
                    <TrendingDown aria-hidden="true" strokeWidth={1.25} className="size-8 text-ivory/50" />
                  )}
                  <span className={better ? 'not-italic text-gold-400' : 'text-ivory/80'}>
                    <CountUp value={Math.abs(uplift)} format={inr} duration={0.7} />
                  </span>
                </p>
                <p className="pb-1.5 text-[15px] font-normal text-ivory/70">
                  <Trans
                    t={t}
                    i18nKey={better ? 'netCalculator.upliftMore' : 'netCalculator.upliftLess'}
                    defaults={
                      better
                        ? 'more in your pocket · <num>{{perKg}}</num> more per kg'
                        : 'less than selling alone · <num>{{perKg}}</num> less per kg'
                    }
                    values={{ perKg: formatPerKg(Math.abs(comparison.upliftPerKg)) }}
                    components={{ num: <span className="tabular-nums text-ivory" /> }}
                  />
                </p>
              </div>
              <p className="mt-6 max-w-[34rem] border-t border-white/10 pt-5 text-[14px] font-normal leading-relaxed text-ivory/65">
                {better
                  ? t('netCalculator.explainBetter', {
                      defaultValue:
                        'A {{priceGap}} difference in the quoted price becomes {{uplift}} in what you keep, once rejection, transport, handling, commission and the wait for payment are counted.',
                      priceGap: formatPerKg(comparison.priceGapPerKg, { signed: true }),
                      uplift: formatPerKg(comparison.upliftPerKg, { signed: true }),
                    })
                  : t('netCalculator.explainWorse', {
                      defaultValue:
                        'Selling alone nets more here — and MandiMate would tell you so. A pooled deal is only worth it when the net is better, which is why we compare net, never just the price.',
                    })}
              </p>
              <p aria-live="polite" className="sr-only">
                {t('netCalculator.liveSummary', {
                  defaultValue: 'Selling alone: {{mandi}} net. Pooled with MandiMate: {{pooled}} net. Difference: {{difference}}.',
                  mandi: inr(comparison.mandi.net_amount),
                  pooled: inr(comparison.pooled.net_amount),
                  difference: formatINR(uplift, { decimals: 0, signed: true }),
                })}
              </p>
            </div>

            <div className="grid gap-x-8 sm:grid-cols-2">
              <OptionCard
                data={localized.mandi}
                highlight={!better}
                caption={t('netCalculator.mandiCaption', {
                  defaultValue: 'Own vehicle · {{transport}} transport · paid next day',
                  transport: formatPerKg(comparison.soloTransport.cost_per_kg),
                })}
              />
              <OptionCard
                data={localized.pooled}
                highlight={better}
                caption={t('netCalculator.pooledCaption', {
                  defaultValue: values.paymentDays === 1
                    ? 'Shared truck · no commission · paid in {{count}} day'
                    : 'Shared truck · no commission · paid in {{count}} days',
                  count: values.paymentDays,
                })}
              />
            </div>

            <BreakdownCompare comparison={comparison} />

            <div className="grid gap-3 sm:grid-cols-2">
              <BreakdownDisclosure data={localized.mandi} showLegend={false} />
              <BreakdownDisclosure data={localized.pooled} showLegend={false} />
            </div>

            <div className="border-t border-line pt-5">
              <CertaintyLegend compact />
              {localized.pooled.unresolved.length ? (
                <p className="mt-2 text-[12.5px] text-muted">
                  {t('netCalculator.openItems', {
                    defaultValue:
                      'Open in the pooled estimate: {{items}}. In a real deal these are resolved before you are asked to decide.',
                    items: localized.pooled.unresolved.join(' · '),
                  })}
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <div role="alert" className="rounded-card border border-danger/40 bg-paper p-6 text-sm text-danger-ink">
            {t('netCalculator.error', {
              defaultValue: 'These numbers can’t be calculated. Check that each value is within its range.',
            })}
          </div>
        )}
      </section>
    </div>
  );
}
