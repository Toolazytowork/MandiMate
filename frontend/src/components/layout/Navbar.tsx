import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useLocation } from 'react-router';
import { ArrowRight, ArrowUpRight, ChevronDown, Menu, X } from 'lucide-react';
import { Contours } from '@/components/art';
import { Logo } from '@/components/brand/Logo';
import { DURATION, EASE_LUXE, STAGGER } from '@/components/motion/tokens';
import { IconButton, LinkButton, Portal, useOverlay, useScrollLock } from '@/components/ui';
import { roleHome, useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { LanguageSwitcher } from './LanguageSwitcher';
import { COMPANY_LINKS, PRIMARY_LINKS, SOLUTIONS } from './siteNavigation';

function useScrolled(threshold: number): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > threshold);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [threshold]);
  return scrolled;
}

const linkClasses = (active: boolean) =>
  cn(
    'relative inline-flex h-10 items-center gap-1.5 whitespace-nowrap px-3 text-[13px] font-semibold transition-colors duration-300',
    active ? 'text-ink' : 'text-ink-2 hover:text-ink',
  );

function ActiveDot({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'absolute inset-x-3 bottom-1.5 h-px bg-gold-700 transition-opacity duration-300',
        active ? 'opacity-100' : 'opacity-0',
      )}
    />
  );
}

