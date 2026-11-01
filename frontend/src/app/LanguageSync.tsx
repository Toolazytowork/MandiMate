import { useLayoutEffect } from 'react';

import { applySavedLanguage } from '@/lib/i18n';

/**
 * Applies the language saved on this device right after the first (English, hydration-safe) render,
 * before the browser paints.
 */
export function LanguageSync() {
  useLayoutEffect(() => {
    applySavedLanguage();
  }, []);
  return null;
}
