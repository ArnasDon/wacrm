// ============================================================
// Outbound message send — the core that both the dashboard's
// `/api/whatsapp/send` route and the public `/api/v1/messages`
// endpoint call.
//
// Given a conversation and message params, this:
//   1. validates the params for the message type,
//   2. loads the conversation + contact + WhatsApp config,
//   3. dispatches through the conversation's pinned provider,
//   4. persists the message + updates the conversation,
//   5. pauses any active Flow run for the contact (agent stepped in).
//
// It is transport-agnostic: it takes a `SupabaseClient` and an
// `accountId` and throws `SendMessageError` on failure. The callers
// own auth, rate-limiting, body parsing, and mapping the error to
// their respective response shapes (internal `{ error }` vs the v1
// envelope). Behaviour is identical to the original inline route —
// this is a straight extraction so the public endpoint can reuse it
// without duplicating ~250 lines of Meta plumbing.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  isWacrmChatMediaUrl,
  uploadTemplateHeaderMedia,
  type MediaKind,
} from '@/lib/whatsapp/meta-api';
import {
  validateInteractivePayload,
  interactivePayloadPreviewText,
  type InteractiveMessagePayload,
} from '@/lib/whatsapp/interactive';
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils';
import {
  resolveWhatsAppRecipient,
  type WhatsAppRecipient,
} from '@/lib/whatsapp/recipient';
import type { MessageTemplate } from '@/types';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';
import {
  TemplateSendValidationError,
  type SendTimeParams,
} from '@/lib/whatsapp/template-send-builder';
import {
  sendTwilioMessage,
  TwilioProviderError,
} from '@/lib/whatsapp/twilio-api';

export const MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;
export const VALID_MESSAGE_TYPES = [
  'text',
  'template',
  'interactive',
  ...MEDIA_KINDS,
] as const;

/**
 * Typed failure with a machine `code` and a suggested HTTP `status`.
 * Callers map it to their own response shape (`toErrorResponse` for
 * the dashboard route, the v1 envelope for the public endpoint).
 */
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

/** Meta's built-in hello_world sample is restricted to public test lines. */
export function isPublicTestTemplateError(message: string): boolean {
  return /131058|Hello World templates can only be sent from the Public Test Numbers/i.test(
    message
  );
}

export interface SendMessageParams {
  conversationId: string;
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  /** Legacy positional body params (only used if messageParams.body unset). */
  templateParams?: string[];
  /** Structured template params (header/body/buttons). */
  templateMessageParams?: SendTimeParams;
  /** Structured payload for `messageType === 'interactive'`. */
  interactivePayload?: InteractiveMessagePayload | null;
  replyToMessageId?: string | null;
  /** Internal callers use `bot`; dashboard/public API sends default to agent. */
  senderType?: 'agent' | 'bot';
  /** Only AI auto-replies set this; deterministic flows/automations do not. */
  aiGenerated?: boolean;
}

export interface SendMessageResult {
  /** Our `messages.id` (the persisted row). */
  messageId: string;
  /** Provider id: Meta `wamid` or Twilio `SM...`. */
  whatsappMessageId: string;
  provider: 'meta' | 'twilio';
}

export function isTwilioSessionOpen(
  lastInboundAt: string | null | undefined,
  now = Date.now()
): boolean {
  if (!lastInboundAt) return false;
  const openedAt = new Date(lastInboundAt).getTime();
  return (
    Number.isFinite(openedAt) &&
    now >= openedAt &&
    now - openedAt < 24 * 60 * 60 * 1000
  );
}

/**
 * Send a message in an existing conversation and persist it.
 *
 * `db` may be an RLS-scoped user client (dashboard) or the service-
 * role client (public API) — every query is filtered by `accountId`
 * either way, so tenancy holds regardless of which client is passed.
 */
/**
 * Validate the message-shape params (type, required content, caption
 * cap) independently of any DB state, throwing `SendMessageError` on a
 * bad payload. Exported so a caller can reject a malformed request
 * *before* it finds-or-creates a contact/conversation — otherwise an
 * invalid payload leaves an orphan empty conversation behind. The send
 * core calls this too, so validation can't be skipped.
 */
