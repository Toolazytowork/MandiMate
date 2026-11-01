import { Trans, useTranslation } from 'react-i18next';
import { ArrowRight, BadgeIndianRupee, CalendarCheck, Container, Fuel, MapPinned, Route, ScrollText, Timer, Weight } from 'lucide-react';
import { LinkButton } from '@/components/ui';
import { RouteLines } from '@/components/art';
import { PageHero } from '@/components/marketing/PageHero';
import { PageSeo } from '@/components/marketing/PageSeo';
import { Section, SectionHeader } from '@/components/marketing/primitives';
import { Chapter, ClosingCta, FaqSection, FeatureGrid, RouteSheetCard, StepRail, VisualFrame, type RoleFaq } from '@/components/marketing/roles';
import { RoleEm } from '@/components/marketing/roles/RoleSections';
import { faqPage } from '@/lib/seo';

/** English source for the FAQ (also used, untranslated, for FAQPage JSON-LD). */
const FAQ: readonly (RoleFaq & { id: string })[] = [
  {
    id: 'cost',
    question: 'Does it cost anything to quote?',
    answer: 'No. Transporters see pickup requests and quote for free. Any logistics coordination fee is shown as its own line to every party.',
  },
  {
    id: 'loads',
    question: 'How are loads and stops confirmed?',
    answer:
      'Quantities are confirmed by farmers and field coordinators close to harvest, and the pickup sequence is fixed before you accept. If something changes, you are told before the truck leaves.',
  },
  {
    id: 'payment',
    question: 'When do I get paid?',
    answer: 'Payment terms are agreed with your quote and released against pickup and delivery confirmations recorded in MandiMate.',
  },
];

