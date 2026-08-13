import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';

// Some catalogue strings are deliberately not ICU messages: template
// placeholders show the literal WhatsApp `{{1}}` syntax to the user, and
// a few setup steps carry raw HTML destined for dangerouslySetInnerHTML.
// next-intl's ICU parser rejects both.
//
// It rejects them *quietly*: `t()` reports INVALID_MESSAGE / FORMATTING_ERROR
// to onError and then renders the keypath itself, so the field shows
// "Settings.templates.bodyPlaceholder" instead of the placeholder. Nothing
// throws, no build fails, and dev looks the same as prod — which is how
// twelve of these shipped unnoticed.
//
// Such strings must be read with `t.raw()` (bypasses the parser) or
// `t.rich()` (tag handlers). This test fails when one is wired to plain
// `t()`. Reported by @Arifuzzamanjoy in #421.
//
// Nota tras la sincronización con upstream: hoy la lista sale VACÍA, y eso
// es correcto. Conviene dejar escrito por qué, porque la fusión pisó aquí
// una mina silenciosa.
//
// Los dos repositorios arreglaron este mismo bug, cada uno por una mitad
// distinta:
//
//   este fork  → arregló el DATO: escapó los `{{…}}` del catálogo con
//                comillas simples (el escape de ICU) y dejó los `t()`.
//   upstream   → arregló el CÓDIGO: dejó los `{{…}}` sin escapar y cambió
//                las llamadas a `t.raw()` (su #483).
//
// Ninguna de las dos mitades entra en conflicto con la otra —tocan archivos
// distintos—, así que git se quedó con NUESTRO catálogo escapado y con SU
// código `t.raw()`, y la suma renderiza las comillas de escape al usuario:
// «Hello '{{1}}', your order '{{2}}'…». Los siete sitios se devolvieron a
// `t()`, que con el catálogo escapado da el texto correcto.
//
// Aparte, next-intl 4.13.4 rechazaba el catálogo ya escapado (fallo suyo,
// corregido en 4.13.5, versión que entró con el bump de upstream). Por eso
// esta lista era no vacía antes de la fusión y ahora no lo es.
//
// El test sigue valiendo: en cuanto alguien añada un `{{…}}` SIN escapar,
// vuelve a haber claves hostiles y esto exige `t.raw()` / `t.rich()`.

const MESSAGES = join(process.cwd(), 'messages', 'en.json');
const SRC = join(process.cwd(), 'src');

/** Leaf keypaths whose value next-intl cannot parse as an ICU message. */
/** Hojas del catálogo y, de ellas, las que el parser no sabe leer. */
function icuHostileKeys(): { leaves: string[]; hostile: string[] } {
  const catalogue = JSON.parse(readFileSync(MESSAGES, 'utf8'));
  const leaves: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
      return;
    }
    if (typeof node === 'string') leaves.push(path);
  };
  walk(catalogue, '');

  const hostile = leaves.filter((key) => {
    let code = '';
    const t = createTranslator({
      locale: 'en',
      messages: catalogue,
      onError: (err) => {
        code = err.code;
      },
    });
    t(key as never);
    // INVALID_MESSAGE only — the parser could not read the string at all,
    // so no call site can rescue it. Deliberately excludes FORMATTING_ERROR,
    // which a well-formed message raises merely because this probe passes no
    // values and no tag handlers; those are `t.rich()` / interpolation sites
    // and are correct as written.
    return code === 'INVALID_MESSAGE';
  });

  return { leaves, hostile };
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return full.endsWith('.tsx') ? [full] : [];
  });
}

describe('ICU-hostile strings are not read with plain t()', () => {
  it('every {{…}} / raw-HTML message is consumed via t.raw() or t.rich()', () => {
    const { leaves, hostile } = icuHostileKeys();
    // Guard the guard. Se mide sobre las HOJAS, no sobre las hostiles: que no
    // haya hostiles es un resultado legítimo — significa que todo el catálogo
    // se escapó bien — mientras que quedarse sin hojas solo puede ser que el
    // recorrido del árbol se haya roto, que es lo que dejaría el test pasando
    // en vacío. Antes se medía sobre `hostile` y bastó con que next-intl
    // arreglara su parser para que saltara sin haber ningún fallo real.
    expect(leaves.length).toBeGreaterThan(100);

    const sources = tsxFiles(SRC).map((path) => ({
      path,
      text: readFileSync(path, 'utf8'),
    }));

    const offenders: string[] = [];

    for (const key of hostile) {
      const namespace = key.slice(0, key.lastIndexOf('.'));
      const leaf = key.slice(key.lastIndexOf('.') + 1);

      for (const { path, text } of sources) {
        // Leaf names repeat across namespaces ('delete', 'desc', …), so only
        // consider a file that actually opens this key's namespace. The call
        // may use a trailing sub-path (useTranslations('Settings.templates')
        // + t('config.foo')), so match on any namespace prefix.
        const opensNamespace = [...text.matchAll(/useTranslations\(\s*['"]([^'"]+)['"]/g)].some(
          (m) => namespace === m[1] || namespace.startsWith(`${m[1]}.`),
        );
        if (!opensNamespace) continue;

        // A plain call: `t('leaf')` or `t("a.leaf")`, but not `.raw(` / `.rich(`.
        const plainCall = new RegExp(
          String.raw`(?<![.\w])t\(\s*['"](?:[\w.]+\.)?${leaf}['"]`,
        );
        if (plainCall.test(text)) {
          offenders.push(`${key} — plain t() in ${path.replace(process.cwd() + '/', '')}`);
        }
      }
    }

    expect(
      offenders.sort(),
      'these render as their own keypath at runtime; use t.raw() (or t.rich() with tag handlers)',
    ).toEqual([]);
  });
});