/** Sticky 80 px ivory navbar with a hairline bottom border. */
export function Navbar() {
  const { t } = useTranslation('common');
  const { status, user } = useAuth();
  const scrolled = useScrolled(8);
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const signedIn = status === 'authenticated' && user !== null;

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <header
      className={cn(
        'sticky top-0 z-40 border-b border-line bg-ivory/95 transition-[background-color] duration-500 ease-luxe',
        scrolled ? 'bg-ivory/[0.97]' : 'bg-ivory/95',
      )}
    >
      <div className="content-container flex h-20 items-center gap-4">
        <Link to="/" className="shrink-0 rounded-sm" aria-label={t('layout.site.homeLink', { defaultValue: 'MandiMate home' })}>
          <Logo />
        </Link>

        <nav aria-label={t('a11y.mainNavigation', { defaultValue: 'Main navigation' })} className="hidden flex-1 lg:block">
          <ul className="flex items-center justify-center xl:gap-2">
            <li>
              <SolutionsMenu />
            </li>
            {PRIMARY_LINKS.map((link) => (
              <li key={link.to}>
                <NavLink to={link.to} className={({ isActive }) => linkClasses(isActive)}>
                  {({ isActive }) => (
                    <>
                      {t(link.labelKey, { defaultValue: link.label })}
                      <ActiveDot active={isActive} />
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ms-auto flex items-center gap-1.5 sm:gap-2">
          <LanguageSwitcher className="me-2 hidden md:flex lg:hidden xl:flex" />
          <LanguageSwitcher compact className="hidden lg:flex xl:hidden" />
          {signedIn ? (
            <LinkButton to={roleHome(user.role)} size="sm" trailingIcon={<ArrowRight strokeWidth={1.25} />}>
              {t('nav.public.openApp', { defaultValue: 'Open MandiMate' })}
            </LinkButton>
          ) : (
            <>
              <Link to="/login" className={cn(linkClasses(false), 'hidden sm:inline-flex')}>
                {t('nav.public.login', { defaultValue: 'Sign in' })}
              </Link>
              <LinkButton to="/signup" variant="primary" size="sm">
                {t('nav.public.getStarted', { defaultValue: 'Get started' })}
              </LinkButton>
            </>
          )}
          <IconButton
            label={t('a11y.openMenu', { defaultValue: 'Open menu' })}
            icon={<Menu strokeWidth={1.25} />}
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            onClick={() => setMenuOpen(true)}
            className="-me-1.5 text-ink lg:hidden"
          />
        </div>
      </div>

      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} signedInHome={signedIn ? roleHome(user.role) : null} />
    </header>
  );
}

/* ── Desktop "Solutions" mega menu (disclosure of links) ───────────────────── */

function SolutionsMenu() {
  const { t } = useTranslation('common');
  const panelId = useId();
  const { pathname } = useLocation();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const openedByHover = useRef(false);
  const [open, setOpen] = useState(false);
  const openRef = useRef(open);
  const active = SOLUTIONS.some((solution) => pathname.startsWith(solution.to));

  useEffect(() => {
    openRef.current = open;
    if (!open) openedByHover.current = false;
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative"
      onPointerEnter={(event) => {
        if (event.pointerType !== 'mouse') return;
        window.clearTimeout(closeTimer.current);
        if (!openRef.current) openedByHover.current = true;
        setOpen(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'mouse') return;
        closeTimer.current = window.setTimeout(() => setOpen(false), 180);
      }}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          // A click right after hover-opening pins the panel open instead of closing it.
          if (openedByHover.current) {
            openedByHover.current = false;
            setOpen(true);
            return;
          }
          setOpen((value) => !value);
        }}
        className={linkClasses(active || open)}
      >
        {t('nav.groups.solutions', { defaultValue: 'Solutions' })}
        <ChevronDown
          aria-hidden="true"
          strokeWidth={1.25}
          className={cn('size-3 transition-transform duration-300 ease-luxe', open && 'rotate-180')}
        />
        <ActiveDot active={active} />
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            id={panelId}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.14 } }}
            transition={{ duration: DURATION.ui + 0.06, ease: EASE_LUXE }}
            className="absolute left-1/2 top-full z-50 w-[min(780px,calc(100vw-2.5rem))] -translate-x-[38%] pt-3"
          >
            <div className="grid grid-cols-[minmax(0,1fr)_17rem] overflow-hidden rounded-sm border border-line bg-paper shadow-luxe">
              <ul className="grid grid-cols-2 gap-px p-3">
                {SOLUTIONS.map((solution) => (
                  <li key={solution.to}>
                    <Link
                      to={solution.to}
                      className="group flex h-full gap-3.5 rounded-sm p-4 transition-colors duration-300 hover:bg-ivory focus-visible:bg-ivory"
                    >
                      <span
                        aria-hidden="true"
                        className="shrink-0 pt-0.5 text-muted transition-colors duration-300 group-hover:text-gold-700"
                      >
                        <solution.icon strokeWidth={1.25} className="size-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1 font-display text-[19px] font-normal text-ink">
                          {t(solution.labelKey, { defaultValue: solution.label })}
                          <ArrowUpRight
                            aria-hidden="true"
                            strokeWidth={1.25}
                            className="size-3.5 text-gold-700 opacity-0 transition-opacity duration-300 ease-luxe group-hover:opacity-100"
                          />
                        </span>
                        <span className="mt-1 block text-[13px] leading-snug text-muted">
                          {t(solution.descriptionKey, { defaultValue: solution.description })}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Link
                to="/calculator"
                className="group surface-dark relative flex flex-col overflow-hidden bg-forest-900 p-7"
              >
                <Contours variant="basin" className="text-ivory/[0.05]" />
                <span className="eyebrow relative">{t('layout.site.calculatorEyebrow', { defaultValue: 'Net-return calculator' })}</span>
                <span className="relative mt-8 font-display text-[26px] font-bold leading-[1.15] tracking-[-0.01em]">
                  {t('layout.site.calculatorTitleStart', { defaultValue: 'What would your harvest' })}{' '}
                  <em className="not-italic text-gold-400">{t('layout.site.calculatorTitleEmphasis', { defaultValue: 'truly' })}</em>{' '}
                  {t('layout.site.calculatorTitleEnd', { defaultValue: 'earn?' })}
                </span>
                <span className="relative mt-auto inline-flex items-center gap-2 self-start border-b border-ivory/40 pb-1 pt-8 text-[13px] font-semibold text-ivory/85 transition-colors group-hover:border-ivory group-hover:text-ivory">
                  {t('layout.site.calculatorCta', { defaultValue: 'Try the calculator' })}
                  <ArrowRight
                    aria-hidden="true"
                    strokeWidth={1.25}
                    className="size-3.5 transition-transform duration-300 ease-luxe group-hover:translate-x-0.5"
                  />
                </span>
              </Link>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ── Full-screen mobile menu (< 1024 px) ───────────────────────────────────── */

interface MobileMenuProps {
  open: boolean;
  onClose: () => void;
  signedInHome: string | null;
}

function MobileMenu(props: MobileMenuProps) {
  return (
    <Portal>
      <AnimatePresence>{props.open ? <MobileMenuPanel key="mobile-menu" {...props} /> : null}</AnimatePresence>
    </Portal>
  );
}

function MobileMenuPanel({ onClose, signedInHome }: MobileMenuProps) {
  const { t } = useTranslation('common');
  const isPresent = useIsPresent();
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlay({ active: isPresent, containerRef: panelRef, onDismiss: onClose });
  useScrollLock(isPresent);

  const links = [...PRIMARY_LINKS, ...COMPANY_LINKS];

  return (
    <motion.div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('a11y.mainNavigation', { defaultValue: 'Main navigation' })}
      tabIndex={-1}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DURATION.overlay, ease: EASE_LUXE }}
      className="surface-dark fixed inset-0 z-50 flex flex-col overflow-y-auto overscroll-contain bg-forest-900 outline-none lg:hidden"
    >
      <Contours variant="ridge" className="text-ivory/[0.04]" />

      <div className="content-container relative flex h-20 shrink-0 items-center justify-between border-b border-ivory/10">
        <Link to="/" onClick={onClose} className="rounded-sm" aria-label={t('layout.site.homeLink', { defaultValue: 'MandiMate home' })}>
          <Logo variant="dark" />
        </Link>
        <IconButton
          label={t('a11y.closeMenu', { defaultValue: 'Close menu' })}
          icon={<X strokeWidth={1.25} />}
          variant="glass"
          onClick={onClose}
        />
      </div>

      <nav aria-label={t('a11y.mainNavigation', { defaultValue: 'Main navigation' })} className="content-container relative flex-1 pb-10 pt-4">
        <ul>
          {links.map((link, index) => (
            <motion.li
              key={link.to}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: DURATION.reveal - 0.2, ease: EASE_LUXE, delay: 0.08 + index * STAGGER }}
              className="border-b border-ivory/10"
            >
              <NavLink
                to={link.to}
                onClick={onClose}
                className={({ isActive }) =>
                  cn(
                    'flex items-center justify-between py-4 font-display text-[30px] font-bold leading-tight tracking-[-0.01em] transition-colors',
                    isActive ? 'not-italic text-gold-400' : 'text-ivory hover:text-gold-300',
                  )
                }
              >
                {t(link.labelKey, { defaultValue: link.label })}
                <ArrowUpRight aria-hidden="true" strokeWidth={1.25} className="size-5 text-ivory/40" />
              </NavLink>
            </motion.li>
          ))}
        </ul>

        <p className="eyebrow eyebrow-rule mt-10">{t('nav.groups.solutions', { defaultValue: 'Solutions' })}</p>
        <ul className="mt-4 grid grid-cols-1 border-t border-ivory/10 sm:grid-cols-2 sm:gap-x-8">
          {SOLUTIONS.map((solution) => (
            <li key={solution.to}>
              <Link
                to={solution.to}
                onClick={onClose}
                className="flex items-center gap-3 border-b border-ivory/10 py-3.5 transition-colors hover:text-gold-300"
              >
                <span aria-hidden="true" className="shrink-0 text-ivory/50">
                  <solution.icon strokeWidth={1.25} className="size-[18px]" />
                </span>
                <span className="text-[15px] text-ivory">{t(solution.labelKey, { defaultValue: solution.label })}</span>
              </Link>
            </li>
          ))}
        </ul>

        <LanguageSwitcher tone="dark" showLabel fullWidth className="mt-10 md:hidden" />
      </nav>

      <div className="content-container relative flex shrink-0 flex-col gap-3 border-t border-ivory/10 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-6 sm:flex-row">
        {signedInHome ? (
          <LinkButton to={signedInHome} onClick={onClose} variant="gold" size="lg" fullWidth trailingIcon={<ArrowRight strokeWidth={1.25} />}>
            {t('nav.public.openApp', { defaultValue: 'Open MandiMate' })}
          </LinkButton>
        ) : (
          <>
            <LinkButton to="/signup" onClick={onClose} variant="gold" size="lg" fullWidth trailingIcon={<ArrowRight strokeWidth={1.25} />}>
              {t('nav.public.getStarted', { defaultValue: 'Get started' })}
            </LinkButton>
            <LinkButton to="/login" onClick={onClose} variant="glass" size="lg" fullWidth>
              {t('nav.public.login', { defaultValue: 'Sign in' })}
            </LinkButton>
          </>
        )}
      </div>
    </motion.div>
  );
}
