// ============================================================
// Outbound Facebook Messenger send — the Facebook counterpart of
// `@/lib/instagram/send-message`, called from the same branch point
// in `@/lib/whatsapp/send-message`:
//
//   if (conversation.channel === 'facebook') {
//     return sendFacebookMessageToConversation(db, accountId, params);
//   }
//
// Facebook has no direct-Meta path in wacrm (see the migration 041
// comment for why) — every send goes through Zernio, so unlike
// Instagram's version this has no provider dispatch: it always calls
// `@/lib/zernio/api` directly.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { sendZernioText, sendZernioMedia, type ZernioMediaKind } from '@/lib/zernio/api';
import { decrypt } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { SendMessageError, type SendMessageParams, type SendMessageResult } from '@/lib/messaging/types';
import { isWithinMessagingWindow } from '@/lib/messaging/window';
import { resolveZernioConversationIdForContact } from '@/lib/messaging/resolve-zernio-conversation';

const MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;

/** Validate the message-shape params against Facebook's supported surface — same as Instagram's. */
function validateFacebookSendParams(params: {
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
}): void {
  const { messageType, contentText, mediaUrl } = params;
  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  if (messageType === 'template') {
    throw new SendMessageError(
      'bad_request',
      'Message templates are a WhatsApp-only concept and are not supported for Facebook conversations.',
      400
    );
  }
  if (messageType === 'interactive') {
    throw new SendMessageError(
      'bad_request',
      'Interactive buttons/lists are not supported for Facebook conversations yet.',
      400
    );
  }
  if (messageType !== 'text' && !isMediaKind) {
    throw new SendMessageError('bad_request', `Unsupported message_type "${messageType}" for Facebook`, 400);
  }
  if (messageType === 'text' && !contentText) {
    throw new SendMessageError('bad_request', 'content_text is required for text messages', 400);
  }
  if (isMediaKind && !mediaUrl) {
    throw new SendMessageError('bad_request', `media_url is required for ${messageType} messages`, 400);
  }
}

export async function sendFacebookMessageToConversation(
  db: SupabaseClient,
  accountId: string,
  params: SendMessageParams
): Promise<SendMessageResult> {
  const { conversationId, messageType, contentText, mediaUrl, filename } = params;

  if (!conversationId) {
    throw new SendMessageError('bad_request', 'conversation_id is required', 400);
  }

  validateFacebookSendParams({ messageType, contentText, mediaUrl });
  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

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
  if (!contact?.facebook_id) {
    throw new SendMessageError('bad_request', 'Contact has no Facebook identity', 400);
  }

  // See the identical comment in `@/lib/instagram/send-message`: fall
  // back to any sibling conversation of this contact that carries a
  // Zernio id when the row being replied to has none, so a reply to a
  // chat that started from an ad / a post → DM never dead-ends.
  let zernioConversationId = conversation.zernio_conversation_id as string | null;
  if (!zernioConversationId) {
    zernioConversationId = await resolveZernioConversationIdForContact(
      db,
      accountId,
      contact.id,
      'facebook'
    );
    if (zernioConversationId) {
      console.warn(
        `[facebook/send-message] conversation ${conversationId} had no zernio_conversation_id; sending via a sibling conversation's id (${zernioConversationId}).`
      );
    } else {
      throw new SendMessageError(
        'facebook_no_conversation',
        'This chat is not linked to a Facebook conversation yet. It links automatically once the customer sends another message — if it keeps happening, re-save the Facebook connection in Settings.',
        409
      );
    }
  }

  const { data: config, error: configError } = await db
    .from('facebook_config')
    .select('*')
    .eq('account_id', accountId)
    .single();

  if (configError || !config) {
    throw new SendMessageError(
      'facebook_not_configured',
      'Facebook not configured. Please set up your Facebook integration first.',
      400
    );
  }

  const apiKey = decrypt(config.zernio_api_key);

  // Only actually apply the tag when the window has truly expired —
  // see the identical check in `@/lib/instagram/send-message`.
  const humanAgentTag = params.humanAgentTag
    ? !(await isWithinMessagingWindow(db, conversationId))
    : false;

  let zernioMessageId = '';
  try {
    if (isMediaKind) {
      const result = await sendZernioMedia({
        apiKey,
        conversationId: zernioConversationId,
        accountId: config.zernio_account_id,
        kind: messageType as ZernioMediaKind,
        link: mediaUrl!,
        caption: contentText ?? undefined,
        filename: filename ?? undefined,
        humanAgentTag,
      });
      zernioMessageId = result.messageId;
    } else {
      const result = await sendZernioText({
        apiKey,
        conversationId: zernioConversationId,
        accountId: config.zernio_account_id,
        text: contentText!,
        humanAgentTag,
      });
      zernioMessageId = result.messageId;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Zernio API error';
    console.error('[facebook/send-message] send failed:', message);
    throw new SendMessageError('facebook_send_error', message, 502);
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
      message_id: zernioMessageId,
      status: 'sent',
    })
    .select()
    .single();

  if (msgError) {
    console.error('[facebook/send-message] error inserting sent message:', msgError);
    throw new SendMessageError(
      'db_error',
      `Message sent to Zernio but failed to save to DB: ${msgError.message}`,
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
  // in" convention as the WhatsApp/Instagram paths. Best-effort.
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

  return { messageId: messageRecord.id, whatsappMessageId: zernioMessageId };
}
