import { Trans, useTranslation } from 'react-i18next';
import { ArrowRight, CircleDollarSign, Clock, PackageCheck, Repeat, TriangleAlert, Truck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { LinkButton } from '@/components/ui';
import { Reveal } from '@/components/motion';
import { PageHero } from '@/components/marketing/PageHero';
import { PageSeo } from '@/components/marketing/PageSeo';
import { Em, IllustrativeNote, Numeral, Section, SectionHeader, Tag } from '@/components/marketing/primitives';
import { RoleChooserCta, StepRail } from '@/components/marketing/roles';

interface Metric {
  key: string;
  icon: LucideIcon;
  name: string;
  definition: string;
  how: string;
  primary?: boolean;
}

const METRICS: readonly Metric[] = [
  {
    key: 'netIncome',
    icon: CircleDollarSign,
    name: 'Additional net income per kg',
    definition: 'What a farmer took home per kilo through MandiMate, minus what a credible alternative — usually selling alone at the local mandi — would have paid after the same costs.',
    how: 'Settled sale records against a same-day mandi baseline, net of transport, commission, rejection and payment delay.',
    primary: true,
  },
  {
    key: 'sellThrough',
    icon: PackageCheck,
    name: 'Share of listed produce sold',
    definition: 'Kilos sold as a share of kilos listed.',
    how: 'Listings matched to delivered, accepted quantities.',
  },
  {
    key: 'timeToBuyer',
    icon: Clock,
    name: 'Time from listing to confirmed buyer',
    definition: 'Hours between a harvest being listed and a deal the farmer has consented to.',
    how: 'Timestamps from listing, offer and consent records.',
  },
  {
    key: 'transportCost',
    icon: Truck,
    name: 'Transport cost per kg',
    definition: 'What it cost to move each kilo, against hauling alone.',
    how: 'Accepted transporter quotes divided by delivered weight.',
  },
  {
    key: 'failures',
    icon: TriangleAlert,
    name: 'Payment delays, rejections & failed deals',
    definition: 'Days paid late, kilos rejected at inspection and deals that did not complete.',
    how: 'Settlement, quality and dispute records.',
  },
  {
    key: 'repeat',
    icon: Repeat,
    name: 'Repeat usage',
    definition: 'Farmers, buyers and transporters who come back for another season.',
    how: 'Returning participants across consecutive harvests.',
  },
];

const RISKS = [
  { key: 'buyers', risk: 'Not enough buyers', mitigation: 'Validate buyer demand before recruiting many farmers.' },
  { key: 'quality', risk: 'Quality is inconsistent', mitigation: 'Pool only produce that meets the agreed specification.' },
  { key: 'transport', risk: 'Transport eats the margin', mitigation: 'Calculate logistics before recommending any deal.' },
  { key: 'trust', risk: 'Farmers distrust the platform', mitigation: 'Show every fee and deduction, and keep the right to decline.' },
  { key: 'payment', risk: 'Buyers do not pay', mitigation: 'Verify counterparties, record payment terms, run a clear dispute process.' },
  { key: 'operations', risk: 'Operations cost too much', mitigation: 'Start with assisted coordination, measure cost per completed sale, automate later.' },
] as const;

const PILOT_SCOPE = [
  { key: 'location', label: 'Location', value: 'One village cluster' },
  { key: 'crop', label: 'Crop', value: 'One crop' },
  { key: 'buyers', label: 'Buyers', value: 'One buyer segment' },
  { key: 'problem', label: 'Problem', value: 'One measurable problem' },
  { key: 'workflow', label: 'Workflow', value: 'One complete workflow' },
] as const;

const PILOT_TARGETS = [
  { key: 'farmers', value: '10–20', label: 'farmers in the first cluster' },
  { key: 'buyers', value: 'A few', label: 'verified buyers' },
  { key: 'transporters', value: '1–2', label: 'transport partners' },
] as const;

const PHASES = [
  { key: 'prototype', title: 'Prototype', body: 'Listings, offers, lot grouping, net-return comparison, consent and a simulated deal confirmation.' },
  { key: 'pilot', title: 'Real pilot', body: 'Verified buyers, real transport quotes, field agents, quality checks, delivery confirmation and payment tracking.' },
  { key: 'growth', title: 'Growing business', body: 'More crops, repeat-order matching, demand insights, logistics planning, more languages and FPO partnerships.' },
  { key: 'scale', title: 'Scale', body: 'More districts and buyer categories, deeper analytics, and integrations with agri-commerce and logistics networks.' },
] as const;

const EMPHASIS = { em: <Em>{null}</Em> };

export default function ImpactPage() {
  const { t } = useTranslation('marketingInfo');
  const metricName = (metric: Metric) => t(`impact.metrics.items.${metric.key}.name`, { defaultValue: metric.name });
  const metricDefinition = (metric: Metric) => t(`impact.metrics.items.${metric.key}.definition`, { defaultValue: metric.definition });
  const metricHow = (metric: Metric) => t(`impact.metrics.items.${metric.key}.how`, { defaultValue: metric.how });

  return (
    <>
      <PageSeo path="/impact" crumb="Impact" />

      <PageHero
        crumb={t('impact.crumb', { defaultValue: 'Impact' })}
        tone="light"
        eyebrow={t('impact.hero.eyebrow', { defaultValue: 'Impact' })}
        title={<Trans t={t} i18nKey="impact.hero.title" defaults="We will prove it <em>in rupees per kilo.</em>" components={EMPHASIS} />}
        lead={t('impact.hero.lead', {
          defaultValue:
            'MandiMate exists to raise what farmers take home. So we measure exactly that — net income against a credible alternative, from real transaction records — and publish what we find, including when it does not work.',
        })}
        actions={
          <>
            <LinkButton to="/signup?role=farmer" trailingIcon={<ArrowRight strokeWidth={1.25} aria-hidden="true" />}>
              {t('impact.hero.join', { defaultValue: 'Join the pilot' })}
            </LinkButton>
            <LinkButton to="/contact" variant="secondary">
              {t('impact.hero.partner', { defaultValue: 'Partner with us' })}
            </LinkButton>
          </>
        }
        footnote={<Tag tone="neutral">{t('impact.hero.footnote', { defaultValue: 'Pilot targets, not results' })}</Tag>}
      />

      <Section labelledBy="metrics-title">
        <SectionHeader
          id="metrics-title"
          layout="split"
          eyebrow={t('impact.metrics.eyebrow', { defaultValue: 'Metrics framework' })}
          title={<Trans t={t} i18nKey="impact.metrics.title" defaults="Six numbers that <em>keep us honest.</em>" components={EMPHASIS} />}
          lead={t('impact.metrics.lead', {
            defaultValue:
              'One question leads: did the farmer earn more? The other five tell us whether that gain is real, repeatable and worth the cost of delivering it.',
          })}
        />
        {METRICS.filter((metric) => metric.primary).map((metric) => {
          const Icon = metric.icon;
          return (
            <Reveal
              key={metric.key}
              className="surface-dark relative isolate mt-14 grid gap-8 overflow-hidden rounded-panel bg-forest-900 p-7 text-ivory sm:p-12 md:mt-20 lg:grid-cols-12 lg:gap-12"
            >
              <div className="flex flex-col gap-6 lg:col-span-7">
                <div className="flex items-center gap-3">
                  <Icon aria-hidden="true" strokeWidth={1.25} className="size-5 text-gold-400" />
                  <Tag tone="glass">{t('impact.metrics.northStar', { defaultValue: 'North star' })}</Tag>
                </div>
                <h3 className="font-display font-bold text-[2rem] leading-[1.06] tracking-[-0.02em] sm:text-display-sm">{metricName(metric)}</h3>
                <p className="max-w-measure text-[17px] font-normal leading-relaxed text-ivory/72">{metricDefinition(metric)}</p>
              </div>
              <div className="flex flex-col justify-end gap-4 border-t border-white/12 pt-6 lg:col-span-5 lg:border-s lg:border-t-0 lg:ps-12 lg:pt-0">
                <p className="eyebrow">{t('impact.metrics.measuredFrom', { defaultValue: 'Measured from' })}</p>
                <p className="text-[15px] leading-relaxed text-ivory/72">{metricHow(metric)}</p>
                <p className="font-display text-xl not-italic text-gold-400">
                  {t('impact.metrics.unit', { defaultValue: '₹ per kg, after every cost' })}
                </p>
              </div>
            </Reveal>
          );
        })}
        <ol className="mt-6 border-t border-line">
          {METRICS.filter((metric) => !metric.primary).map((metric, index) => {
            const Icon = metric.icon;
            return (
              <Reveal
                as="li"
                key={metric.key}
                delay={index * 0.04}
                className="grid gap-4 border-b border-line py-7 md:grid-cols-12 md:gap-8 md:py-8"
              >
                <div className="flex items-start gap-4 md:col-span-5">
                  <Numeral value={index + 2} className="w-8 shrink-0 text-xl leading-tight" />
                  <h3 className="font-display text-xl leading-snug tracking-[-0.01em]">{metricName(metric)}</h3>
                </div>
                <p className="ps-12 text-[15px] font-normal leading-relaxed text-ink-2 md:col-span-4 md:ps-0">{metricDefinition(metric)}</p>
                <p className="flex items-start gap-2.5 ps-12 text-[13px] font-normal leading-relaxed text-ink-2 md:col-span-3 md:ps-0">
                  <Icon aria-hidden="true" strokeWidth={1.25} className="mt-0.5 size-4 shrink-0 text-gold-700" />
                  <span>
                    <span className="sr-only">{t('impact.metrics.measuredFromLabel', { defaultValue: 'Measured from: ' })}</span>
                    {metricHow(metric)}
                  </span>
                </p>
              </Reveal>
            );
          })}
        </ol>
        <IllustrativeNote className="mt-8">
          {t('impact.metrics.note', {
            defaultValue:
              'Every metric is computed from recorded transactions — listings, offers, consent, weights, inspections and payments — never from estimates alone.',
          })}
        </IllustrativeNote>
      </Section>

      <Section tone="dark" labelledBy="pilot-title">
        <SectionHeader
          id="pilot-title"
          layout="split"
          eyebrow={t('impact.pilot.eyebrow', { defaultValue: 'Pilot plan' })}
          title={<Trans t={t} i18nKey="impact.pilot.title" defaults="Start small enough to <em>see clearly.</em>" components={EMPHASIS} />}
          lead={t('impact.pilot.lead', {
            defaultValue: 'A narrow pilot makes the evidence trustworthy. We begin with one of everything, and widen only when the numbers hold.',
          })}
        />
        <dl className="mt-14 grid grid-cols-2 border-y border-(--hairline) sm:grid-cols-3 lg:grid-cols-5 md:mt-20">
          {PILOT_SCOPE.map((item) => (
            <div key={item.key} className="flex flex-col-reverse gap-2 border-(--hairline) px-4 py-7 first:ps-0 lg:border-e lg:last:border-e-0">
              <dt className="text-[12px] text-ivory/50">{t(`impact.pilot.scope.${item.key}.label`, { defaultValue: item.label })}</dt>
              <dd className="font-display text-xl leading-snug">{t(`impact.pilot.scope.${item.key}.value`, { defaultValue: item.value })}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-16 grid border-y border-white/10 md:grid-cols-3">
          {PILOT_TARGETS.map((item) => (
            <div key={item.key} className="border-b border-white/10 py-8 md:border-b-0 md:border-s md:px-8 md:first:border-s-0 md:first:ps-0">
              <p className="font-display text-[2.75rem] font-bold leading-none tracking-[-0.03em] text-ivory">
                {t(`impact.pilot.targets.${item.key}.value`, { defaultValue: item.value })}
              </p>
              <p className="mt-4 text-[13px] font-semibold text-ivory/60">
                {t(`impact.pilot.targets.${item.key}.label`, { defaultValue: item.label })}
              </p>
            </div>
          ))}
        </div>
        <IllustrativeNote className="mt-8">
          {t('impact.pilot.note', { defaultValue: 'These are pilot targets, not claims of current scale.' })}
        </IllustrativeNote>
      </Section>

      <Section labelledBy="phases-title">
        <SectionHeader
          id="phases-title"
          layout="split"
          eyebrow={t('impact.phases.eyebrow', { defaultValue: 'Phases' })}
          title={<Trans t={t} i18nKey="impact.phases.title" defaults="Earn the right to <em>grow.</em>" components={EMPHASIS} />}
          lead={t('impact.phases.lead', { defaultValue: 'Each phase begins only when the one before it shows farmers are better off.' })}
        />
        <StepRail
          className="mt-14 md:mt-20"
          steps={PHASES.map((phase) => ({
            title: t(`impact.phases.steps.${phase.key}.title`, { defaultValue: phase.title }),
            body: t(`impact.phases.steps.${phase.key}.body`, { defaultValue: phase.body }),
          }))}
        />
      </Section>

      <Section tone="parchment" labelledBy="risks-title" rule>
        <SectionHeader
          id="risks-title"
          layout="split"
          eyebrow={t('impact.risks.eyebrow', { defaultValue: 'Risks & mitigations' })}
          title={
            <Trans t={t} i18nKey="impact.risks.title" defaults="What could go wrong, <em>and what we do about it.</em>" components={EMPHASIS} />
          }
          lead={t('impact.risks.lead', {
            defaultValue: 'Naming the risks is part of the plan. Each one has a guardrail built into how MandiMate works.',
          })}
        />
        <div className="mt-14 border-y border-ink/60 md:mt-20">
          <table className="w-full text-start">
            <caption className="sr-only">{t('impact.risks.caption', { defaultValue: 'Risks and how MandiMate mitigates them' })}</caption>
            <thead className="hidden border-b border-line md:table-header-group">
              <tr>
                <th scope="col" className="w-[38%] px-7 py-4 text-[13px] font-semibold text-muted">
                  {t('impact.risks.riskHeader', { defaultValue: 'Risk' })}
                </th>
                <th scope="col" className="px-7 py-4 text-[13px] font-semibold text-muted">
                  {t('impact.risks.mitigationHeader', { defaultValue: 'Mitigation' })}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {RISKS.map((row, index) => (
                <tr key={row.key} className="flex flex-col md:table-row">
                  <th scope="row" className="flex items-baseline gap-4 px-0 pt-6 font-display text-xl font-bold leading-snug md:table-cell md:px-7 md:py-7">
                    <Numeral value={index + 1} className="me-4 text-base" />
                    {t(`impact.risks.items.${row.key}.risk`, { defaultValue: row.risk })}
                  </th>
                  <td className="px-0 pb-6 pt-2 text-[15px] font-normal leading-relaxed text-ink-2 md:px-7 md:py-7">
                    {t(`impact.risks.items.${row.key}.mitigation`, { defaultValue: row.mitigation })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section labelledBy="publish-title" spacing="compact">
        <div className="mx-auto max-w-3xl text-center">
          <SectionHeader
            id="publish-title"
            layout="center"
            eyebrow={t('impact.publish.eyebrow', { defaultValue: 'Our commitment' })}
            title={<Trans t={t} i18nKey="impact.publish.title" defaults="We will publish the results — <em>good or bad.</em>" components={EMPHASIS} />}
            lead={t('impact.publish.lead', {
              defaultValue:
                'At the end of the pilot we will share net uplift per kg, sell-through, transport cost, payment delays and repeat usage, with the method behind each. If farmers did not earn more, you will read that here too.',
            })}
          />
        </div>
      </Section>

      <RoleChooserCta
        id="impact-cta"
        eyebrow={t('impact.cta.eyebrow', { defaultValue: 'Be part of the evidence' })}
        title={<Trans t={t} i18nKey="impact.cta.title" defaults="Help us prove it <em>works.</em>" components={EMPHASIS} />}
        lead={t('impact.cta.lead', { defaultValue: 'Farmers, buyers, transporters and FPOs in our pilot cluster can join today.' })}
      />
    </>
  );
}
