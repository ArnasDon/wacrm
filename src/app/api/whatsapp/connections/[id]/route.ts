// ============================================================
// PATCH | DELETE /api/whatsapp/connections/[id]
//
// PATCH  — mutate one connection (ANY provider) by id: `label`,
//          `is_primary`, `mirror_inbound_media`. Promoting a row to
//          primary calls the `set_primary_connection` RPC (migration 041),
//          which atomically updates all rows in one statement and checks
//          the deferrable EXCLUDE constraint at COMMIT (no 0-primary
//          window). Demoting the sole active connection is 400.
//
// DELETE  — archive: for uazapi rows, best-effort disconnect + delete of
//          the remote instance (pinned via row.uazapi_base_url; failures
//          logged, never block), then
//          stamp archived_at / status / is_primary. If the archived row
//          was primary and exactly one active row remains, it inherits.
//
// loadRow here has NO provider filter on purpose: the Meta card PATCHes
// its provider='meta' row (mirror-media toggle) and Meta rows archive
// through DELETE too.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  disconnectInstance,
  deleteInstance,
} from '@/lib/whatsapp/uazapi-admin';
import { toConnectionDTO } from '@/lib/whatsapp/uazapi-connection-dto';

const SELECT_COLS =
  'id, provider, label, status, is_primary, display_phone, profile_name, last_connection_error, created_at';

type RowLite = {
  id: string;
  provider: 'meta' | 'uazapi';
  is_primary: boolean;
  credential: string;
  uazapi_base_url: string | null;
};

async function loadRow(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
  id: string
): Promise<RowLite | null> {
  const { data } = await supabase
    .from('whatsapp_connections')
    .select('id, provider, is_primary, credential, uazapi_base_url')
    .eq('id', id)
    .eq('account_id', accountId)
    .is('archived_at', null)
    .maybeSingle();
  return (data as RowLite) ?? null;
}

async function activeCount(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string
): Promise<number> {
  const { count } = await supabase
    .from('whatsapp_connections')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .is('archived_at', null);
  return count ?? 0;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, accountId } = await requireRole('admin');
    const row = await loadRow(supabase, accountId, id);
    if (!row) {
      return NextResponse.json(
        { error: 'Connection not found' },
        { status: 404 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      label?: string;
      is_primary?: boolean;
      mirror_inbound_media?: boolean;
    };

    const patch: Record<string, unknown> = {};
    if (typeof body.label === 'string') patch.label = body.label;
    if (typeof body.mirror_inbound_media === 'boolean') {
      patch.mirror_inbound_media = body.mirror_inbound_media;
    }

    if (body.is_primary === true) {
      // Atomic promotion: the RPC does UPDATE ... SET is_primary =
      // (id = p_id) in one statement; migration 041's DEFERRABLE EXCLUDE
      // constraint checks at COMMIT, so there is no 0-primary window.
      const { error: rpcError } = await supabase.rpc('set_primary_connection', {
        p_id: id,
        p_account_id: accountId,
      });
      if (rpcError) {
        const code = (rpcError as { code?: string }).code;
        if (code === 'P0002') {
          return NextResponse.json(
            { error: 'Connection not found' },
            { status: 404 }
          );
        }
        if (code === '42501') {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        console.error('[connections PATCH] set_primary_connection', rpcError);
        return NextResponse.json(
          { error: 'Failed to update connection' },
          { status: 500 }
        );
      }
      // is_primary is already applied by the RPC — do NOT add it to
      // `patch`.
    } else if (body.is_primary === false) {
      if ((await activeCount(supabase, accountId)) <= 1) {
        return NextResponse.json(
          {
            error:
              'The account needs a default channel — promote another connection first.',
          },
          { status: 400 }
        );
      }
      patch.is_primary = false;
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await supabase
        .from('whatsapp_connections')
        .update(patch)
        .eq('id', id)
        .eq('account_id', accountId);
      if (error) {
        console.error('[connections PATCH]', error);
        return NextResponse.json(
          { error: 'Failed to update connection' },
          { status: 500 }
        );
      }
    }

    const { data: fresh } = await supabase
      .from('whatsapp_connections')
      .select(SELECT_COLS)
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle();
    return NextResponse.json({ data: toConnectionDTO(fresh ?? {}) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, accountId } = await requireRole('admin');
    const row = await loadRow(supabase, accountId, id);
    if (!row) {
      return NextResponse.json(
        { error: 'Connection not found' },
        { status: 404 }
      );
    }

    if (row.provider === 'uazapi' && row.uazapi_base_url) {
      try {
        const token = decrypt(row.credential);
        // Pin the UAZAPI server per-connection (FIX 5).
        const baseUrl = row.uazapi_base_url;
        await disconnectInstance(baseUrl, token).catch(() => {});
        await deleteInstance(baseUrl, token);
      } catch (err) {
        // The operator's quota may leak an instance; we still archive
        // the row — the operator isn't stuck behind the unique index.
        console.error('[connections DELETE] remote cleanup failed', err);
      }
    }

    const { data: archived, error } = await supabase
      .from('whatsapp_connections')
      .update({
        archived_at: new Date().toISOString(),
        status: 'disconnected',
        is_primary: false,
      })
      .eq('id', id)
      .eq('account_id', accountId)
      .select(SELECT_COLS)
      .single();
    if (error) {
      console.error('[connections DELETE]', error);
      return NextResponse.json(
        { error: 'Failed to archive connection' },
        { status: 500 }
      );
    }

    // Primary hand-off: if the archived row was primary and exactly one
    // active row remains, it inherits. 0 or 2+ → nobody (explicit choice).
    if (row.is_primary) {
      const { data: remaining } = await supabase
        .from('whatsapp_connections')
        .select('id')
        .eq('account_id', accountId)
        .is('archived_at', null);
      if (remaining && remaining.length === 1) {
        await supabase
          .from('whatsapp_connections')
          .update({ is_primary: true })
          .eq('id', remaining[0].id);
      }
    }

    return NextResponse.json({ data: toConnectionDTO(archived) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