export function validateSendMessageParams(params: {
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  templateName?: string | null;
  interactivePayload?: InteractiveMessagePayload | null;
}): void {
  const {
    messageType,
    contentText,
    mediaUrl,
    templateName,
    interactivePayload,
  } = params;

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

  // Interactive: validate the full structured payload against Meta's
  // limits up front so a bad payload 400s before we touch Meta.
  if (messageType === 'interactive') {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      throw new SendMessageError('bad_request', result.error, 400);
    }
  }

  if (isMediaKind && !mediaUrl) {
    throw new SendMessageError(
      'bad_request',
      `media_url is required for ${messageType} messages`,
      400
    );
  }

  // Meta caps media captions at 1024 chars (audio carries none).
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
    templateMessageParams,
    interactivePayload,
    replyToMessageId,
    senderType = 'agent',
    aiGenerated = false,
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

  // Conversation + contact, account-scoped.
  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*), whatsapp_config:whatsapp_config(*)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .single();

  if (convError || !conversation) {
    throw new SendMessageError('not_found', 'Conversation not found', 404);
  }

  const contact = conversation.contact;
  const contactRecipient = contact
    ? resolveWhatsAppRecipient(contact)
    : null;
  const conversationRecipient =
    conversation.whatsapp_recipient_id &&
    (conversation.whatsapp_recipient_type === 'phone' ||
      conversation.whatsapp_recipient_type === 'bsuid')
      ? ({
          type: conversation.whatsapp_recipient_type,
          value: conversation.whatsapp_recipient_id,
        } as WhatsAppRecipient)
      : null;
  const recipient = contactRecipient ?? conversationRecipient;
  if (!recipient) {
    throw new SendMessageError(
      'bad_request',
      'Contact has no valid WhatsApp recipient identifier',
      400
    );
  }

  // A conversation is pinned to the line that created it. Legacy rows that
  // predate migration 037 fall back to the active line once, preserving the
  // old behaviour until the migration backfill attaches them permanently.
  let config = conversation.whatsapp_config;
  let configError: unknown = null;
  if (!config) {
    const fallback = await db
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .maybeSingle();
    config = fallback.data;
    configError = fallback.error;
  }

  if (configError || !config) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }

  const provider = config.provider === 'twilio' ? 'twilio' : 'meta';
  if (provider === 'twilio' && recipient.type === 'bsuid') {
    throw new SendMessageError(
      'twilio_bsuid_unsupported',
      'This Twilio WhatsApp integration cannot send to a WhatsApp BSUID.',
      400
    );
  }
  if (provider === 'twilio' && messageType === 'template') {
    throw new SendMessageError(
      'twilio_templates_unsupported',
      'Approved Twilio templates are not enabled for this line.',
      400
    );
  }
  if (provider === 'twilio') {
    const { data: latestInbound, error: inboundError } = await db
      .from('messages')
      .select('created_at')
      .eq('conversation_id', conversationId)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (inboundError) {
      throw new SendMessageError(
        'db_error',
        `Could not verify the Twilio customer-service window: ${inboundError.message}`,
        500
      );
    }

    if (!isTwilioSessionOpen(latestInbound?.created_at)) {
      throw new SendMessageError(
        'twilio_session_expired',
        'The 24-hour Twilio customer-service window is closed. Approved Twilio templates are not enabled for this line.',
        400
      );
    }
  }
  if (
    provider === 'twilio' &&
    isMediaKind &&
    (messageType === 'video' || messageType === 'document') &&
    contentText
  ) {
    throw new SendMessageError(
      'twilio_caption_unsupported',
      `Twilio WhatsApp does not deliver captions with ${messageType} messages. Send the text separately.`,
      400
    );
  }

  const accessToken =
    provider === 'meta' && config.access_token
      ? decrypt(config.access_token)
      : null;

  // Self-heal legacy CBC ciphertexts. Fire-and-forget; idempotent.
  if (
    provider === 'meta' &&
    config.access_token &&
    accessToken &&
    isLegacyFormat(config.access_token)
  ) {
    void db
      .from('whatsapp_config')
      .update({ access_token: encrypt(accessToken) })
      .eq('id', config.id)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) {
          console.warn(
            '[send-message] access_token GCM upgrade failed:',
            error.message
          );
        }
      });
  }

  // Resolve the reply target to its Meta message_id. The parent must
  // belong to this same conversation — otherwise a caller could quote
  // messages they can't see by guessing UUIDs.
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
    if (!parent.message_id) {
      console.warn(
        '[send-message] reply target has no Meta message_id; sending without context'
      );
    } else {
      contextMessageId = parent.message_id;
    }
  }

  // Template row (for header + button components). isMessageTemplate
  // guards against a malformed local row crashing the send-builder.
  let templateRow: MessageTemplate | null = null;
  if (provider === 'meta' && messageType === 'template' && templateName) {
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
        'Template row is malformed locally — run "Sync from Meta" in Settings to repair it.',
        500
      );
    }
    templateRow = data ?? null;
    // Meta does not allow phone-number-dependent authentication templates
    // (including copy-code) to target a BSUID. Do not silently fall back to
    // a missing phone; make the unsupported capability explicit.
    if (
      recipient.type === 'bsuid' &&
      templateRow?.buttons?.some((button) => button.type === 'COPY_CODE')
    ) {
      throw new SendMessageError(
        'bsuid_template_unsupported',
        'This authentication template requires a WhatsApp phone number.',
        400
      );
    }
  }

  const templateHeaderMediaUrl =
    messageType === 'template'
      ? templateMessageParams?.headerMediaUrl ||
        templateRow?.header_media_url ||
        null
      : null;
  let templateHeaderMediaId = templateMessageParams?.headerMediaId;

  const attempt = async (target: WhatsAppRecipient): Promise<string> => {
    if (provider === 'twilio') {
      if (!config.sender_phone) {
        throw new TwilioProviderError(
          'The Twilio line has no sender phone configured.'
        );
      }
      const result = await sendTwilioMessage({
        db,
        accountId,
        from: config.sender_phone,
        to: target.value,
        body:
          messageType === 'interactive'
            ? interactivePayload!.body
            : contentText || undefined,
        mediaUrl: isMediaKind ? mediaUrl! : undefined,
        interactivePayload:
          messageType === 'interactive' ? interactivePayload! : undefined,
      });
      return result.messageId;
    }

    if (!accessToken) {
      throw new Error('Meta access token is missing');
    }
    if (messageType === 'template') {
      if (
        templateHeaderMediaUrl &&
        !templateHeaderMediaId &&
        isWacrmChatMediaUrl(templateHeaderMediaUrl)
      ) {
        templateHeaderMediaId = await uploadTemplateHeaderMedia({
          phoneNumberId: config.phone_number_id,
          accessToken,
          mediaUrl: templateHeaderMediaUrl,
        });
      }
      const result = await sendTemplateMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        ...(target.type === 'bsuid'
          ? { recipient: target.value }
          : { to: target.value }),
        templateName: templateName!,
        language: templateLanguage || 'en_US',
        template: templateRow ?? undefined,
        messageParams: {
          ...templateMessageParams,
          headerMediaUrl: templateHeaderMediaId
            ? undefined
            : templateHeaderMediaUrl || undefined,
          headerMediaId: templateHeaderMediaId,
        },
        params: templateParams || [],
        contextMessageId,
      });
      return result.messageId;
    }
    if (isMediaKind) {
      const result = await sendMediaMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        ...(target.type === 'bsuid'
          ? { recipient: target.value }
          : { to: target.value }),
        kind: messageType as MediaKind,
        link: mediaUrl!,
        caption: contentText || undefined,
        filename: filename || undefined,
        contextMessageId,
      });
      return result.messageId;
    }
    if (messageType === 'interactive') {
      const p = interactivePayload!;
      if (p.kind === 'buttons') {
        const result = await sendInteractiveButtons({
          phoneNumberId: config.phone_number_id,
          accessToken,
          ...(target.type === 'bsuid'
            ? { recipient: target.value }
            : { to: target.value }),
          bodyText: p.body,
          headerText: p.header || undefined,
          footerText: p.footer || undefined,
          buttons: p.buttons,
          contextMessageId,
        });
        return result.messageId;
      }
      const result = await sendInteractiveList({
        phoneNumberId: config.phone_number_id,
        accessToken,
        ...(target.type === 'bsuid'
          ? { recipient: target.value }
          : { to: target.value }),
        bodyText: p.body,
        buttonLabel: p.button_label,
        headerText: p.header || undefined,
        footerText: p.footer || undefined,
        sections: p.sections,
        contextMessageId,
      });
      return result.messageId;
    }
    const result = await sendTextMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      ...(target.type === 'bsuid'
        ? { recipient: target.value }
        : { to: target.value }),
      text: contentText!,
      contextMessageId,
    });
    return result.messageId;
  };

  // Meta retries phone-number variants. Twilio receives exactly one strict
  // E.164 target and is never allowed to fall through to Graph API.
  // with "recipient not in allowed list"; persist a working variant
  // back to the contact so the next send goes straight through.
  let waMessageId = '';
  let workingRecipient = recipient;
  try {
    const variants =
      provider === 'meta' && recipient.type === 'phone'
        ? phoneVariants(recipient.value).map(
            (value): WhatsAppRecipient => ({ type: 'phone', value })
          )
        : [recipient];
    let lastError: unknown = null;

    for (const variant of variants) {
      try {
        waMessageId = await attempt(variant);
        workingRecipient = variant;
        lastError = null;
        break;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (provider !== 'meta' || !isRecipientNotAllowedError(message)) {
          throw err;
        }
        lastError = err;
        console.warn(
          `[send-message] phone recipient variant rejected by Meta, trying next…`
        );
      }
    }

    if (lastError) throw lastError;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : `Unknown ${provider} API error`;
    if (err instanceof TemplateSendValidationError) {
      throw new SendMessageError('bad_request', message, 400);
    }
    if (isPublicTestTemplateError(message)) {
      throw new SendMessageError(
        'meta_test_template_only',
        'The Meta hello_world sample can only be sent from a Public Test Number. Select an approved template created for this production WhatsApp number.',
        400
      );
    }
    if (provider === 'twilio') {
      console.error('[send-message] Twilio send failed:', message);
      throw new SendMessageError(
        'twilio_error',
        `Twilio API error: ${message}`,
        502
      );
    }
    console.error('[send-message] Meta send failed for all variants:', message);
    throw new SendMessageError('meta_error', `Meta API error: ${message}`, 502);
  }

  if (
    recipient.type === 'phone' &&
    workingRecipient.type === 'phone' &&
    workingRecipient.value !== recipient.value
  ) {
    console.log(
      '[send-message] Auto-corrected a contact phone recipient variant'
    );
    await db
      .from('contacts')
      .update({ phone: workingRecipient.value })
      .eq('id', contact.id);
  }

  // Keep the conversation-level identity current. This protects active
  // threads if a contact is later edited without a phone number.
  await db
    .from('conversations')
    .update({
      whatsapp_recipient_id: recipient.value,
      whatsapp_recipient_type: recipient.type,
    })
    .eq('id', conversationId);
  console.info(`[send-message] WhatsApp recipient resolved as ${recipient.type}`);

  // Persist the sent message. Field names MUST match the messages
  // schema (see 001_initial_schema.sql).
  // Interactive messages persist the body as content_text (so the
  // conversation-list preview reads sensibly) plus the full structured
  // payload so the thread can re-render the buttons / rows.
  const interactiveBody =
    messageType === 'interactive' ? interactivePayload!.body : null;

  const { data: messageRecord, error: msgError } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: senderType,
      content_type: messageType,
      content_text: interactiveBody ?? contentText ?? null,
      media_url: templateHeaderMediaUrl || mediaUrl || null,
      template_name: templateName || null,
      interactive_payload:
        messageType === 'interactive' ? interactivePayload : null,
      message_id: waMessageId,
      status: 'sent',
      reply_to_message_id: replyToMessageId || null,
      ai_generated: aiGenerated,
    })
    .select()
    .single();

  if (msgError) {
    console.error('[send-message] error inserting sent message:', msgError);
    throw new SendMessageError(
      'db_error',
      `Message sent through ${provider} but failed to save to DB: ${msgError.message}`,
      500
    );
  }

  const lastMessageText =
    messageType === 'interactive'
      ? interactivePayloadPreviewText(interactivePayload!)
      : contentText || `[${messageType}]`;

  await db
    .from('conversations')
    .update({
      last_message_text: lastMessageText,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  if (senderType === 'agent') {
    // A human response pauses active Flows. Automation sends must not pause
    // the workflow that owns them or an unrelated deterministic automation.
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
  }

  return {
    messageId: messageRecord.id,
    whatsappMessageId: waMessageId,
    provider,
  };
}
