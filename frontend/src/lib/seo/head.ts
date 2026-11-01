/**
 * One description of the document head, two renderers: `renderHeadTags` serialises it for the
 * prerendered HTML, `applyHeadTags` reconciles `document.head` on the client.
 */
import type { JsonLd } from './jsonld';
import {
  absoluteUrl,
  DEFAULT_DESCRIPTION,
  formatTitle,
  OG_IMAGE_ALT,
  OG_IMAGE_PATH,
  OG_LOCALE,
  SITE_NAME,
} from './site';

export interface SeoData {
  title?: string;
  description?: string;
  /** Canonical path, e.g. "/faq". */
  path: string;
  noindex?: boolean;
  /** Absolute URL or site path of the social image. */
  image?: string;
  type?: 'website' | 'article' | 'profile';
  jsonLd?: JsonLd | readonly JsonLd[];
}

export type MetaKey = { name: string } | { property: string };

export interface HeadTags {
  title: string;
  metas: { key: MetaKey; content: string }[];
  canonical: string;
  jsonLd: JsonLd[];
}

export const JSON_LD_ATTR = 'data-seo-jsonld';

export function buildHeadTags(data: SeoData): HeadTags {
  const title = formatTitle(data.title, data.path);
  const description = data.description || DEFAULT_DESCRIPTION;
  const url = absoluteUrl(data.path);
  const image = absoluteUrl(data.image ?? OG_IMAGE_PATH);
  const robots = data.noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large';
  const jsonLd = data.jsonLd ? (Array.isArray(data.jsonLd) ? [...data.jsonLd] : [data.jsonLd as JsonLd]) : [];

  return {
    title,
    canonical: url,
    metas: [
      { key: { name: 'description' }, content: description },
      { key: { name: 'robots' }, content: robots },
      { key: { property: 'og:site_name' }, content: SITE_NAME },
      { key: { property: 'og:type' }, content: data.type ?? 'website' },
      { key: { property: 'og:locale' }, content: OG_LOCALE },
      { key: { property: 'og:title' }, content: title },
      { key: { property: 'og:description' }, content: description },
      { key: { property: 'og:url' }, content: url },
      { key: { property: 'og:image' }, content: image },
      { key: { property: 'og:image:alt' }, content: OG_IMAGE_ALT },
      { key: { name: 'twitter:card' }, content: 'summary_large_image' },
      { key: { name: 'twitter:title' }, content: title },
      { key: { name: 'twitter:description' }, content: description },
      { key: { name: 'twitter:image' }, content: image },
    ],
    jsonLd,
  };
}

/* ───────────────────────────── Server rendering ───────────────────────────── */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** JSON safe to inline in a <script> element. */
export function serializeJsonLd(value: JsonLd): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function metaAttr(key: MetaKey): string {
  return 'name' in key ? `name="${escapeHtml(key.name)}"` : `property="${escapeHtml(key.property)}"`;
}

export function renderHeadTags(tags: HeadTags): string {
  const lines = [
    `<title>${escapeHtml(tags.title)}</title>`,
    ...tags.metas.map((meta) => `<meta ${metaAttr(meta.key)} content="${escapeHtml(meta.content)}" />`),
    `<link rel="canonical" href="${escapeHtml(tags.canonical)}" />`,
    ...tags.jsonLd.map((item) => `<script type="application/ld+json" ${JSON_LD_ATTR}>${serializeJsonLd(item)}</script>`),
  ];
  return lines.join('\n    ');
}

/* ───────────────────────────── Client reconciling ─────────────────────────── */

function metaSelector(key: MetaKey): string {
  return 'name' in key ? `meta[name="${key.name}"]` : `meta[property="${key.property}"]`;
}

export function applyHeadTags(tags: HeadTags, doc: Document = document): void {
  if (doc.title !== tags.title) doc.title = tags.title;

  for (const meta of tags.metas) {
    let element = doc.head.querySelector<HTMLMetaElement>(metaSelector(meta.key));
    if (!element) {
      element = doc.createElement('meta');
      if ('name' in meta.key) element.setAttribute('name', meta.key.name);
      else element.setAttribute('property', meta.key.property);
      doc.head.appendChild(element);
    }
    if (element.getAttribute('content') !== meta.content) element.setAttribute('content', meta.content);
  }

  let canonical = doc.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) {
    canonical = doc.createElement('link');
    canonical.rel = 'canonical';
    doc.head.appendChild(canonical);
  }
  if (canonical.getAttribute('href') !== tags.canonical) canonical.setAttribute('href', tags.canonical);

  const nextScripts = tags.jsonLd.map((item) => JSON.stringify(item));
  const current = Array.from(doc.head.querySelectorAll<HTMLScriptElement>(`script[${JSON_LD_ATTR}]`));
  const unchanged =
    current.length === nextScripts.length &&
    current.every((script, index) => {
      try {
        return JSON.stringify(JSON.parse(script.textContent ?? '')) === nextScripts[index];
      } catch {
        return false;
      }
    });
  if (unchanged) return;

  for (const script of current) script.remove();
  for (const json of nextScripts) {
    const script = doc.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute(JSON_LD_ATTR, '');
    script.textContent = json;
    doc.head.appendChild(script);
  }
}
