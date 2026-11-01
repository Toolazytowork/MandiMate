import { Trans, useTranslation } from 'react-i18next';
import { CertaintyBadge, Money } from '@/components/domain';
import { Reveal } from '@/components/motion';
import { LINE_LABELS, LINE_ORDER } from '@/lib/netProceeds';
import type { Certainty } from '@/types/api';
import { ArrowLink, Em, IllustrativeNote, Section, SectionHeader } from '../primitives';
import { WORKED, linePerKg } from '../saleComparison';

const CERTAINTY_COPY: Record<Certainty, string> = {
  confirmed: 'Written into the buyer’s offer or recorded at delivery. It will not change.',
  estimated: 'Calculated from published rates and local averages. Shown, but clearly marked.',
  unresolved: 'Still open — a transport quote, an inspection, a consent. Never hidden in the total.',
};

/** "Net, not gross": the worked example as a per-kg ladder, plus the three certainty markers. */
export function NetNotGrossSection() {
  const { mandi, pooled } = WORKED;
  const { t } = useTranslation('marketingHome');
  const rows = LINE_ORDER.filter((key) => key !== 'gross' && (linePerKg(mandi, key) !== 0 || linePerKg(pooled, key) !== 0 || key === 'platform_fee'));

  return (
    <Section id="net-not-gross" tone="ivory" labelledBy="net-title">
      <div className="grid gap-14 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-5">
          <SectionHeader
            id="net-title"
            eyebrow={t('netNotGross.eyebrow', { defaultValue: 'Net, not gross' })}
            title={
              <Trans
                t={t}
                i18nKey="netNotGross.title"
                defaults="The best price is not always the best <em>deal</em>."
                components={{ em: <Em>{null}</Em> }}
              />
            }
            lead={t('netNotGross.lead', {
              defaultValue:
                'A farmer is paid the quoted price minus everything that happens on the way: produce rejected at the gate, the truck, loading and hamali, the agent’s commission, and the weeks of waiting for money. MandiMate puts every one of those on the screen, per kilogram, before the farmer decides.',
            })}
          />
          <ul className="mt-12 flex flex-col border-t border-line">
            {(Object.keys(CERTAINTY_COPY) as Certainty[]).map((certainty) => (
              <li key={certainty} className="flex flex-col items-start gap-2 border-b border-line py-5 sm:flex-row sm:gap-5">
                <CertaintyBadge certainty={certainty} className="sm:mt-0.5 sm:w-[7.5rem] sm:justify-center" />
                <p className="text-[14.5px] font-normal leading-relaxed text-ink-2">
                  {t(`netNotGross.certainty.${certainty}`, { defaultValue: CERTAINTY_COPY[certainty] })}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <Reveal className="lg:col-span-7">
          <div className="overflow-hidden rounded-card border border-line bg-paper">
            <table className="w-full text-start text-[14px]">
              <caption className="border-b border-line px-5 py-6 text-start sm:px-8">
                <span className="block font-display text-[1.5rem] font-bold tracking-[-0.01em] text-ink">
                  {t('netNotGross.tableTitle', { defaultValue: '400 kg of tomatoes, per kilogram' })}
                </span>
                <span className="mt-1.5 block text-[13px] font-semibold text-muted">
                  {t('netNotGross.tableSubtitle', { defaultValue: 'Worked example · illustrative inputs, published formula' })}
                </span>
              </caption>
              <thead>
                <tr className="text-[13px] text-muted">
                  <th scope="col" className="px-5 py-3 font-medium sm:px-7">
                    {t('netNotGross.colPerKg', { defaultValue: 'Per kg' })}
                  </th>
                  <th scope="col" className="px-3 py-3 text-end font-medium">
                    {t('netNotGross.colAlone', { defaultValue: 'Alone' })}
                  </th>
                  <th scope="col" className="bg-parchment/60 px-5 py-3 text-end font-medium text-gold-700 sm:px-7">
                    {t('netNotGross.colPooled', { defaultValue: 'Pooled' })}
                  </th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                <tr className="border-t border-line">
                  <th scope="row" className="px-5 py-3.5 font-medium text-ink sm:px-7">
                    {t('netNotGross.quotedPrice', { defaultValue: 'Quoted price' })}
                  </th>
                  <td className="px-3 py-3.5 text-end">
                    <Money value={mandi.gross_price_per_kg} perKg size="sm" tone="muted" />
                  </td>
                  <td className="bg-parchment/60 px-5 py-3.5 text-end sm:px-7">
                    <Money value={pooled.gross_price_per_kg} perKg size="sm" />
                  </td>
                </tr>
                {rows.map((key) => (
                  <tr key={key} className="border-t border-line/70">
                    <th scope="row" className="px-5 py-3 font-normal text-muted sm:px-7">
                      {t(`common:enums.breakdownKey.${key}`, { defaultValue: LINE_LABELS[key] })}
                    </th>
                    <td className="px-3 py-3 text-end">
                      <Money value={linePerKg(mandi, key)} perKg size="sm" tone="muted" />
                    </td>
                    <td className="bg-parchment/60 px-5 py-3 text-end sm:px-7">
                      <Money value={linePerKg(pooled, key)} perKg size="sm" />
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-ink/60">
                  <th scope="row" className="px-5 py-5 font-display text-[1.25rem] font-bold text-ink sm:px-7">
                    {t('netNotGross.takeHome', { defaultValue: 'You take home' })}
                  </th>
                  <td className="px-3 py-4 text-end">
                    <Money value={mandi.net_per_kg} perKg size="md" tone="muted" />
                  </td>
                  <td className="bg-parchment/60 px-5 py-4 text-end sm:px-7">
                    <Money value={pooled.net_per_kg} perKg size="lg" className="font-display font-bold text-ink" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <IllustrativeNote>
              {t('netNotGross.feeNote', {
                defaultValue: 'MandiMate charges buyers, not farmers: the MandiMate fee line is ₹0 for every farmer.',
              })}
            </IllustrativeNote>
            <ArrowLink to="/calculator">{t('netNotGross.calculatorLink', { defaultValue: 'Try your own numbers' })}</ArrowLink>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
