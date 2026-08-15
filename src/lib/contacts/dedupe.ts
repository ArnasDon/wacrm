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
 * Find an existing contact in `accountId` whose `instagram_id` (IGSID)
 * exactly matches. Unlike phone matching, Instagram-Scoped IDs are
 * opaque numeric strings assigned by Meta — no normalization or
 * trunk-prefix fuzzy matching applies, so this is a plain equality
 * lookup rather than findExistingContact's suffix-prefilter + JS match.
 */
export async function findExistingInstagramContact(
  db: SupabaseClient,
  accountId: string,
  instagramId: string,
): Promise<ExistingContact | null> {
  if (!instagramId) return null;

  const { data, error } = await db
    .from("contacts")
    .select("*")
    .eq("account_id", accountId)
    .eq("instagram_id", instagramId)
    .maybeSingle();

  if (error || !data) return null;
  return data as ExistingContact;
}

/**
 * Find an existing contact in `accountId` whose `facebook_id` (PSID)
 * exactly matches. Same reasoning as `findExistingInstagramContact` —
 * Facebook's Page-Scoped IDs are opaque, so a plain equality lookup
 * is enough.
 */
export async function findExistingFacebookContact(
  db: SupabaseClient,
  accountId: string,
  facebookId: string,
): Promise<ExistingContact | null> {
  if (!facebookId) return null;

  const { data, error } = await db
    .from("contacts")
    .select("*")
    .eq("account_id", accountId)
    .eq("facebook_id", facebookId)
    .maybeSingle();

  if (error || !data) return null;
  return data as ExistingContact;
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
