import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MESSAGES_DIR = join(process.cwd(), 'messages');
const SOURCE_LOCALE = 'en';
const JSON_TRANSLATED_LOCALES = ['ko'];

function flattenKeys(node: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (value: unknown, path: string) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) {
        walk(child, path ? `${path}.${key}` : key);
      }
      return;
    }
    out.add(path);
  };
  walk(node, '');
  return out;
}

function loadJson(locale: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(MESSAGES_DIR, `${locale}.json`), 'utf8'),
  ) as Record<string, unknown>;
}

function loadPortuguese(): Record<string, unknown> {
  const parts = ['core', 'operations', 'settings'].map((name) =>
    JSON.parse(
      readFileSync(join(MESSAGES_DIR, 'pt', `${name}.json`), 'utf8'),
    ) as Record<string, unknown>,
  );
  return Object.assign({}, ...parts);
}

describe('message catalogue parity', () => {
  const source = flattenKeys(loadJson(SOURCE_LOCALE));

  it.each(JSON_TRANSLATED_LOCALES)(
    '%s.json covers every en.json key',
    (locale) => {
      const translated = flattenKeys(loadJson(locale));
      const missing = [...source].filter((key) => !translated.has(key)).sort();
      expect(missing, `${locale}.json is missing these keys`).toEqual([]);
    },
  );

  it.each(JSON_TRANSLATED_LOCALES)(
    '%s.json has no orphaned keys',
    (locale) => {
      const translated = flattenKeys(loadJson(locale));
      const orphaned = [...translated].filter((key) => !source.has(key)).sort();
      expect(orphaned, `${locale}.json has keys absent from en.json`).toEqual([]);
    },
  );

  it('Portuguese catalogue covers every English key', () => {
    const translated = flattenKeys(loadPortuguese());
    const missing = [...source].filter((key) => !translated.has(key)).sort();
    expect(missing, 'Portuguese catalogue is missing these keys').toEqual([]);
  });
});
