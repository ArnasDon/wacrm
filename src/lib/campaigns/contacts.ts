// Bulk contact resolution for CSV campaigns: every phone becomes a
// contacts row (broadcast_recipients.contact_id is a FK), matched on
// the account-wide (account_id, phone_normalized) unique index
// (migration 022). Existing contacts are reused untouched; missing ones
// are inserted in chunks.

import type { SupabaseClient } from '@supabase/supabase-js';

import { isUniqueViolation } from '@/lib/contacts/dedupe';

const CHUNK = 500;

/**
 * `entries` carry digits-only phones (already normalised + de-duped).
 * Returns digits → contact id for every phone that resolved.
 */
export async function upsertContactsByPhone(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  entries: { phone: string; name?: string | null }[]
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  const lookup = async (phones: string[]) => {
    for (let i = 0; i < phones.length; i += CHUNK) {
      const { data, error } = await db
        .from('contacts')
        .select('id, phone_normalized')
        .eq('account_id', accountId)
        .in('phone_normalized', phones.slice(i, i + CHUNK));
      if (error) throw new Error(`Contact lookup failed: ${error.message}`);
      for (const c of data ?? [])
        ids.set(c.phone_normalized as string, c.id as string);
    }
  };

  await lookup(entries.map((e) => e.phone));

  const missing = entries.filter((e) => !ids.has(e.phone));
  for (let i = 0; i < missing.length; i += CHUNK) {
    const chunk = missing.slice(i, i + CHUNK);
    const { data, error } = await db
      .from('contacts')
      .insert(
        chunk.map((e) => ({
          account_id: accountId,
          user_id: userId,
          phone: `+${e.phone}`,
          name: e.name?.trim() || null,
        }))
      )
      .select('id, phone_normalized');
    if (error) {
      // A teammate (or the webhook) created one of these meanwhile —
      // fall back to looking the chunk up again, then insert singly.
      if (!isUniqueViolation(error))
        throw new Error(`Contact insert failed: ${error.message}`);
      await lookup(chunk.map((e) => e.phone));
      for (const e of chunk.filter((x) => !ids.has(x.phone))) {
        const { data: one } = await db
          .from('contacts')
          .insert({
            account_id: accountId,
            user_id: userId,
            phone: `+${e.phone}`,
            name: e.name?.trim() || null,
          })
          .select('id, phone_normalized')
          .maybeSingle();
        if (one) ids.set(one.phone_normalized as string, one.id as string);
      }
      continue;
    }
    for (const c of data ?? [])
      ids.set(c.phone_normalized as string, c.id as string);
  }

  return ids;
}
