import { Trans, useTranslation } from 'react-i18next';
import { Reveal } from '@/components/motion';
import { cn } from '@/lib/cn';
import { JOURNEY_STEPS } from '../journey';
import { ArrowLink, Em, Numeral, Section, SectionHeader } from '../primitives';

/** The eight-step journey on a dark field; marks where listing apps stop and MandiMate continues. */
export function JourneySection() {
  const { t } = useTranslation('marketing');
  return (
    <Section id="journey" tone="dark" labelledBy="journey-title" contours="ridge">
      <SectionHeader
        id="journey-title"
        layout="split"
        eyebrow={t('journeySection.eyebrow', { defaultValue: 'The whole journey' })}
        title={
          <Trans
            t={t}
            i18nKey="journeySection.title"
            defaults="From harvest to <em>payment</em>, in eight steps."
            components={{ em: <Em /> }}
          />
        }
        lead={t('journeySection.lead', {
          defaultValue:
            'A listing app stops once a buyer is found. MandiMate keeps going — through consent, pickup, delivery and quality checks — until the money reaches the farmer and the result is recorded.',
        })}
      >
        <ArrowLink to="/how-it-works">{t('journeySection.link', { defaultValue: 'Every step in detail' })}</ArrowLink>
      </SectionHeader>

      <ol className="mt-20 grid gap-px border-y border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
        {JOURNEY_STEPS.map((step, index) => {
          const Icon = step.icon;
          const beyond = step.n > 3;
          return (
            <Reveal
              as="li"
              key={step.slug}
              delay={(index % 4) * 0.06}
              className={cn('relative flex flex-col bg-forest-900 px-1 py-8 sm:px-6 md:py-10', beyond && 'bg-forest-950')}
            >
              <div className="flex items-center justify-between">
                <Numeral value={step.n} className="text-[2.25rem] leading-none text-gold-400" />
                <Icon aria-hidden="true" strokeWidth={1.25} className="size-5 text-ivory/40" />
              </div>
              <h3 className="mt-10 font-display text-[1.4rem] font-bold leading-snug tracking-[-0.01em] text-ivory">
                {t(`journey.${step.slug}.title`, { defaultValue: step.title })}
              </h3>
              <p className="mt-3 text-[14px] font-normal leading-relaxed text-ivory/62">
                {t(`journey.${step.slug}.short`, { defaultValue: step.short })}
              </p>
            </Reveal>
          );
        })}
      </ol>

      <div className="mt-6 grid gap-3 text-[13px] font-semibold sm:grid-cols-[3fr_5fr] lg:grid-cols-[3fr_5fr]">
        <p className="flex items-center gap-3 text-ivory/50">
          <span aria-hidden="true" className="h-px flex-1 bg-white/20" />
          {t('journeySection.marketplacesStop', { defaultValue: 'Where most marketplaces stop' })}
        </p>
        <p className="flex items-center gap-3 text-gold-400">
          <span aria-hidden="true" className="hairline-gold flex-1" />
          {t('journeySection.mandimateContinues', { defaultValue: 'Where MandiMate keeps going' })}
        </p>
      </div>
    </Section>
  );
}
