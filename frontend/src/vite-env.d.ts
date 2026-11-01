/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute public origin used for canonical URLs, Open Graph and the sitemap. */
  readonly VITE_SITE_URL?: string;
  /** Base path (or absolute URL) of the MandiMate API. Defaults to "/api/v1". */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
