import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { Contours } from '@/components/art';
import { Reveal } from '@/components/motion';
import { LinkButton } from '@/components/ui';
import { cn } from '@/lib/cn';
import { Em } from './primitives';

export interface CtaAction {
  to: string;
  label: string;
}

export interface CtaBandProps {
  id?: string;
  eyebrow?: ReactNode;
  title?: ReactNode;
  lead?: ReactNode;
  primary?: CtaAction;
  secondary?: CtaAction | null;
  /** Small promises under the buttons. */
  promises?: readonly string[];
  className?: string;
}

const DEFAULT_PROMISES = ['Free for farmers', 'No sale without your consent', 'Every deduction shown'] as const;

/** The closing call to action of a marketing page: a full-bleed deep-green band with rectangular buttons. */
export function CtaBand({
  id = 'cta-title',
  eyebrow: eyebrowProp,
  title: titleProp,
  lead: leadProp,
  primary: primaryProp,
  secondary: secondaryProp,
  promises: promisesProp,
  className,
}: CtaBandProps) {
  const { t } = useTranslation('marketing');
  const eyebrow = eyebrowProp ?? t('ctaBand.eyebrow', { defaultValue: 'Start with your next harvest' });
  const title = titleProp ?? (
    <Trans t={t} i18nKey="ctaBand.title" defaults="Your harvest deserves a <em>stronger</em> deal." components={{ em: <Em /> }} />
  );
  const lead =
    leadProp ??
    t('ctaBand.lead', {
      defaultValue:
        'List what is ready in a minute — by voice, photo or text. We will show you what you would take home before you decide anything.',
    });
  const primary = primaryProp ?? { to: '/signup', label: t('ctaBand.primary', { defaultValue: 'Create a free account' }) };
  const secondary =
    secondaryProp === undefined
      ? { to: '/calculator', label: t('ctaBand.secondary', { defaultValue: 'Calculate your net earnings' }) }
      : secondaryProp;
  const promises =
    promisesProp ?? DEFAULT_PROMISES.map((promise, index) => t(`ctaBand.promises.${index}`, { defaultValue: promise }));
  return (
    <section
      aria-labelledby={id}
      className={cn('surface-dark relative isolate overflow-hidden bg-forest-900 text-ivory', className)}
    >
      <Contours variant="ridge" className="text-white/[0.04]" />
      <Reveal className="content-container relative flex flex-col items-center py-24 text-center md:py-32">
        <p className="eyebrow eyebrow-rule">{eyebrow}</p>
        <h2
          id={id}
          className="mt-6 max-w-3xl font-display text-[2.375rem] font-bold leading-[1.04] tracking-[-0.025em] sm:text-display-md md:text-display-lg"
        >
          {title}
        </h2>
        {lead ? <p className="mt-6 max-w-[36rem] text-[17px] font-normal leading-relaxed text-ivory/70">{lead}</p> : null}
        <div className="mt-10 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center">
          <LinkButton
            to={primary.to}
            variant="inverse"
            size="lg"
           
            trailingIcon={<ArrowRight aria-hidden="true" strokeWidth={1.25} />}
          >
            {primary.label}
          </LinkButton>
          {secondary ? (
            <LinkButton
              to={secondary.to}
              variant="glass"
              size="lg"
             
            >
              {secondary.label}
            </LinkButton>
          ) : null}
        </div>
        {promises.length ? (
          <ul className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 border-t border-white/10 pt-6 text-[13px] font-semibold text-ivory/55">
            {promises.map((promise) => (
              <li key={promise} className="flex items-center gap-2.5">
                <span aria-hidden="true" className="size-1 rounded-full bg-gold-400" />
                {promise}
              </li>
            ))}
          </ul>
        ) : null}
      </Reveal>
    </section>
  );
}
