/** Site-wide SEO constants and the public route inventory used for prerendering and the sitemap. */

const DEFAULT_SITE_URL = 'https://mandimate.in';

/** Absolute origin without a trailing slash. */
export const SITE_URL: string = (import.meta.env.VITE_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, '');
export const SITE_NAME = 'MandiMate';
export const TAGLINE = 'Better deals. Shared logistics. More money for farmers.';
/** The home page title; every other page uses "<title> · MandiMate". */
export const HOME_TITLE = `${SITE_NAME} — ${TAGLINE}`;
export const TITLE_SEPARATOR = ' · ';
export const DEFAULT_DESCRIPTION =
  'MandiMate pools small harvests into buyer-ready lots, negotiates better offers, shares transport and shows every farmer their true net earnings.';
export const OG_IMAGE_PATH = '/og-image.png';
export const OG_IMAGE_ALT = 'MandiMate — better deals, shared logistics and more money for farmers';
export const OG_LOCALE = 'en_IN';
export const THEME_COLOR = '#06110B';

export type ChangeFrequency = 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';

export interface RouteMeta {
  path: string;
  /** Page title without the " · MandiMate" suffix (≤ 50 characters). */
  title: string;
  /** Meta description (≤ 155 characters). */
  description: string;
}

export interface PublicRoute extends RouteMeta {
  changefreq: ChangeFrequency;
  /** Sitemap priority, 0.0–1.0. */
  priority: number;
}

/** Every indexable marketing route — prerendered and listed in sitemap.xml. */
export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  {
    path: '/',
    title: TAGLINE,
    description: DEFAULT_DESCRIPTION,
    changefreq: 'weekly',
    priority: 1.0,
  },
  {
    path: '/how-it-works',
    title: 'How MandiMate works',
    description:
      'From harvest listing to settlement in eight steps: pooling, offers, net-earnings comparison, consent, shared transport, delivery checks and payment.',
    changefreq: 'monthly',
    priority: 0.9,
  },
  {
    path: '/farmers',
    title: 'For farmers',
    description:
      'List a harvest by voice in Telugu, Hindi, Kannada, Urdu or English, join pooled sales and compare offers by what you actually take home before you say yes.',
    changefreq: 'monthly',
    priority: 0.9,
  },
  {
    path: '/buyers',
    title: 'For buyers',
    description:
      'Source consistent, graded produce from coordinated farmer groups. Post requirements, negotiate openly and track every delivery and payment.',
    changefreq: 'monthly',
    priority: 0.8,
  },
  {
    path: '/transporters',
    title: 'For transporters',
    description:
      'Quote on consolidated pickups with planned routes, known loads and confirmed stops. Fewer empty kilometres, fuller trucks, clear payment.',
    changefreq: 'monthly',
    priority: 0.7,
  },
  {
    path: '/fpos',
    title: 'For FPOs and field coordinators',
    description:
      'Run aggregation for your farmer producer organisation: assisted listing, quality checks, lot building, buyer management and settlement records.',
    changefreq: 'monthly',
    priority: 0.7,
  },
  {
    path: '/calculator',
    title: 'Net earnings calculator',
    description:
      'Work out what a crop sale really pays after transport, handling, commission, rejection and payment delay — the number a farmer takes home.',
    changefreq: 'monthly',
    priority: 0.8,
  },
  {
    path: '/pricing',
    title: 'Pricing',
    description:
      'MandiMate is free for farmers. Buyers pay a coordination fee per sourced lot, and FPOs can subscribe for aggregation and settlement tools.',
    changefreq: 'monthly',
    priority: 0.7,
  },
  {
    path: '/impact',
    title: 'Impact',
    description:
      'How we measure whether farmers earn more: net uplift per kg against the local mandi, sell-through, transport cost per kg and payment delays.',
    changefreq: 'monthly',
    priority: 0.6,
  },
  {
    path: '/about',
    title: 'About MandiMate',
    description:
      'We turn fragmented harvests into viable commercial deals and prove, with real transaction records, whether farmers actually earn more.',
    changefreq: 'monthly',
    priority: 0.6,
  },
  {
    path: '/faq',
    title: 'Frequently asked questions',
    description:
      'Answers about pooled sales, net earnings, fees, farmer consent, transport, quality checks, payments and how MandiMate uses AI.',
    changefreq: 'monthly',
    priority: 0.7,
  },
  {
    path: '/contact',
    title: 'Contact',
    description:
      'Talk to the MandiMate team about a pilot in your village cluster, sourcing as a buyer, joining as a transporter or partnering as an FPO.',
    changefreq: 'yearly',
    priority: 0.5,
  },
  {
    path: '/privacy',
    title: 'Privacy policy',
    description:
      'How MandiMate collects, uses and protects personal and transaction data for farmers, buyers, transporters and coordinators.',
    changefreq: 'yearly',
    priority: 0.3,
  },
  {
    path: '/terms',
    title: 'Terms of service',
    description:
      'The terms that govern use of MandiMate by farmers, buyers, transporters and FPO coordinators, including consent, fees and disputes.',
    changefreq: 'yearly',
    priority: 0.3,
  },
];

/** Public, prerendered but not listed in the sitemap. */
export const AUTH_ROUTES: readonly RouteMeta[] = [
  {
    path: '/login',
    title: 'Sign in',
    description: 'Sign in to MandiMate to manage harvests, offers, pooled lots, transport and payments.',
  },
  {
    path: '/signup',
    title: 'Create your account',
    description:
      'Join MandiMate as a farmer, buyer, transporter or FPO coordinator. Free for farmers, in English, Hindi, Telugu, Kannada and Urdu.',
  },
  {
    path: '/forgot-password',
    title: 'Reset your password',
    description: 'Get help regaining access to your MandiMate account.',
  },
];

/** Metadata for a public or auth route; throws for unknown paths so typos fail loudly in development. */
export function routeMeta(path: string): RouteMeta {
  const meta = PUBLIC_ROUTES.find((route) => route.path === path) ?? AUTH_ROUTES.find((route) => route.path === path);
  if (!meta) throw new Error(`No SEO metadata registered for "${path}"`);
  return meta;
}

/** Absolute URL for a site path ("/faq" → "https://mandimate.in/faq"). Absolute URLs pass through. */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (path === '/' || path === '') return `${SITE_URL}/`;
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/** "<title> · MandiMate", or the brand title for the home page. */
export function formatTitle(title: string | undefined, path?: string): string {
  if (path === '/' || !title || title === TAGLINE) return HOME_TITLE;
  return `${title}${TITLE_SEPARATOR}${SITE_NAME}`;
}
