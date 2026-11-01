import { Trans, useTranslation } from 'react-i18next';
import { ArrowRight, BadgeCheck, CalendarClock, ClipboardList, FileCheck2, Gauge, Handshake, Layers, MessagesSquare, Receipt, ShieldCheck } from 'lucide-react';
import { LinkButton } from '@/components/ui';
import { PageHero } from '@/components/marketing/PageHero';
import { PageSeo } from '@/components/marketing/PageSeo';
import { Section, SectionHeader } from '@/components/marketing/primitives';
import {
  Chapter,
  ClosingCta,
  FactStrip,
  FaqSection,
  FeatureGrid,
  LotSpecCard,
  QualityRecordCard,
  StepRail,
  VisualFrame,
  type RoleFaq,
} from '@/components/marketing/roles';
import { RoleEm } from '@/components/marketing/roles/RoleSections';
import { faqPage } from '@/lib/seo';

/** English source for the FAQ (also used, untranslated, for FAQPage JSON-LD). */
const FAQ: readonly (RoleFaq & { id: string })[] = [
  {
    id: 'fees',
    question: 'What does MandiMate charge buyers?',
    answer:
      'A coordination fee per successfully sourced lot, shown in your offer before you commit. There is no fee for posting requirements or browsing supply. Pilot pricing is subject to validation.',
  },
  {
    id: 'quality',
    question: 'How do you keep quality consistent across many small farms?',
    answer:
      'Lots are pooled only from produce that meets the specification you agreed — size, colour, defect tolerance. Produce is inspected at collection and again at delivery, and the results are recorded against each farmer’s share.',
  },
  {
    id: 'verification',
    question: 'Who verifies the supply?',
    answer:
      'Field coordinators and FPO partners confirm farmers, quantities and readiness before a lot is offered. Supply is never invented or silently combined to fill an order.',
  },
  {
    id: 'negotiate',
    question: 'Can I negotiate?',
    answer:
      'Yes. You can offer, counter and agree terms — price, quantity, quality standards, pickup and payment conditions — in one thread. Farmers in the lot consent before a deal is confirmed.',
  },
];

