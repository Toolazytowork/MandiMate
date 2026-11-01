/**
 * Server entry used only at build time by scripts/prerender.mjs. Renders a URL to static HTML and
 * the matching <head> tags. Public pages are imported eagerly, so the markup is complete.
 */
import { StrictMode } from 'react';
import { prerender } from 'react-dom/static';
import { StaticRouter } from 'react-router';

import { App } from '@/app/App';
import { createQueryClient } from '@/lib/query';
import { createHeadCollector, renderCollectedHead } from '@/lib/seo';

export { AUTH_ROUTES, PUBLIC_ROUTES, SITE_URL } from '@/lib/seo/site';
export type { PublicRoute, RouteMeta } from '@/lib/seo/site';

export interface RenderResult {
  /** Markup for inside <div id="root">. */
  html: string;
  /** Title, meta, canonical and JSON-LD tags for <head>. */
  head: string;
}

export async function render(url: string): Promise<RenderResult> {
  const queryClient = createQueryClient();
  const collector = createHeadCollector();
  const pathname = new URL(url, 'http://prerender.local').pathname;
  const errors: unknown[] = [];

  try {
    const { prelude } = await prerender(
      <StrictMode>
        <StaticRouter location={url}>
          <App queryClient={queryClient} headCollector={collector} />
        </StaticRouter>
      </StrictMode>,
      {
        onError(error) {
          errors.push(error);
        },
      },
    );
    const html = await new Response(prelude).text();
    // A page that only rendered its error fallback must fail the build rather than ship silently.
    if (errors.length > 0) throw errors[0];
    return { html, head: renderCollectedHead(collector, pathname) };
  } finally {
    queryClient.clear();
  }
}
