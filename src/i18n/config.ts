export const locales = ["en", "kk", "ru"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export const localeNames: Record<Locale, string> = {
  en: "English",
  kk: "Қазақша",
  ru: "Русский",
};
