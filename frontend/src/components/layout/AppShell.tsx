import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router';
import { Sheet } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/hooks';
import { MobileTabBar } from './MobileTabBar';
import { Sidebar } from './Sidebar';
import { SkipLink } from './SkipLink';
import { Topbar } from './Topbar';

/**
 * Signed-in workspace frame: 272 px deep-green sidebar (a drawer below 1024 px), ivory topbar with a hairline,
 * farmer bottom tabs on phones, and `<main id="main">` for the routed page.
 * Rendered inside the platform's `RequireAuth` guard.
 */
export function AppShell() {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 64rem)');

  // The drawer only exists below the desktop breakpoint; close it on navigation or when widening.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname, isDesktop]);

  if (!user) return null;
  const isFarmer = user.role === 'farmer';

  return (
    <div className="min-h-dvh bg-ivory">
      <SkipLink />

      <aside className="fixed inset-y-0 start-0 z-40 hidden w-68 lg:block">
        <Sidebar user={user} />
      </aside>

      <Sheet
        open={drawerOpen && !isDesktop}
        onOpenChange={setDrawerOpen}
        side="left"
        surface="dark"
        title={t('a11y.mainNavigation', { defaultValue: 'Main navigation' })}
        hideTitle
        bodyClassName="p-0 sm:px-0"
      >
        <Sidebar user={user} onNavigate={() => setDrawerOpen(false)} />
      </Sheet>

      <div className="flex min-h-dvh flex-col lg:ps-68">
        <Topbar user={user} onOpenNavigation={() => setDrawerOpen(true)} />
        <main
          id="main"
          tabIndex={-1}
          className={cn('flex-1 outline-none', isFarmer && 'pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0')}
        >
          <div className="mx-auto w-full max-w-app p-5 md:p-8">
            <Outlet />
          </div>
        </main>
      </div>

      {isFarmer ? <MobileTabBar onOpenMore={() => setDrawerOpen(true)} /> : null}
    </div>
  );
}
