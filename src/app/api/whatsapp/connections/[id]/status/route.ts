// ============================================================
// GET /api/whatsapp/connections/[id]/status
//
// Thin UAZAPI proxy. Loads the account's uazapi row (provider
// filtered — 404 otherwise), decrypts the instance token, reads
// the live instance status, then persists the mapping:
//   connected  → status='connected' + display_phone + profile_name,
//                clear last_connection_error
//   otherwise  → status = instanceStatus ?? 'disconnected'
// The response echoes the persisted status, phone/name (only when
// connected) and the current qrcode straight through.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import { uazapiEnv } from '@/lib/whatsapp/uazapi-env';
import { instanceStatus } from '@/lib/whatsapp/uazapi-admin';
import { loadUazapiConnectionRow } from '@/lib/whatsapp/uazapi-connection-row';

export async function GET(
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

    const { baseUrl } = uazapiEnv();
    const st = await instanceStatus(baseUrl, decrypt(row.credential));

    const patch: Record<string, unknown> = st.connected
      ? {
          status: 'connected',
          display_phone: st.phone,
          profile_name: st.profileName,
          last_connection_error: null,
        }
      : { status: st.instanceStatus ?? 'disconnected' };

    await supabase
      .from('whatsapp_connections')
      .update(patch)
      .eq('id', id)
      .eq('account_id', accountId);

    return NextResponse.json({
      status: patch.status,
      display_phone: st.connected ? st.phone : null,
      profile_name: st.connected ? st.profileName : null,
      qrcode: st.qrcode,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
