// ============================================================
// Helpers for `product_categories` (migration 106) — a per-account
// grouping for the catalog (rooms / spa / activities / packages for the
// hotel vertical; unused by generic accounts).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ResolveCategoryResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string }

/**
 * Validates a request-body `category_id`: absent/null/empty → `null`;
 * a string must be a UUID that belongs to `accountId`. Prevents a
 * product being filed under another account's category.
 */
export async function resolveCategoryId(
  db: SupabaseClient,
  accountId: string,
  raw: unknown,
): Promise<ResolveCategoryResult> {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null }
  if (typeof raw !== 'string' || !UUID_RE.test(raw)) {
    return { ok: false, error: 'category_id must be a category UUID or null' }
  }
  const { data, error } = await db
    .from('product_categories')
    .select('id')
    .eq('id', raw)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'category_id does not belong to this account' }
  return { ok: true, value: raw }
}
