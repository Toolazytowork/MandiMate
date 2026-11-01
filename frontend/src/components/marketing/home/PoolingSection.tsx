import { Trans, useTranslation } from 'react-i18next';
import { Money } from '@/components/domain';
import { Reveal } from '@/components/motion';
import { formatKg } from '@/lib/format';
import { Em, IllustrativeNote, Section, SectionHeader } from '../primitives';
import { WORKED, linePerKg } from '../saleComparison';

const FARMS = [
  { name: 'Farmer A', letter: 'A', kg: 200 },
  { name: 'Farmer B', letter: 'B', kg: 350 },
  { name: 'Farmer C', letter: 'C', kg: 500 },
] as const;

const ORDER_KG = 1000;
const POOLED_KG = FARMS.reduce((sum, farm) => sum + farm.kg, 0);
/** Bars are drawn against the pooled total so the three shares visibly add up to the lot. */
const pct = (kg: number) => `${(kg / POOLED_KG) * 100}%`;
const SHADES = ['bg-gold-300', 'bg-gold-500', 'bg-forest-800'] as const;

/** "200 + 350 + 500 kg → one lot": the core idea of pooling, drawn to scale. */
export function PoolingSection() {
  const aloneTransport = WORKED.soloTransport.cost_per_kg;
  const pooledTransport = Math.abs(linePerKg(WORKED.pooled, 'transport'));
  const { t } = useTranslation('marketingHome');
  const farmName = (farm: (typeof FARMS)[number]) =>
    t('pooling.farmer', { letter: farm.letter, defaultValue: 'Farmer {{letter}}' });

  return (
    <Section id="pooling" tone="parchment" labelledBy="pooling-title" contours="valley">
      <div className="grid gap-14 lg:grid-cols-12 lg:items-center lg:gap-16">
        <div className="lg:col-span-5">
          <SectionHeader
            id="pooling-title"
            eyebrow={t('pooling.eyebrow', { defaultValue: 'Why pooling works' })}
            title={
              <Trans
                t={t}
                i18nKey="pooling.title"
                defaults="Three harvests. <em>One</em> buyer-ready lot."
                components={{ em: <Em>{null}</Em> }}
              />
            }
            lead={t('pooling.lead', {
              defaultValue:
                'A retailer wants 1,000 kg of consistent tomatoes. No single farm in the village has it. Three neighbours together do — and one truck can collect all of it on a single route.',
            })}
          />
          <dl className="mt-12 grid grid-cols-2 border-y border-line">
            <div className="py-6 pe-5">
              <dt className="text-[13px] font-semibold text-muted">{t('pooling.aloneLabel', { defaultValue: 'Transport alone' })}</dt>
              <dd className="mt-2">
                <Money value={aloneTransport} perKg size="lg" tone="muted" className="font-display font-bold" />
              </dd>
              <dd className="mt-1 text-[12.5px] font-normal text-muted">
                {t('pooling.aloneDetail', { defaultValue: '400 kg, own vehicle' })}
              </dd>
            </div>
            <div className="border-s border-line py-6 ps-5">
              <dt className="text-[13px] font-semibold text-gold-700">{t('pooling.pooledLabel', { defaultValue: 'Transport pooled' })}</dt>
              <dd className="mt-2">
                <Money value={pooledTransport} perKg size="lg" className="font-display font-bold text-ink" />
              </dd>
              <dd className="mt-1 text-[12.5px] font-normal text-muted">
                {t('pooling.pooledDetail', { defaultValue: 'Shared by weight' })}
              </dd>
            </div>
          </dl>
          <IllustrativeNote className="mt-4">
            {t('pooling.note', {
              defaultValue:
                'Estimated with MandiMate’s published vehicle rates for the worked example. Real lots use transporter quotes.',
            })}
          </IllustrativeNote>
        </div>

        <Reveal variant="fade" className="lg:col-span-7">
          <figure
            aria-label={t('pooling.figureLabel', {
              a: FARMS[0].kg,
              b: FARMS[1].kg,
              c: FARMS[2].kg,
              lot: formatKg(POOLED_KG),
              order: formatKg(ORDER_KG),
              defaultValue:
                'Farmer A {{a}} kg, Farmer B {{b}} kg and Farmer C {{c}} kg pooled into one {{lot}} lot that fills a {{order}} order',
            })}
            className="rounded-card border border-line bg-paper p-6 sm:p-10"
          >
            <ul className="flex flex-col gap-5">
              {FARMS.map((farm, index) => (
                <li key={farm.name} className="grid grid-cols-[5.5rem_1fr] items-center gap-4 sm:grid-cols-[7rem_1fr]">
                  <div>
                    <p className="text-[13px] font-semibold text-ink">{farmName(farm)}</p>
                    <p className="mt-1 text-[12.5px] font-normal tabular-nums text-muted">{formatKg(farm.kg)}</p>
                  </div>
                  <div className="h-1.5 bg-sand/60">
                    <div className={`h-full ${SHADES[index]}`} style={{ width: pct(farm.kg) }} />
                  </div>
                </li>
              ))}
            </ul>

            <div aria-hidden="true" className="my-9 flex items-center gap-4 text-gold-700">
              <span className="hairline-gold flex-1" />
              <span className="text-[13px] font-semibold text-gold-700">
                {t('pooling.oneTruck', { defaultValue: 'One truck, one route' })}
              </span>
              <span className="hairline-gold flex-1" />
            </div>

            <div>
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-display text-[2rem] font-bold leading-none tracking-[-0.02em] text-ink sm:text-[2.75rem]">
                  {formatKg(POOLED_KG)}
                </p>
                <p className="text-[13px] font-semibold text-muted">{t('pooling.oneLot', { defaultValue: 'One pooled lot' })}</p>
              </div>
              <div className="relative mt-5 flex h-2.5 overflow-hidden">
                {FARMS.map((farm, index) => (
                  <span key={farm.name} className={`${SHADES[index]} h-full`} style={{ width: pct(farm.kg) }} />
                ))}
              </div>
              <div className="relative mt-2 h-8">
                <span
                  className="absolute top-0 flex -translate-x-full flex-col items-end text-end"
                  style={{ left: pct(ORDER_KG) }}
                >
                  <span aria-hidden="true" className="h-3 w-px bg-gold-500" />
                  <span className="mt-1.5 whitespace-nowrap text-[13px] font-semibold text-gold-700">
                    {t('pooling.buyerOrder', { kg: formatKg(ORDER_KG), defaultValue: 'Buyer’s order · {{kg}}' })}
                  </span>
                </span>
              </div>
            </div>
            <figcaption className="mt-6 border-t border-line pt-5 text-[13.5px] font-normal leading-relaxed text-ink-2">
              {t('pooling.caption', {
                defaultValue:
                  'Each farmer keeps their own share, their own price and their own decision. MandiMate records who contributed what, so payment, grading and any rejection are settled farmer by farmer.',
              })}
            </figcaption>
          </figure>
        </Reveal>
      </div>
    </Section>
  );
}
