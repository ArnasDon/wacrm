import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Locale dictionaries are hand-maintained. English is the source of
// truth (src/i18n/request.ts falls back to en.json only when a whole
// locale file is missing — there is no per-key fallback), so a key
// that lands in en.json and not in a translation renders as a raw
// keypath for users on that locale. This guards the parity.

const MESSAGES_DIR = join(process.cwd(), 'messages');
const SOURCE_LOCALE = 'en';
const TRANSLATED_LOCALES = ['ko'];

function loadKeys(locale: string): Set<string> {
  const raw = readFileSync(join(MESSAGES_DIR, `${locale}.json`), 'utf8');
  const out = new Set<string>();
  const walk = (node: unknown, path: string) => {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const [k, v] of Object.entries(node)) {
        walk(v, path ? `${path}.${k}` : k);
      }
      return;
    }
    out.add(path);
  };
  walk(JSON.parse(raw), '');
  return out;
}

describe('message catalogue parity', () => {
  const source = loadKeys(SOURCE_LOCALE);

  it.each(TRANSLATED_LOCALES)('%s.json covers every en.json key', (locale) => {
    const translated = loadKeys(locale);
    const missing = [...source].filter((k) => !translated.has(k)).sort();
    expect(missing, `${locale}.json is missing these keys`).toEqual([]);
  });

  it.each(TRANSLATED_LOCALES)('%s.json has no orphaned keys', (locale) => {
    const translated = loadKeys(locale);
    const orphaned = [...translated].filter((k) => !source.has(k)).sort();
    expect(orphaned, `${locale}.json has keys absent from en.json`).toEqual([]);
  });

  it('exposes the navigation labels used by the sidebar and header', () => {
    const sourceLocale = JSON.parse(
      readFileSync(join(MESSAGES_DIR, `${SOURCE_LOCALE}.json`), 'utf8'),
    );

    for (const locale of TRANSLATED_LOCALES) {
      const translatedLocale = JSON.parse(
        readFileSync(join(MESSAGES_DIR, `${locale}.json`), 'utf8'),
      );

      for (const key of ['produits', 'commandes', 'services', 'reservations']) {
        expect(sourceLocale.Sidebar?.[key], `en.json should define Sidebar.${key}`).toBeDefined();
        expect(translatedLocale.Sidebar?.[key], `${locale}.json should define Sidebar.${key}`).toBeDefined();
        expect(sourceLocale.Header?.[key], `en.json should define Header.${key}`).toBeDefined();
        expect(translatedLocale.Header?.[key], `${locale}.json should define Header.${key}`).toBeDefined();
      }
    }
  });
});
