import type { CSSProperties } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { Contours, FieldLines } from '@/components/art';
import { LinkButton } from '@/components/ui';
import { Em } from '../primitives';
import { DealCard } from './DealCard';

/** CSS-only entrance: prerendered HTML is never stuck hidden. */
const enter = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

const PROMISES = [
  { key: 'free', text: 'Free for farmers' },
  { key: 'consent', text: 'No sale without your consent' },
  { key: 'fees', text: 'Every fee and deduction shown' },
] as const;

const CTA = '';

/** The full-bleed deep-green hero: headline, net-earnings promise, CTAs and the illustrative deal panel. */
export function HomeHero() {
  const { t } = useTranslation('marketingHome');
  return (
    <section
      aria-labelledby="home-title"
      className="surface-dark relative isolate overflow-hidden bg-forest-900 text-ivory"
    >
      <Contours variant="ridge" className="text-white/[0.045]" />
      <FieldLines className="top-auto h-[38%] text-gold-400/[0.06]" />

      <div className="content-container relative grid gap-16 pb-20 pt-16 md:pb-28 md:pt-24 lg:grid-cols-12 lg:items-center lg:gap-14 lg:pb-32 lg:pt-28">
        <div className="flex min-w-0 flex-col lg:col-span-7">
          <p className="eyebrow eyebrow-rule animate-fade-up" style={enter(0)}>
            {t('hero.eyebrow', { defaultValue: 'Farmer-first marketplace · Madanapalle' })}
          </p>
          <h1
            id="home-title"
            className="mt-8 animate-fade-up font-display text-[3rem] font-bold leading-[0.98] tracking-[-0.03em] sm:text-display-xl lg:text-display-2xl"
            style={enter(80)}
          >
            <Trans
              t={t}
              i18nKey="hero.title"
              defaults="Small harvests.<br/><em>Stronger deals.</em>"
              components={{ br: <br />, em: <Em>{null}</Em> }}
            />
          </h1>
          <p
            className="mt-8 max-w-[36rem] animate-fade-up text-[17px] font-normal leading-relaxed text-ivory/72 md:text-lg md:leading-relaxed"
            style={enter(160)}
          >
            <Trans
              t={t}
              i18nKey="hero.lead"
              defaults="MandiMate pools harvests from neighbouring farms into lots buyers want, then shows every farmer what they would <strong>actually take home</strong> — after transport, handling, commission, rejection and the wait for payment — before they agree to anything."
              components={{ strong: <span className="text-ivory" /> }}
            />
          </p>
          <div
            className="mt-11 flex animate-fade-up flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center"
            style={enter(240)}
          >
            <LinkButton
              to="/signup"
              variant="inverse"
              size="lg"
              className={CTA}
              trailingIcon={<ArrowRight aria-hidden="true" strokeWidth={1.25} />}
            >
              {t('hero.ctaPrimary', { defaultValue: 'List your harvest' })}
            </LinkButton>
            <LinkButton to="/how-it-works" variant="glass" size="lg" className={CTA}>
              {t('hero.ctaSecondary', { defaultValue: 'See how it works' })}
            </LinkButton>
          </div>
        </div>

        <div className="relative animate-fade-up lg:col-span-5" style={enter(220)}>
          <DealCard />
        </div>
      </div>

      <div className="relative border-t border-white/10">
        <ul
          className="content-container flex animate-fade-up flex-wrap items-center gap-x-10 gap-y-3 py-5 text-[13px] font-semibold text-ivory/55"
          style={enter(320)}
        >
          {PROMISES.map((promise) => (
            <li key={promise.key} className="flex items-center gap-2.5">
              <span aria-hidden="true" className="size-1 rounded-full bg-gold-400" />
              {t(`hero.promises.${promise.key}`, { defaultValue: promise.text })}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
