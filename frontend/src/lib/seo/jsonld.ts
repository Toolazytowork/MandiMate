/** Schema.org JSON-LD builders for <Seo jsonLd={…}>. All URLs are absolute. */
import { absoluteUrl, DEFAULT_DESCRIPTION, OG_IMAGE_PATH, SITE_NAME, SITE_URL, TAGLINE } from './site';

export type JsonLdValue = string | number | boolean | null | JsonLdValue[] | { [key: string]: JsonLdValue };
export type JsonLd = { '@context'?: string; '@type': string } & { [key: string]: JsonLdValue };

const CONTEXT = 'https://schema.org';
const LANGUAGES = ['en-IN', 'hi-IN', 'te-IN', 'kn-IN', 'ur-IN'];

export function organization(): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: SITE_NAME,
    url: absoluteUrl('/'),
    logo: absoluteUrl('/favicon.svg'),
    image: absoluteUrl(OG_IMAGE_PATH),
    description: DEFAULT_DESCRIPTION,
    slogan: TAGLINE,
    areaServed: { '@type': 'Country', name: 'India' },
    knowsLanguage: LANGUAGES,
  };
}

export function website(): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    name: SITE_NAME,
    url: absoluteUrl('/'),
    description: DEFAULT_DESCRIPTION,
    inLanguage: LANGUAGES,
    publisher: { '@id': `${SITE_URL}/#organization` },
  };
}

export function softwareApplication(): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    url: absoluteUrl('/'),
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Agricultural marketplace',
    operatingSystem: 'Web',
    description: DEFAULT_DESCRIPTION,
    inLanguage: LANGUAGES,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'INR',
      description: 'Free for farmers',
    },
    publisher: { '@id': `${SITE_URL}/#organization` },
  };
}

export interface FaqItem {
  question: string;
  answer: string;
}

export function faqPage(items: readonly FaqItem[]): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}

export interface BreadcrumbItem {
  name: string;
  path: string;
}

/** Pass the trail from the home page down to the current page. */
export function breadcrumb(items: readonly BreadcrumbItem[]): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export interface HowToStep {
  name: string;
  text: string;
}

export function howTo(
  steps: readonly HowToStep[],
  {
    name = 'How to sell a harvest with MandiMate',
    description = 'From listing a harvest to receiving payment: pooling, offers, net-earnings comparison, consent, shared transport, delivery and settlement.',
  }: { name?: string; description?: string } = {},
): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'HowTo',
    name,
    description,
    step: steps.map((step, index) => ({
      '@type': 'HowToStep',
      position: index + 1,
      name: step.name,
      text: step.text,
    })),
  };
}
