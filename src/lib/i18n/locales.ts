export const SUPPORTED_LOCALES = ["en", "es"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isSupportedLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

export function otherLocale(locale: Locale): Locale {
  return locale === "en" ? "es" : "en";
}
