import { describe, expect, it } from 'vitest';
import { LANGUAGES, languageDir } from '@/lib/i18n';

type Messages = Record<string, unknown>;

const files = import.meta.glob<Messages>('./locales/*/*.json', { eager: true, import: 'default' });

function messages(lng: string, ns: string): Messages {
  return files[`./locales/${lng}/${ns}.json`] ?? {};
}

const flatten = (value: unknown, prefix = ''): string[] =>
  typeof value === 'object' && value !== null
    ? Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key))
    : [prefix];

const namespaces = [...new Set(Object.keys(files).map((path) => /\/([^/]+)\.json$/.exec(path)![1]!))];
// A namespace counts as translated once Hindi has it; every other language must then match it key for key.
const translated = namespaces.filter((ns) => flatten(messages('hi', ns)).length > 0);

describe('translations', () => {
  it('ships a file for every namespace in every language', () => {
    for (const { code } of LANGUAGES) {
      for (const ns of namespaces) expect(files[`./locales/${code}/${ns}.json`], `${code}/${ns}`).toBeDefined();
    }
  });

  it.each(LANGUAGES.filter(({ code }) => code !== 'en').map(({ code }) => code))(
    '%s has the same keys as Hindi in every translated namespace',
    (code) => {
      for (const ns of translated) expect(flatten(messages(code, ns)).sort(), `${code}/${ns}`).toEqual(flatten(messages('hi', ns)).sort());
    },
  );

  it('keeps every {{placeholder}} of the English text', () => {
    const placeholders = (text: unknown) => (typeof text === 'string' ? (text.match(/\{\{[^}]+\}\}/g) ?? []).sort() : []);
    const at = (root: Messages, key: string) => key.split('.').reduce<unknown>((node, part) => (node as Messages | undefined)?.[part], root);
    for (const ns of translated) {
      const english = messages('en', ns);
      for (const key of flatten(english)) {
        for (const { code } of LANGUAGES) {
          if (code === 'en') continue;
          const value = at(messages(code, ns), key);
          if (value === undefined) continue;
          expect(placeholders(value), `${code}/${ns}:${key}`).toEqual(placeholders(at(english, key)));
        }
      }
    }
  });

  it('reads Urdu right to left and every other language left to right', () => {
    expect(languageDir('ur')).toBe('rtl');
    for (const code of ['en', 'hi', 'te', 'kn']) expect(languageDir(code)).toBe('ltr');
  });
});
