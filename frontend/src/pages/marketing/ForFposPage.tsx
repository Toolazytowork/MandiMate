import { Trans, useTranslation } from 'react-i18next';
import { ArrowRight, BarChart3, Boxes, ClipboardCheck, FileSpreadsheet, Gavel, Mic, Sprout, UserPlus, Users } from 'lucide-react';
import { LinkButton } from '@/components/ui';
import { PoolingMotif } from '@/components/art';
import { PageHero } from '@/components/marketing/PageHero';
import { PageSeo } from '@/components/marketing/PageSeo';
import { IllustrativeNote, Section, SectionHeader } from '@/components/marketing/primitives';
import {
  Chapter,
  ClosingCta,
  FaqSection,
  FeatureGrid,
  FpoLedgerCard,
  StepRail,
  VisualFrame,
  type RoleFaq,
} from '@/components/marketing/roles';
import { RoleEm } from '@/components/marketing/roles/RoleSections';
import { faqPage } from '@/lib/seo';

/** English source for the FAQ (also used, untranslated, for FAQPage JSON-LD). */
const FAQ: readonly (RoleFaq & { id: string })[] = [
  {
    id: 'assisted',
    question: 'Can coordinators list on behalf of farmers?',
    answer:
      'Yes. Assisted onboarding is built in: a coordinator can register farmers, record harvests by voice, explain offers and capture consent — while each farmer keeps the final say on every sale.',
  },
  {
    id: 'buyers',
    question: 'Does MandiMate replace our FPO’s buyer relationships?',
    answer:
      'No. Bring your own buyers and use MandiMate to run aggregation, records and settlement. Verified buyers on the platform are an addition, not a replacement.',
  },
  {
    id: 'subscription',
    question: 'What does an FPO subscription include?',
    answer:
      'Aggregation tools, buyer management, records and settlement tracking for your members. See the pricing page for pilot tiers, which are subject to validation.',
  },
];

