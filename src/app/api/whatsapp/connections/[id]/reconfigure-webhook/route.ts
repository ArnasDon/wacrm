import { NextResponse } from 'next/server';
import crypto from 'node:crypto';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import { resolveAppBaseUrl } from '@/lib/whatsapp/uazapi-env';
import { configureWebhook } from '@/lib/whatsapp/uazapi-admin';
import { loadUazapiConnectionRow } from '@/lib/whatsapp/uazapi-connection-row';
import { toConnectionDTO } from '@/lib/whatsapp/uazapi-connection-dto';

const SELECT_COLS =
  'id, provider, label, status, is_primary, display_phone, profile_name, last_connection_error, created_at';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, accountId } = await requireRole('admin');
    const row = await loadUazapiConnectionRow(supabase, accountId, id);
    if (!row || !row.uazapi_base_url) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    }

    const baseUrl = row.uazapi_base_url;
    const token = decrypt(row.credential);
    const secret = crypto.randomBytes(32).toString('hex');
    const webhookSecretHash = crypto
      .createHash('sha256')
      .update(secret)
      .digest('hex');
    const webhookUrl = `${resolveAppBaseUrl(request)}/api/whatsapp/webhook/uazapi/${secret}`;

    try {
      await configureWebhook(baseUrl, token, webhookUrl);
    } catch (err) {
      console.error('[reconfigure-webhook] configureWebhook failed', err);
      await supabase
        .from('whatsapp_connections')
        .update({ last_connection_error: 'Webhook não configurado — tente de novo.' })
        .eq('id', id)
        .eq('account_id', accountId);
      return NextResponse.json({ error: 'Failed to configure webhook' }, { status: 502 });
    }

    const { data: fresh } = await supabase
      .from('whatsapp_connections')
      .update({ webhook_secret_hash: webhookSecretHash, last_connection_error: null })
      .eq('id', id)
      .eq('account_id', accountId)
      .select(SELECT_COLS)
      .single();

    return NextResponse.json({ data: toConnectionDTO(fresh ?? {}) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
