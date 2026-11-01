import { Trans, useTranslation } from 'react-i18next';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Reveal } from '@/components/motion';
import { CtaBand } from '@/components/marketing/CtaBand';
import { JOURNEY_STEPS } from '@/components/marketing/journey';
import { PageHero } from '@/components/marketing/PageHero';
import { PageSeo } from '@/components/marketing/PageSeo';
import { CheckList, Em, Numeral, Section, SectionHeader } from '@/components/marketing/primitives';
import { LinkButton } from '@/components/ui';
import { cn } from '@/lib/cn';
import { howTo } from '@/lib/seo';

const JSON_LD = [howTo(JOURNEY_STEPS.map((step) => ({ name: step.title, text: step.detail })))];

const PHASES = [
  { id: 'before', label: 'Before the deal', steps: [1, 2, 3, 4], tone: 'Listing, pooling, offers and the net comparison.' },
  { id: 'decision', label: 'The decision', steps: [5], tone: 'Each farmer accepts or declines.' },
  { id: 'after', label: 'After the deal', steps: [6, 7, 8], tone: 'Pickup, delivery, quality and payment.' },
] as const;

const PROMISES = [
  'Free for farmers — MandiMate charges buyers',
  'No sale without each farmer’s consent',
  'Net earnings shown before any decision',
  'Every fee and deduction on the screen',
] as const;

