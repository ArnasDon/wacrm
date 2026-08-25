// ============================================================
// Outbound Instagram DM send — the Instagram counterpart of
// `@/lib/whatsapp/send-message`'s `sendMessageToConversation`, called
// from the single branch point added there:
//
//   if (conversation.channel === 'instagram') {
//     return sendInstagramMessageToConversation(db, accountId, params);
//   }
//
// Given a conversation and message params, this:
//   1. validates the params for Instagram's (narrower) message-type
//      surface — text and media only, no templates, no WhatsApp-shaped
//      interactive payloads (Instagram's quick-reply equivalent lives
//      in @/lib/instagram/api's sendQuickReplies, used directly by
//      automations/flows — see PROGRESS.md Phase 8/11 for wiring it
//      into the inbox composer),
//   2. loads the conversation + contact + Instagram config,
//   3. sends to Meta,
//   4. persists the message + updates the conversation,
//   5. pauses any active Flow run for the contact (agent stepped in) —
//      same convention as the WhatsApp path.
//
// Returns the same `SendMessageResult` shape WhatsApp sends do
// (`{ messageId, whatsappMessageId }`) so the two existing callers
// (`/api/whatsapp/send` and `/api/v1/messages`) don't need a
// channel-specific field name — `whatsappMessageId` here just holds
// the Instagram-assigned message id.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { InstagramMediaKind } from '@/lib/instagram/api';
import { sendInstagramText, sendInstagramMedia } from '@/lib/instagram/provider-send';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { SendMessageError, type SendMessageParams, type SendMessageResult } from '@/lib/messaging/types';
import { isWithinMessagingWindow } from '@/lib/messaging/window';

const MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;

/**
 * Validate the message-shape params against Instagram's supported
 * surface. Instagram DMs support free-form text and media
 * attachments; WhatsApp-only concepts (templates, the 24h-window
 * "interactive" buttons/list shape) are rejected with a clear error
 * rather than silently mis-sent.
 */
function validateInstagramSendParams(params: {
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
}): void {
  const { messageType, contentText, mediaUrl } = params;
  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  if (messageType === 'template') {
    throw new SendMessageError(
      'bad_request',
      'Message templates are a WhatsApp-only concept and are not supported for Instagram conversations.',
      400
    );
  }
  if (messageType === 'interactive') {
    throw new SendMessageError(
      'bad_request',
      'Interactive buttons/lists are not supported for Instagram conversations yet — use quick replies via automations/flows instead.',
      400
    );
  }
  if (messageType !== 'text' && !isMediaKind) {
    throw new SendMessageError('bad_request', `Unsupported message_type "${messageType}" for Instagram`, 400);
  }
  if (messageType === 'text' && !contentText) {
    throw new SendMessageError('bad_request', 'content_text is required for text messages', 400);
  }
  if (isMediaKind && !mediaUrl) {
    throw new SendMessageError('bad_request', `media_url is required for ${messageType} messages`, 400);
  }
}

export async function sendInstagramMessageToConversation(
  db: SupabaseClient,
  accountId: string,
  params: SendMessageParams
): Promise<SendMessageResult> {
  const { conversationId, messageType, contentText, mediaUrl, filename } = params;

  if (!conversationId) {
    throw new SendMessageError('bad_request', 'conversation_id is required', 400);
  }

  validateInstagramSendParams({ messageType, contentText, mediaUrl });
  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  // Conversation + contact, account-scoped.
  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .single();

  if (convError || !conversation) {
    throw new SendMessageError('not_found', 'Conversation not found', 404);
  }

  const contact = conversation.contact;
  if (!contact?.instagram_id) {
    throw new SendMessageError('bad_request', 'Contact has no Instagram identity', 400);
  }

  // Instagram config, account-scoped.
  const { data: config, error: configError } = await db
    .from('instagram_config')
    .select('*')
    .eq('account_id', accountId)
    .single();

  if (configError || !config) {
    throw new SendMessageError(
      'instagram_not_configured',
      'Instagram not configured. Please set up your Instagram integration first.',
      400
    );
  }

  const target = {
    config,
    igsid: contact.instagram_id as string,
    zernioConversationId: (conversation.zernio_conversation_id as string | null) ?? null,
  };

  // Only actually apply the tag when the window has truly expired —
  // never trust the caller's flag alone, so a stray/stale true from an
  // older client can't tag a perfectly normal in-window send. See
  // `SendMessageParams.humanAgentTag`'s own doc comment for why this
  // must only ever originate from a human clicking send.
  const humanAgentTag = params.humanAgentTag
    ? !(await isWithinMessagingWindow(db, conversationId))
    : false;

  let igMessageId = '';
  try {
    if (isMediaKind) {
      const result = await sendInstagramMedia(target, messageType as InstagramMediaKind, mediaUrl!, {
        caption: contentText,
        filename,
        humanAgentTag,
      });
      igMessageId = result.messageId;
    } else {
      const result = await sendInstagramText(target, contentText!, { humanAgentTag });
      igMessageId = result.messageId;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown provider API error';
    console.error('[instagram/send-message] send failed:', message);
    throw new SendMessageError('instagram_send_error', message, 502);
  }

  const persistedText = contentText ?? null;

  const { data: messageRecord, error: msgError } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      content_type: messageType,
      content_text: persistedText,
      media_url: mediaUrl || null,
      message_id: igMessageId,
      status: 'sent',
    })
    .select()
    .single();

  if (msgError) {
    console.error('[instagram/send-message] error inserting sent message:', msgError);
    throw new SendMessageError(
      'db_error',
      `Message sent to Meta but failed to save to DB: ${msgError.message}`,
      500
    );
  }

  await db
    .from('conversations')
    .update({
      last_message_text: persistedText || `[${messageType}]`,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  // Pause any active Flow run for this contact — same "agent stepped
  // in" convention as the WhatsApp path. Best-effort.
  try {
    const { error: pauseErr } = await supabaseAdmin()
      .from('flow_runs')
      .update({
        status: 'paused_by_agent',
        ended_at: new Date().toISOString(),
        end_reason: 'agent_replied',
      })
      .eq('account_id', accountId)
      .eq('contact_id', contact.id)
      .eq('status', 'active');
    if (pauseErr) {
      console.error('[flows] pause-on-agent-send failed:', pauseErr.message);
    }
  } catch (err) {
    console.error('[flows] pause-on-agent-send threw:', err instanceof Error ? err.message : err);
  }

  return { messageId: messageRecord.id, whatsappMessageId: igMessageId };
}
