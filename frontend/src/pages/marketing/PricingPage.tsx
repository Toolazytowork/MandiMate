import { Trans, useTranslation } from 'react-i18next';
import { ArrowRight, Eye, HandCoins, Receipt, ShieldCheck } from 'lucide-react';
import { LinkButton } from '@/components/ui';
import { PageHero } from '@/components/marketing/PageHero';
import { PageSeo } from '@/components/marketing/PageSeo';
import { CheckList, Em, IllustrativeNote, Section, SectionHeader, Tag } from '@/components/marketing/primitives';
import { FaqSection, FeatureGrid, RoleChooserCta, type RoleFaq } from '@/components/marketing/roles';
import { cn } from '@/lib/cn';
import { faqPage } from '@/lib/seo';

interface Plan {
  /** `pricing.plans.<id>` translation key. */
  id: 'farmers' | 'buyers' | 'logistics';
  audience: string;
  name: string;
  price: string;
  unit: string;
  summary: string;
  includes: readonly string[];
  cta: { label: string; to: string };
  featured?: boolean;
}

const PLANS: readonly Plan[] = [
  {
    id: 'farmers',
    audience: 'Farmers',
    name: 'Free, always',
    price: '₹0',
    unit: 'to list, pool and sell',
    summary: 'No barrier for the people who grow the food. Farmers never pay MandiMate.',
    includes: [
      'Voice, photo and assisted listing',
      'Private minimum net price',
      'Offer comparison by net earnings',
      'Consent on every sale',
      'Delivery, deduction and payment tracking',
    ],
    cta: { label: 'Join as a farmer', to: '/signup?role=farmer' },
    featured: true,
  },
  {
    id: 'buyers',
    audience: 'Buyers',
    name: 'Coordination fee',
    price: '₹500',
    unit: 'indicative, per successfully sourced lot',
    summary: 'Pay only when a lot is delivered to you. Posting requirements and browsing supply cost nothing.',
    includes: [
      'Lots built to your specification',
      'Verified farmers and quantities',
      'Offers, counters and terms in one thread',
      'Delivery and quality records',
      'Settlement against accepted quantity',
    ],
    cta: { label: 'Start sourcing', to: '/signup?role=buyer' },
  },
  {
    id: 'logistics',
    audience: 'Logistics',
    name: 'Coordination fee',
    price: 'Per run',
    unit: 'shown as its own line in every quote',
    summary: 'A transparent fee for planning consolidated pickups — never folded into the transport price.',
    includes: [
      'Free for transporters to quote',
      'Route and pickup sequencing',
      'Capacity planning',
      'Pickup and delivery confirmations',
    ],
    cta: { label: 'Join as a transporter', to: '/signup?role=transporter' },
  },
];

const FPO_TIERS = [
  {
    id: 'pilot',
    name: 'Pilot',
    price: '₹0',
    unit: 'during the pilot',
    body: 'For the first FPO partners in our pilot cluster, while we learn together.',
    includes: ['Assisted onboarding', 'Lot builder', 'Settlement records'],
  },
  {
    id: 'cluster',
    name: 'Cluster',
    price: '₹1,500',
    unit: 'per month, indicative',
    body: 'For an FPO coordinating one village cluster and a handful of buyers.',
    includes: ['Everything in Pilot', 'Buyer management', 'Season insights & exports'],
    featured: true,
  },
  {
    id: 'federation',
    name: 'Federation',
    price: 'Custom',
    unit: 'by arrangement',
    body: 'For federations and cooperatives running many clusters and crops.',
    includes: ['Everything in Cluster', 'Multi-cluster reporting', 'Dispute & audit workflows'],
  },
] as const;

