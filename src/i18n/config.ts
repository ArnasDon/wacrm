/**
 * Single source of truth for supported locales. Add a new locale by
 * appending it here and creating its `messages/<locale>/*.json` files —
 * everything else (request config, type narrowing, the locale switcher)
 * derives from this list.
 */
export const LOCALES = ["pt-BR", "en-US"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "pt-BR";

export const LOCALE_COOKIE = "locale";

export const LOCALE_LABELS: Record<Locale, string> = {
  "pt-BR": "Português (Brasil)",
  "en-US": "English (US)",
};

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

/**
 * Message namespaces, one JSON file per (locale, namespace) under
 * `messages/<locale>/<namespace>.json`. Mirrors the feature layout of
 * `src/app/(dashboard)` and `src/components` so each domain owns its
 * own dictionary file instead of one giant per-locale blob.
 */
export const NAMESPACES = [
  "common",
  "layout",
  "auth",
  "dashboard",
  "contacts",
  "inbox",
  "kanban",
  "pipelines",
  "automations",
  "flows",
  "broadcasts",
  "settings",
  "notifications",
  "presence",
  "join",
] as const;

export type Namespace = (typeof NAMESPACES)[number];
