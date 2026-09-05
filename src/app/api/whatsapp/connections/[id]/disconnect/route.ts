// ============================================================
// POST /api/whatsapp/connections/[id]/disconnect
//
// Thin UAZAPI proxy. Loads the account's uazapi row (provider
// filtered — 404 otherwise), best-effort tells the UAZAPI server
// to drop the session (a failure there is logged, never blocks),
// then stamps the row `disconnected` and returns the fresh
// ConnectionDTO. The instance itself is kept — reconnect via
// …/connect. DELETE (route.ts) is what tears the instance down.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import { disconnectInstance } from '@/lib/whatsapp/uazapi-admin';
import { loadUazapiConnectionRow } from '@/lib/whatsapp/uazapi-connection-row';
import { toConnectionDTO } from '@/lib/whatsapp/uazapi-connection-dto';

const SELECT_COLS =
  'id, provider, label, status, is_primary, display_phone, profile_name, last_connection_error, created_at';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, accountId } = await requireRole('admin');
    const row = await loadUazapiConnectionRow(supabase, accountId, id);
    if (!row || !row.uazapi_base_url) {
      return NextResponse.json(
        { error: 'Connection not found' },
        { status: 404 }
      );
    }

    try {
      // Pin the UAZAPI server per-connection (FIX 5).
      await disconnectInstance(row.uazapi_base_url, decrypt(row.credential));
    } catch (err) {
      console.error('[connections disconnect] remote disconnect failed', err);
    }

    const { data: fresh } = await supabase
      .from('whatsapp_connections')
      .update({ status: 'disconnected' })
      .eq('id', id)
      .eq('account_id', accountId)
      .select(SELECT_COLS)
      .single();

    return NextResponse.json({ data: toConnectionDTO(fresh ?? {}) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
