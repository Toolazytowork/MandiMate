import { Trans, useTranslation } from 'react-i18next';
import { CtaBand } from '@/components/marketing/CtaBand';
import { NetCalculator } from '@/components/marketing/NetCalculator';
import { PageHero } from '@/components/marketing/PageHero';
import { PageSeo } from '@/components/marketing/PageSeo';
import { Em, Numeral, Section, SectionHeader } from '@/components/marketing/primitives';
import {
  BASELINE_DISTANCE_KM,
  CAPITAL_COST_ANNUAL_PCT,
  LOADING_PER_KG,
  MANDI_COMMISSION_PCT,
  MANDI_HANDLING_PER_KG,
  VEHICLE_CLASSES,
  vehicleLabel,
} from '@/lib/netProceeds';
import { formatINR, formatKg, formatPerKg } from '@/lib/format';
import { faqPage, type FaqItem } from '@/lib/seo';

/** English copy with `{{placeholders}}`; translated at render time under `calculator.method.<id>`. */
const METHOD: readonly { id: string; title: string; body: string; values?: Record<string, string | number> }[] = [
  {
    id: 'gross',
    title: 'Gross sale value',
    body: 'Quantity × the price per kilogram. This is the number most apps stop at — and the one that tells you least about what you will take home.',
  },
  {
    id: 'rejection',
    title: 'Expected rejection',
    body: 'Produce refused at the gate or sold as waste is never paid for. Selling alone, ungraded produce is often rejected more; in a pooled lot, harvests are inspected and graded before pickup.',
  },
  {
    id: 'transport',
    title: 'Transport',
    body: 'Selling alone, you hire a whole vehicle for your harvest. Pooled, one vehicle collects the lot along a planned route and the cost is split by weight. Estimates use published vehicle rates; a real deal uses the transporter’s quote.',
  },
  {
    id: 'handling',
    title: 'Handling & loading',
    body: 'Hamali and unloading at a mandi is estimated at {{mandiRate}}. At a MandiMate collection point, loading and crates are estimated at {{loadingRate}}.',
    values: { mandiRate: formatPerKg(MANDI_HANDLING_PER_KG), loadingRate: formatPerKg(LOADING_PER_KG) },
  },
  {
    id: 'commission',
    title: 'Commission',
    body: 'A commission agent at the mandi typically takes about {{pct}}% of the accepted value. MandiMate deals carry no commission for farmers — MandiMate charges buyers.',
    values: { pct: MANDI_COMMISSION_PCT },
  },
  {
    id: 'paymentWait',
    title: 'Cost of waiting for payment',
    body: 'Money that arrives in three weeks is worth less than money tomorrow. We price the wait at an informal credit rate of {{rate}}% a year, so a faster-paying buyer is properly rewarded.',
    values: { rate: CAPITAL_COST_ANNUAL_PCT },
  },
];

const FAQ: readonly FaqItem[] = [
  {
    question: 'What is net earnings, and why does it matter more than price?',
    answer:
      'Net earnings is what reaches the farmer after expected rejection, transport, handling, commission and the cost of waiting for payment. A buyer who quotes ₹2 more per kilogram can still leave a farmer with less if their transport, deductions or payment terms are worse.',
  },
  {
    question: 'How accurate is this calculator?',
    answer:
      'It uses the same net-proceeds formula MandiMate uses inside the app, with published estimates for transport, handling and commission. Your real figures depend on the actual offer, transporter quote and quality inspection, which MandiMate marks as confirmed, estimated or unresolved in every deal.',
  },
  {
    question: 'Does MandiMate charge farmers a fee?',
    answer: 'No. MandiMate charges buyers a coordination fee per successfully sourced lot. The MandiMate fee line is ₹0 for farmers.',
  },
  {
    question: 'How is pooled transport shared between farmers?',
    answer:
      'By weight. If your harvest is 400 kg of a 1,000 kg lot, you pay 40% of the vehicle cost for that route — not the whole trip.',
  },
  {
    question: 'What if selling alone pays more?',
    answer:
      'Then MandiMate shows you that. A pooled deal is only worth taking when your net is better, and no sale goes ahead without your consent.',
  },
];

/** FAQ JSON-LD stays in English (SEO); the visible list is translated. */
const JSON_LD = [faqPage(FAQ)];

