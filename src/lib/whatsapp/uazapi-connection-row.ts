// ============================================================
// Shared row-loader for the UAZAPI instance-lifecycle routes
// (connect / status / disconnect).
//
// Filters `provider = 'uazapi'` on top of id + account_id +
// archived_at IS NULL: these three proxy routes are UAZAPI-only,
// so a meta row (or another account's row) must read as "not
// found". The provider-agnostic loader in
// `connections/[id]/route.ts` (PATCH/DELETE) is deliberately
// separate — it serves both providers.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export type UazapiConnectionRow = {
  id: string;
  provider: 'meta' | 'uazapi';
  is_primary: boolean;
  status: string;
  credential: string;
  uazapi_base_url: string | null;
  uazapi_instance_id: string | null;
};

export async function loadUazapiConnectionRow(
  db: SupabaseClient,
  accountId: string,
  id: string
): Promise<UazapiConnectionRow | null> {
  const { data } = await db
    .from('whatsapp_connections')
    .select(
      'id, provider, is_primary, status, credential, uazapi_base_url, uazapi_instance_id'
    )
    .eq('id', id)
    .eq('account_id', accountId)
    .eq('provider', 'uazapi')
    .is('archived_at', null)
    .maybeSingle();
  return (data as UazapiConnectionRow) ?? null;
}
