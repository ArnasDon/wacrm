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
import {
  uazapiMessageToInbound,
  uazapiStatusToInbound,
  eventTypeOf,
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ secret: string }> }
) {
  const { secret } = await params;
  const hash = crypto.createHash('sha256').update(secret).digest('hex');

  const payload = (await request.json().catch(() => ({}))) as Json;
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

  // Defesa em profundidade: o instance/token do payload tem que bater.
  const payloadInstance =
    payload.instance ??
    payload.token ??
    (payload.data as Json | undefined)?.instance;
  if (payloadInstance && payloadInstance !== row.uazapi_instance_id) {
    console.warn(
      `[uazapi webhook] instance mismatch: payload=${String(payloadInstance)} row=${row.uazapi_instance_id}`
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
  const eventType = eventTypeOf(payload);
  const lite = {
    id: row.id as string,
    account_id: row.account_id as string,
    user_id: row.user_id as string,
    uazapi_instance_id: row.uazapi_instance_id as string | null,
  };

  switch (eventType) {
    case 'messages':
      await processInboundMessage(db, uazapiMessageToInbound(payload, lite));
      return;
    case 'messages_update':
      await processStatusUpdate(db, uazapiStatusToInbound(payload, lite));
      return;
    case 'connection':
      await handleConnectionEvent(db, row, payload);
      return;
    default:
      console.info('[uazapi webhook] unhandled EventType:', eventType);
  }
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
    patch.display_phone =
      (m.phone as string) ??
      ((m.jid as Json | undefined)?.user as string) ??
      null;
    patch.profile_name = (m.profileName as string) ?? (m.pushName as string) ?? null;
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
