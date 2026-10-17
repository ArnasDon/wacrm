import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

export default getRequestConfig(async () => {
  // Locale priority: cookie → env var → 'en'
  // The cookie is set by the LanguageSwitcher component so the
  // user's choice persists across SSR renders without a DB call.
  let locale: string;
  try {
    const cookieStore = await cookies();
    locale = cookieStore.get('NEXT_LOCALE')?.value
      || process.env.NEXT_PUBLIC_APP_LOCALE
      || 'en';
  } catch {
    locale = process.env.NEXT_PUBLIC_APP_LOCALE || 'en';
  }

  // Real defect found while investigating this catch block (it used to
  // silently discard `error`): NEXT_PUBLIC_APP_LOCALE is set to the
  // BCP-47 regional form `es-DO` in this project's own production
  // config, but `messages/` only ships base-language files (`es.json`,
  // not `es-DO.json`) — so every request with no NEXT_LOCALE cookie
  // override was silently rendering in English instead of Spanish.
  // Regional-variant → base-language is the correct i18n fallback
  // (`es-DO` → `es`), tried BEFORE giving up to English outright.
  const baseLocale = locale.split('-')[0];
  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch (error) {
    if (baseLocale !== locale) {
      try {
        messages = (await import(`../../messages/${baseLocale}.json`)).default;
        locale = baseLocale;
      } catch {
        // Base-language dictionary doesn't exist either — fall through
        // to the English fallback below, logged once for the ORIGINAL
        // (more specific) locale.
      }
    }
    if (!messages) {
      // Expected for a locale with no dictionary at all yet; logged so
      // a genuinely unexpected failure here (e.g. a broken
      // messages/en.json) is never silently indistinguishable from
      // that normal case.
      console.error(`[i18n] failed to load messages for locale "${locale}", falling back to en:`, error);
      messages = (await import(`../../messages/en.json`)).default;
    }
  }

  return {
    locale,
    messages
  };
});
