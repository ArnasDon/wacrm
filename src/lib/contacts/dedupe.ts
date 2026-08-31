import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhone, phonesMatch } from "@/lib/whatsapp/phone-utils";

/**
 * Contact de-duplication helpers, shared by the WhatsApp webhook, the
 * manual contact form, and CSV import so all paths agree on what
 * "same number" means (issue #212).
 *
 * The canonical key is `normalizePhone` (digits-only) — the same form
 * the DB stores in the generated `contacts.phone_normalized` column
 * and enforces unique per account. `phonesMatch` adds trunk-prefix
 * tolerance (last-8-digit match) for the softer "possible duplicate"
 * surfaces.
 */

/** Canonical de-dup key for a phone string (digits only). */
export function normalizeKey(phone: string): string {
  return normalizePhone(phone);
}

/** Minimal shape we need back from a contacts lookup. */
export interface ExistingContact {
  id: string;
  phone: string;
  name?: string | null;
  [key: string]: unknown;
}

/**
 * Find an existing contact in `accountId` whose phone matches `phone`,
 * or null. Pre-filters in SQL by the last-8-digit suffix (so we don't
 * pull every contact), then applies the strict `phonesMatch` in JS on
 * the small candidate set — the exact approach the webhook has used.
 */
export async function findExistingContact(
  db: SupabaseClient,
  accountId: string,
  phone: string,
): Promise<ExistingContact | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const suffix = normalized.length >= 8 ? normalized.slice(-8) : normalized;

  const { data, error } = await db
    .from("contacts")
    .select("*")
    .eq("account_id", accountId)
    .like("phone", `%${suffix}`);

  if (error || !data) return null;

  return (
    (data as ExistingContact[]).find((c) => phonesMatch(c.phone, phone)) ?? null
  );
}

/**
 * True when an existing contact is an *exact* normalized match for
 * `phone` (vs only a fuzzy trunk-variant match). The form hard-blocks
 * exact matches but only warns on fuzzy ones.
 */
export function isExactMatch(existing: ExistingContact, phone: string): boolean {
  return normalizeKey(existing.phone) === normalizeKey(phone);
}

/**
 * True for a Postgres unique-constraint violation (SQLSTATE 23505).
 * Used as the backstop when the DB unique index rejects a racing or
 * format-equal insert that slipped past the in-app check.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: string }).code === "23505";
}

/** One indexed contact — just enough to match and to report back an id. */
export interface PhoneIndexEntry {
  id: string;
  phoneNormalized: string;
}

/**
 * Build a batch-friendly lookup of existing contacts by phone, for CSV
 * import. `findExistingContact` above does one DB round trip per phone
 * (fine for a single webhook message); a CSV can carry hundreds of
 * rows, so import instead fetches every account contact once and
 * matches in memory via this index.
 *
 * Bucketed by last-8-digit suffix (same tolerance as `phonesMatch`) so
 * a contact stored with a country-code prefix ("+919505048493") is
 * still found by a bare CSV number ("9505048493") — an exact
 * `phone_normalized` string match alone misses that pairing entirely,
 * which is what let existing contacts get silently re-classified as
 * "new" (and their CSV tags dropped) purely over a formatting
 * difference, not an actual missing contact.
 */
export function buildPhoneIndex(
  contacts: { id: string; phone_normalized: string | null }[],
): Map<string, PhoneIndexEntry[]> {
  const index = new Map<string, PhoneIndexEntry[]>();
  for (const c of contacts) {
    const normalized = c.phone_normalized;
    if (!normalized) continue;
    const suffix = normalized.length >= 8 ? normalized.slice(-8) : normalized;
    const bucket = index.get(suffix);
    const entry = { id: c.id, phoneNormalized: normalized };
    if (bucket) bucket.push(entry);
    else index.set(suffix, [entry]);
  }
  return index;
}

/**
 * Look up `phone` in an index built by `buildPhoneIndex`. Exact
 * normalized match wins when present; otherwise falls back to the
 * same trunk-prefix-tolerant `phonesMatch` used by `findExistingContact`,
 * so the two matching paths (single lookup vs batch import) agree on
 * what counts as "the same contact".
 */
export function findInPhoneIndex(
  index: Map<string, PhoneIndexEntry[]>,
  phone: string,
): string | undefined {
  const normalized = normalizeKey(phone);
  if (!normalized) return undefined;
  const suffix = normalized.length >= 8 ? normalized.slice(-8) : normalized;
  const candidates = index.get(suffix);
  if (!candidates) return undefined;

  const exact = candidates.find((c) => c.phoneNormalized === normalized);
  if (exact) return exact.id;

  const fuzzy = candidates.find((c) => phonesMatch(c.phoneNormalized, phone));
  return fuzzy?.id;
}

/**
 * De-duplicate parsed CSV rows by normalized phone, keeping the first
 * occurrence of each. Rows with an empty normalized phone are dropped
 * (they can't be a valid contact). Returns the unique rows plus the
 * count removed as in-file duplicates.
 */
export function dedupeByPhone<T extends { phone: string }>(
  rows: T[],
): { unique: T[]; duplicates: number } {
  const seen = new Set<string>();
  const unique: T[] = [];
  let duplicates = 0;

  for (const row of rows) {
    const key = normalizeKey(row.phone);
    if (!key) {
      duplicates++;
      continue;
    }
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    unique.push(row);
  }

  return { unique, duplicates };
}
