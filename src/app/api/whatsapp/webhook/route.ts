import { NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import { getCatalogProductNames, getMediaUrl } from '@/lib/whatsapp/meta-api';
import { productNameFromCardapio } from '@/lib/cardapio/product-names';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import { resolveOrCreateConversation } from '@/lib/whatsapp/resolve-conversation';
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { dispatchInboundToFlows } from '@/lib/flows/engine';
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import {
  processFreeTextOrderInbound,
  processInboundHandoff,
} from '@/lib/orders/text-order-flow';
import {
  handleTemplateWebhookChange,
  isTemplateWebhookField,
} from '@/lib/whatsapp/template-webhook';

export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}

interface WhatsAppMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type: string; caption?: string };
  video?: { id: string; mime_type: string; caption?: string };
  document?: {
    id: string;
    mime_type: string;
    filename?: string;
    caption?: string;
  };
  audio?: { id: string; mime_type: string };
  sticker?: { id: string; mime_type: string };
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  reaction?: { message_id: string; emoji: string };
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  order?: {
    catalog_id?: string;
    text?: string;
    product_items?: Array<{
      product_retailer_id: string;
      quantity: number;
      item_price: number;
      currency?: string;
    }>;
  };
  context?: { id: string };
}

interface WhatsAppWebhookEntry {
  id: string;
  changes: Array<{
    value: {
      messaging_product: string;
      metadata: {
        display_phone_number: string;
        phone_number_id: string;
      };
      contacts?: Array<{
        profile: { name: string };
        wa_id: string;
      }>;
      messages?: WhatsAppMessage[];
      statuses?: Array<{
        id: string;
        status: string;
        timestamp: string;
        recipient_id: string;
      }>;
    };
    field: string;
  }>;
}

export function shouldAttemptAiReply(args: {
  flowConsumed: boolean;
  outcome?: string;
  interactiveReplyId: string | null;
  inboundText: string;
}): boolean {
  const trimmed = args.inboundText.trim();
  const decision =
    !!trimmed &&
    !args.interactiveReplyId &&
    (!args.flowConsumed ||
      args.outcome === 'no_match' ||
      args.outcome === 'duplicate_inbound_ignored');

  if (process.env.NODE_ENV !== 'production') {
    console.log('[webhook] ai gate', {
      flowConsumed: args.flowConsumed,
      outcome: args.outcome,
      interactiveReplyId: args.interactiveReplyId,
      inboundTextLength: trimmed.length,
      decision,
    });
  }

  return decision;
}

