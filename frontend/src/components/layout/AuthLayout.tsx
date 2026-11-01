import { useTranslation } from 'react-i18next';
import { Link, Outlet } from 'react-router';
import { ArrowLeft, Combine, ReceiptText, ShieldCheck, type LucideIcon } from 'lucide-react';
import { Contours, PoolingMotif } from '@/components/art';
import { Logo } from '@/components/brand/Logo';
import { LanguageSwitcher } from './LanguageSwitcher';
import { SkipLink } from './SkipLink';
import { LEGAL_LINKS } from './siteNavigation';

interface ProofPoint {
  icon: LucideIcon;
  titleKey: string;
  title: string;
  bodyKey: string;
  body: string;
}

const PROOF_POINTS: readonly ProofPoint[] = [
  {
    icon: ReceiptText,
    titleKey: 'layout.auth.proof.net.title',
    title: 'Net earnings, not quoted prices',
    bodyKey: 'layout.auth.proof.net.body',
    body: 'Transport, commission, rejection and payment wait are shown before you agree.',
  },
  {
    icon: Combine,
    titleKey: 'layout.auth.proof.pool.title',
    title: 'Pool with your neighbours',
    bodyKey: 'layout.auth.proof.pool.body',
    body: 'Small harvests become buyer-ready lots with one shared pickup.',
  },
  {
    icon: ShieldCheck,
    titleKey: 'layout.auth.proof.consent.title',
    title: 'Nothing sells without your yes',
    bodyKey: 'layout.auth.proof.consent.body',
    body: 'Every deal waits for your consent — and every fee is written down.',
  },
];

/**
 * Split-screen frame for sign-in, sign-up and password recovery: a dark editorial panel with art
 * and proof points on the left, the routed form on the right. Stacks on phones.
 */
export function AuthLayout() {
  const { t } = useTranslation('common');

  return (
    <div className="min-h-dvh bg-ivory lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,11fr)_minmax(0,12fr)]">
      <SkipLink />

      <aside className="surface-dark relative isolate overflow-hidden bg-forest-900 lg:sticky lg:top-0 lg:h-dvh">
        <Contours variant="ridge" className="text-ivory/[0.05]" />

        <div className="relative flex h-full flex-col px-5 pb-8 pt-5 sm:px-10 lg:px-14 lg:py-12 xl:px-16">
          <Link to="/" className="self-start rounded-sm" aria-label={t('layout.site.homeLink', { defaultValue: 'MandiMate home' })}>
            <Logo variant="dark" />
          </Link>

          <div className="mt-8 lg:my-auto lg:py-12">
            <p className="eyebrow eyebrow-rule">{t('layout.auth.eyebrow', { defaultValue: 'A farmer-first marketplace' })}</p>
            <p className="mt-5 max-w-xl font-display text-h1 font-bold leading-[1.1] tracking-[-0.01em] text-ivory sm:text-display-sm lg:mt-8 lg:text-display-md xl:text-display-lg">
              {t('layout.auth.headlineStart', { defaultValue: 'Every harvest, priced for what it' })}{' '}
              <em className="not-italic text-gold-400">{t('layout.auth.headlineEmphasis', { defaultValue: 'truly earns.' })}</em>
            </p>

            <ol className="mt-12 hidden max-w-md flex-col border-t border-ivory/10 lg:flex">
              {PROOF_POINTS.map((point, index) => (
                <li key={point.titleKey} className="flex gap-5 border-b border-ivory/10 py-5">
                  <span aria-hidden="true" className="w-6 shrink-0 font-display text-[18px] not-italic leading-6 text-gold-400">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span>
                    <span className="block text-[15px] font-normal text-ivory">
                      {t(point.titleKey, { defaultValue: point.title })}
                    </span>
                    <span className="mt-1 block text-sm font-normal leading-relaxed text-ivory/65">
                      {t(point.bodyKey, { defaultValue: point.body })}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <figure className="hidden grid-cols-[7rem_minmax(0,1fr)] items-center gap-x-6 border-t border-ivory/10 pt-8 lg:grid">
            <PoolingMotif tone="dark" className="row-span-2 w-28" />
            <blockquote className="font-display text-[19px] font-bold not-italic leading-snug text-ivory/80">
              <p>
                {t('layout.auth.promise', {
                  defaultValue:
                    'Twenty small harvests can travel as one lot. MandiMate does the pooling, the paperwork and the arithmetic — you keep the say.',
                })}
              </p>
            </blockquote>
            <figcaption className="mt-3 self-start text-[13px] font-semibold text-gold-400">
              {t('layout.auth.promiseCaption', { defaultValue: 'The MandiMate promise' })}
            </figcaption>
          </figure>
        </div>
      </aside>

      <div className="flex min-h-[70dvh] flex-col lg:min-h-dvh">
        <div className="flex items-center justify-between gap-4 px-5 py-5 sm:px-10">
          <Link
            to="/"
            className="group inline-flex items-center gap-2 rounded-sm text-[13px] font-semibold text-muted transition-colors hover:text-ink"
          >
            <ArrowLeft
              aria-hidden="true"
              strokeWidth={1.25}
              className="size-3.5 transition-transform duration-300 ease-luxe group-hover:-translate-x-0.5"
            />
            {t('actions.backToHome', { defaultValue: 'Back to home' })}
          </Link>
          <LanguageSwitcher className="hidden sm:flex" />
        </div>

        <main id="main" tabIndex={-1} className="flex flex-1 items-start justify-center px-5 pb-16 pt-6 outline-none sm:px-10 lg:items-center lg:pt-0">
          <div className="w-full max-w-[440px]">
            <Outlet />
          </div>
        </main>

        <div className="flex flex-col items-center gap-4 px-5 pb-8 sm:flex-row sm:justify-between sm:px-10">
          <LanguageSwitcher className="sm:hidden" />
          <ul className="flex items-center gap-5 text-[13px] text-muted">
            {LEGAL_LINKS.map((link) => (
              <li key={link.to}>
                <Link to={link.to} className="link-luxe transition-colors hover:text-ink">
                  {t(link.labelKey, { defaultValue: link.label })}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
