import { Trans, useTranslation } from 'react-i18next';
import { Check, Minus } from 'lucide-react';
import { Reveal } from '@/components/motion';
import { Em, Section, SectionHeader } from '../primitives';

const ROWS: readonly (readonly [string, string])[] = [
  ['Shows buyers and sellers', 'Coordinates a complete transaction'],
  ['Lists prices', 'Calculates estimated net proceeds for each farmer'],
  ['Treats each listing separately', 'Finds compatible lots across farmers'],
  ['Leaves transport to the user', 'Coordinates consolidated pickup on one route'],
  ['Stops at buyer discovery', 'Tracks delivery, deductions and settlement'],
  ['Generic recommendations', 'Explains why a particular deal is better or worse'],
];

/** Typical marketplace versus MandiMate, from the product brief. */
export function DifferenceSection() {
  const { t } = useTranslation('marketingHome');
  return (
    <Section id="difference" tone="ivory" labelledBy="difference-title">
      <SectionHeader
        id="difference-title"
        layout="center"
        eyebrow={t('difference.eyebrow', { defaultValue: 'Not another listing app' })}
        title={
          <Trans
            t={t}
            i18nKey="difference.title"
            defaults="A marketplace finds a buyer. MandiMate finishes the <em>deal</em>."
            components={{ em: <Em>{null}</Em> }}
          />
        }
        lead={t('difference.lead', {
          defaultValue:
            'Discovery is the easy part. The money is won or lost in what comes after — pooling, transport, quality and getting paid.',
        })}
      />
      <Reveal className="mx-auto mt-16 max-w-4xl">
        <div className="border-y border-ink/60">
          <table className="w-full table-fixed text-start">
            <caption className="sr-only">
              {t('difference.caption', { defaultValue: 'How MandiMate differs from a typical agricultural marketplace' })}
            </caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="px-4 py-4 text-[13px] font-semibold text-muted sm:px-8">
                  {t('difference.colTypical', { defaultValue: 'Typical marketplace' })}
                </th>
                <th
                  scope="col"
                  className="border-s border-line px-4 py-4 text-[13px] font-semibold text-gold-700 sm:px-8"
                >
                  MandiMate
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([typical, mandimate], index) => (
                <tr key={typical} className="border-t border-line">
                  <td className="px-4 py-5 align-top text-[14px] font-normal leading-snug text-muted sm:px-8 sm:py-6 sm:text-[15px]">
                    <span className="flex items-start gap-2.5">
                      <Minus aria-hidden="true" strokeWidth={1.25} className="mt-0.5 size-4 shrink-0 text-ink/25" />
                      {t(`difference.rows.${index}.typical`, { defaultValue: typical })}
                    </span>
                  </td>
                  <td className="border-s border-line px-4 py-5 align-top text-[14px] leading-snug text-ink sm:px-8 sm:py-6 sm:text-[15px]">
                    <span className="flex items-start gap-2.5">
                      <Check aria-hidden="true" strokeWidth={1.25} className="mt-0.5 size-4 shrink-0 text-gold-700" />
                      {t(`difference.rows.${index}.mandimate`, { defaultValue: mandimate })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>
    </Section>
  );
}
