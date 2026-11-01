import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { Contours } from '@/components/art';
import { Logo, LogoMark } from '@/components/brand/Logo';
import { LinkButton } from '@/components/ui';
import { FOOTER_COLUMNS, LEGAL_LINKS } from './siteNavigation';

/** Editorial dark footer: closing statement, link columns, legal line and language note. */
export function Footer() {
  const { t } = useTranslation('common');
  const year = new Date().getFullYear();

  return (
    <footer className="surface-dark relative isolate overflow-hidden bg-forest-900">
      <Contours variant="basin" className="text-ivory/[0.04]" />

      <div className="content-container relative">
        <div className="grid gap-10 border-b border-ivory/10 py-24 md:py-32 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-7">
            <p className="eyebrow eyebrow-rule">{t('layout.footer.eyebrow', { defaultValue: 'Made for farmers of Bharat' })}</p>
            <h2 className="mt-8 font-display text-display-sm font-bold text-ivory md:text-display-md xl:text-display-lg">
              {t('layout.footer.statementStart', { defaultValue: 'Better deals. Shared logistics.' })}{' '}
              <em className="not-italic text-gold-400">
                {t('layout.footer.statementEmphasis', { defaultValue: 'More money' })}
              </em>{' '}
              {t('layout.footer.statementEnd', { defaultValue: 'for farmers.' })}
            </h2>
          </div>
          <div className="flex flex-col justify-end gap-8 lg:col-span-4 lg:col-start-9">
            <p className="max-w-measure text-[16px] font-normal leading-relaxed text-ivory/70">
              {t('layout.footer.summary', {
                defaultValue:
                  'MandiMate pools small harvests into buyer-ready lots, shares the trip to market and shows every farmer what they will truly take home — before they say yes.',
              })}
            </p>
            <div className="flex flex-wrap gap-3">
              <LinkButton to="/signup" variant="gold" trailingIcon={<ArrowRight strokeWidth={1.25} />}>
                {t('nav.public.getStarted', { defaultValue: 'Get started' })}
              </LinkButton>
              <LinkButton to="/calculator" variant="glass">
                {t('nav.public.calculator', { defaultValue: 'Earnings calculator' })}
              </LinkButton>
            </div>
          </div>
        </div>

        <nav
          aria-label={t('a11y.footerNavigation', { defaultValue: 'Footer navigation' })}
          className="grid grid-cols-2 gap-x-6 gap-y-12 py-16 md:grid-cols-12 md:gap-x-8"
        >
          <div className="col-span-2 md:col-span-5">
            <Link to="/" className="inline-flex rounded-sm" aria-label={t('layout.site.homeLink', { defaultValue: 'MandiMate home' })}>
              <Logo variant="dark" size="lg" />
            </Link>
            <p className="mt-6 max-w-xs text-sm font-normal leading-relaxed text-ivory/60">
              {t('layout.footer.about', {
                defaultValue: 'A farmer-first marketplace for pooled harvests, shared transport and honest net earnings.',
              })}
            </p>
          </div>
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.id} className="md:col-span-2 last:col-span-2 md:last:col-span-3">
              <h3 className="font-sans text-[13px] font-semibold text-gold-400">
                {t(column.labelKey, { defaultValue: column.label })}
              </h3>
              <ul className="mt-5 flex flex-col gap-3">
                {column.links.map((link) => (
                  <li key={link.to}>
                    <Link to={link.to} className="link-luxe text-[15px] font-normal text-ivory/75 transition-colors hover:text-ivory">
                      {t(link.labelKey, { defaultValue: link.label })}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="flex flex-col gap-5 border-t border-ivory/10 py-8 text-[12px] text-ivory/55 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="tabular-nums" suppressHydrationWarning>
              © {year} MandiMate
            </span>
            <ul className="flex items-center gap-5">
              {LEGAL_LINKS.map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className="link-luxe transition-colors hover:text-ivory">
                    {t(link.labelKey, { defaultValue: link.label })}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <p>
            {t('layout.footer.languages', { defaultValue: 'Available in' })}{' '}
            <span lang="en">English</span>, <span lang="hi">हिन्दी</span> {t('layout.footer.and', { defaultValue: 'and' })}{' '}
            <span lang="te">తెలుగు</span>
          </p>
          <p className="inline-flex items-center gap-2 text-ivory/70">
            <LogoMark className="size-5 text-ivory/80" />
            {t('layout.footer.madeFor', { defaultValue: 'Made for farmers of Bharat' })}
          </p>
        </div>
      </div>
    </footer>
  );
}
