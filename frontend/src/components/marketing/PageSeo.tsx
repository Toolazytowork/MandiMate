import { useTranslation } from 'react-i18next';
import { breadcrumb, routeMeta, Seo, type JsonLd } from '@/lib/seo';

export interface PageSeoProps {
  /** A path registered in PUBLIC_ROUTES. */
  path: string;
  /** Breadcrumb label for this page (defaults to its SEO title). Sub pages always get BreadcrumbList JSON-LD. */
  crumb?: string;
  jsonLd?: readonly JsonLd[];
}

/** "/" → "home", "/how-it-works" → "howItWorks": the `pageSeo.<key>` translation key of a route. */
function routeKey(path: string): string {
  const slug = path.replace(/^\/+|\/+$/g, '');
  if (!slug) return 'home';
  return slug.replace(/[-/]+(\w)/g, (_, letter: string) => letter.toUpperCase());
}

/** Title, description, canonical, social cards and JSON-LD for a public page. */
export function PageSeo({ path, crumb, jsonLd = [] }: PageSeoProps) {
  const { t } = useTranslation('marketing');
  const meta = routeMeta(path);
  const key = routeKey(path);
  // The home page title is always the brand title (see formatTitle), so only its description is translated.
  const title = path === '/' ? meta.title : t(`pageSeo.${key}.title`, { defaultValue: meta.title });
  const description = t(`pageSeo.${key}.description`, { defaultValue: meta.description });
  const items: JsonLd[] = [...jsonLd];
  if (path !== '/') {
    items.push(
      breadcrumb([
        { name: t('pageHero.home', { defaultValue: 'Home' }), path: '/' },
        { name: crumb ?? title, path },
      ]),
    );
  }
  return <Seo {...meta} title={title} description={description} jsonLd={items} />;
}
