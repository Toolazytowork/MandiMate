import { useTranslation } from 'react-i18next';
import { Link, NavLink, useLocation } from 'react-router';
import { Ellipsis, Mic } from 'lucide-react';
import { cn } from '@/lib/cn';
import { FARMER_TABS, VOICE_LISTING_PATH } from './navigation';

const TAB_CLASSES =
  'relative flex h-full flex-col items-center justify-center gap-1.5 text-[9.5px] font-semibold transition-colors duration-300';

/**
 * Farmer bottom navigation for phones (< 768 px) with a round green microphone button
 * that opens voice listing — always within thumb reach.
 */
export function MobileTabBar({ onOpenMore }: { onOpenMore: () => void }) {
  const { t } = useTranslation('common');
  const { pathname } = useLocation();
  const onNewHarvest = pathname.startsWith('/app/farmer/harvests/new');

  return (
    <>
      {onNewHarvest ? null : (
        <Link
          to={VOICE_LISTING_PATH}
          aria-label={t('nav.farmer.voiceListing', { defaultValue: 'Speak to list' })}
          className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] end-4 z-30 grid size-14 place-items-center rounded-full bg-forest-600 text-white shadow-luxe-lg transition-colors duration-300 ease-luxe hover:bg-forest-700 md:hidden"
        >
          <Mic aria-hidden="true" strokeWidth={1.25} className="size-6" />
        </Link>
      )}
      <nav
        aria-label={t('layout.tabs.label', { defaultValue: 'Quick navigation' })}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="grid h-16 grid-cols-5">
          {FARMER_TABS.map((tab) => (
            <li key={tab.to}>
              <NavLink
                to={tab.to}
                end={tab.end}
                className={({ isActive }) => cn(TAB_CLASSES, isActive ? 'text-ink' : 'text-muted')}
              >
                {({ isActive }) => (
                  <>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute -top-px h-[3px] w-8 rounded-full bg-forest-600 transition-opacity duration-300',
                        isActive ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <tab.icon aria-hidden="true" strokeWidth={1.25} className="size-[22px]" />
                    <span>{t(tab.shortKey, { defaultValue: tab.shortLabel })}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
          <li>
            <button type="button" onClick={onOpenMore} className={cn(TAB_CLASSES, 'w-full text-muted')}>
              <Ellipsis aria-hidden="true" strokeWidth={1.25} className="size-[22px]" />
              <span>{t('nav.farmer.more', { defaultValue: 'More' })}</span>
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