export default function ForBuyersPage() {
  const { t } = useTranslation('marketingRoles');
  const em = { em: <RoleEm /> };
  const faq = FAQ.map((item) => ({
    question: t(`buyers.faq.${item.id}.question`, { defaultValue: item.question }),
    answer: t(`buyers.faq.${item.id}.answer`, { defaultValue: item.answer }),
  }));

  return (
    <>
      <PageSeo path="/buyers" crumb="For buyers" jsonLd={[faqPage(FAQ)]} />

      <PageHero
        crumb={t('buyers.hero.crumb', { defaultValue: 'For buyers' })}
        eyebrow={t('buyers.hero.eyebrow', { defaultValue: 'For buyers' })}
        title={<Trans t={t} i18nKey="buyers.hero.title" defaults="Farm-gate supply, <em>buyer-ready</em> quality." components={em} />}
        lead={t('buyers.hero.lead', {
          defaultValue:
            'Retailers, wholesalers, processors and kitchens source graded produce from coordinated farmer groups — one specification, one delivery, one record of what arrived and what you paid.',
        })}
        actions={
          <>
            <LinkButton to="/signup?role=buyer" variant="inverse" size="lg" trailingIcon={<ArrowRight strokeWidth={1.25} aria-hidden="true" />}>
              {t('buyers.hero.primary', { defaultValue: 'Start sourcing' })}
            </LinkButton>
            <LinkButton to="/contact" variant="glass" size="lg">
              {t('buyers.hero.secondary', { defaultValue: 'Talk to our team' })}
            </LinkButton>
          </>
        }
        footnote={
          <p className="text-[13px] font-semibold text-ivory/55">
            {t('buyers.hero.footnote', {
              defaultValue: 'No fee to post requirements. Pay a coordination fee only on lots you actually source.',
            })}
          </p>
        }
        aside={<LotSpecCard />}
      />

      <Section spacing="compact">
        <FactStrip
          facts={[
            {
              value: t('buyers.facts.specValue', { defaultValue: '1 spec' }),
              label: t('buyers.facts.spec', { defaultValue: 'agreed before any produce is pooled' }),
            },
            {
              value: t('buyers.facts.checksValue', { defaultValue: '2 checks' }),
              label: t('buyers.facts.checks', { defaultValue: 'at collection and at your dock' }),
            },
            {
              value: t('buyers.facts.threadValue', { defaultValue: '1 thread' }),
              label: t('buyers.facts.thread', { defaultValue: 'for offers, counters and terms' }),
            },
            {
              value: t('buyers.facts.recordValue', { defaultValue: '1 record' }),
              label: t('buyers.facts.record', { defaultValue: 'of delivery, quality and settlement' }),
            },
          ]}
        />
      </Section>

      <Chapter
        id="lots"
        tone="parchment"
        eyebrow={t('buyers.lots.eyebrow', { defaultValue: 'Consistent-quality lots' })}
        title={<Trans t={t} i18nKey="buyers.lots.title" defaults="Many small farms. <em>One standard.</em>" components={em} />}
        lead={t('buyers.lots.lead', {
          defaultValue:
            'Describe what you need — crop, grade, size, defect tolerance, quantity, delivery window. MandiMate finds compatible harvests across nearby farmers and builds a lot to your specification, with a clear explanation of why each harvest fits.',
        })}
        points={[
          t('buyers.lots.points.spec', { defaultValue: 'Pooled only from produce that meets the agreed specification' }),
          t('buyers.lots.points.rules', { defaultValue: 'Quantity checks follow explicit rules — no padding, no guesswork' }),
          t('buyers.lots.points.repeat', { defaultValue: 'Repeat requirements remembered for the next season' }),
        ]}
        visual={
          <VisualFrame
            label={t('buyers.lots.card.label', { defaultValue: 'Your requirement · posted' })}
            footer={t('buyers.lots.card.footer', { defaultValue: 'Matched against verified harvests near your delivery point.' })}
          >
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
              {[
                [t('buyers.lots.card.crop', { defaultValue: 'Crop' }), t('buyers.lots.card.cropValue', { defaultValue: 'Tomato, hybrid' })],
                [t('buyers.lots.card.grade', { defaultValue: 'Grade' }), t('buyers.lots.card.gradeValue', { defaultValue: 'A · 55–65 mm' })],
                [
                  t('buyers.lots.card.quantity', { defaultValue: 'Quantity' }),
                  t('buyers.lots.card.quantityValue', { defaultValue: '{{kg}} weekly', kg: '1,000 kg' }),
                ],
                [
                  t('buyers.lots.card.defects', { defaultValue: 'Defects' }),
                  t('buyers.lots.card.defectsValue', { defaultValue: '≤ 3% tolerance' }),
                ],
                [
                  t('buyers.lots.card.deliverTo', { defaultValue: 'Deliver to' }),
                  t('buyers.lots.card.deliverToValue', { defaultValue: 'Vijayawada DC' }),
                ],
                [t('buyers.lots.card.window', { defaultValue: 'Window' }), t('buyers.lots.card.windowValue', { defaultValue: 'Tue & Fri, 8–10 am' })],
              ].map(([term, value]) => (
                <div key={term} className="border-t border-line pt-3">
                  <dt className="text-[13px] text-muted">{term}</dt>
                  <dd className="mt-1 text-sm font-medium text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 border-s border-forest-600 ps-4 text-[13px] font-normal leading-snug text-ink-2">
              {t('buyers.lots.card.match', {
                defaultValue: '{{harvests}} compatible harvests found · {{kg}} · ready Tue. Two details still to confirm at collection.',
                harvests: 4,
                kg: '1,040 kg',
              })}
            </p>
          </VisualFrame>
        }
      />

      <Section labelledBy="verified-title">
        <SectionHeader
          id="verified-title"
          layout="split"
          eyebrow={t('buyers.verified.eyebrow', { defaultValue: 'Verified supply' })}
          title={<Trans t={t} i18nKey="buyers.verified.title" defaults="Supply you can <em>plan around.</em>" components={em} />}
          lead={t('buyers.verified.lead', {
            defaultValue:
              'Every lot is backed by people on the ground: coordinators who know the farmers, confirm quantities and check readiness before you see an offer.',
          })}
        />
        <FeatureGrid
          className="mt-14 md:mt-20"
          features={[
            {
              icon: BadgeCheck,
              title: t('buyers.verified.features.farmers.title', { defaultValue: 'Known farmers' }),
              body: t('buyers.verified.features.farmers.body', {
                defaultValue: 'Farmers are onboarded and verified by field coordinators and FPO partners, not anonymous listings.',
              }),
            },
            {
              icon: Layers,
              title: t('buyers.verified.features.quantities.title', { defaultValue: 'Real quantities' }),
              body: t('buyers.verified.features.quantities.body', {
                defaultValue: 'Readiness and volume are confirmed close to harvest, so the lot you agree is the lot that arrives.',
              }),
            },
            {
              icon: Gauge,
              title: t('buyers.verified.features.status.title', { defaultValue: 'Honest status' }),
              body: t('buyers.verified.features.status.body', {
                defaultValue: 'Each lot shows what is confirmed, what is estimated and what is still unresolved — before you commit.',
              }),
            },
          ]}
        />
      </Section>

      <Chapter
        id="records"
        reverse
        tone="parchment"
        eyebrow={t('buyers.records.eyebrow', { defaultValue: 'Delivery & quality records' })}
        title={
          <Trans
            t={t}
            i18nKey="buyers.records.title"
            defaults="What was sent, what arrived, <em>what you accepted.</em>"
            components={em}
          />
        }
        lead={t('buyers.records.lead', {
          defaultValue:
            'Weights at pickup and at your dock. Inspection results with photos and timestamps. Shortages and rejections traced to individual farmers. When there is a question, the record answers it.',
        })}
        points={[
          t('buyers.records.points.weights', { defaultValue: 'Pickup and delivery confirmations with weights' }),
          t('buyers.records.points.quality', { defaultValue: 'Quality checks recorded against the agreed specification' }),
          t('buyers.records.points.disputes', { defaultValue: 'A clear dispute process with an audit trail' }),
        ]}
        visual={<QualityRecordCard />}
      />

      <Section labelledBy="terms-title">
        <div className="grid gap-12 lg:grid-cols-12 lg:items-center lg:gap-16">
          <div className="lg:col-span-6">
            <SectionHeader
              id="terms-title"
              eyebrow={t('buyers.terms.eyebrow', { defaultValue: 'Payment terms' })}
              title={<Trans t={t} i18nKey="buyers.terms.title" defaults="Terms written down, <em>settled on record.</em>" components={em} />}
              lead={t('buyers.terms.lead', {
                defaultValue:
                  'Agree payment terms in the offer — advance, on delivery or net days — and settle against accepted quantities. Farmers see when payment is due; you see exactly what you are paying for.',
              })}
            />
          </div>
          <div className="lg:col-span-6">
            <VisualFrame
              label={t('buyers.terms.card.label', { defaultValue: 'Settlement · Lot {{code}}', code: 'L-0412' })}
              footer={t('buyers.terms.card.footer', { defaultValue: 'Coordination fee shown in the offer before you commit.' })}
            >
              <dl className="divide-y divide-line/70 text-sm">
                {[
                  [t('buyers.terms.card.accepted', { defaultValue: 'Accepted quantity' }), '1,004 kg'],
                  [t('buyers.terms.card.price', { defaultValue: 'Agreed price' }), '₹16.00/kg'],
                  [t('buyers.terms.card.value', { defaultValue: 'Produce value' }), '₹16,064'],
                  [t('buyers.terms.card.terms', { defaultValue: 'Terms' }), t('buyers.terms.card.termsValue', { defaultValue: 'Net 7 days' })],
                  [t('buyers.terms.card.due', { defaultValue: 'Due' }), t('buyers.terms.card.dueValue', { defaultValue: 'Tue, 4 Nov' })],
                ].map(([term, value]) => (
                  <div key={term} className="flex items-center justify-between gap-3 py-2.5">
                    <dt className="text-muted">{term}</dt>
                    <dd className="tabular-nums text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            </VisualFrame>
          </div>
        </div>
      </Section>

      <Section tone="dark" labelledBy="buyer-steps-title">
        <SectionHeader
          id="buyer-steps-title"
          layout="split"
          eyebrow={t('buyers.sourcing.eyebrow', { defaultValue: 'How sourcing works' })}
          title={<Trans t={t} i18nKey="buyers.sourcing.title" defaults="From requirement to <em>receipt.</em>" components={em} />}
          lead={t('buyers.sourcing.lead', {
            defaultValue: 'One workflow replaces the phone calls, the separate trucks and the spreadsheet reconciliation.',
          })}
        />
        <StepRail
          className="mt-14 md:mt-20"
          steps={[
            {
              title: t('buyers.sourcing.steps.post.title', { defaultValue: 'Post a requirement' }),
              body: t('buyers.sourcing.steps.post.body', {
                defaultValue: 'Crop, grade, quantity, delivery window and payment terms you can offer.',
              }),
            },
            {
              title: t('buyers.sourcing.steps.review.title', { defaultValue: 'Review matched supply' }),
              body: t('buyers.sourcing.steps.review.body', {
                defaultValue: 'See pooled lots with their specification, origin and certainty of each detail.',
              }),
            },
            {
              title: t('buyers.sourcing.steps.negotiate.title', { defaultValue: 'Offer and negotiate' }),
              body: t('buyers.sourcing.steps.negotiate.body', {
                defaultValue: 'Submit an offer, counter in the same thread, agree terms openly.',
              }),
            },
            {
              title: t('buyers.sourcing.steps.consent.title', { defaultValue: 'Farmers consent' }),
              body: t('buyers.sourcing.steps.consent.body', {
                defaultValue: 'Every farmer in the lot accepts before the deal is confirmed.',
              }),
            },
            {
              title: t('buyers.sourcing.steps.delivery.title', { defaultValue: 'Receive one delivery' }),
              body: t('buyers.sourcing.steps.delivery.body', {
                defaultValue: 'Consolidated pickup, planned route, confirmed arrival at your dock.',
              }),
            },
            {
              title: t('buyers.sourcing.steps.settle.title', { defaultValue: 'Inspect and settle' }),
              body: t('buyers.sourcing.steps.settle.body', {
                defaultValue: 'Record quality, accept quantities and pay against the record.',
              }),
            },
          ]}
        />
        <div className="mt-16 grid border-y border-white/10 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: ClipboardList, label: t('buyers.sourcing.tools.requirements', { defaultValue: 'Requirements' }) },
            { icon: MessagesSquare, label: t('buyers.sourcing.tools.negotiation', { defaultValue: 'Negotiation' }) },
            { icon: FileCheck2, label: t('buyers.sourcing.tools.quality', { defaultValue: 'Quality records' }) },
            { icon: Receipt, label: t('buyers.sourcing.tools.settlements', { defaultValue: 'Settlements' }) },
          ].map(({ icon: Icon, label }) => (
            <p key={label} className="flex items-center gap-3 border-b border-white/10 py-6 text-[13px] font-semibold text-ivory/80 sm:px-5 lg:border-b-0 lg:border-s lg:first:border-s-0 lg:first:ps-0">
              <Icon aria-hidden="true" strokeWidth={1.25} className="size-4 text-gold-400" />
              {label}
            </p>
          ))}
        </div>
      </Section>

      <Section labelledBy="buyer-why-title">
        <SectionHeader
          id="buyer-why-title"
          layout="center"
          eyebrow={t('buyers.why.eyebrow', { defaultValue: 'Why it lasts' })}
          title={<Trans t={t} i18nKey="buyers.why.title" defaults="Better for farmers is <em>better for you.</em>" components={em} />}
          lead={t('buyers.why.lead', {
            defaultValue:
              'When farmers trust the deal, they come back with the next harvest. Reliable counterparties, recorded terms and fair settlement build supply you can rely on season after season.',
          })}
        />
        <FeatureGrid
          className="mt-14"
          features={[
            {
              icon: ShieldCheck,
              title: t('buyers.why.features.verified.title', { defaultValue: 'Verified counterparties' }),
              body: t('buyers.why.features.verified.body', {
                defaultValue: 'Buyers and transporters are verified too, so farmers say yes faster.',
              }),
            },
            {
              icon: CalendarClock,
              title: t('buyers.why.features.windows.title', { defaultValue: 'Predictable windows' }),
              body: t('buyers.why.features.windows.body', {
                defaultValue: 'Pickup sequencing and timing planned before the truck leaves.',
              }),
            },
            {
              icon: Handshake,
              title: t('buyers.why.features.terms.title', { defaultValue: 'Fair, visible terms' }),
              body: t('buyers.why.features.terms.body', {
                defaultValue: 'Every fee and deduction shown to every party, every time.',
              }),
            },
          ]}
        />
      </Section>

      <FaqSection id="buyer-faq" title={t('buyers.faq.title', { defaultValue: 'Questions from buyers' })} items={faq} tone="parchment" />

      <ClosingCta
        role="buyer"
        title={<Trans t={t} i18nKey="buyers.cta.title" defaults="Source your next lot <em>with confidence.</em>" components={em} />}
        lead={t('buyers.cta.lead', {
          defaultValue:
            'Post a requirement today. We will tell you honestly what supply exists in our pilot cluster — and what does not yet.',
        })}
        primaryLabel={t('buyers.cta.primary', { defaultValue: 'Create a buyer account' })}
        secondary={{ label: t('buyers.cta.secondary', { defaultValue: 'See pricing' }), to: '/pricing' }}
      />
    </>
  );
}