const FAQ: readonly RoleFaq[] = [
  {
    question: 'Why is MandiMate free for farmers?',
    answer:
      'Our mission is to raise what farmers take home. Charging them would work against that, so the business is paid for by buyers, FPO subscriptions and a transparent logistics coordination fee.',
  },
  {
    question: 'Are these prices final?',
    answer:
      'No. This is pilot pricing, subject to validation with real transactions. We will change it if it does not work for farmers, buyers or partners — and we will say so publicly.',
  },
  {
    question: 'Will fees reduce what a farmer earns?',
    answer:
      'Any cost that touches a farmer’s sale — transport, handling, a commission — appears as its own line in their net earnings before they agree. Nothing is hidden inside the price.',
  },
  {
    question: 'Do buyers pay if a deal fails?',
    answer: 'No. The buyer coordination fee applies only to lots that are successfully sourced and delivered.',
  },
];

function PlanCard({ plan }: { plan: Plan }) {
  const { t } = useTranslation('marketing');
  const k = `pricing.plans.${plan.id}`;
  const includes = plan.includes.map((item, index) => t(`${k}.includes.${index}`, { defaultValue: item }));
  return (
    <article
      className={cn(
        'relative flex h-full flex-col rounded-card border p-8 sm:p-10',
        plan.featured ? 'surface-dark border-forest-600 bg-forest-600 text-white' : 'border-line bg-paper',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow eyebrow-rule">{t(`${k}.audience`, { defaultValue: plan.audience })}</p>
        <Tag tone={plan.featured ? 'glass' : 'gold'}>
          {plan.featured ? t('pricing.tagAlways', { defaultValue: 'Always' }) : t('pricing.tagPilot', { defaultValue: 'Pilot' })}
        </Tag>
      </div>
      <h3 className="mt-8 font-display font-bold text-[1.75rem] tracking-[-0.015em]">{t(`${k}.name`, { defaultValue: plan.name })}</h3>
      <p className="mt-5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="font-display font-bold text-[3rem] leading-none tracking-[-0.03em] tabular-nums">
          {t(`${k}.price`, { defaultValue: plan.price })}
        </span>
        <span className="text-[13px] font-semibold text-muted [.surface-dark_&]:text-(--fg-muted)">
          {t(`${k}.unit`, { defaultValue: plan.unit })}
        </span>
      </p>
      <p className="mt-5 text-[15px] font-normal leading-relaxed text-ink-2 [.surface-dark_&]:text-(--fg-muted)">
        {t(`${k}.summary`, { defaultValue: plan.summary })}
      </p>
      <span aria-hidden="true" className="hairline my-7" />
      <CheckList items={includes} dense className="flex-1" />
      <LinkButton
        to={plan.cta.to}
        variant={plan.featured ? 'inverse' : 'secondary'}
        className="mt-8"
        fullWidth
        trailingIcon={<ArrowRight strokeWidth={1.25} aria-hidden="true" />}
      >
        {t(`${k}.cta`, { defaultValue: plan.cta.label })}
      </LinkButton>
    </article>
  );
}

/** FAQ JSON-LD stays in English (SEO); the visible list is translated. */
const JSON_LD = [faqPage(FAQ)];

export default function PricingPage() {
  const { t } = useTranslation('marketing');
  const crumb = t('pricing.crumb', { defaultValue: 'Pricing' });
  const faq = FAQ.map((item, index) => ({
    question: t(`pricing.faq.items.${index}.question`, { defaultValue: item.question }),
    answer: t(`pricing.faq.items.${index}.answer`, { defaultValue: item.answer }),
  }));
  return (
    <>
      <PageSeo path="/pricing" crumb={crumb} jsonLd={JSON_LD} />

      <PageHero
        crumb={crumb}
        tone="light"
        eyebrow={t('pricing.hero.eyebrow', { defaultValue: 'Pricing' })}
        title={
          <Trans
            t={t}
            i18nKey="pricing.hero.title"
            defaults="Free for farmers. <em>Fair for everyone else.</em>"
            components={{ em: <Em /> }}
          />
        }
        lead={t('pricing.hero.lead', {
          defaultValue:
            'Farmers never pay. Buyers pay a coordination fee only on lots they actually source, FPOs can subscribe for aggregation and settlement tools, and logistics coordination is always its own visible line.',
        })}
        footnote={
          <Tag tone="gold" className="h-7 px-3">
            {t('pricing.hero.footnote', { defaultValue: 'Pilot pricing — subject to validation' })}
          </Tag>
        }
      />

      <Section labelledBy="plans-title" spacing="compact">
        <h2 id="plans-title" className="sr-only">
          {t('pricing.plansTitle', { defaultValue: 'Plans by role' })}
        </h2>
        <ul className="grid gap-5 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <li key={plan.id}>
              <PlanCard plan={plan} />
            </li>
          ))}
        </ul>
        <IllustrativeNote className="mt-8">
          {t('pricing.plansNote', {
            defaultValue:
              'Indicative amounts for the pilot. Final fees will be set from real transaction data and published here before they apply.',
          })}
        </IllustrativeNote>
      </Section>

      <Section tone="parchment" labelledBy="fpo-tiers-title" rule>
        <SectionHeader
          id="fpo-tiers-title"
          layout="split"
          eyebrow={t('pricing.fpo.eyebrow', { defaultValue: 'FPOs & cooperatives' })}
          title={
            <Trans
              t={t}
              i18nKey="pricing.fpo.title"
              defaults="A subscription for the <em>people who coordinate.</em>"
              components={{ em: <Em /> }}
            />
          }
          lead={t('pricing.fpo.lead', {
            defaultValue:
              'Aggregation, buyer management, records and settlement tracking for your members — priced by the scale you run, not by the farmers you serve.',
          })}
        />
        <ul className="mt-14 grid gap-5 md:mt-20 lg:grid-cols-3">
          {FPO_TIERS.map((tier) => (
            <li
              key={tier.id}
              className={cn(
                'flex flex-col rounded-card border bg-paper p-8',
                'featured' in tier && tier.featured ? 'border-ink/40' : 'border-line',
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-display font-bold text-2xl tracking-[-0.015em]">
                  {t(`pricing.fpo.tiers.${tier.id}.name`, { defaultValue: tier.name })}
                </h3>
                {'featured' in tier && tier.featured ? (
                  <Tag tone="forest">{t('pricing.fpo.mostFpos', { defaultValue: 'Most FPOs' })}</Tag>
                ) : null}
              </div>
              <p className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-display font-bold text-[2.5rem] leading-none tracking-[-0.03em] tabular-nums">
                  {t(`pricing.fpo.tiers.${tier.id}.price`, { defaultValue: tier.price })}
                </span>
                <span className="text-[13px] font-semibold text-muted">
                  {t(`pricing.fpo.tiers.${tier.id}.unit`, { defaultValue: tier.unit })}
                </span>
              </p>
              <p className="mt-4 text-[15px] font-normal leading-relaxed text-ink-2">
                {t(`pricing.fpo.tiers.${tier.id}.body`, { defaultValue: tier.body })}
              </p>
              <CheckList
                items={tier.includes.map((item, index) =>
                  t(`pricing.fpo.tiers.${tier.id}.includes.${index}`, { defaultValue: item }),
                )}
                dense
                className="mt-6"
              />
            </li>
          ))}
        </ul>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
          <LinkButton to="/signup?role=coordinator" trailingIcon={<ArrowRight strokeWidth={1.25} aria-hidden="true" />}>
            {t('pricing.fpo.primary', { defaultValue: 'Join as a coordinator' })}
          </LinkButton>
          <LinkButton to="/contact" variant="secondary">
            {t('pricing.fpo.secondary', { defaultValue: 'Discuss a federation plan' })}
          </LinkButton>
        </div>
      </Section>

      <Section labelledBy="principles-title">
        <SectionHeader
          id="principles-title"
          layout="center"
          eyebrow={t('pricing.principles.eyebrow', { defaultValue: 'Our pricing principles' })}
          title={
            <Trans
              t={t}
              i18nKey="pricing.principles.title"
              defaults="Every rupee, <em>in the open.</em>"
              components={{ em: <Em /> }}
            />
          }
          lead={t('pricing.principles.lead', {
            defaultValue: 'A marketplace that asks farmers to trust its numbers has to be transparent about its own.',
          })}
        />
        <FeatureGrid
          className="mt-14"
          columns={4}
          features={[
            {
              icon: HandCoins,
              title: t('pricing.principles.items.farmersNeverPay.title', { defaultValue: 'Farmers never pay' }),
              body: t('pricing.principles.items.farmersNeverPay.body', {
                defaultValue: 'No listing fee, no membership, no cut of the farmer’s price.',
              }),
            },
            {
              icon: Eye,
              title: t('pricing.principles.items.feesShownFirst.title', { defaultValue: 'Fees shown first' }),
              body: t('pricing.principles.items.feesShownFirst.body', {
                defaultValue: 'Every fee and deduction appears before anyone consents.',
              }),
            },
            {
              icon: Receipt,
              title: t('pricing.principles.items.paidOnSuccess.title', { defaultValue: 'Paid on success' }),
              body: t('pricing.principles.items.paidOnSuccess.body', {
                defaultValue: 'Buyer fees apply only to lots that are sourced and delivered.',
              }),
            },
            {
              icon: ShieldCheck,
              title: t('pricing.principles.items.neverHidden.title', { defaultValue: 'Never hidden in price' }),
              body: t('pricing.principles.items.neverHidden.body', {
                defaultValue: 'Coordination is its own line, never buried in a per-kg rate.',
              }),
            },
          ]}
        />
      </Section>

      <Section tone="dark" labelledBy="model-title" spacing="compact">
        <div className="grid gap-10 lg:grid-cols-12 lg:items-center lg:gap-16">
          <div className="lg:col-span-6">
            <SectionHeader
              id="model-title"
              eyebrow={t('pricing.model.eyebrow', { defaultValue: 'How the model adds up' })}
              title={
                <Trans
                  t={t}
                  i18nKey="pricing.model.title"
                  defaults="Small fees, <em>many good deals.</em>"
                  components={{ em: <Em /> }}
                />
              }
              lead={t('pricing.model.lead', {
                defaultValue:
                  'We earn when farmers sell well and buyers get what they ordered. A hypothetical illustration — not a forecast:',
              })}
            />
          </div>
          <dl className="grid grid-cols-[1fr_auto] items-baseline gap-x-6 gap-y-4 border-y border-white/12 py-8 lg:col-span-6">
            <dt className="text-ivory/65">{t('pricing.model.consignments', { defaultValue: 'Consignments per month' })}</dt>
            <dd className="text-end font-display font-bold text-2xl tabular-nums">100</dd>
            <dt className="text-ivory/65">{t('pricing.model.feePerLot', { defaultValue: 'Coordination fee per lot' })}</dt>
            <dd className="text-end font-display font-bold text-2xl tabular-nums">× ₹500</dd>
            <dt className="border-t border-white/12 pt-4 text-ivory">
              {t('pricing.model.monthlyGross', { defaultValue: 'Monthly gross, before operating costs' })}
            </dt>
            <dd className="border-t border-white/12 pt-4 text-end font-display font-bold text-[2.25rem] leading-none tabular-nums not-italic text-gold-400">
              ₹50,000
            </dd>
          </dl>
        </div>
      </Section>

      <FaqSection id="pricing-faq" title={t('pricing.faq.title', { defaultValue: 'Pricing questions' })} items={faq} />

      <RoleChooserCta
        id="pricing-cta"
        title={
          <Trans
            t={t}
            i18nKey="pricing.cta.title"
            defaults="Choose your <em>side of the deal.</em>"
            components={{ em: <Em /> }}
          />
        }
        lead={t('pricing.cta.lead', { defaultValue: 'Sign up with your role and we will set up the right tools for you.' })}
      />
    </>
  );
}
