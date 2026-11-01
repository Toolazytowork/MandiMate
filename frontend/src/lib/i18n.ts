/**
 * i18next setup. Every namespace JSON under src/i18n/locales/<lng>/ is bundled eagerly, so translation
 * never suspends and prerendered pages contain real text.
 *
 * Hydration safety: the server render and the first client render always use English. The visitor's
 * saved language is applied right after mount via `applySavedLanguage()`.
 */
import i18n, { type Resource, type ResourceLanguage } from 'i18next';
import { initReactI18next } from 'react-i18next';

import type { Language } from '@/types/api';

export interface LanguageOption {
  code: Language;
  label: string;
  native: string;
  /** Writing direction; Urdu is right-to-left. */
  dir: 'ltr' | 'rtl';
}

export const LANGUAGES: readonly LanguageOption[] = [
  { code: 'en', label: 'English', native: 'English', dir: 'ltr' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी', dir: 'ltr' },
  { code: 'te', label: 'Telugu', native: 'తెలుగు', dir: 'ltr' },
  { code: 'kn', label: 'Kannada', native: 'ಕನ್ನಡ', dir: 'ltr' },
  { code: 'ur', label: 'Urdu', native: 'اردو', dir: 'rtl' },
];

export const DEFAULT_LANGUAGE: Language = 'en';
export const LANGUAGE_STORAGE_KEY = 'mandimate.lang';

export const NAMESPACES = [
  'common',
  'marketing',
  'marketingHome',
  'marketingRoles',
  'marketingInfo',
  'auth',
  'farmer',
  'buyer',
  'transporter',
  'coordinator',
  'admin',
  'domain',
  'shared',
  'farmerDeals',
  'buyerOrders',
  'coordinatorLots',
  'coordinatorOps',
] as const;
export type Namespace = (typeof NAMESPACES)[number];

const LANGUAGE_CODES = new Set<string>(LANGUAGES.map((language) => language.code));

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && LANGUAGE_CODES.has(value);
}

const modules = import.meta.glob<ResourceLanguage>('../i18n/locales/*/*.json', { eager: true, import: 'default' });

function buildResources(): Resource {
  const resources: Resource = {};
  for (const [path, messages] of Object.entries(modules)) {
    const match = /\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path);
    if (!match) continue;
    const [, lng, ns] = match as unknown as [string, string, string];
    resources[lng] ??= {};
    resources[lng][ns] = messages;
  }
  return resources;
}

void i18n.use(initReactI18next).init({
  resources: buildResources(),
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: LANGUAGES.map((language) => language.code),
  ns: [...NAMESPACES],
  defaultNS: 'common',
  fallbackNS: 'common',
  interpolation: { escapeValue: false },
  returnNull: false,
  initAsync: false,
  react: { useSuspense: false },
});

/** Writing direction of a language code; unknown codes are left-to-right. */
export function languageDir(lng: string): 'ltr' | 'rtl' {
  return LANGUAGES.find((language) => language.code === lng)?.dir ?? 'ltr';
}

function syncDocumentLanguage(lng: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lng;
  document.documentElement.dir = languageDir(lng);
}

i18n.on('languageChanged', syncDocumentLanguage);

/** The language saved on this device, if any. */
export function getSavedLanguage(): Language | null {
  try {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(saved) ? saved : null;
  } catch {
    return null;
  }
}

/** Switch the UI language, remember it on this device and update `<html lang dir>`. */
export async function setLanguage(lng: Language): Promise<void> {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
  } catch {
    // Storage may be blocked; the switch still applies to this session.
  }
  if (i18n.language !== lng) await i18n.changeLanguage(lng);
  syncDocumentLanguage(lng);
}

/** Apply the saved language after hydration. Returns the language now in use. */
export function applySavedLanguage(): Language {
  const saved = getSavedLanguage();
  if (saved && saved !== i18n.language) void i18n.changeLanguage(saved);
  return saved ?? (isLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE);
}

/** Current UI language narrowed to the supported set. */
export function currentLanguage(): Language {
  return isLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE;
}

export { i18n };
export default i18n;
