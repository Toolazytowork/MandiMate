import { ArrowLeft, Compass } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';

import { Button, LinkButton } from '@/components/ui';
import { roleHome, useAuth } from '@/lib/auth';
import { Seo } from '@/lib/seo';

/** Field furrows converging on a single gold pin — the lost path, found again. */
function FurrowArt() {
  return (
    <svg viewBox="0 0 480 360" aria-hidden="true" className="h-full w-full" fill="none">
      <rect width="480" height="360" fill="var(--color-forest-950)" />
      {Array.from({ length: 11 }, (_, i) => {
        const offset = i * 34 - 20;
        return (
          <path
            key={i}
            d={`M ${offset - 120} 380 C ${offset + 40} 250, ${offset + 120} 190, 330 132`}
            stroke="white"
            strokeOpacity={0.06 + (i % 3) * 0.02}
            strokeWidth="1.25"
          />
        );
      })}
      <circle cx="330" cy="132" r="18" stroke="var(--color-gold-400)" strokeOpacity="0.45" strokeWidth="1" />
      <circle cx="330" cy="132" r="3" fill="var(--color-gold-400)" />
      <text
        x="40"
        y="316"
        fill="var(--color-ivory)"
        fillOpacity="0.9"
        fontFamily="var(--font-display)"
        fontSize="96"
        fontWeight="300"
        letterSpacing="-3"
      >
        404
      </text>
    </svg>
  );
}

export default function NotFoundPage() {
  const { t } = useTranslation('common');
  const location = useLocation();
  const navigate = useNavigate();
  const { pathname } = location;
  /** The first entry of a session has nowhere to go back to. */
  const canGoBack = location.key !== 'default';
  const { user } = useAuth();
  const inApp = pathname.startsWith('/app');
  const home = inApp && user ? roleHome(user.role) : '/';

  return (
    <section className="mx-auto grid w-full max-w-content items-center gap-12 px-5 py-20 md:grid-cols-[1.1fr_1fr] md:px-8 md:py-32">
      <Seo title={t('notFound.title')} description={t('notFound.description')} path={pathname} noindex />
      <div>
        <p className="eyebrow eyebrow-rule">{t('notFound.eyebrow')}</p>
        <h1 className="mt-6 font-display text-display-md font-bold text-ink">
          {t('notFound.headingStart')} <em className="not-italic text-gold-700">{t('notFound.headingEmphasis')}</em>
        </h1>
        <p className="mt-6 max-w-measure text-[17px] font-normal leading-relaxed text-ink-2">{t('notFound.body')}</p>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <LinkButton to={home} variant="primary" size="lg" leadingIcon={<Compass strokeWidth={1.25} />}>
            {inApp && user ? t('actions.goToDashboard') : t('actions.backToHome')}
          </LinkButton>
          {canGoBack ? (
            <Button variant="ghost" size="lg" leadingIcon={<ArrowLeft strokeWidth={1.25} />} onClick={() => navigate(-1)}>
              {t('actions.goBack')}
            </Button>
          ) : null}
        </div>
        {!inApp ? (
          <nav aria-label={t('notFound.suggestions')} className="mt-12 border-t border-line pt-6">
            <p className="text-[13px] font-semibold text-muted">{t('notFound.suggestions')}</p>
            <ul className="mt-4 flex flex-wrap gap-x-8 gap-y-3 text-[13px] font-semibold">
              <li>
                <Link to="/how-it-works" className="border-b border-transparent pb-1 text-ink transition-colors hover:border-gold-700">
                  {t('nav.public.howItWorks')}
                </Link>
              </li>
              <li>
                <Link to="/calculator" className="border-b border-transparent pb-1 text-ink transition-colors hover:border-gold-700">
                  {t('nav.public.calculator')}
                </Link>
              </li>
              <li>
                <Link to="/faq" className="border-b border-transparent pb-1 text-ink transition-colors hover:border-gold-700">
                  {t('nav.public.faq')}
                </Link>
              </li>
              <li>
                <Link to="/contact" className="border-b border-transparent pb-1 text-ink transition-colors hover:border-gold-700">
                  {t('nav.public.contact')}
                </Link>
              </li>
            </ul>
          </nav>
        ) : null}
      </div>
      <div className="aspect-[4/3] w-full overflow-hidden rounded-sm">
        <FurrowArt />
      </div>
    </section>
  );
}