export default function CalculatorPage() {
  const { t } = useTranslation('marketing');
  const crumb = t('calculator.crumb', { defaultValue: 'Net earnings calculator' });
  return (
    <>
      <PageSeo path="/calculator" crumb={crumb} jsonLd={JSON_LD} />
      <PageHero
        tone="light"
        size="md"
        crumb={crumb}
        eyebrow={t('calculator.hero.eyebrow', { defaultValue: 'Net earnings calculator' })}
        title={
          <Trans
            t={t}
            i18nKey="calculator.hero.title"
            defaults="What will you <em>actually</em> take home?"
            components={{ em: <Em /> }}
          />
        }
        lead={t('calculator.hero.lead', {
          defaultValue:
            'Compare selling your harvest alone at the mandi with a pooled sale through MandiMate — after rejection, transport, handling, commission and the wait for payment. Change any number; the answer updates instantly.',
        })}
      />

      <Section tone="ivory" spacing="compact" className="pt-10 md:pt-14">
        <NetCalculator />
      </Section>

      <Section tone="parchment" labelledBy="method-title" rule>
        <SectionHeader
          id="method-title"
          layout="split"
          eyebrow={t('calculator.method.eyebrow', { defaultValue: 'How the calculation works' })}
          title={
            <Trans
              t={t}
              i18nKey="calculator.method.title"
              defaults="Six lines between the price and your <em>pocket</em>."
              components={{ em: <Em /> }}
            />
          }
          lead={t('calculator.method.lead', {
            defaultValue:
              'Every figure comes from one published formula — the same one farmers see inside MandiMate. Where a real distance is unknown, we assume {{km}} km to the nearest mandi. Each line is rounded to the paisa and the net is their sum.',
            km: BASELINE_DISTANCE_KM,
          })}
        />
        <ol className="mt-14 grid gap-px border-y border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {METHOD.map((item, index) => (
            <li key={item.id} className="flex flex-col bg-parchment px-1 py-9 sm:px-8">
              <Numeral value={index + 1} className="text-[1.75rem] leading-none" />
              <h3 className="mt-6 font-display text-[1.5rem] font-bold leading-snug tracking-[-0.01em] text-ink">
                {t(`calculator.method.items.${item.id}.title`, { defaultValue: item.title })}
              </h3>
              <p className="mt-2.5 text-[14.5px] font-normal leading-relaxed text-ink-2">
                {t(`calculator.method.items.${item.id}.body`, { defaultValue: item.body, ...item.values })}
              </p>
            </li>
          ))}
        </ol>

        <div className="mt-16 overflow-x-auto border-y border-ink/60">
          <table className="w-full min-w-[32rem] text-start text-[14px]">
            <caption className="pb-4 pt-6 text-start">
              <span className="block font-display text-[1.5rem] font-bold text-ink">
                {t('calculator.vehicles.title', { defaultValue: 'Vehicle rates used for estimates' })}
              </span>
              <span className="mt-1 block text-[12.5px] text-muted">
                {t('calculator.vehicles.note', {
                  defaultValue: 'The smallest vehicle that fits the load is chosen; larger loads take more trips.',
                })}
              </span>
            </caption>
            <thead>
              <tr className="border-b border-line text-[13px] text-muted">
                <th scope="col" className="px-5 py-3 font-medium sm:px-7">
                  {t('calculator.vehicles.vehicle', { defaultValue: 'Vehicle' })}
                </th>
                <th scope="col" className="px-3 py-3 text-end font-medium">
                  {t('calculator.vehicles.capacity', { defaultValue: 'Capacity' })}
                </th>
                <th scope="col" className="px-3 py-3 text-end font-medium">
                  {t('calculator.vehicles.baseCharge', { defaultValue: 'Base charge' })}
                </th>
                <th scope="col" className="px-5 py-3 text-end font-medium sm:px-7">
                  {t('calculator.vehicles.perKm', { defaultValue: 'Per km' })}
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {VEHICLE_CLASSES.filter((vehicle) => !vehicle.refrigerated).map((vehicle) => (
                <tr key={vehicle.vehicle_type} className="border-t border-line/60">
                  <th scope="row" className="px-5 py-3 font-medium text-ink sm:px-7">
                    {t(`common:enums.vehicleType.${vehicle.vehicle_type}`, { defaultValue: vehicleLabel(vehicle.vehicle_type) })}
                  </th>
                  <td className="px-3 py-3 text-end text-muted">{formatKg(vehicle.capacity_kg)}</td>
                  <td className="px-3 py-3 text-end text-muted">{formatINR(vehicle.base_charge)}</td>
                  <td className="px-5 py-3 text-end text-muted sm:px-7">{formatINR(vehicle.per_km_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section tone="ivory" labelledBy="calc-faq-title">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-4">
            <SectionHeader
              id="calc-faq-title"
              eyebrow={t('calculator.faq.eyebrow', { defaultValue: 'Questions' })}
              title={
                <Trans
                  t={t}
                  i18nKey="calculator.faq.title"
                  defaults="Net earnings, <em>explained</em>."
                  components={{ em: <Em /> }}
                />
              }
            />
          </div>
          <dl className="flex flex-col lg:col-span-8">
            {FAQ.map((item, index) => (
              <div key={item.question} className="border-t border-line py-7 first:border-t-0 first:pt-0">
                <dt className="font-display text-[1.5rem] font-bold leading-snug tracking-[-0.01em] text-ink">
                  {t(`calculator.faq.items.${index}.question`, { defaultValue: item.question })}
                </dt>
                <dd className="mt-3 max-w-measure text-[15px] font-normal leading-relaxed text-ink-2">
                  {t(`calculator.faq.items.${index}.answer`, { defaultValue: item.answer })}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </Section>

      <CtaBand
        eyebrow={t('calculator.cta.eyebrow', { defaultValue: 'Ready when your harvest is' })}
        title={
          <Trans
            t={t}
            i18nKey="calculator.cta.title"
            defaults="Put real offers behind <em>these</em> numbers."
            components={{ em: <Em /> }}
          />
        }
        lead={t('calculator.cta.lead', {
          defaultValue:
            'List your harvest and MandiMate will look for neighbours to pool with, invite verified buyers and show your net for every offer — confirmed, estimated and open items clearly marked.',
        })}
        secondary={{ to: '/how-it-works', label: t('calculator.cta.secondary', { defaultValue: 'See how it works' }) }}
      />
    </>
  );
}
