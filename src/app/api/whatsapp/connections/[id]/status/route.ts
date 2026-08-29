// ============================================================
// GET /api/whatsapp/connections/[id]/status
//
// Thin UAZAPI proxy. Loads the account's uazapi row (provider
// filtered — 404 otherwise), decrypts the instance token, reads
// the live instance status from the pinned row.uazapi_base_url,
// then persists the mapping:
//   connected  → status='connected' + display_phone + profile_name,
//                clear last_connection_error
//   otherwise  → status = whitelisted(instanceStatus) ?? 'disconnected'
// The whitelist mirrors migration 040's CHECK
// (disconnected|connecting|connected|hibernated|banned) — an
// unexpected UAZAPI value would otherwise 23514 and be swallowed.
// The response echoes the persisted status, phone/name (only when
// connected) and the current qrcode straight through.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import { instanceStatus } from '@/lib/whatsapp/uazapi-admin';
import { loadUazapiConnectionRow } from '@/lib/whatsapp/uazapi-connection-row';

const ALLOWED_STATUS = [
  'disconnected',
  'connecting',
  'connected',
  'hibernated',
  'banned',
] as const;

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

    // Pin the UAZAPI server per-connection (FIX 5).
    const baseUrl = row.uazapi_base_url;
    const st = await instanceStatus(baseUrl, decrypt(row.credential));

    const mappedStatus = ALLOWED_STATUS.includes(
      st.instanceStatus as (typeof ALLOWED_STATUS)[number]
    )
      ? st.instanceStatus
      : 'disconnected';

    const patch: Record<string, unknown> = st.connected
      ? {
          status: 'connected',
          display_phone: st.phone,
          profile_name: st.profileName,
          last_connection_error: null,
        }
      : { status: mappedStatus };

    const { error: updateError } = await supabase
      .from('whatsapp_connections')
      .update(patch)
      .eq('id', id)
      .eq('account_id', accountId);
    if (updateError) {
      console.error('[connections status]', updateError);
      return NextResponse.json(
        { error: 'Failed to persist connection status' },
        { status: 500 }
      );
    }

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
