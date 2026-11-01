import '@/styles/globals.css';

import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { I18nextProvider } from 'react-i18next';

import { Toaster } from '@/components/ui';
import { AuthProvider } from '@/lib/auth';
import { i18n } from '@/lib/i18n';
import { HeadProvider, type HeadCollector } from '@/lib/seo';

import { LanguageSync } from './LanguageSync';
import { RouteErrorBoundary } from './RouteErrorBoundary';
import { AppRoutes } from './routes';
import { ScrollToTop } from './ScrollToTop';

export interface AppProps {
  /** One client per browser session or per server render. */
  queryClient: QueryClient;
  /** Server only: receives the page's <Seo> data. */
  headCollector?: HeadCollector | null;
  /** Client only: `true` when hydrating prerendered HTML. */
  hydrating?: boolean;
}

/** Every provider plus the route tree. The router itself is supplied by main.tsx / entry-server.tsx. */
export function App({ queryClient, headCollector = null, hydrating = false }: AppProps) {
  return (
    <HeadProvider collector={headCollector}>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider hydrating={hydrating}>
            <MotionConfig reducedMotion="user">
              <LanguageSync />
              <ScrollToTop />
              <RouteErrorBoundary>
                <AppRoutes />
              </RouteErrorBoundary>
              <Toaster />
            </MotionConfig>
          </AuthProvider>
        </QueryClientProvider>
      </I18nextProvider>
    </HeadProvider>
  );
}
