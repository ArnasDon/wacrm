/**
 * Lead sources — single source of truth for where a contact came from.
 *
 * Mirrors the `contacts_source_check` CHECK constraint in migration
 * 037. Adding a source means touching exactly two places: that CHECK
 * and this list (plus a label in messages/*.json). Same pattern as
 * `src/lib/currency.ts`.
 *
 * Labels intentionally live in i18n, not here: the picker renders
 * `Contacts.sources.<id>` so the vocabulary translates. `tone` maps
 * onto the badge classes already used across the app.
 */

export const CONTACT_SOURCES = [
  'meta_ads',
  'google_ads',
  'organic',
  'web',
  'referral',
  'manual',
  'other',
  'unknown',
] as const;

export type ContactSource = (typeof CONTACT_SOURCES)[number];

/** What a contact carries until something classifies it. */
export const DEFAULT_SOURCE: ContactSource = 'unknown';

/**
 * Sources we set automatically from an inbound signal. Everything else
 * is a human classification — the UI shows these with a "detected"
 * hint so an agent doesn't think they picked it.
 */
export const AUTO_DETECTED_SOURCES: ReadonlySet<ContactSource> = new Set([
  'meta_ads',
  'google_ads',
  'web',
]);

export function isContactSource(value: unknown): value is ContactSource {
  return (
    typeof value === 'string' &&
    (CONTACT_SOURCES as readonly string[]).includes(value)
  );
}

/**
 * Coerce anything (a DB row from before this migration, a bad import
 * cell) to a usable source. Never throws — an unrecognised value is
 * treated as unclassified rather than crashing a contact list render.
 */
export function toContactSource(value: unknown): ContactSource {
  return isContactSource(value) ? value : DEFAULT_SOURCE;
}

/** Badge tint per source. Kept in sync with the app's badge classes. */
export const SOURCE_TONE: Record<ContactSource, string> = {
  meta_ads: 'blue',
  google_ads: 'amber',
  organic: 'emerald',
  web: 'violet',
  referral: 'rose',
  manual: 'slate',
  other: 'slate',
  unknown: 'slate',
};

/** Order for pickers: the ones a human picks first, unknown last. */
export const SOURCE_PICKER_ORDER: readonly ContactSource[] = [
  'meta_ads',
  'google_ads',
  'organic',
  'web',
  'referral',
  'manual',
  'other',
  'unknown',
];
