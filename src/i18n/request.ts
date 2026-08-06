import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

export const SUPPORTED_LOCALES = ['en', 'ko', 'pt'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export const LOCALE_COOKIE = 'wacrm_locale';

function isSupportedLocale(value: string | undefined): value is AppLocale {
  return SUPPORTED_LOCALES.includes(value as AppLocale);
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  const environmentLocale = process.env.NEXT_PUBLIC_APP_LOCALE;
  const locale = isSupportedLocale(cookieLocale)
    ? cookieLocale
    : isSupportedLocale(environmentLocale)
      ? environmentLocale
      : 'en';

  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch {
    messages = (await import('../../messages/en.json')).default;
  }

  return {
    locale,
    messages,
  };
});