export default function ForTransportersPage() {
  const { t } = useTranslation('marketingRoles');
  const em = { em: <RoleEm /> };
  const faq = FAQ.map((item) => ({
    question: t(`transporters.faq.${item.id}.question`, { defaultValue: item.question }),
    answer: t(`transporters.faq.${item.id}.answer`, { defaultValue: item.answer }),
  }));

  return (
    <>
      <PageSeo path="/transporters" crumb="For transporters" jsonLd={[faqPage(FAQ)]} />

      <PageHero
        crumb={t('transporters.hero.crumb', { defaultValue: 'For transporters' })}
        eyebrow={t('transporters.hero.eyebrow', { defaultValue: 'For transporters' })}
        title={
          <Trans t={t} i18nKey="transporters.hero.title" defaults="Fuller trucks. <em>Fewer empty kilometres.</em>" components={em} />
        }
        lead={t('transporters.hero.lead', {
          defaultValue:
            'Quote on consolidated pickups with known loads, confirmed stops and a planned route — instead of a dozen phone calls for a dozen half-loads.',
        })}
        actions={
          <>
            <LinkButton to="/signup?role=transporter" variant="inverse" size="lg" trailingIcon={<ArrowRight strokeWidth={1.25} aria-hidden="true" />}>
              {t('transporters.hero.primary', { defaultValue: 'Join as a transporter' })}
            </LinkButton>
            <LinkButton to="/how-it-works" variant="glass" size="lg">
              {t('transporters.hero.secondary', { defaultValue: 'How a run is planned' })}
            </LinkButton>
          </>
        }
        footnote={
          <p className="text-[13px] font-semibold text-ivory/55">
            {t('transporters.hero.footnote', { defaultValue: 'Free to quote. Paid against recorded pickup and delivery.' })}
          </p>
        }
        aside={<RouteSheetCard />}
      />

      <Section labelledBy="consolidated-title">
        <SectionHeader
          id="consolidated-title"
          layout="split"
          eyebrow={t('transporters.consolidated.eyebrow', { defaultValue: 'Consolidated pickups' })}
          title={
            <Trans t={t} i18nKey="transporters.consolidated.title" defaults="One run, many farms, <em>one drop.</em>" components={em} />
          }
          lead={t('transporters.consolidated.lead', {
            defaultValue:
              'MandiMate pools harvests from neighbouring farms into a single consignment, so a pickup is worth the diesel. You see the full load, the stops and the destination before you quote.',
          })}
        />
        <FeatureGrid
          className="mt-14 md:mt-20"
          features={[
            {
              icon: Weight,
              title: t('transporters.consolidated.features.loads.title', { defaultValue: 'Known loads' }),
              body: t('transporters.consolidated.features.loads.body', {
                defaultValue: 'Total weight, crop and packaging per stop, confirmed close to harvest.',
              }),
            },
            {
              icon: Container,
              title: t('transporters.consolidated.features.capacity.title', { defaultValue: 'Capacity planning' }),
              body: t('transporters.consolidated.features.capacity.body', {
                defaultValue: 'Loads matched to vehicle capacity, so you are neither overloaded nor half-empty.',
              }),
            },
            {
              icon: Fuel,
              title: t('transporters.consolidated.features.deadRunning.title', { defaultValue: 'Less dead running' }),
              body: t('transporters.consolidated.features.deadRunning.body', {
                defaultValue: 'Clustered stops and one destination cut the kilometres that earn nothing.',
              }),
            },
          ]}
        />
      </Section>

      <Chapter
        id="routes"
        tone="parchment"
        eyebrow={t('transporters.routes.eyebrow', { defaultValue: 'Route sequencing' })}
        title={
          <Trans
            t={t}
            i18nKey="transporters.routes.title"
            defaults="A route that makes sense <em>before you start the engine.</em>"
            components={em}
          />
        }
        lead={t('transporters.routes.lead', {
          defaultValue:
            'Collection points, pickup order and timing are planned around harvest readiness and the buyer’s delivery window. Every stop is confirmed; every change reaches you first.',
        })}
        points={[
          t('transporters.routes.points.order', { defaultValue: 'Pickup order and time windows per stop' }),
          t('transporters.routes.points.points', { defaultValue: 'Collection points agreed with farmers in advance' }),
          t('transporters.routes.points.confirmed', { defaultValue: 'Pickup and delivery confirmed in the app, with weights' }),
        ]}
        visual={
          <VisualFrame
            label={t('transporters.routes.card.label', { defaultValue: 'Planned route · {{km}} km', km: 58 })}
            footer={t('transporters.routes.card.footer', {
              defaultValue: 'Three collection points, one buyer dock, delivered inside the window.',
            })}
          >
            <RouteLines tone="light" className="h-56 w-full sm:h-64" />
          </VisualFrame>
        }
      />

      <Chapter
        id="quotes"
        reverse
        eyebrow={t('transporters.quotes.eyebrow', { defaultValue: 'Quotes' })}
        title={<Trans t={t} i18nKey="transporters.quotes.title" defaults="Quote once, <em>clearly.</em>" components={em} />}
        lead={t('transporters.quotes.lead', {
          defaultValue:
            'Price the run as a whole. Your quote becomes a transparent line in every farmer’s net earnings — so a fair quote wins work, and the cheapest is not the only one that does.',
        })}
        points={[
          t('transporters.quotes.points.perRun', { defaultValue: 'Quote per run, shown per kilo to farmers' }),
          t('transporters.quotes.points.terms', { defaultValue: 'Payment terms agreed with the quote' }),
          t('transporters.quotes.points.settlement', { defaultValue: 'Recorded confirmations make settlement simple' }),
        ]}
        visual={
          <VisualFrame label={t('transporters.quotes.card.label', { defaultValue: 'Your quote · Tue run' })}>
            <dl className="divide-y divide-line/70 text-sm">
              {[
                [
                  t('transporters.quotes.card.load', { defaultValue: 'Load' }),
                  t('transporters.quotes.card.loadValue', { defaultValue: '{{kg}} · {{stops}} stops', kg: '1,040 kg', stops: 3 }),
                ],
                [t('transporters.quotes.card.distance', { defaultValue: 'Distance' }), '58 km'],
                [
                  t('transporters.quotes.card.price', { defaultValue: 'Your price' }),
                  t('transporters.quotes.card.priceValue', { defaultValue: '{{amount}} per run', amount: '₹1,250' }),
                ],
                [t('transporters.quotes.card.perKg', { defaultValue: 'Per kg to farmers' }), '₹1.20'],
                [
                  t('transporters.quotes.card.paid', { defaultValue: 'Paid' }),
                  t('transporters.quotes.card.paidValue', { defaultValue: 'On delivery confirmation' }),
                ],
              ].map(([term, value]) => (
                <div key={term} className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="text-muted">{term}</dt>
                  <dd className="tabular-nums text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </VisualFrame>
        }
      />

      <Section tone="dark" labelledBy="transport-steps-title">
        <SectionHeader
          id="transport-steps-title"
          layout="split"
          eyebrow={t('transporters.workflow.eyebrow', { defaultValue: 'Your workflow' })}
          title={<Trans t={t} i18nKey="transporters.workflow.title" defaults="From request to <em>receipt.</em>" components={em} />}
          lead={t('transporters.workflow.lead', { defaultValue: 'Everything a run needs, in the order you need it.' })}
        />
        <StepRail
          className="mt-14 md:mt-20"
          steps={[
            {
              title: t('transporters.workflow.steps.requests.title', { defaultValue: 'See pickup requests' }),
              body: t('transporters.workflow.steps.requests.body', {
                defaultValue: 'Consolidated loads near your base, with crop, weight and delivery window.',
              }),
            },
            {
              title: t('transporters.workflow.steps.quote.title', { defaultValue: 'Quote the run' }),
              body: t('transporters.workflow.steps.quote.body', {
                defaultValue: 'Price it once; terms and timing travel with your quote.',
              }),
            },
            {
              title: t('transporters.workflow.steps.sheet.title', { defaultValue: 'Get the route sheet' }),
              body: t('transporters.workflow.steps.sheet.body', {
                defaultValue: 'Sequenced stops, collection points and contact for each farmer group.',
              }),
            },
            {
              title: t('transporters.workflow.steps.paid.title', { defaultValue: 'Confirm and get paid' }),
              body: t('transporters.workflow.steps.paid.body', {
                defaultValue: 'Record pickup and delivery weights; payment follows the record.',
              }),
            },
          ]}
        />
        <ul className="mt-16 grid border-y border-white/10 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: MapPinned, label: t('transporters.workflow.tools.points', { defaultValue: 'Collection points' }) },
            { icon: Route, label: t('transporters.workflow.tools.stops', { defaultValue: 'Sequenced stops' }) },
            { icon: Timer, label: t('transporters.workflow.tools.windows', { defaultValue: 'Time windows' }) },
            { icon: CalendarCheck, label: t('transporters.workflow.tools.confirmations', { defaultValue: 'Confirmations' }) },
          ].map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-3 border-b border-white/10 py-6 text-[13px] font-semibold text-ivory/80 sm:px-5 lg:border-b-0 lg:border-s lg:first:border-s-0 lg:first:ps-0">
              <Icon aria-hidden="true" strokeWidth={1.25} className="size-4 text-gold-400" />
              {label}
            </li>
          ))}
        </ul>
      </Section>

      <Section labelledBy="transport-trust-title">
        <SectionHeader
          id="transport-trust-title"
          layout="center"
          eyebrow={t('transporters.trust.eyebrow', { defaultValue: 'Trust' })}
          title={<Trans t={t} i18nKey="transporters.trust.title" defaults="Verified partners, <em>recorded terms.</em>" components={em} />}
          lead={t('transporters.trust.lead', {
            defaultValue:
              'Transporters are verified before they quote, and every pickup, delivery and payment is on record. Good work builds a history buyers and farmers can see.',
          })}
        />
        <FeatureGrid
          className="mt-14"
          features={[
            {
              icon: ScrollText,
              title: t('transporters.trust.features.agreements.title', { defaultValue: 'Clear agreements' }),
              body: t('transporters.trust.features.agreements.body', {
                defaultValue: 'Load, route, timing and price agreed in writing before the run.',
              }),
            },
            {
              icon: BadgeIndianRupee,
              title: t('transporters.trust.features.payment.title', { defaultValue: 'Reliable payment' }),
              body: t('transporters.trust.features.payment.body', {
                defaultValue: 'Settlement tied to confirmations, with a clear dispute process.',
              }),
            },
            {
              icon: CalendarCheck,
              title: t('transporters.trust.features.repeat.title', { defaultValue: 'Repeat work' }),
              body: t('transporters.trust.features.repeat.body', {
                defaultValue: 'Seasonal lanes and repeat buyers bring predictable runs.',
              }),
            },
          ]}
        />
      </Section>

      <FaqSection
        id="transport-faq"
        title={t('transporters.faq.title', { defaultValue: 'Questions from transporters' })}
        items={faq}
        tone="parchment"
      />

      <ClosingCta
        role="transporter"
        title={<Trans t={t} i18nKey="transporters.cta.title" defaults="Put your truck on <em>better runs.</em>" components={em} />}
        lead={t('transporters.cta.lead', {
          defaultValue: 'Join our pilot transport partners. Quote on consolidated pickups with known loads and planned routes.',
        })}
        primaryLabel={t('transporters.cta.primary', { defaultValue: 'Join as a transporter' })}
        secondary={{ label: t('transporters.cta.secondary', { defaultValue: 'Contact us' }), to: '/contact' }}
      />
    </>
  );
}
