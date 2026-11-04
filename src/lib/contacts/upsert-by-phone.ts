import type { SupabaseClient } from '@supabase/supabase-js';

import { normalizeKey } from '@/lib/contacts/dedupe';
import { fetchAllInChunks } from '@/lib/supabase/paged-query';
import type { Contact } from '@/types';

export interface PhoneNameRow {
  phone: string;
  name?: string;
}

/**
 * Resolve `{ phone, name? }[]` to real `contacts` rows for the account:
 * look up by `phone_normalized`, insert any missing numbers, return the
 * full set in input order. Shared by broadcast CSV audience and Groups
 * CSV member import.
 */
export async function upsertContactsByPhone(
  db: SupabaseClient,
  params: {
    accountId: string;
    userId: string;
    rows: PhoneNameRow[];
  },
): Promise<Contact[]> {
  const { accountId, userId, rows } = params;
  if (rows.length === 0) return [];

  const uniqueByKey = new Map<string, PhoneNameRow>();
  for (const row of rows) {
    const key = normalizeKey(row.phone);
    if (key && !uniqueByKey.has(key)) uniqueByKey.set(key, row);
  }
  const keys = [...uniqueByKey.keys()];
  if (keys.length === 0) return [];

  const existing = await fetchAllInChunks<Contact, string>(
    keys,
    (slice, from, to) =>
      db
        .from('contacts')
        .select('*')
        .eq('account_id', accountId)
        .in('phone_normalized', slice)
        .order('id')
        .range(from, to),
  );

  const byKey = new Map<string, Contact>();
  for (const c of existing) {
    const key = normalizeKey(c.phone ?? '');
    if (key) byKey.set(key, c);
  }

  const missing = keys
    .filter((k) => !byKey.has(k))
    .map((k) => uniqueByKey.get(k)!)
    .map((row) => ({
      user_id: userId,
      account_id: accountId,
      phone: row.phone,
      name: row.name ?? null,
    }));

  const INSERT_CHUNK = 200;
  for (let i = 0; i < missing.length; i += INSERT_CHUNK) {
    const chunk = missing.slice(i, i + INSERT_CHUNK);
    const { data: inserted, error } = await db
      .from('contacts')
      .insert(chunk)
      .select();
    if (error) {
      throw new Error(error.message);
    }
    for (const c of (inserted ?? []) as Contact[]) {
      const key = normalizeKey(c.phone ?? '');
      if (key) byKey.set(key, c);
    }
  }

  return keys
    .map((k) => byKey.get(k))
    .filter((c): c is Contact => Boolean(c));
}
