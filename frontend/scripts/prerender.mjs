#!/usr/bin/env node
/**
 * Static prerendering for MandiMate's public pages.
 *
 * Runs after:
 *   vite build --outDir dist/client
 *   vite build --ssr src/entry-server.tsx --outDir dist/server
 *
 * Writes dist/client/<path>/index.html for every public and auth route, dist/client/404.html,
 * dist/client/app.html (the SPA shell for /app/**), sitemap.xml and robots.txt (both carrying
 * the absolute VITE_SITE_URL baked into the server bundle).
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const clientDir = join(root, 'dist', 'client');
const serverDir = join(root, 'dist', 'server');
const serverEntry = join(serverDir, 'entry-server.js');

const APP_HTML = '<!--app-html-->';
const APP_HEAD = '<!--app-head-->';
/** Path rendered for the 404 page; it matches no route so the catch-all renders. */
const NOT_FOUND_PATH = '/404';

function fail(message) {
  console.error(`\n[prerender] ${message}\n`);
  process.exit(1);
}

/**
 * The client build's index.html is the template. A copy is kept in dist/server (never served) so
 * the script can run again after index.html itself has been replaced by the prerendered home page.
 */
async function loadTemplate() {
  const indexPath = join(clientDir, 'index.html');
  const savedPath = join(serverDir, 'template.html');
  const index = existsSync(indexPath) ? await readFile(indexPath, 'utf8') : '';
  if (index.includes(APP_HTML)) {
    await writeFile(savedPath, index, 'utf8');
    return index;
  }
  if (existsSync(savedPath)) return readFile(savedPath, 'utf8');
  fail('No HTML template with the <!--app-html--> placeholder found — run "npm run build:client" first.');
}

/** The rendered head carries its own title and description, so drop the template defaults. */
function stripDefaultHead(template) {
  return template.replace(/\s*<title>[\s\S]*?<\/title>/, '').replace(/\s*<meta\s+name="description"[\s\S]*?\/?>/, '');
}

/** Function replacers keep "$&"-style sequences in the markup from being treated as patterns. */
function fillTemplate(template, { head, html }) {
  return stripDefaultHead(template)
    .replace(APP_HEAD, () => head)
    .replace(APP_HTML, () => html);
}

function outputPathFor(route) {
  if (route === '/') return join(clientDir, 'index.html');
  return join(clientDir, ...route.split('/').filter(Boolean), 'index.html');
}

function escapeXml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function todayIST() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function buildRobots(siteUrl) {
  return ['User-agent: *', 'Allow: /', 'Disallow: /app/', '', `Sitemap: ${siteUrl}/sitemap.xml`, ''].join('\n');
}

function buildSitemap(siteUrl, routes) {
  const lastmod = todayIST();
  const urls = routes
    .map((route) => {
      const loc = route.path === '/' ? `${siteUrl}/` : `${siteUrl}${route.path}`;
      return [
        '  <url>',
        `    <loc>${escapeXml(loc)}</loc>`,
        `    <lastmod>${lastmod}</lastmod>`,
        `    <changefreq>${route.changefreq}</changefreq>`,
        `    <priority>${route.priority.toFixed(1)}</priority>`,
        '  </url>',
      ].join('\n');
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

async function writePage(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, 'utf8');
}

async function main() {
  if (!existsSync(serverEntry)) fail('dist/server/entry-server.js is missing — run "npm run build:server" first.');

  const template = await loadTemplate();
  const { render, PUBLIC_ROUTES, AUTH_ROUTES, SITE_URL } = await import(pathToFileURL(serverEntry).href);

  // SPA fallback for /app/** (served by nginx / preview): no placeholders, no prerendered markup.
  const shell = template.replace(/\n?[ \t]*<!--app-head-->/, '').replace(APP_HTML, '');
  await writePage(join(clientDir, 'app.html'), shell);

  const routes = [...PUBLIC_ROUTES.map((route) => route.path), ...AUTH_ROUTES.map((route) => route.path)];
  const started = performance.now();

  for (const route of routes) {
    const rendered = await render(route);
    if (!rendered.html.trim()) fail(`Rendering "${route}" produced no markup.`);
    await writePage(outputPathFor(route), fillTemplate(template, rendered));
    console.log(`  ✓ ${route}`);
  }

  const notFound = await render(NOT_FOUND_PATH);
  await writePage(join(clientDir, '404.html'), fillTemplate(template, notFound));
  console.log('  ✓ 404.html');

  await writeFile(join(clientDir, 'sitemap.xml'), buildSitemap(SITE_URL, PUBLIC_ROUTES), 'utf8');
  console.log(`  ✓ sitemap.xml (${PUBLIC_ROUTES.length} URLs, ${SITE_URL})`);

  await writeFile(join(clientDir, 'robots.txt'), buildRobots(SITE_URL), 'utf8');
  console.log('  ✓ robots.txt');

  const seconds = ((performance.now() - started) / 1000).toFixed(2);
  console.log(`\n[prerender] ${routes.length + 1} pages in ${seconds}s`);
}

main().catch((error) => {
  console.error('\n[prerender] failed:', error);
  process.exit(1);
});
