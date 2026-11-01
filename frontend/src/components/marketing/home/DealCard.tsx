import { Trans, useTranslation } from 'react-i18next';
import { CertaintyBadge, CertaintyIcon, Money } from '@/components/domain';
import { formatPerKg } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { Certainty, NetProceeds } from '@/types/api';
import { IllustrativeNote, Tag } from '../primitives';
import { WORKED, linePerKg } from '../saleComparison';

interface OfferRowProps {
  letter: 'A' | 'B';
  title: string;
  terms: string;
  data: NetProceeds;
  grossCertainty: Certainty;
  best?: boolean;
}

function OfferRow({ letter, title, terms, data, grossCertainty, best = false }: OfferRowProps) {
  const { t } = useTranslation('marketingHome');
  return (
    <li className="border-t border-line py-5 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-3 text-[13px] font-semibold text-muted">
            <span>{t('dealCard.offer', { letter, defaultValue: 'Offer {{letter}}' })}</span>
            {best ? (
              <span className="inline-flex items-center gap-1.5 text-forest-600">
                <span aria-hidden="true" className="size-1 rounded-full bg-forest-600" />
                {t('dealCard.higherNet', { defaultValue: 'Higher net' })}
              </span>
            ) : null}
          </p>
          <p className="mt-1.5 font-display text-[1.25rem] leading-tight text-ink">{title}</p>
          <p className="mt-1 text-[12.5px] font-normal leading-snug text-muted">{terms}</p>
        </div>
        <div className="shrink-0 text-end">
          <p className="text-[13px] font-semibold text-muted">{t('dealCard.quoted', { defaultValue: 'Quoted' })}</p>
          <p className="mt-1.5 inline-flex items-center gap-1.5 text-sm tabular-nums text-ink-2">
            <CertaintyIcon certainty={grossCertainty} />
            <span>{formatPerKg(data.gross_price_per_kg)}</span>
            <span className="sr-only">({t(`common:enums.certainty.${grossCertainty}`, { defaultValue: grossCertainty })})</span>
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <p className="text-[13px] font-semibold text-muted">{t('dealCard.takeHome', { defaultValue: 'You take home' })}</p>
          <Money
            value={data.net_per_kg}
            perKg
            size="xl"
            className={cn('mt-1 font-display font-bold', best ? 'text-ink' : 'text-ink/60')}
          />
        </div>
        <CertaintyBadge certainty={data.confidence} size="sm" />
      </div>
    </li>
  );
}

/** The hero's illustrative deal: 400 kg of tomatoes, two offers, compared on net — from the real formula. */
export function DealCard({ className }: { className?: string }) {
  const { mandi, pooled, upliftPerKg, upliftTotal, priceGapPerKg, inputs } = WORKED;
  const transportGap = linePerKg(pooled, 'transport') - linePerKg(mandi, 'transport');
  const { t } = useTranslation('marketingHome');

  return (
    <figure
      aria-label={t('dealCard.ariaLabel', {
        kg: inputs.quantityKg,
        defaultValue: 'Illustrative deal: {{kg}} kg of tomatoes, two offers compared on net earnings',
      })}
      className={cn('relative rounded-panel border border-line bg-paper p-6 text-ink shadow-luxe-lg sm:p-8', className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-gold-700">{t('dealCard.eyebrow', { defaultValue: 'Lot · Tomatoes' })}</p>
          <p className="mt-2 truncate font-display text-[1.75rem] font-bold leading-tight tracking-[-0.01em]">
            {t('dealCard.harvest', { kg: inputs.quantityKg, defaultValue: '{{kg}} kg Tomatoes' })}
          </p>
          <p className="mt-1 truncate text-[12.5px] font-normal text-muted">
            {t('dealCard.status', { defaultValue: 'Ready tomorrow · Quality pending inspection' })}
          </p>
        </div>
        <Tag tone="gold">{t('dealCard.illustrative', { defaultValue: 'Illustrative' })}</Tag>
      </div>

      <span aria-hidden="true" className="hairline mt-6 [--hairline:var(--color-line)]" />

      <ul className="mt-6 flex flex-col">
        <OfferRow
          letter="A"
          title={t('dealCard.offerA.title', { defaultValue: 'Local trader at the mandi' })}
          terms={t('dealCard.offerA.terms', { defaultValue: 'Your own vehicle · 8% commission · paid next day' })}
          data={mandi}
          grossCertainty="estimated"
        />
        <OfferRow
          letter="B"
          title={t('dealCard.offerB.title', { defaultValue: 'Pooled sale with 2 neighbours' })}
          terms={t('dealCard.offerB.terms', {
            days: inputs.paymentDays,
            defaultValue: 'Shared truck · no commission · paid in {{days}} days',
          })}
          data={pooled}
          grossCertainty="confirmed"
          best
        />
      </ul>

      <figcaption className="mt-1 border-t border-line pt-5">
        <p className="text-[13.5px] font-normal leading-relaxed text-ink-2">
          <Trans
            t={t}
            i18nKey="dealCard.summary"
            defaults="Offer B quotes {{gap}} more and saves {{transport}} on transport. After every deduction you keep <strong>{{uplift}} more</strong> — about <money/> on this harvest."
            values={{
              gap: formatPerKg(priceGapPerKg),
              transport: formatPerKg(Math.abs(transportGap)),
              uplift: formatPerKg(upliftPerKg),
            }}
            components={{
              strong: <strong className="font-medium text-ink" />,
              money: <Money value={upliftTotal} decimals={0} className="font-medium text-ink" />,
            }}
          />
        </p>
      </figcaption>

      <IllustrativeNote className="mt-4 text-[12px] text-muted">
        {t('dealCard.note', {
          defaultValue: 'Illustrative inputs, real formula: the same net-proceeds engine farmers see in the app.',
        })}
      </IllustrativeNote>
    </figure>
  );
}
