// ============================================================
// Inbound webhook for the Evolution API (UNOFFICIAL WhatsApp Web).
//
// The Meta Cloud webhook (../webhook/route.ts) routes inbound events by
// `phone_number_id`. Evolution has no such id — it identifies a
// connection by its `instance` name and signs nothing (there's no HMAC
// like Meta's). So this handler:
//
//   1. reads the instance name from the event body,
//   2. looks up the matching whatsapp_config (service-role, by the
//      UNIQUE instance_name from migration 037),
//   3. authenticates by comparing the presented `apikey` (header or
//      body) against the instance apikey we stored (decrypted from the
//      access_token column) in constant time,
//   4. reuses `resolveConversationByPhone` — the same find-or-create
//      the public API and Meta webhook lean on — so a contact/conversation
//      created here is indistinguishable from any other transport's,
//   5. persists the inbound message and bumps the conversation.
//
// Scope (matches the Phase-1 send transport): text + media metadata.
// Media *bytes* live on the Evolution server and need a separate
// download/proxy step — a follow-up — so media messages are recorded
// with their caption/placeholder text and no media_url for now.
// ============================================================

import { timingSafeEqual } from 'crypto';

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';

export const runtime = 'nodejs';

// Content types the messages.content_type CHECK constraint allows
// (001 → widened in 010). Anything else maps to 'text'.
const ALLOWED_CONTENT_TYPES = new Set([
  'text',
  'image',
  'document',
  'audio',
  'video',
  'location',
  'template',
  'interactive',
]);

interface EvolutionKey {
  remoteJid?: string;
  fromMe?: boolean;
  id?: string;
}

interface EvolutionMessageContent {
  conversation?: string;
  extendedTextMessage?: { text?: string };
  imageMessage?: { caption?: string };
  videoMessage?: { caption?: string };
  documentMessage?: { caption?: string; fileName?: string };
  audioMessage?: unknown;
}

interface EvolutionMessageData {
  key?: EvolutionKey;
  pushName?: string;
  message?: EvolutionMessageContent;
  messageType?: string;
  messageTimestamp?: number | string;
}

interface EvolutionWebhookBody {
  event?: string;
  instance?: string;
  apikey?: string;
  data?: EvolutionMessageData | EvolutionMessageData[];
}

/** Constant-time string compare that never short-circuits on length. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still burn a compare against a same-length buffer so timing doesn't
    // leak the length relationship.
    timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Turn an Evolution `remoteJid` into an E.164-ish phone, or null when it
 * isn't a routable 1:1 user JID (group, broadcast, status, empty).
 */
export function jidToPhone(remoteJid: string | undefined): string | null {
  if (!remoteJid) return null;
  if (
    remoteJid.endsWith('@g.us') ||
    remoteJid.endsWith('@broadcast') ||
    remoteJid === 'status@broadcast'
  ) {
    return null;
  }
  const raw = remoteJid.split('@')[0].split(':')[0].replace(/[^\d]/g, '');
  return raw ? `+${raw}` : null;
}

/** Map an Evolution message object to our content_type + text. */
export function parseContent(data: EvolutionMessageData): {
  contentType: string;
  contentText: string;
} {
  const m = data.message ?? {};
  if (typeof m.conversation === 'string' && m.conversation.length > 0) {
    return { contentType: 'text', contentText: m.conversation };
  }
  if (m.extendedTextMessage?.text) {
    return { contentType: 'text', contentText: m.extendedTextMessage.text };
  }
  if (m.imageMessage) {
    return { contentType: 'image', contentText: m.imageMessage.caption || '[image]' };
  }
  if (m.videoMessage) {
    return { contentType: 'video', contentText: m.videoMessage.caption || '[video]' };
  }
  if (m.documentMessage) {
    return {
      contentType: 'document',
      contentText:
        m.documentMessage.caption || m.documentMessage.fileName || '[document]',
    };
  }
  if (m.audioMessage) {
    return { contentType: 'audio', contentText: '[audio]' };
  }
  // Unknown/unsupported shape — record something rather than dropping it.
  return { contentType: 'text', contentText: '[unsupported message]' };
}

