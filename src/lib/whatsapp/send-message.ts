// ============================================================
// Outbound message send — the core that both the dashboard's
// `/api/whatsapp/send` route and the public `/api/v1/messages`
// endpoint call.
//
// Given a conversation and message params, this:
//   1. validates the params for the message type,
//   2. loads the conversation + contact + WhatsApp config,
//   3. sends via Z-API,
//   4. persists the message + updates the conversation,
//   5. pauses any active Flow run for the contact (agent stepped in).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  sendText,
  sendImage,
  sendVideo,
  sendDocument,
  sendAudio,
} from '@/lib/whatsapp/zapi-api';
import { buildZapiCredentials } from '@/lib/whatsapp/zapi-config';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  sanitizePhone,
  isValidE164,
} from '@/lib/whatsapp/phone-utils';
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';
import type { MessageTemplate } from '@/types';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';
import { interpolateTemplateText } from '@/lib/whatsapp/template-send-builder';

export const MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;
export const VALID_MESSAGE_TYPES = [
  'text',
  'template',
  'interactive',
  ...MEDIA_KINDS,
] as const;

export class SendMessageError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SendMessageError';
    this.code = code;
    this.status = status;
  }
}

export interface SendMessageParams {
  conversationId: string;
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  templateParams?: string[];
  templateMessageParams?: unknown;
  interactivePayload?: InteractiveMessagePayload | null;
  replyToMessageId?: string | null;
}

export interface SendMessageResult {
  messageId: string;
  whatsappMessageId: string;
}

export function validateSendMessageParams(params: {
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  templateName?: string | null;
  interactivePayload?: InteractiveMessagePayload | null;
}): void {
  const { messageType, contentText, mediaUrl, templateName, interactivePayload } = params;

  if (!messageType) {
    throw new SendMessageError('bad_request', 'message_type is required', 400);
  }

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  if (!(VALID_MESSAGE_TYPES as readonly string[]).includes(messageType)) {
    throw new SendMessageError(
      'bad_request',
      `Unsupported message_type "${messageType}"`,
      400
    );
  }

  if (messageType === 'text' && !contentText) {
    throw new SendMessageError(
      'bad_request',
      'content_text is required for text messages',
      400
    );
  }

  if (messageType === 'template' && !templateName) {
    throw new SendMessageError(
      'bad_request',
      'template_name is required for template messages',
      400
    );
  }

  if (messageType === 'interactive' && !interactivePayload) {
    throw new SendMessageError(
      'bad_request',
      'interactive_payload is required for interactive messages',
      400
    );
  }

  if (isMediaKind && !mediaUrl) {
    throw new SendMessageError(
      'bad_request',
      `media_url is required for ${messageType} messages`,
      400
    );
  }

  if (
    isMediaKind &&
    messageType !== 'audio' &&
    typeof contentText === 'string' &&
    contentText.length > 1024
  ) {
    throw new SendMessageError(
      'bad_request',
      'Caption exceeds the 1024-character limit',
      400
    );
  }
}

function interactivePayloadToText(payload: InteractiveMessagePayload): string {
  const parts: string[] = [];
  if (payload.header) parts.push(payload.header, '');
  parts.push(payload.body, '');

  if (payload.kind === 'buttons') {
    payload.buttons.forEach((button, index) => {
      parts.push(`${index + 1}. ${button.title}`);
    });
  } else {
    let counter = 1;
    for (const section of payload.sections) {
      if (section.title) parts.push(`*${section.title}*`);
      for (const row of section.rows) {
        parts.push(
          `${counter}. ${row.title}${row.description ? ` - ${row.description}` : ''}`,
        );
        counter++;
      }
    }
  }

  if (payload.footer) parts.push('', payload.footer);
  return parts.join('\n');
}