export default function ForFposPage() {
  const { t } = useTranslation('marketingRoles');
  const em = { em: <RoleEm /> };
  const faq = FAQ.map((item) => ({
    question: t(`fpos.faq.${item.id}.question`, { defaultValue: item.question }),
    answer: t(`fpos.faq.${item.id}.answer`, { defaultValue: item.answer }),
  }));

  return (
    <>
      <PageSeo path="/fpos" crumb="For FPOs" jsonLd={[faqPage(FAQ)]} />

      <PageHero
        crumb={t('fpos.hero.crumb', { defaultValue: 'For FPOs' })}
        eyebrow={t('fpos.hero.eyebrow', { defaultValue: 'For FPOs & field coordinators' })}
        title={<Trans t={t} i18nKey="fpos.hero.title" defaults="Run aggregation like a <em>well-kept ledger.</em>" components={em} />}
        lead={t('fpos.hero.lead', {
          defaultValue:
            'Onboard members, verify harvests, build lots to buyer specifications and settle every rupee on record — with the people your farmers already trust at the centre.',
        })}
        actions={
          <>
            <LinkButton to="/signup?role=coordinator" variant="inverse" size="lg" trailingIcon={<ArrowRight strokeWidth={1.25} aria-hidden="true" />}>
              {t('fpos.hero.primary', { defaultValue: 'Set up your cluster' })}
            </LinkButton>
            <LinkButton to="/pricing" variant="glass" size="lg">
              {t('fpos.hero.secondary', { defaultValue: 'FPO plans' })}
            </LinkButton>
          </>
        }
        footnote={
          <p className="text-[13px] font-semibold text-ivory/55">
            {t('fpos.hero.footnote', { defaultValue: 'Built for assisted use. Farmers keep the final say on every sale.' })}
          </p>
        }
        aside={<FpoLedgerCard />}
      />

      <Chapter
        id="onboarding"
        eyebrow={t('fpos.onboarding.eyebrow', { defaultValue: 'Assisted onboarding' })}
        title={
          <Trans t={t} i18nKey="fpos.onboarding.title" defaults="Meet farmers where they are — <em>in their language.</em>" components={em} />
        }
        lead={t('fpos.onboarding.lead', {
          defaultValue:
            'Register members in the field, record harvests by voice in Telugu, Hindi, Kannada or Urdu, and explain each offer in plain words. Consent is captured from the farmer, with you beside them.',
        })}
        points={[
          t('fpos.onboarding.points.register', { defaultValue: 'Register farmers and their plots in minutes' }),
          t('fpos.onboarding.points.voice', { defaultValue: 'Voice and photo-assisted harvest listing on their behalf' }),
          t('fpos.onboarding.points.consent', { defaultValue: 'Consent recorded with time and terms, never assumed' }),
        ]}
        visual={
          <VisualFrame label={t('fpos.onboarding.card.label', { defaultValue: 'Assisted listing · field visit' })}>
            <ul className="divide-y divide-line/70">
              {[
                {
                  icon: UserPlus,
                  title: t('fpos.onboarding.card.registered.title', { defaultValue: 'Lakshmi R. registered' }),
                  meta: t('fpos.onboarding.card.registered.meta', { defaultValue: 'Kothapalli · 1.5 acres · tomato' }),
                },
                {
                  icon: Mic,
                  title: t('fpos.onboarding.card.voice.title', { defaultValue: 'Harvest recorded by voice' }),
                  meta: t('fpos.onboarding.card.voice.meta', { defaultValue: '350 kg · ready Thu · Telugu' }),
                },
                {
                  icon: ClipboardCheck,
                  title: t('fpos.onboarding.card.verified.title', { defaultValue: 'Readiness verified' }),
                  meta: t('fpos.onboarding.card.verified.meta', { defaultValue: 'Field visit · photos attached' }),
                },
              ].map(({ icon: Icon, title, meta }) => (
                <li key={title} className="flex items-center gap-3.5 py-3.5">
                  <Icon aria-hidden="true" strokeWidth={1.25} className="size-4 shrink-0 text-muted" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{title}</p>
                    <p className="truncate text-[12.5px] text-muted">{meta}</p>
                  </div>
                </li>
              ))}
            </ul>
          </VisualFrame>
        }
      />

      <Section tone="dark" labelledBy="lot-builder-title">
        <div className="grid gap-12 lg:grid-cols-12 lg:items-center lg:gap-16">
          <div className="flex flex-col gap-8 lg:col-span-6">
            <SectionHeader
              id="lot-builder-title"
              eyebrow={t('fpos.lotBuilder.eyebrow', { defaultValue: 'Lot builder' })}
              title={<Trans t={t} i18nKey="fpos.lotBuilder.title" defaults="Small harvests, <em>serious lots.</em>" components={em} />}
              lead={t('fpos.lotBuilder.lead', {
                defaultValue:
                  'MandiMate suggests compatible harvests by crop, grade, location, quantity and timing, and explains why they fit. You check, adjust and confirm — rules decide compatibility, people decide trust.',
              })}
            />
            <IllustrativeNote>
              {t('fpos.lotBuilder.note', {
                defaultValue: 'AI explains a match and flags what is missing. It never silently combines incompatible produce or invents supply.',
              })}
            </IllustrativeNote>
          </div>
          <div className="lg:col-span-6">
            <PoolingMotif className="mx-auto aspect-square w-full max-w-md" />
          </div>
        </div>
      </Section>

      <Section labelledBy="fpo-features-title">
        <SectionHeader
          id="fpo-features-title"
          layout="split"
          eyebrow={t('fpos.settlements.eyebrow', { defaultValue: 'Settlements & insights' })}
          title={
            <Trans t={t} i18nKey="fpos.settlements.title" defaults="Every member paid, <em>every rupee explained.</em>" components={em} />
          }
          lead={t('fpos.settlements.lead', {
            defaultValue:
              'Settle buyer payments across many members without a spreadsheet, and learn from each season what actually raised their earnings.',
          })}
        />
        <FeatureGrid
          className="mt-14 md:mt-20"
          features={[
            {
              icon: FileSpreadsheet,
              title: t('fpos.settlements.features.records.title', { defaultValue: 'Settlement records' }),
              body: t('fpos.settlements.features.records.body', {
                defaultValue: 'Per-farmer shares, deductions and payouts reconciled against accepted quantities.',
              }),
            },
            {
              icon: Users,
              title: t('fpos.settlements.features.buyers.title', { defaultValue: 'Buyer management' }),
              body: t('fpos.settlements.features.buyers.body', {
                defaultValue: 'Your buyers and verified platform buyers, with terms and payment history.',
              }),
            },
            {
              icon: Gavel,
              title: t('fpos.settlements.features.disputes.title', { defaultValue: 'Disputes & audit trail' }),
              body: t('fpos.settlements.features.disputes.body', {
                defaultValue: 'Rejections, shortages and payment issues resolved on record.',
              }),
            },
            {
              icon: BarChart3,
              title: t('fpos.settlements.features.insights.title', { defaultValue: 'Earnings insights' }),
              body: t('fpos.settlements.features.insights.body', {
                defaultValue: 'Net uplift per kg against the local mandi, sell-through and payment delays, by crop and season.',
              }),
            },
            {
              icon: Boxes,
              title: t('fpos.settlements.features.collection.title', { defaultValue: 'Collection planning' }),
              body: t('fpos.settlements.features.collection.body', {
                defaultValue: 'Collection points, pickup sequence and vehicle capacity planned with transporters.',
              }),
            },
            {
              icon: Sprout,
              title: t('fpos.settlements.features.memory.title', { defaultValue: 'Season memory' }),
              body: t('fpos.settlements.features.memory.body', {
                defaultValue: 'Recurring buyer requirements and surplus periods, so you plan the next harvest earlier.',
              }),
            },
          ]}
        />
      </Section>

      <Section tone="parchment" labelledBy="fpo-steps-title">
        <SectionHeader
          id="fpo-steps-title"
          layout="split"
          eyebrow={t('fpos.week.eyebrow', { defaultValue: 'A coordinator’s week' })}
          title={<Trans t={t} i18nKey="fpos.week.title" defaults="One desk for the <em>whole cluster.</em>" components={em} />}
          lead={t('fpos.week.lead', { defaultValue: 'The work you already do, in one place, with a record that holds up.' })}
        />
        <StepRail
          className="mt-14 md:mt-20"
          steps={[
            {
              title: t('fpos.week.steps.onboard.title', { defaultValue: 'Onboard and verify' }),
              body: t('fpos.week.steps.onboard.body', { defaultValue: 'Register farmers, confirm plots and record harvests with them.' }),
            },
            {
              title: t('fpos.week.steps.build.title', { defaultValue: 'Build lots' }),
              body: t('fpos.week.steps.build.body', { defaultValue: 'Group compatible harvests to a buyer’s specification.' }),
            },
            {
              title: t('fpos.week.steps.consent.title', { defaultValue: 'Explain and consent' }),
              body: t('fpos.week.steps.consent.body', {
                defaultValue: 'Walk each farmer through their net outcome; capture their yes or no.',
              }),
            },
            {
              title: t('fpos.week.steps.dispatch.title', { defaultValue: 'Inspect and dispatch' }),
              body: t('fpos.week.steps.dispatch.body', {
                defaultValue: 'Quality checks at collection, then a planned, consolidated pickup.',
              }),
            },
            {
              title: t('fpos.week.steps.settle.title', { defaultValue: 'Settle' }),
              body: t('fpos.week.steps.settle.body', {
                defaultValue: 'Reconcile payment against accepted quantities and pay each member.',
              }),
            },
            {
              title: t('fpos.week.steps.learn.title', { defaultValue: 'Learn' }),
              body: t('fpos.week.steps.learn.body', { defaultValue: 'See which deals beat the mandi, and by how much, after every cost.' }),
            },
          ]}
        />
      </Section>

      <FaqSection id="fpo-faq" title={t('fpos.faq.title', { defaultValue: 'Questions from FPOs' })} items={faq} />

      <ClosingCta
        role="coordinator"
        title={<Trans t={t} i18nKey="fpos.cta.title" defaults="Bring your cluster to a <em>single ledger.</em>" components={em} />}
        lead={t('fpos.cta.lead', {
          defaultValue: 'We are piloting with one village cluster and one crop. If your FPO wants to be part of it, start here.',
        })}
        primaryLabel={t('fpos.cta.primary', { defaultValue: 'Join as a coordinator' })}
        secondary={{ label: t('fpos.cta.secondary', { defaultValue: 'Talk to us' }), to: '/contact' }}
      />
    </>
  );
}
