import { Trans, useTranslation } from 'react-i18next';
import { ArrowRight, Calculator, ClipboardCheck, EyeOff, HandCoins, Handshake, Languages, Scale, Truck, UsersRound } from 'lucide-react';
import { LinkButton } from '@/components/ui';
import { PageHero } from '@/components/marketing/PageHero';
import { PageSeo } from '@/components/marketing/PageSeo';
import { IllustrativeNote, Section, SectionHeader } from '@/components/marketing/primitives';
import {
  Chapter,
  ClosingCta,
  FactStrip,
  FaqSection,
  FeatureGrid,
  NetDealCard,
  SettlementCard,
  StepRail,
  VoiceDraftCard,
  VisualFrame,
  type RoleFaq,
} from '@/components/marketing/roles';
import { RoleEm } from '@/components/marketing/roles/RoleSections';
import { faqPage } from '@/lib/seo';

/** English source for the FAQ (also used, untranslated, for FAQPage JSON-LD). */
const FAQ: readonly (RoleFaq & { id: string })[] = [
  {
    id: 'cost',
    question: 'Does it cost anything to list a harvest?',
    answer:
      'No. Farmers never pay to list, to join a pooled sale or to compare offers. Any cost that touches your sale — transport, handling, a market commission — is shown as its own line before you agree.',
  },
  {
    id: 'consent',
    question: 'Can MandiMate sell my produce without asking me?',
    answer:
      'Never. Every sale needs your explicit consent. You can decline any offer, and declining a pooled deal does not stop you from selling elsewhere.',
  },
  {
    id: 'floor',
    question: 'Who sees my minimum price?',
    answer:
      'Only you, and a field coordinator if you choose to list with one. Buyers never see it. We use it to tell you which offers clear your floor once every cost is taken out.',
  },
  {
    id: 'rejection',
    question: 'What if some of my produce is rejected at delivery?',
    answer:
      'The quantity and reason are recorded at delivery with the inspector’s notes and photos. Rejections are traced to your own produce, not shared across the lot, and you can raise a dispute from the same screen.',
  },
  {
    id: 'smartphone',
    question: 'I do not use a smartphone much. Can I still sell?',
    answer:
      'Yes. A field coordinator from your FPO or village cluster can list, explain offers and record your consent with you, in your language.',
  },
];

const STEPS = [
  { id: 'ready', title: 'Say what is ready', body: 'Speak your harvest in Telugu, Hindi, Kannada, Urdu or English, or add a photo. MandiMate drafts the listing and asks for anything it is unsure of.' },
  { id: 'floor', title: 'Set your private floor', body: 'Tell us the least you would accept after costs. Buyers never see it; we use it to flag offers worth your time.' },
  { id: 'pool', title: 'Get pooled with neighbours', body: 'Compatible harvests — same crop, grade and timing — become one lot a serious buyer will bid on.' },
  { id: 'compare', title: 'Compare by take-home', body: 'Every offer is shown as net earnings beside the mandi, with each cost marked confirmed, estimated or unresolved.' },
  { id: 'decide', title: 'Say yes — or no', body: 'Nothing is sold without your consent. Decline freely; your harvest stays yours.' },
  { id: 'track', title: 'Track until you are paid', body: 'Pickup, weighing, quality, deductions and payment, recorded as they happen and explained in plain words.' },
] as const;

