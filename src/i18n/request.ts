import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, NAMESPACES, isLocale, type Locale } from "./config";

/**
 * Picks a locale with no DB round-trip: cookie (set at login / via the
 * language switcher) wins, otherwise we take a best-effort guess from
 * the browser's `Accept-Language`, otherwise `DEFAULT_LOCALE` (pt-BR).
 * The DB `profiles.locale` value is synced into this cookie client-side
 * once the profile loads (see `useAuth`), so it converges to the DB
 * preference without paying a query on every render.
 */
function resolveLocaleFromAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null;
  const preferred = header.split(",")[0]?.trim().toLowerCase();
  if (!preferred) return null;
  if (preferred.startsWith("pt")) return "pt-BR";
  if (preferred.startsWith("en")) return "en-US";
  return null;
}

async function loadMessages(locale: Locale) {
  const entries = await Promise.all(
    NAMESPACES.map(async (namespace) => {
      const mod = await import(`../../messages/${locale}/${namespace}.json`);
      return [namespace, mod.default] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;

  let locale: Locale;
  if (isLocale(cookieLocale)) {
    locale = cookieLocale;
  } else {
    const headerStore = await headers();
    locale =
      resolveLocaleFromAcceptLanguage(headerStore.get("accept-language")) ?? DEFAULT_LOCALE;
  }

  return {
    locale,
    messages: await loadMessages(locale),
  };
});