function HeroAside() {
  const { t } = useTranslation('marketing');
  const promises = PROMISES.map((promise, index) => t(`howItWorks.promises.${index}`, { defaultValue: promise }));
  return (
    <div className="border-y border-white/15 py-8">
      <p className="eyebrow">{t('howItWorks.phases.eyebrow', { defaultValue: 'Three phases, one record' })}</p>
      <ol className="mt-6 flex flex-col gap-5">
        {PHASES.map((phase) => (
          <li key={phase.label} className="grid grid-cols-[auto_1fr] gap-4">
            <span className="flex gap-1 pt-1.5" aria-hidden="true">
              {phase.steps.map((n) => (
                <span key={n} className="size-1.5 rounded-full bg-gold-400" />
              ))}
            </span>
            <span>
              <span className="block font-medium text-ivory">
                {t(`howItWorks.phases.${phase.id}.label`, { defaultValue: phase.label })}
              </span>
              <span className="mt-0.5 block text-[13.5px] leading-relaxed text-ivory/60">
                {phase.steps.length > 1
                  ? t('howItWorks.phases.stepRange', {
                      defaultValue: 'Steps {{from}}–{{to}}',
                      from: phase.steps[0],
                      to: phase.steps[phase.steps.length - 1],
                    })
                  : t('howItWorks.phases.stepSingle', { defaultValue: 'Steps {{n}}', n: phase.steps[0] })}{' '}
                · {t(`howItWorks.phases.${phase.id}.tone`, { defaultValue: phase.tone })}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <span aria-hidden="true" className="hairline my-6" />
      <CheckList dense items={promises} className="text-ivory/80" />
    </div>
  );
}

export default function HowItWorksPage() {
  const { t } = useTranslation('marketing');
  const crumb = t('howItWorks.crumb', { defaultValue: 'How it works' });
  return (
    <>
      <PageSeo path="/how-it-works" crumb={crumb} jsonLd={JSON_LD} />
      <PageHero
        crumb={crumb}
        eyebrow={t('howItWorks.hero.eyebrow', { defaultValue: 'How MandiMate works' })}
        title={
          <Trans
            t={t}
            i18nKey="howItWorks.hero.title"
            defaults="From harvest to <em>payment</em>, in eight steps."
            components={{ em: <Em /> }}
          />
        }
        lead={t('howItWorks.hero.lead', {
          defaultValue:
            'MandiMate connects the whole sale into one workflow — pooling, offers, net-earnings comparison, consent, shared transport, delivery checks and settlement — and keeps going until the money reaches the farmer.',
        })}
        actions={
          <>
            <LinkButton to="/signup" variant="inverse" size="lg" trailingIcon={<ArrowRight strokeWidth={1.25} aria-hidden="true" />}>
              {t('howItWorks.hero.primary', { defaultValue: 'List your harvest — free' })}
            </LinkButton>
            <LinkButton to="/calculator" variant="glass" size="lg">
              {t('howItWorks.hero.secondary', { defaultValue: 'Calculate your net earnings' })}
            </LinkButton>
          </>
        }
        aside={<HeroAside />}
        furrows
      />

      <Section id="steps" tone="ivory" labelledBy="steps-title">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
          <aside className="hidden lg:col-span-4 lg:block">
            <nav aria-label={t('howItWorks.steps.navLabel', { defaultValue: 'Journey steps' })} className="sticky top-28">
              <p className="eyebrow eyebrow-rule">{t('howItWorks.steps.navEyebrow', { defaultValue: 'The journey' })}</p>
              <ol className="mt-6 flex flex-col border-s border-line">
                {JOURNEY_STEPS.map((step) => (
                  <li key={step.slug}>
                    <a
                      href={`#${step.slug}`}
                      className="-ms-px flex items-baseline gap-3 border-s border-transparent py-2.5 ps-5 text-[14.5px] text-muted transition-colors hover:border-gold-500 hover:text-ink"
                    >
                      <span className="w-6 font-display tabular-nums text-gold-700">{String(step.n).padStart(2, '0')}</span>
                      {t(`journey.${step.slug}.title`, { defaultValue: step.title })}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>

          <div className="lg:col-span-8">
            <SectionHeader
              id="steps-title"
              eyebrow={t('howItWorks.steps.eyebrow', { defaultValue: 'Step by step' })}
              title={
                <Trans
                  t={t}
                  i18nKey="howItWorks.steps.title"
                  defaults="What happens, who acts, and what <em>protects</em> the farmer."
                  components={{ em: <Em /> }}
                />
              }
              lead={t('howItWorks.steps.lead', {
                defaultValue:
                  'Each step has an owner, a clear output and a rule that keeps the farmer in control. Nothing moves forward on a guess.',
              })}
            />
            <ol className="mt-14 flex flex-col">
              {JOURNEY_STEPS.map((step) => {
                const Icon = step.icon;
                const sees = step.sees.map((item, index) =>
                  t(`journey.${step.slug}.sees.${index}`, { defaultValue: item }),
                );
                return (
                  <Reveal
                    as="li"
                    key={step.slug}
                    id={step.slug}
                    className={cn(
                      'scroll-mt-28 border-t border-line py-12 first:border-t-0 first:pt-0',
                      step.n === 5 && 'relative',
                    )}
                  >
                    <article aria-labelledby={`${step.slug}-title`} className="grid gap-6 sm:grid-cols-[5.5rem_1fr]">
                      <div className="flex items-center gap-4 sm:flex-col sm:items-start">
                        <Numeral value={step.n} className="text-[2.75rem] leading-none sm:text-[3.5rem]" />
                        <Icon aria-hidden="true" strokeWidth={1.25} className="size-5 text-muted" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-muted">
                          {t(`journey.${step.slug}.who`, { defaultValue: step.who })}
                        </p>
                        <h3
                          id={`${step.slug}-title`}
                          className="mt-2 font-display font-bold text-[1.875rem] leading-tight tracking-[-0.018em] text-ink sm:text-[2.125rem]"
                        >
                          {t(`journey.${step.slug}.title`, { defaultValue: step.title })}
                        </h3>
                        <p className="mt-4 max-w-measure text-[16px] font-normal leading-relaxed text-ink-2">
                          {t(`journey.${step.slug}.detail`, { defaultValue: step.detail })}
                        </p>
                        <div className="mt-8 grid gap-x-10 gap-y-6 border-t border-line pt-6 md:grid-cols-[1.2fr_1fr]">
                          <div>
                            <p className="eyebrow">{t('howItWorks.steps.whatYouSee', { defaultValue: 'What you see' })}</p>
                            <CheckList dense items={sees} className="mt-4" />
                          </div>
                          <div className="md:border-s md:border-line md:ps-10">
                            <p className="flex items-center gap-2 text-[13px] font-semibold text-gold-700">
                              <ShieldCheck aria-hidden="true" strokeWidth={1.25} className="size-4" />
                              {t('howItWorks.steps.safeguard', { defaultValue: 'Safeguard' })}
                            </p>
                            <p className="mt-3 font-display text-[1.15rem] not-italic leading-relaxed text-ink-2">
                              {t(`journey.${step.slug}.safeguard`, { defaultValue: step.safeguard })}
                            </p>
                          </div>
                        </div>
                      </div>
                    </article>
                  </Reveal>
                );
              })}
            </ol>
          </div>
        </div>
      </Section>

      <Section tone="parchment" spacing="compact" labelledBy="stop-title" rule>
        <div className="grid gap-10 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-7">
            <SectionHeader
              id="stop-title"
              eyebrow={t('howItWorks.stop.eyebrow', { defaultValue: 'Why all eight matter' })}
              title={
                <Trans
                  t={t}
                  i18nKey="howItWorks.stop.title"
                  defaults="Most platforms stop at step three. The farmer’s money is made in the <em>other five</em>."
                  components={{ em: <Em /> }}
                />
              }
              lead={t('howItWorks.stop.lead', {
                defaultValue:
                  'Rejections at the gate, a half-empty truck, an unpaid invoice — that is where small farmers lose what a better price promised. MandiMate is built to carry the deal through to settlement and record what the farmer actually earned.',
              })}
            />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row lg:col-span-5 lg:justify-end">
            <LinkButton to="/calculator" variant="primary" size="lg" trailingIcon={<ArrowRight strokeWidth={1.25} aria-hidden="true" />}>
              {t('howItWorks.stop.primary', { defaultValue: 'See the net difference' })}
            </LinkButton>
            <LinkButton to="/faq" variant="secondary" size="lg">
              {t('howItWorks.stop.secondary', { defaultValue: 'Read the FAQ' })}
            </LinkButton>
          </div>
        </div>
      </Section>

      <CtaBand />
    </>
  );
}
