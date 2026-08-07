import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

export const LOCALE_COOKIE = 'NEXT_LOCALE';
export const SUPPORTED_LOCALES = ['en', 'pt-BR', 'ko'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export default getRequestConfig(async () => {
  // Per-visitor override (set by the language switcher via
  // POST /api/locale) wins over the deployment's default locale, which
  // in turn wins over the hardcoded 'en' fallback. No URL-based
  // [locale] routing — this app's routes aren't structured for it, and
  // a cookie gets a working switcher without restructuring every route.
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale =
    (cookieLocale && SUPPORTED_LOCALES.includes(cookieLocale as SupportedLocale)
      ? cookieLocale
      : undefined) ||
    process.env.NEXT_PUBLIC_APP_LOCALE ||
    'en';

  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch (error) {
    // Fallback to English if the dictionary for the requested locale doesn't exist yet
    messages = (await import(`../../messages/en.json`)).default;
  }

  return {
    locale,
    messages
  };
});
