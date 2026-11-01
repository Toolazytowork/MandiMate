import { createContext, useContext, type ReactNode } from 'react';

import { buildHeadTags, renderHeadTags, type SeoData } from './head';
import { DEFAULT_DESCRIPTION } from './site';

/** Collects the page's <Seo> data during a server render. The last <Seo> rendered wins. */
export interface HeadCollector {
  data: SeoData | null;
}

export function createHeadCollector(): HeadCollector {
  return { data: null };
}

/** The serialised head for a finished server render (falls back to the home defaults). */
export function renderCollectedHead(collector: HeadCollector, fallbackPath = '/'): string {
  const data = collector.data ?? { path: fallbackPath, description: DEFAULT_DESCRIPTION };
  return renderHeadTags(buildHeadTags(data));
}

const HeadContext = createContext<HeadCollector | null>(null);

/**
 * Provide a collector only on the server. On the client the provider is a no-op and <Seo>
 * updates `document.head` itself.
 */
export function HeadProvider({ collector = null, children }: { collector?: HeadCollector | null; children: ReactNode }) {
  return <HeadContext value={collector}>{children}</HeadContext>;
}

export function useHeadCollector(): HeadCollector | null {
  return useContext(HeadContext);
}
