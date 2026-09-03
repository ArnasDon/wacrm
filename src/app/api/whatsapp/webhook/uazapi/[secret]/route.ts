// ============================================================
// POST /api/whatsapp/webhook/uazapi/[secret]
//
// Inbound webhook endpoint for the UAZAPI (unofficial QR-code
// WhatsApp) provider. The `[secret]` path segment is the raw webhook
// secret UAZAPI was configured with at connect time; we SHA-256 it and
// look the connection up by `webhook_secret_hash` (the raw secret is
// never stored). Envelope parsing lives in the Task-1 adapter
// (`uazapi-adapter.ts`); the provider-agnostic pipeline in
// `src/lib/whatsapp/inbound/` does the rest.
//
// Same fast-ack shape as the Meta route: hand the work to `after()` and
// return 200 immediately so UAZAPI does not redeliver on a slow ack.
// ============================================================

import { NextResponse, after } from 'next/server';
import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { processInboundMessage } from '@/lib/whatsapp/inbound/process-inbound-message';
import { processStatusUpdate } from '@/lib/whatsapp/inbound/process-status-update';
import type { InboundStatus } from '@/lib/whatsapp/inbound/types';
import {
  uazapiMessageToInbound,
  uazapiStatusToInbound,
  eventTypeOf,
  eventKindOf,
} from '@/lib/whatsapp/inbound/uazapi-adapter';

export const maxDuration = 60;

let _admin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _admin;
}

const CONNECTION_STATES = [
  'disconnected',
  'connecting',
  'connected',
  'hibernated',
  'banned',
] as const;

type Json = Record<string, unknown>;

/** First value that is a non-blank string; `null` otherwise (so `''` falls through). */
const firstNonEmpty = (...vals: unknown[]): string | null => {
  for (const v of vals) if (typeof v === 'string' && v.trim() !== '') return v;
  return null;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ secret: string }> }
) {
  const { secret } = await params;
  const hash = crypto.createHash('sha256').update(secret).digest('hex');

  const parsed = await request.json().catch(() => null);
  const payload: Json =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Json)
      : {};
  const db = admin();

  const { data: row } = await db
    .from('whatsapp_connections')
    .select('*')
    .eq('webhook_secret_hash', hash)
    .eq('provider', 'uazapi')
    .is('archived_at', null)
    .maybeSingle();

  if (!row) {
    console.warn('[uazapi webhook] secret hash matched no connection');
    return NextResponse.json({ status: 'ignored' }, { status: 200 });
  }

  // Defesa em profundidade: quando o payload traz um `instance` id, ele
  // tem que bater com o da conexão. NÃO usamos `payload.token` aqui — é a
  // credencial da instância (o segredo, guardado cifrado em
  // `row.credential`), nunca igual a `row.uazapi_instance_id`. O envelope
  // achatado `{ EventType, token }` (sem `instance`) segue em frente: a
  // defesa real é o hash do segredo na URL.
  const payloadInstance =
    payload.instance ?? (payload.data as Json | undefined)?.instance;
  if (payloadInstance && payloadInstance !== row.uazapi_instance_id) {
    // TEMP — confirming the real `connection` event shape (payload
    // logged only on this rejection path). Remove once confirmed.
    console.warn(
      '[uazapi webhook] instance mismatch — payload:',
      JSON.stringify(payload)
    );
    console.warn(
      '[uazapi webhook] instance mismatch (payload instance does not match connection)'
    );
    return NextResponse.json({ status: 'ignored' }, { status: 200 });
  }

  // Ack rápido — a UAZAPI reenvia se o ack demora (igual à Meta).
  after(async () => {
    try {
      await handleUazapiEvent(db, row, payload);
    } catch (err) {
      console.error('[uazapi webhook] processing error:', err);
    }
  });

  return NextResponse.json({ status: 'received' }, { status: 200 });
}

async function handleUazapiEvent(
  db: SupabaseClient,
  row: Json,
  payload: Json
): Promise<void> {
  const lite = {
    id: row.id as string,
    account_id: row.account_id as string,
    user_id: row.user_id as string,
    uazapi_instance_id: row.uazapi_instance_id as string | null,
  };

  switch (eventKindOf(payload)) {
    case 'message':
      await processInboundMessage(db, uazapiMessageToInbound(payload, lite));
      return;
    case 'status': {
      // UAZAPI can batch more than one id into a single event's
      // `MessageIDs` (confirmed via 1c-ii smoke) — one InboundStatus
      // per id, applied independently.
      for (const inbound of uazapiStatusToInbound(payload, lite)) {
        await applyStatusUpdate(db, row, inbound);
      }
      return;
    }
    case 'connection':
      await handleConnectionEvent(db, row, payload);
      return;
    default:
      console.info('[uazapi webhook] unhandled event:', eventTypeOf(payload));
  }
}

// Confine status writes to this connection's own messages — the shared
// pipeline updates `messages` by `message_id` alone (not unique,
// migration 009), and this endpoint's payload is attacker-controllable.
// Without this a caller holding one account's URL secret could flip
// statuses in other tenants that share a `message_id`.
async function applyStatusUpdate(
  db: SupabaseClient,
  row: Json,
  inbound: InboundStatus
): Promise<void> {
  const { data: owned } = await db
    .from('messages')
    .select('id, conversations!inner(connection_id)')
    .eq('message_id', inbound.providerMessageId)
    .eq('conversations.connection_id', row.id as string)
    .limit(1)
    .maybeSingle();
  if (!owned) {
    console.info(
      '[uazapi webhook] status update for a message not under this connection — ignoring'
    );
    return;
  }
  await processStatusUpdate(db, inbound);
}

async function handleConnectionEvent(
  db: SupabaseClient,
  row: Json,
  payload: Json
): Promise<void> {
  const m = ((payload.data as Json | undefined) ?? payload) as Json;
  const raw = String(m.status ?? m.state ?? '').toLowerCase();
  const status = (CONNECTION_STATES as readonly string[]).includes(raw)
    ? raw
    : null;
  if (!status) {
    console.info('[uazapi webhook] connection event, unmapped state:', raw);
    return;
  }
  const patch: Json = { status };
  if (status === 'connected') {
    patch.display_phone = firstNonEmpty(
      m.phone,
      (m.jid as Json | undefined)?.user
    );
    patch.profile_name = firstNonEmpty(m.profileName, m.pushName);
    patch.last_connection_error = null;
  } else {
    patch.last_connection_error =
      (m.reason as string) ?? (m.lastDisconnectReason as string) ?? null;
  }
  const { error } = await db
    .from('whatsapp_connections')
    .update(patch)
    .eq('id', row.id as string);
  if (error) {
    console.error('[uazapi webhook] connection UPDATE failed:', error);
  }
}
