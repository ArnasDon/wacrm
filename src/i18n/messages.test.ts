import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Locale dictionaries are hand-maintained. English is the source of
// truth (src/i18n/request.ts falls back to en.json only when a whole
// locale file is missing — there is no per-key fallback), so a key
// that lands in en.json and not in a translation renders as a raw
// keypath for users on that locale. This guards the parity.

const MESSAGES_DIR = join(process.cwd(), 'messages');
const SOURCE_LOCALE = 'en';
const TRANSLATED_LOCALES = ['ko', 'es'];

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

const SRC_DIR = join(process.cwd(), 'src');

function walkSource(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walkSource(full, acc);
    } else if (
      /\.tsx?$/.test(name) &&
      !/\.(test|spec)\.tsx?$/.test(name) &&
      !/\.d\.ts$/.test(name)
    ) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Every `const <t> = useTranslations('<NS>')` in a file, mapped to its
 * namespace. A var bound twice to *different* namespaces in one file is
 * marked ambiguous ('') so its keys are skipped rather than
 * mis-resolved. Every `useTranslations(...)` call in this codebase
 * passes exactly one string-literal namespace (asserted by grep), so
 * there is no dynamic-namespace case to handle.
 */
function translatorNamespaces(src: string): Map<string, string> {
  const map = new Map<string, string>();
  const re =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*useTranslations\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of src.matchAll(re)) {
    const [, name, ns] = m;
    if (map.has(name) && map.get(name) !== ns) map.set(name, '');
    else if (!map.has(name)) map.set(name, ns);
  }
  return map;
}

/** Static, string-literal `t('key')` / `t.rich('key')` / `t.markup('key')`
 *  calls only — anything built from a template literal or a variable is
 *  invisible here (see the SETTINGS_SECTIONS guard below for one such
 *  dynamic pattern that is checked explicitly). */
function referencedKeys(src: string, namespaces: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [name, ns] of namespaces) {
    if (!ns) continue; // ambiguous binding — skip
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `\\b${escaped}(?:\\.rich|\\.markup)?\\(\\s*['"]([^'"\`$]+)['"]`,
      'g',
    );
    for (const m of src.matchAll(re)) out.push(`${ns}.${m[1]}`);
  }
  return out;
}

describe('translation keys referenced in code exist in en.json', () => {
  const source = loadKeys(SOURCE_LOCALE);
  // A key is "defined" if it's a leaf, or a namespace prefix of one
  // (covers `t('a')` where messages nest `a.b` — a valid next-intl call
  // only when `a` itself resolves to a string, but tolerating it here
  // keeps false positives at zero).
  const isDefined = (key: string) =>
    source.has(key) || [...source].some((leaf) => leaf.startsWith(`${key}.`));

  it('every literal t(...) / t.rich(...) key resolves', () => {
    const missing: string[] = [];
    let resolved = 0;
    for (const file of walkSource(SRC_DIR)) {
      const src = readFileSync(file, 'utf8');
      if (!src.includes('useTranslations')) continue;
      const ns = translatorNamespaces(src);
      for (const key of referencedKeys(src, ns)) {
        resolved++;
        if (!isDefined(key)) missing.push(`${file.replace(SRC_DIR, 'src')} → ${key}`);
      }
    }
    // Self-check: if the regex ever stops matching (refactor, syntax
    // change) this test would pass vacuously — fail loudly instead.
    expect(resolved, 'the t(...) scanner resolved almost nothing — it is broken').toBeGreaterThan(500);
    expect(
      [...new Set(missing)].sort(),
      'these t(...) keys are referenced in code but absent from en.json',
    ).toEqual([]);
  });

  // The settings rail renders each section's label via a dynamic
  // `t('sections.' + id)`, which the literal scan can't see — this is
  // exactly how `Settings.sections.google-sheets` shipped as a raw key.
  it('every SETTINGS_SECTIONS id has a Settings.sections.<id> label', () => {
    const railSrc = readFileSync(
      join(SRC_DIR, 'components/settings/settings-sections.ts'),
      'utf8',
    );
    const block = railSrc.match(/SETTINGS_SECTIONS\s*=\s*\[([\s\S]*?)\]/);
    const ids = [...(block?.[1] ?? '').matchAll(/['"]([a-z0-9-]+)['"]/g)].map(
      (m) => m[1],
    );
    expect(ids.length, 'could not parse SETTINGS_SECTIONS').toBeGreaterThan(5);
    const missing = ids.filter((id) => !source.has(`Settings.sections.${id}`));
    expect(missing, 'Settings.sections.* labels missing from en.json').toEqual([]);
  });
});

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
});
