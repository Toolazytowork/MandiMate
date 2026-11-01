import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ArrowLeft, Building2, LifeBuoy, ShieldCheck, type LucideIcon } from 'lucide-react';

import { PageHeader } from '@/components/domain';
import { Reveal } from '@/components/motion';
import { LinkButton } from '@/components/ui';
import { routeMeta, Seo } from '@/lib/seo';

const meta = routeMeta('/forgot-password');

interface Route {
  icon: LucideIcon;
  title: string;
  body: string;
}

export default function ForgotPasswordPage() {
  const { t } = useTranslation('auth');

  const routes: Route[] = [
    {
      icon: Building2,
      title: t('forgot.coordinator.title', { defaultValue: 'Ask your FPO coordinator' }),
      body: t('forgot.coordinator.body', {
        defaultValue:
          'Farmers in a pilot FPO can reset in person. Your coordinator confirms it’s you and issues a temporary password on the spot.',
      }),
    },
    {
      icon: LifeBuoy,
      title: t('forgot.support.title', { defaultValue: 'Write to MandiMate support' }),
      body: t('forgot.support.body', {
        defaultValue:
          'Buyers, transporters and coordinators: send us the email or phone on your account. We verify and reply within one working day.',
      }),
    },
  ];

  return (
    <>
      <Seo {...meta} noindex />
      <Reveal>
        <PageHeader
          eyebrow={t('forgot.eyebrow', { defaultValue: 'Account recovery' })}
          title={t('forgot.title', { defaultValue: 'Reset your password' })}
          description={t('forgot.description', {
            defaultValue:
              'During the pilot, passwords are reset by a person — not an emailed link — so no one can take over an account on a shared phone.',
          })}
        />
      </Reveal>

      <Reveal delay={0.08}>
        <ol className="mt-10 flex flex-col">
          {routes.map((route, index) => (
            <li key={route.title} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-4 border-t border-line py-7 last:border-b">
              <span aria-hidden="true" className="font-display text-2xl font-bold not-italic leading-none text-gold-700 tabular-nums">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div>
                <p className="flex items-center gap-2 text-[13px] font-semibold text-muted">
                  <route.icon aria-hidden="true" strokeWidth={1.25} className="size-3.5" />
                  {t('forgot.option', { defaultValue: 'Option {{n}}', n: index + 1 })}
                </p>
                <h2 className="mt-2 font-display text-2xl font-bold leading-snug text-ink">{route.title}</h2>
                <p className="mt-2 text-[15px] font-normal leading-relaxed text-ink-2">{route.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Reveal>

      <Reveal delay={0.16}>
        <div className="mt-8 flex items-start gap-3 border-s border-gold-700 ps-4 text-sm font-normal leading-relaxed text-ink-2">
          <ShieldCheck aria-hidden="true" strokeWidth={1.25} className="mt-0.5 size-4 shrink-0 text-gold-700" />
          <p>
            {t('forgot.safety', {
              defaultValue:
                'MandiMate will never ask for your password, OTP or bank PIN — not on a call, not on WhatsApp. Change your temporary password after you sign in.',
            })}
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <LinkButton to="/contact" size="lg" className="sm:flex-1" leadingIcon={<LifeBuoy aria-hidden="true" strokeWidth={1.25} className="size-4" />}>
            {t('forgot.contact', { defaultValue: 'Contact support' })}
          </LinkButton>
          <LinkButton
            to="/login"
            variant="secondary"
            size="lg"
            className="sm:flex-1"
            leadingIcon={<ArrowLeft aria-hidden="true" strokeWidth={1.25} className="size-4" />}
          >
            {t('forgot.back', { defaultValue: 'Back to sign in' })}
          </LinkButton>
        </div>

        <p className="mt-10 flex flex-wrap items-baseline justify-between gap-3 border-t border-line pt-6 text-sm font-normal text-ink-2">
          {t('forgot.demoHint', { defaultValue: 'Exploring the demo?' })}
          <Link
            to="/login"
            className="inline-flex items-center gap-2 border-b border-ink/40 pb-1 text-[13px] font-semibold text-ink transition-colors hover:border-ink"
          >
            {t('forgot.demoLink', { defaultValue: 'Every demo account shares one password' })}
            <span aria-hidden="true">→</span>
          </Link>
        </p>
      </Reveal>
    </>
  );
}