export async function POST(request: Request) {
  let body: EvolutionWebhookBody;
  try {
    body = (await request.json()) as EvolutionWebhookBody;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  // Only inbound messages. Ack everything else with 200 so Evolution
  // doesn't retry connection/status/presence events at us.
  if (body.event !== 'messages.upsert') {
    return Response.json({ ok: true, ignored: body.event ?? 'unknown' });
  }

  const instanceName = body.instance;
  if (!instanceName) {
    return Response.json({ error: 'missing_instance' }, { status: 400 });
  }

  // Route to the owning config by instance name (UNIQUE — migration 037).
  const { data: config, error: configError } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('id, account_id, access_token, api_type, instance_name')
    .eq('instance_name', instanceName)
    .eq('api_type', 'evolution')
    .maybeSingle();

  if (configError || !config) {
    // Unknown instance — don't reveal which. 404 keeps Evolution from
    // hammering retries the way a 500 would.
    return Response.json({ error: 'unknown_instance' }, { status: 404 });
  }

  // Authenticate. Evolution can present the instance apikey via an
  // `apikey` header or in the JSON body; accept either, compare in
  // constant time to the stored (decrypted) token.
  const presented = request.headers.get('apikey') || body.apikey || '';
  let expected = '';
  try {
    expected = config.access_token ? decrypt(config.access_token) : '';
  } catch {
    expected = '';
  }
  if (!presented || !expected || !safeEqual(presented, expected)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const accountId = config.account_id as string;
  const events = Array.isArray(body.data) ? body.data : body.data ? [body.data] : [];

  let processed = 0;
  for (const evt of events) {
    const key = evt.key ?? {};
    // Skip our own outbound echoes and non-user JIDs (groups, broadcast).
    if (key.fromMe) continue;
    const phone = jidToPhone(key.remoteJid);
    if (!phone) continue;

    let resolved;
    try {
      resolved = await resolveConversationByPhone(
        supabaseAdmin(),
        accountId,
        phone,
        evt.pushName || null
      );
    } catch (err) {
      console.error(
        '[evolution-webhook] resolveConversationByPhone failed:',
        err instanceof Error ? err.message : err
      );
      continue;
    }

    // Dedupe: Evolution can redeliver. Skip if we already stored this id.
    if (key.id) {
      const { data: existing } = await supabaseAdmin()
        .from('messages')
        .select('id')
        .eq('conversation_id', resolved.conversationId)
        .eq('message_id', key.id)
        .maybeSingle();
      if (existing) continue;
    }

    const { contentType, contentText } = parseContent(evt);
    const safeType = ALLOWED_CONTENT_TYPES.has(contentType) ? contentType : 'text';

    const tsSeconds =
      typeof evt.messageTimestamp === 'string'
        ? parseInt(evt.messageTimestamp, 10)
        : evt.messageTimestamp;
    const createdAt =
      tsSeconds && !Number.isNaN(tsSeconds)
        ? new Date(tsSeconds * 1000).toISOString()
        : new Date().toISOString();

    const { error: msgError } = await supabaseAdmin().from('messages').insert({
      conversation_id: resolved.conversationId,
      sender_type: 'customer',
      content_type: safeType,
      content_text: contentText,
      media_url: null,
      message_id: key.id || null,
      status: 'delivered',
      created_at: createdAt,
    });

    if (msgError) {
      console.error('[evolution-webhook] insert message failed:', msgError.message);
      continue;
    }

    // Bump the conversation. Read current unread_count first (same
    // best-effort increment the Meta webhook does).
    const { data: conv } = await supabaseAdmin()
      .from('conversations')
      .select('unread_count')
      .eq('id', resolved.conversationId)
      .maybeSingle();

    await supabaseAdmin()
      .from('conversations')
      .update({
        last_message_text: contentText,
        last_message_at: new Date().toISOString(),
        unread_count: ((conv?.unread_count as number) || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', resolved.conversationId);

    processed += 1;
  }

  return Response.json({ ok: true, processed });
}