export default function ForFarmersPage() {
  const { t } = useTranslation('marketingRoles');
  const em = { em: <RoleEm /> };
  const faq = FAQ.map((item) => ({
    question: t(`farmers.faq.${item.id}.question`, { defaultValue: item.question }),
    answer: t(`farmers.faq.${item.id}.answer`, { defaultValue: item.answer }),
  }));
  const steps = STEPS.map((step) => ({
    title: t(`farmers.steps.${step.id}.title`, { defaultValue: step.title }),
    body: t(`farmers.steps.${step.id}.body`, { defaultValue: step.body }),
  }));

  return (
    <>
      <PageSeo path="/farmers" crumb="For farmers" jsonLd={[faqPage(FAQ)]} />

      <PageHero
        crumb={t('farmers.hero.crumb', { defaultValue: 'For farmers' })}
        eyebrow={t('farmers.hero.eyebrow', { defaultValue: 'For farmers' })}
        furrows
        title={
          <Trans t={t} i18nKey="farmers.hero.title" defaults="Know what you <em>take home</em> before you say yes." components={em} />
        }
        lead={t('farmers.hero.lead', {
          defaultValue:
            'Speak your harvest in your own language. MandiMate pools it with your neighbours’ into a lot buyers compete for — and shows every offer as money in your hand, after transport, commission, rejection and the wait for payment.',
        })}
        actions={
          <>
            <LinkButton to="/signup?role=farmer" variant="inverse" size="lg" trailingIcon={<ArrowRight strokeWidth={1.25} aria-hidden="true" />}>
              {t('farmers.hero.primary', { defaultValue: 'List your harvest — free' })}
            </LinkButton>
            <LinkButton to="/calculator" variant="glass" size="lg" leadingIcon={<Calculator strokeWidth={1.25} aria-hidden="true" />}>
              {t('farmers.hero.secondary', { defaultValue: 'Work out a net price' })}
            </LinkButton>
          </>
        }
        footnote={
          <p className="text-[13px] font-semibold text-ivory/55">
            {t('farmers.hero.footnote', { defaultValue: 'Free for farmers. No sale without your consent. Every fee shown first.' })}
          </p>
        }
        aside={<NetDealCard />}
      />

      <Section spacing="compact">
        <FactStrip
          facts={[
            { value: '₹0', label: t('farmers.facts.free', { defaultValue: 'to list, pool and compare offers' }) },
            { value: '5', label: t('farmers.facts.languages', { defaultValue: 'languages by voice — Telugu, Hindi, Kannada, Urdu, English' }) },
            { value: '100%', label: t('farmers.facts.consent', { defaultValue: 'of sales need your explicit yes' }) },
            {
              value: t('farmers.facts.oneViewValue', { defaultValue: '1 view' }),
              label: t('farmers.facts.oneView', { defaultValue: 'from listing to the money in your bank' }),
            },
          ]}
        />
      </Section>

      <Chapter
        id="voice"
        tone="parchment"
        eyebrow={t('farmers.voice.eyebrow', { defaultValue: 'Listing, by voice' })}
        title={
          <Trans t={t} i18nKey="farmers.voice.title" defaults="Speak it the way you would <em>tell a neighbour.</em>" components={em} />
        }
        lead={t('farmers.voice.lead', {
          defaultValue:
            'No forms to fight with. Say what is ready in Telugu, Hindi, Kannada, Urdu or English and MandiMate turns it into a draft listing. It asks about what it did not hear — grade, a pickup point — instead of guessing, and you confirm every field.',
        })}
        points={[
          t('farmers.voice.points.phone', { defaultValue: 'Works on a basic smartphone, or with a field coordinator beside you' }),
          t('farmers.voice.points.photo', { defaultValue: 'Add a photo for a first description; final grade is always set by inspection' }),
          t('farmers.voice.points.reminders', { defaultValue: 'Harvest deadlines and pickup times arrive as reminders you can hear' }),
        ]}
        visual={<VoiceDraftCard />}
      />

      <Chapter
        id="floor"
        reverse
        eyebrow={t('farmers.floor.eyebrow', { defaultValue: 'Your private minimum' })}
        title={<Trans t={t} i18nKey="farmers.floor.title" defaults="A floor price only <em>you</em> can see." components={em} />}
        lead={t('farmers.floor.lead', {
          defaultValue:
            'Tell MandiMate the least you would accept per kilo after every cost. Buyers never see it. It quietly sorts offers into those that clear your floor and those that do not — and helps you counter with numbers, not guesses.',
        })}
        points={[
          t('farmers.floor.points.net', { defaultValue: 'Set it as a net figure, so transport and commission cannot hide inside it' }),
          t('farmers.floor.points.change', { defaultValue: 'Change it any time before you consent' }),
          t('farmers.floor.points.counter', { defaultValue: 'Counter-offer suggestions use your floor and verified market prices only' }),
        ]}
        visual={
          <VisualFrame
            label={t('farmers.floor.card.label', { defaultValue: 'Minimum acceptable · net' })}
            footer={
              <span className="flex items-center gap-2">
                <EyeOff aria-hidden="true" strokeWidth={1.25} className="size-3.5 text-forest-700" />{' '}
                {t('farmers.floor.card.hidden', { defaultValue: 'Hidden from buyers and other farmers' })}
              </span>
            }
          >
            <p className="font-display font-bold text-[3rem] leading-none tracking-[-0.03em] tabular-nums text-ink">
              <span dir="ltr">
                ₹13.50<span className="text-xl text-muted">/kg</span>
              </span>
            </p>
            <ul className="mt-6 divide-y divide-line/70 border-t border-line text-sm">
              {[
                [
                  t('farmers.floor.card.offerB', { defaultValue: 'Offer B · pooled sale' }),
                  t('farmers.floor.card.net', { defaultValue: '{{amount}} net', amount: '₹14.02' }),
                  t('farmers.floor.card.clears', { defaultValue: 'Clears your floor' }),
                  'text-forest-700',
                ],
                [
                  t('farmers.floor.card.offerC', { defaultValue: 'Offer C · processor' }),
                  t('farmers.floor.card.net', { defaultValue: '{{amount}} net', amount: '₹13.10' }),
                  t('farmers.floor.card.below', { defaultValue: 'Below your floor' }),
                  'text-danger',
                ],
                [
                  t('farmers.floor.card.offerA', { defaultValue: 'Offer A · local trader' }),
                  t('farmers.floor.card.net', { defaultValue: '{{amount}} net', amount: '₹11.06' }),
                  t('farmers.floor.card.below', { defaultValue: 'Below your floor' }),
                  'text-danger',
                ],
              ].map(([name, net, verdict, tone]) => (
                <li key={name} className="flex items-center justify-between gap-3 py-3">
                  <span className="min-w-0 text-ink">
                    {name}
                    <span className={`mt-0.5 block text-[12.5px] ${tone}`}>{verdict}</span>
                  </span>
                  <span className="shrink-0 font-display text-lg tabular-nums text-ink">{net}</span>
                </li>
              ))}
            </ul>
          </VisualFrame>
        }
      />

      <Section tone="dark" labelledBy="net-title">
        <SectionHeader
          id="net-title"
          layout="split"
          eyebrow={t('farmers.net.eyebrow', { defaultValue: 'Net, not quoted' })}
          title={
            <Trans t={t} i18nKey="farmers.net.title" defaults="The highest price is not always the <em>best deal.</em>" components={em} />
          }
          lead={t('farmers.net.lead', {
            defaultValue:
              'A trader’s ₹16 can pay less than a pooled ₹15 once you count the truck, the commission, the produce sent back and the weeks you wait for money. MandiMate counts all of it, and tells you how sure each number is.',
          })}
        />
        <FeatureGrid
          className="mt-14 md:mt-20"
          columns={4}
          features={[
            {
              icon: Truck,
              title: t('farmers.net.features.transport.title', { defaultValue: 'Transport' }),
              body: t('farmers.net.features.transport.body', {
                defaultValue: 'Your share of a shared truck, against what it would cost to haul alone.',
              }),
            },
            {
              icon: HandCoins,
              title: t('farmers.net.features.commission.title', { defaultValue: 'Commission & handling' }),
              body: t('farmers.net.features.commission.body', {
                defaultValue: 'Market fees, loading and crating — itemised, never folded into the price.',
              }),
            },
            {
              icon: Scale,
              title: t('farmers.net.features.rejection.title', { defaultValue: 'Rejection risk' }),
              body: t('farmers.net.features.rejection.body', {
                defaultValue: 'Expected losses at inspection, based on the grade and the buyer’s standards.',
              }),
            },
            {
              icon: Handshake,
              title: t('farmers.net.features.delay.title', { defaultValue: 'Payment delay' }),
              body: t('farmers.net.features.delay.body', {
                defaultValue: 'When the money actually reaches you, and how reliable the buyer has been.',
              }),
            },
          ]}
        />
        <IllustrativeNote className="mt-10">
          {t('farmers.net.note', {
            defaultValue:
              'Each figure carries a marker: confirmed (agreed in writing), estimated (calculated from known costs) or unresolved (still to be settled, such as the final grade).',
          })}
        </IllustrativeNote>
      </Section>

      <Section labelledBy="consent-title">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <SectionHeader
              id="consent-title"
              eyebrow={t('farmers.consent.eyebrow', { defaultValue: 'Consent' })}
              title={<Trans t={t} i18nKey="farmers.consent.title" defaults="Nothing is sold <em>without your yes.</em>" components={em} />}
              lead={t('farmers.consent.lead', {
                defaultValue:
                  'Pooling makes you stronger, never smaller. You see the whole deal — buyer, price, every cost, when you will be paid — and you decide. Decline, and your harvest is still yours to sell anywhere.',
              })}
            />
          </div>
          <FeatureGrid
            columns={2}
            className="lg:col-span-7"
            features={[
              {
                icon: UsersRound,
                title: t('farmers.consent.features.share.title', { defaultValue: 'Your share, clearly' }),
                body: t('farmers.consent.features.share.body', {
                  defaultValue: 'How many kilos you contribute, and what that share earns after costs.',
                }),
              },
              {
                icon: Languages,
                title: t('farmers.consent.features.language.title', { defaultValue: 'Explained in your language' }),
                body: t('farmers.consent.features.language.body', {
                  defaultValue: 'Trade-offs in plain words: “pays ₹2 more, but three days later.”',
                }),
              },
              {
                icon: ClipboardCheck,
                title: t('farmers.consent.features.recorded.title', { defaultValue: 'Recorded, not assumed' }),
                body: t('farmers.consent.features.recorded.body', {
                  defaultValue: 'Your consent is logged with time and terms, so no one can change them later.',
                }),
              },
              {
                icon: EyeOff,
                title: t('farmers.consent.features.decline.title', { defaultValue: 'Free to decline' }),
                body: t('farmers.consent.features.decline.body', {
                  defaultValue: 'Say no to any deal without penalty, and keep listing next season.',
                }),
              },
            ]}
          />
        </div>
      </Section>

      <Chapter
        id="payment"
        tone="parchment"
        eyebrow={t('farmers.payment.eyebrow', { defaultValue: 'Payment tracking' })}
        title={
          <Trans t={t} i18nKey="farmers.payment.title" defaults="Follow your money all the way <em>to your bank.</em>" components={em} />
        }
        lead={t('farmers.payment.lead', {
          defaultValue:
            'After pickup, nothing disappears into a ledger you cannot read. Weights, quality checks, deductions and payment status are recorded at every step, and your earnings history shows how each sale compared with selling alone.',
        })}
        points={[
          t('farmers.payment.points.weighed', { defaultValue: 'Weighed at pickup and again at delivery' }),
          t('farmers.payment.points.rejections', { defaultValue: 'Rejections recorded with reason, photos and inspector' }),
          t('farmers.payment.points.alerts', { defaultValue: 'Alerts when payment is due, received and paid to you' }),
        ]}
        visual={<SettlementCard />}
      />

      <Section labelledBy="journey-title">
        <SectionHeader
          id="journey-title"
          eyebrow={t('farmers.journey.eyebrow', { defaultValue: 'Your journey' })}
          title={<Trans t={t} i18nKey="farmers.journey.title" defaults="Six steps, <em>one place.</em>" components={em} />}
          lead={t('farmers.journey.lead', {
            defaultValue:
              'You stop chasing buyers, trucks and payments separately. MandiMate keeps the whole sale together, from the field to the final rupee.',
          })}
          layout="split"
        />
        <StepRail steps={steps} className="mt-14 md:mt-20" />
      </Section>

      <FaqSection id="farmer-faq" title={t('farmers.faq.title', { defaultValue: 'What farmers ask first' })} items={faq} tone="ivory" />

      <ClosingCta
        role="farmer"
        title={<Trans t={t} i18nKey="farmers.cta.title" defaults="Your next harvest deserves a <em>better deal.</em>" components={em} />}
        lead={t('farmers.cta.lead', {
          defaultValue: 'Sign up in a minute, or ask a field coordinator to list with you. It is free, and nothing is sold without your yes.',
        })}
        primaryLabel={t('farmers.cta.primary', { defaultValue: 'Join as a farmer' })}
        secondary={{ label: t('farmers.cta.secondary', { defaultValue: 'See how it works' }), to: '/how-it-works' }}
      />
    </>
  );
}
