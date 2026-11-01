import { Trans, useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { PoolingMotif } from '@/components/art';
import { PageHero } from '@/components/marketing/PageHero';
import { PageSeo } from '@/components/marketing/PageSeo';
import { CheckList, Em, IllustrativeNote, Numeral, Section, SectionHeader, Tag } from '@/components/marketing/primitives';
import { Reveal } from '@/components/motion';
import { LinkButton } from '@/components/ui';

const PRINCIPLES = [
  {
    key: 'net',
    title: 'Net, not quoted',
    body: 'A price per kg is a promise; what reaches the farmer is a fact. We compare every offer on what is left after transport, handling, commission, rejection and the wait for payment.',
  },
  {
    key: 'consent',
    title: 'Consent before commerce',
    body: 'No harvest joins a sale until its farmer has seen their own number and said yes. If the deal changes, we ask again. A coordinator can help, but never decides.',
  },
  {
    key: 'honest',
    title: 'Honest when alone is better',
    body: 'If the mandi would pay a farmer more today, we say so. A marketplace that hides a better option has stopped working for the people it was built for.',
  },
  {
    key: 'certainty',
    title: 'Every number carries its certainty',
    body: 'Confirmed, estimated or quoted — each figure is marked for what it is. Farmers should never have to guess which numbers they can count on.',
  },
  {
    key: 'proof',
    title: 'Proof over promises',
    body: 'We record each pooled sale against what selling alone would have paid, and publish the results, including the sales where pooling did not help.',
  },
  {
    key: 'field',
    title: 'Built for the field',
    body: 'Voice notes, local languages, low bandwidth, shared phones and a coordinator nearby. Software should fit the way villages already work.',
  },
] as const;

const CLUSTER_REASONS = [
  { key: 'volatile', text: 'One of India’s busiest tomato markets, with prices that can swing sharply within a single week.' },
  { key: 'smallLoads', text: 'Many smallholders bring a few dozen crates at a time — too little to fill a truck or meet a large buyer’s minimum.' },
  { key: 'costs', text: 'Transport, loading, commission and rejected crates take a visible share of each sale, so the gap between quoted and net is real.' },
  { key: 'routes', text: 'Villages sit close enough together that one planned route can collect from several farms in a morning.' },
] as const;

const SUCCESS_SIGNS = [
  { key: 'net', text: 'Higher net earnings per kg than selling alone, on recorded sales.' },
  { key: 'transport', text: 'Lower transport cost per kg through shared, planned routes.' },
  { key: 'payment', text: 'Fewer days between delivery and payment.' },
  { key: 'return', text: 'Farmers who come back because the numbers were true.' },
] as const;

const EMPHASIS = { em: <Em>{null}</Em> };

export default function AboutPage() {
  const { t } = useTranslation('marketingInfo');

  return (
    <>
      <PageSeo path="/about" crumb="About" />
      <PageHero
        crumb={t('about.crumb', { defaultValue: 'About' })}
        eyebrow={t('about.hero.eyebrow', { defaultValue: 'Our mission' })}
        title={
          <Trans
            t={t}
            i18nKey="about.hero.title"
            defaults="Maximise what farmers <em>take home</em>, not the price they are quoted."
            components={EMPHASIS}
          />
        }
        lead={t('about.hero.lead', {
          defaultValue:
            'MandiMate pools small harvests into lots buyers want, and shows every farmer, in rupees, whether the pooled sale beats selling alone. Then we prove it, sale by sale.',
        })}
        actions={
          <>
            <LinkButton to="/how-it-works" variant="inverse" size="lg" trailingIcon={<ArrowRight strokeWidth={1.25} aria-hidden="true" className="size-4" />}>
              {t('about.hero.howItWorks', { defaultValue: 'How it works' })}
            </LinkButton>
            <LinkButton to="/contact" variant="glass" size="lg">
              {t('about.hero.talkToTeam', { defaultValue: 'Talk to the team' })}
            </LinkButton>
          </>
        }
        aside={<PoolingMotif animated className="mx-auto w-full max-w-md" />}
        furrows
      />

      <Section labelledBy="about-problem">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-10">
          <SectionHeader
            id="about-problem"
            className="lg:col-span-6"
            eyebrow={t('about.problem.eyebrow', { defaultValue: 'Why we exist' })}
            title={<Trans t={t} i18nKey="about.problem.title" defaults="A good price can still be a <em>bad sale</em>." components={EMPHASIS} />}
          />
          <Reveal className="flex flex-col gap-5 text-[17px] font-normal leading-relaxed text-ink-2 lg:col-span-6 lg:pt-14">
            <p>
              {t('about.problem.farmer', {
                defaultValue:
                  'A smallholder with a few crates of tomato has few choices. Hire a vehicle alone, pay for loading, hand over a commission, lose a share to rejection, then wait for payment. The rate on the board looks fine; the money in hand often does not.',
              })}
            </p>
            <p>
              {t('about.problem.buyer', {
                defaultValue:
                  'Buyers face the mirror image: they want consistent volume and grade, and cannot afford to negotiate with dozens of tiny sellers. The harvest exists. The deal does not.',
              })}
            </p>
            <p className="text-ink">
              {t('about.problem.answer', {
                defaultValue:
                  'MandiMate turns fragmented harvests into viable commercial deals — and makes the farmer’s net the number that decides whether a deal is worth doing.',
              })}
            </p>
          </Reveal>
        </div>
      </Section>

      <Section tone="parchment" labelledBy="about-principles" rule>
        <SectionHeader
          id="about-principles"
          layout="split"
          eyebrow={t('about.principles.eyebrow', { defaultValue: 'Principles' })}
          title={t('about.principles.title', { defaultValue: 'Six commitments we design around.' })}
          lead={t('about.principles.lead', {
            defaultValue: 'They decide what we build, what we refuse to build, and how we measure ourselves.',
          })}
        />
        <ol className="mt-16 grid gap-px border-y border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {PRINCIPLES.map((principle, index) => (
            <Reveal as="li" key={principle.key} delay={(index % 3) * 0.06} className="flex flex-col gap-4 bg-ivory px-1 py-9 sm:px-8 md:py-10">
              <Numeral value={index + 1} className="text-2xl" />
              <h3 className="font-display text-[1.6rem] font-bold leading-snug tracking-[-0.01em] text-ink">
                {t(`about.principles.items.${principle.key}.title`, { defaultValue: principle.title })}
              </h3>
              <p className="text-[15px] font-normal leading-relaxed text-ink-2">
                {t(`about.principles.items.${principle.key}.body`, { defaultValue: principle.body })}
              </p>
            </Reveal>
          ))}
        </ol>
      </Section>

      <Section tone="dark" labelledBy="about-cluster" contours="valley">
        <div className="grid gap-14 lg:grid-cols-12 lg:items-start lg:gap-10">
          <div className="flex flex-col gap-6 lg:col-span-6">
            <Tag tone="glass">{t('about.cluster.tag', { defaultValue: 'Pilot cluster' })}</Tag>
            <h2
              id="about-cluster"
              className="font-display font-bold text-[2.125rem] leading-[1.06] tracking-[-0.022em] sm:text-display-sm md:text-display-md"
            >
              <Trans t={t} i18nKey="about.cluster.title" defaults="Why we start in <em>Madanapalle</em>." components={EMPHASIS} />
            </h2>
            <p className="max-w-measure text-[17px] font-normal leading-relaxed text-ivory/72">
              {t('about.cluster.lead', {
                defaultValue:
                  'Madanapalle, in Andhra Pradesh’s Annamayya district, is a tomato town. It is the hardest and most useful place to test whether pooling actually leaves farmers with more money.',
              })}
            </p>
            <IllustrativeNote className="text-ivory/60">
              {t('about.cluster.note', {
                defaultValue: 'We begin with tomato and nearby vegetable crops, then widen only once the numbers hold up.',
              })}
            </IllustrativeNote>
          </div>
          <Reveal className="lg:col-span-6">
            <CheckList
              items={CLUSTER_REASONS.map((reason) => t(`about.cluster.reasons.${reason.key}`, { defaultValue: reason.text }))}
              className="text-ivory/85"
            />
          </Reveal>
        </div>
      </Section>

      <Section labelledBy="about-bharat">
        <div className="grid gap-12 lg:grid-cols-12 lg:items-center lg:gap-10">
          <SectionHeader
            id="about-bharat"
            className="lg:col-span-7"
            eyebrow={t('about.bharat.eyebrow', { defaultValue: 'Built for Build Your Bharat' })}
            title={
              <Trans
                t={t}
                i18nKey="about.bharat.title"
                defaults="Infrastructure for the farms that <em>feed</em> the country."
                components={EMPHASIS}
              />
            }
            lead={t('about.bharat.lead', {
              defaultValue:
                "MandiMate is being built for Build Your Bharat: practical technology for the smallholders who grow most of India's fruit and vegetables, measured by whether their incomes rise.",
            })}
          />
          <Reveal className="rounded-card border border-line bg-paper p-8 md:p-10 lg:col-span-5">
            <p className="eyebrow eyebrow-rule">{t('about.bharat.successTitle', { defaultValue: 'What success looks like' })}</p>
            <CheckList
              className="mt-6"
              items={SUCCESS_SIGNS.map((sign) => t(`about.bharat.success.${sign.key}`, { defaultValue: sign.text }))}
            />
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <LinkButton to="/impact" variant="primary">
                {t('about.bharat.seeHowWeMeasure', { defaultValue: 'See how we measure' })}
              </LinkButton>
              <LinkButton to="/faq" variant="ghost">
                {t('about.bharat.readFaq', { defaultValue: 'Read the FAQ' })}
              </LinkButton>
            </div>
          </Reveal>
        </div>
      </Section>
    </>
  );
}
