import type { SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_TAG_COLOR = '#3b82f6';

/**
 * Find an existing tag by (account, category, case-insensitive name),
 * or create it. Used by the lead-analysis job (BLOCO 2/4): tags aren't
 * a fixed catalog (each account creates its own), so the AI must reuse
 * whatever the account already has under a category — "Bessa" and
 * "bessa" must resolve to the same tag — before minting a new one.
 *
 * `user_id` is omitted on creation: a tag the AI creates has no human
 * author (tags.user_id is nullable since migration 050).
 */
export async function findOrCreateTag(
  db: SupabaseClient,
  input: { accountId: string; name: string; category: string },
): Promise<string | null> {
  const name = input.name.trim();
  if (!name) return null;

  const { data: existing, error: findError } = await db
    .from('tags')
    .select('id, name')
    .eq('account_id', input.accountId)
    .eq('category', input.category);

  if (findError) {
    console.error('[tag-find-or-create] lookup failed:', findError.message);
    return null;
  }

  const match = (existing ?? []).find(
    (t: { id: string; name: string }) =>
      t.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (match) return match.id;

  const { data: created, error: insertError } = await db
    .from('tags')
    .insert({
      account_id: input.accountId,
      name,
      category: input.category,
      color: DEFAULT_TAG_COLOR,
    })
    .select('id')
    .single();

  if (insertError) {
    console.error('[tag-find-or-create] create failed:', insertError.message);
    return null;
  }
  return created?.id ?? null;
}

/**
 * Find a tag by (account, category, case-insensitive name) without
 * creating it — used for removals, where a nonexistent tag simply
 * means there's nothing to remove.
 */
export async function findTag(
  db: SupabaseClient,
  input: { accountId: string; name: string; category: string },
): Promise<string | null> {
  const name = input.name.trim().toLowerCase();
  if (!name) return null;

  const { data: existing, error } = await db
    .from('tags')
    .select('id, name')
    .eq('account_id', input.accountId)
    .eq('category', input.category);

  if (error) {
    console.error('[tag-find-or-create] lookup failed:', error.message);
    return null;
  }

  const match = (existing ?? []).find(
    (t: { id: string; name: string }) => t.name.trim().toLowerCase() === name,
  );
  return match?.id ?? null;
}
