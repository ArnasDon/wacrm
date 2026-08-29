import { NextResponse } from 'next/server';
import crypto from 'node:crypto';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { encrypt } from '@/lib/whatsapp/encryption';
import { uazapiEnv, resolveAppBaseUrl } from '@/lib/whatsapp/uazapi-env';
import {
  createInstance,
  configureWebhook,
  deleteInstance,
} from '@/lib/whatsapp/uazapi-admin';
import { toConnectionDTO } from '@/lib/whatsapp/uazapi-connection-dto';

const SELECT_COLS =
  'id, provider, label, status, is_primary, display_phone, profile_name, last_connection_error, created_at';

export async function GET() {
  try {
    // Read-only, sanitized ConnectionDTO[] (no secrets) — any account
    // member may list connections (RLS whatsapp_connections_select
    // already allows it). Every MUTATION below stays admin-gated.
    const { supabase, accountId } = await requireRole('agent');
    const { data, error } = await supabase
      .from('whatsapp_connections')
      .select(SELECT_COLS)
      .eq('account_id', accountId)
      .is('archived_at', null)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('[connections GET]', error);
      return NextResponse.json(
        { error: 'Failed to load connections' },
        { status: 500 }
      );
    }
    return NextResponse.json({ data: (data ?? []).map(toConnectionDTO) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    // Uma conexão UAZAPI ativa por conta (o índice parcial
    // idx_connections_account_provider também trava no banco; este
    // check dá o 409 amigável).
    const { data: existing } = await supabase
      .from('whatsapp_connections')
      .select('id')
      .eq('account_id', accountId)
      .eq('provider', 'uazapi')
      .is('archived_at', null)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { error: 'This account already has a UAZAPI connection.' },
        { status: 409 }
      );
    }

    const { baseUrl, adminToken } = uazapiEnv();

    // 1. Cria a instância no servidor do operador.
    let instance: { token: string; instanceId: string };
    try {
      instance = await createInstance(
        baseUrl,
        adminToken,
        `wacrm-${accountId}`
      );
    } catch (err) {
      console.error('[connections POST] createInstance failed', err);
      return NextResponse.json(
        {
          error:
            'Could not create a UAZAPI instance. Check UAZAPI_BASE_URL / UAZAPI_ADMIN_TOKEN.',
        },
        { status: 502 }
      );
    }

    // 2. Segredo do webhook — só o hash é persistido.
    const secret = crypto.randomBytes(32).toString('hex');
    const webhookSecretHash = crypto
      .createHash('sha256')
      .update(secret)
      .digest('hex');

    // 2b. Eleição de is_primary (FIX 2): a primeira e única conexão do
    // account (inclusive uma conta só-UAZAPI) nasce primária — não há
    // canal do qual "trocar silenciosamente". "Nasce não-primária" só
    // vale quando já existe outra conexão ativa. Espelha config/route.ts.
    const { count: activeCount, error: countError } = await supabase
      .from('whatsapp_connections')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .is('archived_at', null);
    if (countError) {
      console.error(
        '[connections POST] count failed, rolling back instance',
        countError
      );
      await deleteInstance(baseUrl, instance.token).catch((e) =>
        console.error('[connections POST] rollback deleteInstance failed', e)
      );
      return NextResponse.json(
        { error: 'Failed to save the connection.' },
        { status: 502 }
      );
    }

    // 3. Grava a linha.
    const { data: inserted, error: insertError } = await supabase
      .from('whatsapp_connections')
      .insert({
        account_id: accountId,
        user_id: userId,
        provider: 'uazapi',
        credential: encrypt(instance.token),
        uazapi_instance_id: instance.instanceId,
        uazapi_base_url: baseUrl,
        status: 'disconnected',
        is_primary: (activeCount ?? 0) === 0,
        webhook_secret_hash: webhookSecretHash,
      })
      .select(SELECT_COLS)
      .single();

    if (insertError || !inserted) {
      console.error(
        '[connections POST] insert failed, rolling back instance',
        insertError
      );
      await deleteInstance(baseUrl, instance.token).catch((e) =>
        console.error('[connections POST] rollback deleteInstance failed', e)
      );
      return NextResponse.json(
        { error: 'Failed to save the connection.' },
        { status: 502 }
      );
    }

    // 4. Registra o webhook (não-fatal).
    const webhookUrl = `${resolveAppBaseUrl(request)}/api/whatsapp/webhook/uazapi/${secret}`;
    try {
      await configureWebhook(baseUrl, instance.token, webhookUrl);
    } catch (err) {
      console.error(
        '[connections POST] configureWebhook failed (non-fatal)',
        err
      );
      await supabase
        .from('whatsapp_connections')
        .update({
          last_connection_error: 'Webhook não configurado — reconecte.',
        })
        .eq('id', inserted.id);
      const withErr = {
        ...inserted,
        last_connection_error: 'Webhook não configurado — reconecte.',
      };
      return NextResponse.json(
        { data: toConnectionDTO(withErr) },
        { status: 201 }
      );
    }

    return NextResponse.json(
      { data: toConnectionDTO(inserted) },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
