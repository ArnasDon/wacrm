/**
 * Supported UI locales and how a request is matched to one.
 *
 * The catalogue in `messages/` is the source of truth for what can be
 * rendered; this module is the source of truth for what the app will
 * actually *choose*. Keep the two in step: adding `fr.json` does
 * nothing until `fr` lands in SUPPORTED_LOCALES.
 */

export const DEFAULT_LOCALE = "en";

/** Locales offered in the UI, in the order the picker lists them. */
export const SUPPORTED_LOCALES = [
  { id: "en", label: "English", englishLabel: "English" },
  { id: "es", label: "Español", englishLabel: "Spanish" },
] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number]["id"];

export const LOCALE_IDS = SUPPORTED_LOCALES.map((l) => l.id) as readonly Locale[];

/**
 * Cookie holding an explicit choice from the settings panel.
 *
 * `NEXT_LOCALE` is next-intl's conventional name — using it keeps us
 * compatible with its middleware should routing-based locales ever
 * land here.
 */
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** One year: the pick should outlive any realistic session. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALE_IDS as readonly string[]).includes(value);
}

/**
 * Best supported locale for an `Accept-Language` header.
 *
 * Parses the header's quality-weighted list, sorts by weight, and
 * returns the first entry whose *language* subtag we support — so
 * `es-419`, `es-MX` and `es` all match Spanish. Anything we don't
 * speak is skipped rather than failing the whole header, and a header
 * with no supported language yields null (caller falls back to
 * DEFAULT_LOCALE).
 */
export function matchAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;

  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="))
        ?.slice(2);
      const quality = q === undefined ? 1 : Number.parseFloat(q);
      return {
        tag: tag.trim().toLowerCase(),
        // A malformed q= ("q=high") must not sort as NaN — treat it as
        // the lowest acceptable weight rather than dropping the entry.
        quality: Number.isFinite(quality) ? quality : 0,
      };
    })
    // q=0 explicitly means "not acceptable".
    .filter((entry) => entry.tag && entry.quality > 0)
    // Stable sort keeps header order among equal weights, which is the
    // browser's own preference order.
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of ranked) {
    // "*" means "anything is acceptable" — no signal, let the caller's
    // fallback decide rather than forcing English here.
    if (tag === "*") return null;
    const language = tag.split("-")[0];
    if (isLocale(language)) return language;
  }

  return null;
}

/**
 * The locale for a request: explicit choice wins, then the browser's
 * preference, then the deployment default.
 */
export function resolveLocale(
  cookieValue: string | null | undefined,
  acceptLanguage: string | null | undefined,
  fallback: Locale = DEFAULT_LOCALE,
): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  return matchAcceptLanguage(acceptLanguage) ?? fallback;
}

/**
 * Persist an explicit locale choice, or clear it to go back to
 * browser detection.
 *
 * Written from the client rather than through an API route: this is a
 * display preference, not account state, so it belongs to the device
 * the same way the theme does. Not `httpOnly` for the same reason —
 * nothing here is a secret, and the boot path benefits from the
 * client being able to read it back.
 *
 * `SameSite=Lax` so the cookie still rides along on top-level
 * navigations into the app (an emailed invite link renders in the
 * user's chosen language) while staying off cross-site subrequests.
 */
export function persistLocale(locale: Locale | null) {
  if (typeof document === "undefined") return;

  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    locale === null
      ? `${LOCALE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
      : `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

/** The explicit choice currently stored, or null when on auto-detect. */
export function readStoredLocale(): Locale | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`),
  );
  const value = match ? decodeURIComponent(match[1]) : null;
  return isLocale(value) ? value : null;
}
