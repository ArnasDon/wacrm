// ============================================================
// POST /api/whatsapp/connections/[id]/connect
//
// Thin UAZAPI proxy. Loads the account's uazapi row (provider
// filtered — a meta row or another account's row reads as 404),
// decrypts the instance token, asks the UAZAPI server for a fresh
// QR / pair code, then marks the row `connecting` and clears any
// stale connection error. The QR is valid for ~120s.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import { uazapiEnv } from '@/lib/whatsapp/uazapi-env';
import { connectInstance } from '@/lib/whatsapp/uazapi-admin';
import { loadUazapiConnectionRow } from '@/lib/whatsapp/uazapi-connection-row';

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

    const { baseUrl } = uazapiEnv();
    const { qrcode, paircode } = await connectInstance(
      baseUrl,
      decrypt(row.credential)
    );

    await supabase
      .from('whatsapp_connections')
      .update({ status: 'connecting', last_connection_error: null })
      .eq('id', id)
      .eq('account_id', accountId);

    return NextResponse.json({ qrcode, paircode, expiresInSeconds: 120 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
