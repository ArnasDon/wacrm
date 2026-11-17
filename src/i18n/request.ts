import { getRequestConfig } from 'next-intl/server';

const SUPPORTED_LOCALES = ['en', 'pt', 'es', 'ko'] as const;

export default getRequestConfig(async () => {
  // Keep the runtime locale in sync with the build-time catalogue alias.
  // An invalid value must not be returned alongside the English fallback:
  // next-intl uses the locale for formatting as well as dictionary lookup.
  const requestedLocale = process.env.NEXT_PUBLIC_APP_LOCALE;
  const locale = (SUPPORTED_LOCALES as readonly string[]).includes(
    requestedLocale ?? ''
  )
    ? (requestedLocale as (typeof SUPPORTED_LOCALES)[number])
    : 'en';

  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch {
    // Fallback to English if a supported dictionary is unavailable.
    messages = (await import(`../../messages/en.json`)).default;
  }

  return {
    locale,
    messages,
  };
});
