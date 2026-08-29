// ============================================================
// POST /api/whatsapp/connections/[id]/connect
//
// Thin UAZAPI proxy. Loads the account's uazapi row (provider
// filtered — a meta row or another account's row reads as 404),
// decrypts the instance token, asks the UAZAPI server (pinned via
// row.uazapi_base_url) for a fresh QR / pair code, RE-REGISTERS the
// webhook (spec §3.3 — regenerates secret + hash; the raw secret
// only ever existed as a local in POST /connections, so a webhook
// that failed at creation is otherwise unrecoverable), then marks
// the row `connecting`. The QR is valid for ~120s.
// ============================================================

import { NextResponse } from 'next/server';
import crypto from 'node:crypto';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import { resolveAppBaseUrl } from '@/lib/whatsapp/uazapi-env';
import { connectInstance, configureWebhook } from '@/lib/whatsapp/uazapi-admin';
import { loadUazapiConnectionRow } from '@/lib/whatsapp/uazapi-connection-row';

export async function POST(
  request: Request,
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

    // Pin the UAZAPI server per-connection (FIX 5): the column exists
    // for exactly this — do NOT read the env base URL here.
    const baseUrl = row.uazapi_base_url;
    const token = decrypt(row.credential);
    const { qrcode, paircode } = await connectInstance(baseUrl, token);

    // Re-register the webhook. resolveAppBaseUrl(request) is the app's
    // own origin (where UAZAPI should POST back) — unrelated to
    // row.uazapi_base_url (the UAZAPI server we talk TO).
    const secret = crypto.randomBytes(32).toString('hex');
    const webhookSecretHash = crypto
      .createHash('sha256')
      .update(secret)
      .digest('hex');
    const webhookUrl = `${resolveAppBaseUrl(request)}/api/whatsapp/webhook/uazapi/${secret}`;

    const patch: Record<string, unknown> = { status: 'connecting' };
    try {
      await configureWebhook(baseUrl, token, webhookUrl);
      // Only persist the new hash once UAZAPI actually has the secret.
      patch.webhook_secret_hash = webhookSecretHash;
      patch.last_connection_error = null;
    } catch (err) {
      console.error(
        '[connections connect] configureWebhook failed (non-fatal)',
        err
      );
      patch.last_connection_error = 'Webhook não configurado — reconecte.';
    }

    await supabase
      .from('whatsapp_connections')
      .update(patch)
      .eq('id', id)
      .eq('account_id', accountId);

    return NextResponse.json({ qrcode, paircode, expiresInSeconds: 120 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