// GET - Webhook verification
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('hub.mode');
    const challenge = searchParams.get('hub.challenge');
    const verifyToken = searchParams.get('hub.verify_token');

    if (mode !== 'subscribe' || !challenge || !verifyToken) {
      return NextResponse.json(
        { error: 'Missing verification parameters' },
        { status: 400 }
      );
    }

    const { data: configs, error: configError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('id, verify_token');

    if (configError || !configs) {
      console.error('Error fetching configs for verification:', configError);
      return NextResponse.json(
        { error: 'Verification failed' },
        { status: 403 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let matchedConfig: any = null;
    for (const config of configs) {
      if (!config.verify_token) continue;
      try {
        if (decrypt(config.verify_token) === verifyToken) {
          matchedConfig = config;
          break;
        }
      } catch {
        // ignora erro de chave
      }
    }

    if (matchedConfig) {
      if (isLegacyFormat(matchedConfig.verify_token)) {
        void supabaseAdmin()
          .from('whatsapp_config')
          .update({ verify_token: encrypt(verifyToken) })
          .eq('id', matchedConfig.id);
      }
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    return NextResponse.json(
      { error: 'Verification token mismatch' },
      { status: 403 }
    );
  } catch (error) {
    console.error('Error in webhook GET verification:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST - Receive messages
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-hub-signature-256');

  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    console.warn('[webhook] rejected request with invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: { entry?: WhatsAppWebhookEntry[] };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const pendingEffects: Array<() => Promise<void>> = [];
  try {
    // History is durable before acknowledging Meta. Slow business effects are
    // scheduled only after their separate at-most-once receipt is claimed.
    await processWebhook(body, pendingEffects);
  } catch (error) {
    console.error('Error persisting webhook:', error);
    return NextResponse.json(
      { error: 'Unable to persist webhook' },
      { status: 500 }
    );
  } finally {
    // after callbacks may run concurrently. Keep this payload's turns in one
    // ordered worker, including receipts claimed before a later persistence error.
    if (pendingEffects.length) {
      after(async () => {
        for (const effect of pendingEffects) await effect();
      });
    }
  }

  return NextResponse.json({ status: 'received' }, { status: 200 });
}

async function processWebhook(
  body: { entry?: WhatsAppWebhookEntry[] },
  pendingEffects: Array<() => Promise<void>>
) {
  if (!body.entry) return;

  for (const entry of body.entry) {
    for (const change of entry.changes) {
      if (isTemplateWebhookField(change.field)) {
        await handleTemplateWebhookChange(
          { field: change.field, value: change.value as unknown },
          supabaseAdmin()
        );
        continue;
      }

      const value = change.value;

      if (value.statuses) {
        for (const status of value.statuses) {
          await handleStatusUpdate(status);
        }
      }

      if (!value.messages || !value.contacts) continue;

      const phoneNumberId = value.metadata.phone_number_id;

      const { data: configRows, error: configError } = await supabaseAdmin()
        .from('whatsapp_config')
        .select('*')
        .eq('phone_number_id', phoneNumberId);

      if (configError || !configRows || configRows.length === 0) {
        console.error('No config found for phone_number_id:', phoneNumberId);
        throw new Error('Unable to route inbound account');
      }

      const config = configRows[0];
      const decryptedAccessToken = decrypt(config.access_token);

      for (let i = 0; i < value.messages.length; i++) {
        const message = value.messages[i];
        const contact = value.contacts[i] || value.contacts[0];

        await processMessage(
          message,
          contact,
          config.account_id,
          config.user_id,
          decryptedAccessToken,
          phoneNumberId,
          pendingEffects
        );
      }
    }
  }
}

const RECIPIENT_STATUS_LADDER = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
] as const;

function ladderLevel(s: string): number {
  const idx = (RECIPIENT_STATUS_LADDER as readonly string[]).indexOf(s);
  return idx < 0 ? -1 : idx;
}

function isValidStatusTransition(current: string, incoming: string): boolean {
  if (incoming === 'failed') return current === 'pending' || current === 'sent';
  if (current === 'failed') return false;
  const ci = ladderLevel(current);
  const ii = ladderLevel(incoming);
  if (ii < 0) return false;
  if (ci < 0) return true;
  return ii > ci;
}

async function handleStatusUpdate(status: {
  id: string;
  status: string;
  timestamp: string;
  recipient_id: string;
}) {
  await supabaseAdmin()
    .from('messages')
    .update({ status: status.status })
    .eq('message_id', status.id);

  const tsIso = new Date(parseInt(status.timestamp) * 1000).toISOString();

  const { data: recipient } = await supabaseAdmin()
    .from('broadcast_recipients')
    .select('id, status')
    .eq('whatsapp_message_id', status.id)
    .maybeSingle();

  if (recipient && isValidStatusTransition(recipient.status, status.status)) {
    const update: Record<string, unknown> = { status: status.status };
    if (status.status === 'sent' && !('sent_at' in update))
      update.sent_at = tsIso;
    if (status.status === 'delivered') update.delivered_at = tsIso;
    if (status.status === 'read') update.read_at = tsIso;

    await supabaseAdmin()
      .from('broadcast_recipients')
      .update(update)
      .eq('id', recipient.id);
  }

  const { data: msgRow } = await supabaseAdmin()
    .from('messages')
    .select('conversation_id, conversations(account_id)')
    .eq('message_id', status.id)
    .limit(1)
    .maybeSingle();

  if (msgRow) {
    const conv = msgRow.conversations as { account_id: string } | null;
    if (conv?.account_id) {
      await dispatchWebhookEvent(
        supabaseAdmin(),
        conv.account_id,
        'message.status_updated',
        {
          whatsapp_message_id: status.id,
          conversation_id: msgRow.conversation_id,
          status: status.status,
        }
      );
    }
  }
}

async function flagBroadcastReplyIfAny(accountId: string, contactId: string) {
  try {
    const { data: recs } = await supabaseAdmin()
      .from('broadcast_recipients')
      .select('id, status, broadcast_id, broadcasts!inner(account_id)')
      .eq('contact_id', contactId)
      .eq('broadcasts.account_id', accountId)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false })
      .limit(1);

    if (!recs || recs.length === 0) return;

    await supabaseAdmin()
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', recs[0].id);
  } catch (err) {
    console.error('flagBroadcastReplyIfAny failed:', err);
  }
}

async function lookupInternalIdByMetaId(
  metaId: string,
  conversationId: string
): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('message_id', metaId)
    .eq('conversation_id', conversationId)
    .maybeSingle();
  return data?.id ?? null;
}

async function handleReaction(
  message: WhatsAppMessage,
  conversationId: string,
  contactId: string
) {
  const reaction = message.reaction;
  if (!reaction?.message_id) return;

  const targetInternalId = await lookupInternalIdByMetaId(
    reaction.message_id,
    conversationId
  );
  if (!targetInternalId) return;

  if (!reaction.emoji) {
    await supabaseAdmin()
      .from('message_reactions')
      .delete()
      .eq('message_id', targetInternalId)
      .eq('actor_type', 'customer')
      .eq('actor_id', contactId);
    return;
  }

  await supabaseAdmin().from('message_reactions').upsert(
    {
      message_id: targetInternalId,
      conversation_id: conversationId,
      actor_type: 'customer',
      actor_id: contactId,
      emoji: reaction.emoji,
    },
    { onConflict: 'message_id,actor_type,actor_id' }
  );
}

async function processMessage(
  message: WhatsAppMessage,
  contact: { profile: { name: string }; wa_id: string },
  accountId: string,
  configOwnerUserId: string,
  accessToken: string,
  phoneNumberId: string,
  pendingEffects: Array<() => Promise<void>>
) {
  const senderPhone = normalizePhone(message.from);
  const contactName = contact.profile.name;

  const contactOutcome = await findOrCreateContact(
    accountId,
    configOwnerUserId,
    senderPhone,
    contactName
  );
  if (!contactOutcome) throw new Error('Unable to persist inbound contact');
  const contactRecord = contactOutcome.contact;

  const convResult = await resolveOrCreateConversation(supabaseAdmin(), {
    accountId,
    userId: configOwnerUserId,
    contactId: contactRecord.id,
  });
  const conversation = convResult.conversation;
  const conversationCreated = convResult.is_new;
  const contactWasCreated = contactOutcome.wasCreated;

  // Reactions have no standalone inbound history row.
  if (message.type === 'reaction') {
    await handleReaction(message, conversation.id, contactRecord.id);
    return;
  }

  // Persist history independently of the business-effect receipt.

  const { contentText, mediaUrl, interactiveReplyId, order } =
    await parseMessageContent(message, accessToken);

  let replyToInternalId: string | null = null;
  if (message.context?.id) {
    replyToInternalId = await lookupInternalIdByMetaId(
      message.context.id,
      conversation.id
    );
  }

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
  const contentType = ALLOWED_CONTENT_TYPES.has(message.type)
    ? message.type
    : message.type === 'sticker'
      ? 'image'
      : 'text';

  let isFirstInboundMessage = conversationCreated;
  if (!isFirstInboundMessage && conversation.status !== 'pending') {
    const { count: priorCustomerMsgCount } = await supabaseAdmin()
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversation.id)
      .eq('sender_type', 'customer');
    isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0;
  }

  const { error: msgError } = await supabaseAdmin()
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      sender_type: 'customer',
      content_type: contentType,
      content_text: contentText,
      media_url: mediaUrl,
      message_id: message.id,
      status: 'delivered',
      created_at: new Date(parseInt(message.timestamp) * 1000).toISOString(),
      reply_to_message_id: replyToInternalId,
      interactive_reply_id: interactiveReplyId,
    });

  if (msgError && msgError.code !== '23505') {
    console.error('Error inserting message:', msgError);
    throw new Error('Unable to persist inbound message');
  }

  // Existing receipts (including legacy payloads) suppress effects, not repair.
  const { error: receiptError } = await supabaseAdmin()
    .from('whatsapp_inbound_receipts')
    .insert({
      account_id: accountId,
      meta_message_id: message.id,
      payload: message,
    });
  if (receiptError?.code === '23505') return;
  if (receiptError) throw new Error('Unable to reserve inbound effects');

  // This receipt winner owns conversation metadata, even if a previous
  // delivery saved history but could not claim the receipt.
  {
    const conversationUpdate: Record<string, unknown> = {
      last_message_text: contentText || `[${message.type}]`,
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    };

    // Reabertura automática (Opção A): se o cliente já havia sido atendido e a
    // conversa foi fechada (ex.: após pagamento aprovado), uma nova mensagem
    // reabre a conversa e zera o contador de respostas da IA, para que a IA
    // volte a atender do zero dentro do limite por conversa.
    if (conversation.status === 'closed') {
      conversationUpdate.status = 'open';
      conversationUpdate.ai_reply_count = 0;
    }

    await supabaseAdmin()
      .from('conversations')
      .update(conversationUpdate)
      .eq('id', conversation.id);
  }

  pendingEffects.push(async () => {
    try {
      await runBusinessEffects();
    } catch (error) {
      // An uncertain business attempt must not be replayed automatically.
      console.error('[webhook] inbound business effects failed:', error);
    }
  });

  async function runBusinessEffects() {
    if (conversationCreated) {
      await dispatchWebhookEvent(
        supabaseAdmin(),
        accountId,
        'conversation.created',
        {
          conversation_id: conversation.id,
          contact_id: contactRecord.id,
        }
      );
    }
    await flagBroadcastReplyIfAny(accountId, contactRecord.id);

    // ============================================================
    // 🥟 PEDIDO POR TEXTO LIVRE NO WHATSAPP
    // ============================================================
    if (!order && (contentText || message.text?.body)) {
      try {
        const textOrderResult = await processFreeTextOrderInbound({
          supabase: supabaseAdmin(),
          accountId,
          userId: configOwnerUserId,
          contactRecord: {
            id: contactRecord.id,
            name: contactRecord.name,
            phone: senderPhone,
          },
          contactName: contactRecord.name || contactName,
          senderPhone,
          conversationId: conversation.id,
          inboundText: contentText ?? message.text?.body ?? '',
          inboundMessageId: message.id,
          inboundTimestamp: new Date(
            Number(message.timestamp) * 1000
          ).toISOString(),
          phoneNumberId,
          accessToken,
        });

        if (textOrderResult.handled) {
          console.log(
            '[webhook] Mensagem processada pelo fluxo de pedido por texto livre:',
            textOrderResult.outcome
          );

          await dispatchWebhookEvent(
            supabaseAdmin(),
            accountId,
            'message.received',
            {
              conversation_id: conversation.id,
              contact_id: contactRecord.id,
              whatsapp_message_id: message.id,
              content_type: contentType,
              text: contentText,
            }
          );

          return;
        }
      } catch (err) {
        console.error(
          '[webhook] Erro no fluxo de pedido por texto livre:',
          err
        );
        // Never fall through to the LLM or a second payment path after a failed order turn.
        await supabaseAdmin()
          .from('conversations')
          .update({ ai_autoreply_disabled: true })
          .eq('id', conversation.id)
          .eq('account_id', accountId);
        return;
      }
    }

    // Deals are created only by a catalog/order flow, never by incidental chat.

    // Checkout is only authorized from a confirmed, catalog-grounded structured draft.
    // Never charge a total extracted from AI prose or supplied by a website message.
    // ============================================================
    // 🔄 FLUXOS NORMAIS
    // ============================================================
    // A native cart must honor the same persisted human handoff as text orders.
    if (order) {
      try {
        const blocked = await processInboundHandoff(
          {
            supabase: supabaseAdmin(),
            accountId,
            userId: configOwnerUserId,
            contactRecord: {
              id: contactRecord.id,
              name: contactRecord.name,
              phone: senderPhone,
            },
            contactName: contactRecord.name || contactName,
            senderPhone,
            conversationId: conversation.id,
            inboundText: contentText ?? '',
            inboundMessageId: message.id,
            inboundTimestamp: new Date(
              Number(message.timestamp) * 1000
            ).toISOString(),
            phoneNumberId,
            accessToken,
          },
          { items: order.items, notes: order.notes }
        );
        if (blocked) return;
        // Catalog validation above grants routing priority only; the flow still
        // owns notes review, delivery collection and explicit checkout consent.
      } catch (error) {
        console.error('[webhook] native order handoff failed:', error);
        await supabaseAdmin()
          .from('conversations')
          .update({ ai_autoreply_disabled: true })
          .eq('id', conversation.id)
          .eq('account_id', accountId);
        return;
      }
    }

    const flowResult = await dispatchInboundToFlows({
      accountId,
      userId: configOwnerUserId,
      contactId: contactRecord.id,
      conversationId: conversation.id,
      message: order
        ? {
            kind: 'catalog_order',
            text: contentText ?? '',
            total: order.total,
            items: order.items,
            notes: order.notes,
            meta_message_id: message.id,
          }
        : interactiveReplyId
          ? {
              kind: 'interactive_reply',
              reply_id: interactiveReplyId,
              reply_title: contentText ?? '',
              meta_message_id: message.id,
              context_message_id: message.context?.id,
            }
          : {
              kind: 'text',
              text: contentText ?? message.text?.body ?? '',
              meta_message_id: message.id,
            },
      isFirstInboundMessage,
    });
    const flowConsumed = flowResult.consumed;

    const inboundText = contentText ?? message.text?.body ?? '';
    const automationTriggers: (
      | 'new_contact_created'
      | 'first_inbound_message'
      | 'new_message_received'
      | 'keyword_match'
    )[] = [];

    if (!flowConsumed) {
      automationTriggers.push('new_message_received', 'keyword_match');
    }

    if (contactWasCreated) automationTriggers.unshift('new_contact_created');
    if (isFirstInboundMessage)
      automationTriggers.unshift('first_inbound_message');
    for (const triggerType of automationTriggers) {
      runAutomationsForTrigger({
        accountId,
        triggerType,
        contactId: contactRecord.id,
        context: {
          message_text: inboundText,
          conversation_id: conversation.id,
          contact_name: contactRecord.name,
        },
      }).catch((err) => console.error('[automations] dispatch failed:', err));
    }

    // A cart the order flow already picked up (or a Meta retry of it) must
    // not also get an AI reply — the customer would get two answers.
    const shouldAttemptAi =
      !(order && flowConsumed) &&
      shouldAttemptAiReply({
        flowConsumed,
        outcome: flowResult.outcome,
        interactiveReplyId,
        inboundText,
      });

    if (shouldAttemptAi) {
      await dispatchInboundToAiReply({
        accountId,
        conversationId: conversation.id,
        contactId: contactRecord.id,
        configOwnerUserId,
      });
    }

    await dispatchWebhookEvent(supabaseAdmin(), accountId, 'message.received', {
      conversation_id: conversation.id,
      contact_id: contactRecord.id,
      whatsapp_message_id: message.id,
      content_type: contentType,
      text: contentText,
    });
  }
}

