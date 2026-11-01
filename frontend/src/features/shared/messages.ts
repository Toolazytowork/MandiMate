/**
 * Static, translatable copy for lookup tables (role cards, categories, demo accounts…).
 * `msg('key', 'English')` keeps the key and its English default together so every string still renders
 * in English when a translation is missing; `tr(t, message)` translates it.
 */
export interface Msg {
  key: string;
  defaultValue: string;
}

export function msg(key: string, defaultValue: string): Msg {
  return { key, defaultValue };
}

/** Minimal shape of an i18next `t` function, so helpers accept any namespace's `t`. */
export type Translate = (key: string, options?: Record<string, unknown>) => string;

export function tr(t: Translate, message: Msg, options?: Record<string, unknown>): string {
  return t(message.key, { defaultValue: message.defaultValue, ...options });
}
