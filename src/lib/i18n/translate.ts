import { createTranslator } from 'next-intl';

/**
 * Translator for code that runs outside React — API route handlers,
 * validators shared by client and server, starter templates, and so on.
 * Components should keep using `useTranslations` / `getTranslations`.
 *
 * The locale is fixed at build time (NEXT_PUBLIC_APP_LOCALE, see
 * src/i18n/request.ts), so this resolves one catalogue per process. The
 * conditional `require`s let the bundler drop the locales that aren't in
 * use instead of shipping all four to the browser. Unknown or unset locales
 * fall back to English, which is also what the test suite sees.
 */

type Catalogue = Record<string, unknown>;

/* eslint-disable @typescript-eslint/no-require-imports */
function loadCatalogue(): { locale: string; messages: Catalogue } {
  const locale = process.env.NEXT_PUBLIC_APP_LOCALE;
  if (locale === 'pt') return { locale, messages: require('../../../messages/pt.json') };
  if (locale === 'es') return { locale, messages: require('../../../messages/es.json') };
  if (locale === 'ko') return { locale, messages: require('../../../messages/ko.json') };
  return { locale: 'en', messages: require('../../../messages/en.json') };
}
/* eslint-enable @typescript-eslint/no-require-imports */

let cached: { locale: string; messages: Catalogue } | null = null;

export type TranslateValues = Record<string, string | number | Date>;
export type Translate = (key: string, values?: TranslateValues) => string;

/**
 * Returns a `t(key, values)` bound to `namespace` (e.g. `'Api'`,
 * `'Validation.flows'`). Messages use ICU syntax like the rest of the
 * catalogue; literal WhatsApp `{{1}}` must be passed in as a value.
 */
export function getT(namespace: string): Translate {
  cached ??= loadCatalogue();
  const t = createTranslator({
    locale: cached.locale,
    messages: cached.messages,
    namespace: namespace as never,
  }) as unknown as (key: string, values?: TranslateValues) => string;
  return (key, values) => t(key, values);
}