async function parseMessageContent(
  message: WhatsAppMessage,
  accessToken: string
): Promise<{
  contentText: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  interactiveReplyId: string | null;
  order: {
    total: number;
    notes?: string;
    items: Array<{
      retailer_id: string;
      name?: string;
      quantity: number;
      unit_price: number;
    }>;
  } | null;
}> {
  const verifyAndBuildUrl = async (mediaId: string): Promise<string | null> => {
    try {
      await getMediaUrl({ mediaId, accessToken });
      return `/api/whatsapp/media/${mediaId}`;
    } catch (error) {
      console.error(
        `Failed to verify media ${mediaId} with Meta:`,
        error instanceof Error ? error.message : error
      );
      return null;
    }
  };

  const empty = {
    contentText: null,
    mediaUrl: null,
    mediaType: null,
    interactiveReplyId: null,
    order: null,
  };

  switch (message.type) {
    case 'text':
      return { ...empty, contentText: message.text?.body || null };

    case 'image':
      if (message.image?.id) {
        return {
          ...empty,
          contentText: message.image.caption || null,
          mediaUrl: await verifyAndBuildUrl(message.image.id),
          mediaType: message.image.mime_type,
        };
      }
      return empty;

    case 'video':
      if (message.video?.id) {
        return {
          ...empty,
          contentText: message.video.caption || null,
          mediaUrl: await verifyAndBuildUrl(message.video.id),
          mediaType: message.video.mime_type,
        };
      }
      return empty;

    case 'document':
      if (message.document?.id) {
        return {
          ...empty,
          contentText:
            message.document.caption || message.document.filename || null,
          mediaUrl: await verifyAndBuildUrl(message.document.id),
          mediaType: message.document.mime_type,
        };
      }
      return empty;

    case 'audio':
      if (message.audio?.id) {
        return {
          ...empty,
          mediaUrl: await verifyAndBuildUrl(message.audio.id),
          mediaType: message.audio.mime_type,
        };
      }
      return empty;

    case 'sticker':
      if (message.sticker?.id) {
        return {
          ...empty,
          mediaUrl: await verifyAndBuildUrl(message.sticker.id),
          mediaType: message.sticker.mime_type,
        };
      }
      return empty;

    case 'location':
      if (message.location) {
        const loc = message.location;
        const locationText = [
          loc.name,
          loc.address,
          `${loc.latitude},${loc.longitude}`,
        ]
          .filter(Boolean)
          .join(' - ');
        return { ...empty, contentText: locationText };
      }
      return empty;

    case 'reaction':
      return { ...empty, contentText: message.reaction?.emoji || null };

    case 'interactive': {
      const reply =
        message.interactive?.button_reply ?? message.interactive?.list_reply;
      if (reply?.id) {
        return {
          ...empty,
          contentText: reply.title || reply.id,
          interactiveReplyId: reply.id,
        };
      }
      return { ...empty, contentText: '[Interactive reply]' };
    }

    case 'order': {
      const productItems = message.order?.product_items ?? [];
      // Local cardápio first; ask Meta only for ids it doesn't know.
      const names: Record<string, string> = {};
      for (const it of productItems) {
        const local = productNameFromCardapio(it.product_retailer_id);
        if (local) names[it.product_retailer_id] = local;
      }
      const unknownIds = productItems
        .map((it) => it.product_retailer_id)
        .filter((id) => !names[id]);
      if (message.order?.catalog_id && unknownIds.length) {
        try {
          Object.assign(
            names,
            await getCatalogProductNames({
              catalogId: message.order.catalog_id,
              retailerIds: unknownIds,
              accessToken,
            })
          );
        } catch (err) {
          // Falls back to the retailer_id; the order still goes through.
          console.error(
            '[webhook] catalog product name lookup failed:',
            err instanceof Error ? err.message : err
          );
        }
      }
      const items = productItems.map((it) => ({
        retailer_id: it.product_retailer_id,
        name: names[it.product_retailer_id],
        quantity: it.quantity,
        unit_price: it.item_price,
      }));
      const total = items.reduce(
        (sum, it) => sum + it.quantity * it.unit_price,
        0
      );
      const fmt = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;
      const lines = items.map(
        (it) =>
          `• ${it.quantity}x ${it.name ?? it.retailer_id} — ${fmt(it.quantity * it.unit_price)}`
      );
      const summary = [
        '🛒 Novo pedido pelo catálogo:',
        ...lines,
        `Total: ${fmt(total)}`,
        ...(message.order?.text ? [`Observações: ${message.order.text}`] : []),
      ].join('\n');
      return {
        ...empty,
        contentText: summary,
        order: { total, items, notes: message.order?.text },
      };
    }

    default:
      return {
        ...empty,
        contentText: `[Unsupported message type: ${message.type}]`,
      };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContactRow = any;

interface ContactOutcome {
  contact: ContactRow;
  wasCreated: boolean;
}

async function findOrCreateContact(
  accountId: string,
  configOwnerUserId: string,
  phone: string,
  name: string
): Promise<ContactOutcome | null> {
  const existingContact = await findExistingContact(
    supabaseAdmin(),
    accountId,
    phone
  );

  if (existingContact) {
    if (name && name !== existingContact.name) {
      await supabaseAdmin()
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existingContact.id);
    }
    return { contact: existingContact, wasCreated: false };
  }

  const { data: newContact, error: createError } = await supabaseAdmin()
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      phone,
      name: name || phone,
    })
    .select()
    .single();

  if (createError) {
    if (isUniqueViolation(createError)) {
      const raced = await findExistingContact(
        supabaseAdmin(),
        accountId,
        phone
      );
      if (raced) return { contact: raced, wasCreated: false };
    }
    console.error('Error creating contact:', createError);
    return null;
  }

  return { contact: newContact, wasCreated: true };
}
