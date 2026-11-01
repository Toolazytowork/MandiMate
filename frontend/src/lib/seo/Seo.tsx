import { useEffect, useMemo } from 'react';

import { applyHeadTags, buildHeadTags, type SeoData } from './head';
import { useHeadCollector } from './HeadProvider';

export type SeoProps = SeoData;

/**
 * Declares the page's title, description, canonical URL, social cards and JSON-LD.
 * Server: writes into the HeadProvider collector during render. Client: reconciles `document.head`
 * after commit. Renders nothing — never render <title> elements directly.
 */
export function Seo(props: SeoProps) {
  const collector = useHeadCollector();
  if (collector) collector.data = props;

  const signature = JSON.stringify(props);
  const tags = useMemo(() => buildHeadTags(JSON.parse(signature) as SeoData), [signature]);

  useEffect(() => {
    applyHeadTags(tags);
  }, [tags]);

  return null;
}
