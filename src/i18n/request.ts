import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, resolveLocale } from '@/lib/locales';

/**
 * Per-request locale resolution.
 *
 * Order of precedence:
 *   1. `NEXT_LOCALE` cookie — an explicit pick in Settings → Appearance.
 *   2. The browser's `Accept-Language` header.
 *   3. English.
 *
 * `NEXT_PUBLIC_APP_LOCALE` still acts as the deployment-wide default
 * for step 2/3 — a self-hoster running a Spanish-only office can pin
 * it — but it no longer overrides what an individual user picked.
 *
 * Reading cookies/headers opts every page into dynamic rendering.
 * That is already the case app-wide: the dashboard reads the Supabase
 * session in middleware and on every server component.
 */
export default getRequestConfig(async () => {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);

  const envDefault = process.env.NEXT_PUBLIC_APP_LOCALE;
  const fallback = isLocale(envDefault) ? envDefault : DEFAULT_LOCALE;

  const locale = resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value,
    headerList.get('accept-language'),
    fallback,
  );

  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch {
    // A supported locale whose catalogue is missing would render every
    // string as its own keypath; English is always present.
    messages = (await import(`../../messages/en.json`)).default;
  }

  return { locale, messages };
});
