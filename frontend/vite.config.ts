/// <reference types="vitest/config" />
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** Ports default to 8000 (API) and 5173 (web); ./dev.sh overrides them when a default port is taken. */
const API_PORT = Number(process.env.MANDIMATE_API_PORT) || 8000;
const WEB_PORT = Number(process.env.MANDIMATE_WEB_PORT) || 5173;
const API_TARGET = `http://localhost:${API_PORT}`;
/** Public tunnel domains used by `./dev.sh share`. */
const TUNNEL_HOSTS = ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.dev', '.ngrok.io', '.trycloudflare.com'];

/** Vendor groups split out of the client bundle so they cache independently of app code. */
const VENDOR_CHUNKS: { name: string; test: RegExp; priority: number }[] = [
  { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 50 },
  { name: 'router', test: /node_modules[\\/](react-router|cookie|set-cookie-parser)[\\/]/, priority: 40 },
  { name: 'query', test: /node_modules[\\/]@tanstack[\\/]/, priority: 40 },
  { name: 'motion', test: /node_modules[\\/](motion|motion-dom|motion-utils|framer-motion)[\\/]/, priority: 40 },
  { name: 'charts', test: /node_modules[\\/](recharts|victory-vendor|d3-[^\\/]+)[\\/]/, priority: 30 },
  { name: 'i18n', test: /node_modules[\\/](i18next|react-i18next|html-parse-stringify|void-elements)[\\/]/, priority: 30 },
];

/**
 * `vite preview` routing that mirrors infra/nginx/default.conf: /app/** boots the SPA shell
 * (app.html), public paths resolve to their prerendered <path>/index.html, and unknown paths get
 * the prerendered 404 page instead of the home page.
 */
function previewRouting(): Plugin {
  return {
    name: 'mandimate:preview-routing',
    configurePreviewServer(server) {
      const clientDir = resolve(server.config.root, server.config.build.outDir);
      server.middlewares.use((req, _res, next) => {
        const pathname = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
        const isFile = /\.[a-z0-9]+$/i.test(pathname);
        if (/^\/app(?:\/|$)/.test(pathname)) {
          req.url = '/app.html';
        } else if (!isFile && !pathname.startsWith('/api/') && !pathname.startsWith('/media/')) {
          const page = `${pathname.replace(/\/+$/, '')}/index.html`;
          req.url = existsSync(join(clientDir, page)) ? page : '/404.html';
        }
        next();
      });
    },
  };
}

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react(), tailwindcss(), previewRouting()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: WEB_PORT,
    strictPort: true,
    // `./dev.sh share --dev` exposes the dev server through an ngrok or cloudflared tunnel.
    allowedHosts: TUNNEL_HOSTS,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false },
      '/media': { target: API_TARGET, changeOrigin: false },
    },
  },
  preview: {
    port: 4173,
    // `./dev.sh share` serves this production preview through the tunnel.
    allowedHosts: TUNNEL_HOSTS,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false },
      '/media': { target: API_TARGET, changeOrigin: false },
    },
  },
  build: {
    sourcemap: false,
    target: 'es2022',
    rolldownOptions: isSsrBuild
      ? undefined
      : {
          output: {
            codeSplitting: {
              groups: VENDOR_CHUNKS,
            },
          },
        },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    unstubGlobals: true,
    css: false,
  },
}));
