import { Trans, useTranslation } from 'react-i18next';
import { Reveal } from '@/components/motion';
import { ArrowLink, Em, Numeral, Section, SectionHeader, Tag } from '../primitives';

const METRICS: readonly { title: string; detail: string }[] = [
  {
    title: 'Additional net income per kg',
    detail: 'Against a credible alternative — what the same farmer would have netted selling alone that week.',
  },
  { title: 'Share of listed produce sold', detail: 'How much of what farmers list actually finds a buyer before its sell-by date.' },
  { title: 'Time to a confirmed buyer', detail: 'From the moment a harvest is listed to a deal every farmer has accepted.' },
  { title: 'Transport cost per kg', detail: 'What consolidated pickup really costs, from quotes and delivered weights.' },
  {
    title: 'Delays, rejections, failures',
    detail: 'Late payments, rejected produce and transactions that fell through — recorded, not hidden.',
  },
  { title: 'Repeat usage', detail: 'Whether farmers and buyers come back for the next harvest.' },
];

const PILOT = [
  ['1', 'village cluster', 'cluster'],
  ['1', 'crop', 'crop'],
  ['10–20', 'farmers', 'farmers'],
  ['1–2', 'transport partners', 'transport'],
] as const;

/** What the pilot will measure — targets to test, not traction to claim. */
export function ProveSection() {
  const { t } = useTranslation('marketingHome');
  return (
    <Section id="prove" tone="ivory" labelledBy="prove-title" rule>
      <div className="grid gap-14 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-5">
          <div className="lg:sticky lg:top-28">
            <SectionHeader
              id="prove-title"
              eyebrow={t('prove.eyebrow', { defaultValue: 'What we will prove' })}
              title={
                <Trans
                  t={t}
                  i18nKey="prove.title"
                  defaults="We will publish the <em>results</em>, not the promises."
                  components={{ em: <Em>{null}</Em> }}
                />
              }
              lead={t('prove.lead', {
                defaultValue:
                  'MandiMate starts small on purpose: one location, one crop, one buyer segment and one complete workflow. Success means one thing — farmers measurably earning more. These are the numbers we will track and share.',
              })}
            />
            <div className="mt-12 rounded-card border border-line bg-paper p-6 sm:p-8">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] font-semibold text-ink">{t('prove.pilotTitle', { defaultValue: 'First pilot' })}</p>
                <Tag tone="neutral">{t('prove.pilotTag', { defaultValue: 'Targets, not claims' })}</Tag>
              </div>
              <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-6 border-t border-line pt-6">
                {PILOT.map(([value, label, key]) => (
                  <div key={key} className="flex flex-col-reverse">
                    <dt className="mt-2 text-[13px] font-semibold text-muted">
                      {t(`prove.pilot.${key}`, { defaultValue: label })}
                    </dt>
                    <dd className="font-display text-[2.25rem] font-bold leading-none tracking-[-0.02em] text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <ArrowLink to="/impact" className="mt-8">
              {t('prove.impactLink', { defaultValue: 'How we measure impact' })}
            </ArrowLink>
          </div>
        </div>

        <ol className="flex flex-col lg:col-span-7">
          {METRICS.map((metric, index) => (
            <Reveal
              as="li"
              key={metric.title}
              delay={(index % 3) * 0.06}
              className="grid grid-cols-[3rem_1fr] gap-4 border-t border-line py-7 first:border-t-0 first:pt-0 sm:grid-cols-[4.5rem_1fr_auto] sm:items-baseline"
            >
              <Numeral value={index + 1} className="text-[1.75rem] leading-none" />
              <div>
                <h3 className="font-display text-[1.5rem] font-bold leading-snug tracking-[-0.01em] text-ink">
                  {t(`prove.metrics.${index}.title`, { defaultValue: metric.title })}
                </h3>
                <p className="mt-2 max-w-measure text-[14.5px] font-normal leading-relaxed text-ink-2">
                  {t(`prove.metrics.${index}.detail`, { defaultValue: metric.detail })}
                </p>
              </div>
              <Tag tone="gold" className="col-start-2 justify-self-start sm:col-start-auto">
                {t('prove.toBeMeasured', { defaultValue: 'To be measured' })}
              </Tag>
            </Reveal>
          ))}
        </ol>
      </div>
    </Section>
  );
}