export async function sendMessageToConversation(
  db: SupabaseClient,
  accountId: string,
  params: SendMessageParams
): Promise<SendMessageResult> {
  const {
    conversationId,
    messageType,
    contentText,
    mediaUrl,
    filename,
    templateName,
    templateLanguage,
    templateParams,
    interactivePayload,
    replyToMessageId,
  } = params;

  if (!conversationId) {
    throw new SendMessageError(
      'bad_request',
      'conversation_id is required',
      400
    );
  }

  validateSendMessageParams({
    messageType,
    contentText,
    mediaUrl,
    templateName,
    interactivePayload,
  });

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
  if (!contact?.phone) {
    throw new SendMessageError(
      'bad_request',
      'Contact phone number not found',
      400
    );
  }

  const sanitizedPhone = sanitizePhone(contact.phone);
  if (!isValidE164(sanitizedPhone)) {
    throw new SendMessageError(
      'bad_request',
      'Invalid phone number format',
      400
    );
  }

  const { data: config, error: configError } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single();

  if (configError || !config) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }

  const credentials = buildZapiCredentials(config);
  if (!credentials) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your Z-API instance first.',
      400
    );
  }

  let contextMessageId: string | undefined;
  if (replyToMessageId) {
    const { data: parent, error: parentError } = await db
      .from('messages')
      .select('message_id, conversation_id')
      .eq('id', replyToMessageId)
      .eq('conversation_id', conversationId)
      .maybeSingle();

    if (parentError || !parent) {
      throw new SendMessageError(
        'bad_request',
        'reply_to_message_id not found in this conversation',
        400
      );
    }
    if (parent.message_id) {
      contextMessageId = parent.message_id;
    }
  }

  let templateRow: MessageTemplate | null = null;
  if (messageType === 'template' && templateName) {
    const { data } = await db
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .eq('name', templateName)
      .eq('language', templateLanguage || 'en_US')
      .maybeSingle();
    if (data && !isMessageTemplate(data)) {
      throw new SendMessageError(
        'template_malformed',
        'Template row is malformed locally.',
        500
      );
    }
    templateRow = data ?? null;
  }

  let waMessageId = '';
  let resolvedText = contentText || '';

  try {
    if (messageType === 'template') {
      const bodyText = templateRow?.body_text || templateName!;
      resolvedText = interpolateTemplateText(bodyText, templateParams || []);
      const result = await sendText({
        credentials,
        phone: sanitizedPhone,
        text: resolvedText,
        replyTo: contextMessageId,
      });
      waMessageId = result.messageId;
    } else if (isMediaKind) {
      const sendFn =
        messageType === 'image' ? sendImage :
        messageType === 'video' ? sendVideo :
        messageType === 'audio' ? sendAudio :
        sendDocument;

      const result = await sendFn({
        credentials,
        phone: sanitizedPhone,
        url: mediaUrl!,
        ...(messageType !== 'audio' && contentText ? { caption: contentText } : {}),
        ...(messageType === 'document' && filename ? { filename } : {}),
        replyTo: contextMessageId,
      } as Parameters<typeof sendFn>[0]);
      waMessageId = result.messageId;
    } else if (messageType === 'interactive') {
      resolvedText = interactivePayloadToText(interactivePayload!);
      const result = await sendText({
        credentials,
        phone: sanitizedPhone,
        text: resolvedText,
        replyTo: contextMessageId,
      });
      waMessageId = result.messageId;
    } else {
      const result = await sendText({
        credentials,
        phone: sanitizedPhone,
        text: contentText!,
        replyTo: contextMessageId,
      });
      waMessageId = result.messageId;
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown Z-API error';
    console.error('[send-message] Z-API send failed:', message);
    throw new SendMessageError('whatsapp_provider_error', `Z-API error: ${message}`, 502);
  }

  const { data: messageRecord, error: msgError } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      content_type: messageType,
      content_text:
        messageType === 'template' || messageType === 'interactive'
          ? resolvedText
          : (contentText || null),
      media_url: mediaUrl || null,
      template_name: templateName || null,
      message_id: waMessageId,
      status: 'sent',
      reply_to_message_id: replyToMessageId || null,
      interactive_payload: interactivePayload ?? null,
    })
    .select()
    .single();

  if (msgError) {
    console.error('[send-message] error inserting sent message:', msgError);
    throw new SendMessageError(
      'db_error',
      `Message sent but failed to save to DB: ${msgError.message}`,
      500
    );
  }

  await db
    .from('conversations')
    .update({
      last_message_text:
        (messageType === 'template' || messageType === 'interactive'
          ? resolvedText
          : contentText) || `[${messageType}]`,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

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
    console.error(
      '[flows] pause-on-agent-send threw:',
      err instanceof Error ? err.message : err
    );
  }

  return { messageId: messageRecord.id, whatsappMessageId: waMessageId };
}
