// ============================================================
// POST /api/v1/messages — send a WhatsApp or Instagram message via
// the public API.
//
// The headline public endpoint (issue #245). Unlike the dashboard's
// `/api/whatsapp/send` (which takes an internal `conversation_id`),
// this takes a phone number — what an external automation actually
// has — resolves-or-creates the contact + conversation, then runs the
// same shared send core.
//
// Channel selection: pass exactly one of `to` (phone, WhatsApp) or
// `to_instagram_id` (IGSID, Instagram) — never both. Kept as two
// distinct params rather than overloading `to` with a `channel` field,
// so existing integrations built against `to` as "a phone number"
// never change meaning; adding Instagram support couldn't be a
// breaking change for them.
//
// Auth: API key with the `messages:send` scope. Account context (and
// the service-role client) come from `requireApiKey`.
//
// Body (WhatsApp):
//   {
//     "to": "+14155550123",                 // required (or to_instagram_id), E.164
//     "type": "text",                        // text|template|image|video|document|audio (default: text)
//     "text": "Hello!",                      // text body, or media caption
//     "media_url": "https://…/file.pdf",     // required for image/video/document/audio
//     "filename": "invoice.pdf",             // optional, document filename
//     "template": {                          // required when type=template
//       "name": "order_update",
//       "language": "en_US",
//       "params": ["A123"] | { "body": [...] }   // array = positional body; object = structured
//     },
//     "reply_to_message_id": "<uuid>",       // optional, must be in the same conversation
//     "name": "Jane Doe"                     // optional, names a newly-created contact
//   }
//
// Body (Instagram):
//   {
//     "to_instagram_id": "17841400000000000", // required (or to), the recipient's IGSID
//     "type": "text",                          // text|image|video|document|audio — no template/interactive
//     "text": "Hello!",
//     "media_url": "https://…/photo.jpg",      // required for image/video/document/audio
//     "name": "Jane Doe"                       // optional, names a newly-created contact
//   }
//
// Response (201):
//   { "data": { "message_id", "whatsapp_message_id", "conversation_id",
//               "contact_id", "contact_created" } }
//   (`whatsapp_message_id` holds the provider's message id for either
//   channel — see src/lib/messaging/types.ts for why the field name
//   is shared.)
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import { resolveConversationByInstagramId } from '@/lib/instagram/resolve-conversation';
import {
  sendMessageToConversation,
  validateSendMessageParams,
  SendMessageError,
} from '@/lib/whatsapp/send-message';
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'messages:send');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const to = typeof body.to === 'string' ? body.to.trim() : '';
    const toInstagramId =
      typeof body.to_instagram_id === 'string' ? body.to_instagram_id.trim() : '';

    if (!to && !toInstagramId) {
      return fail('bad_request', "'to' or 'to_instagram_id' is required", 400);
    }
    if (to && toInstagramId) {
      return fail('bad_request', "Pass only one of 'to' or 'to_instagram_id', not both", 400);
    }
    const isInstagram = !!toInstagramId;

    const type = typeof body.type === 'string' ? body.type : 'text';

    if (isInstagram && (type === 'template' || type === 'interactive')) {
      return fail(
        'bad_request',
        `type "${type}" is a WhatsApp-only concept and is not supported for Instagram sends`,
        400
      );
    }

    // Unpack the optional `template` object into the flat params the
    // send core expects. `params` as an array → legacy positional body
    // params; as an object → structured header/body/button params.
    const template =
      body.template && typeof body.template === 'object'
        ? (body.template as Record<string, unknown>)
        : null;
    const templateParams = Array.isArray(template?.params)
      ? (template.params as unknown[]).filter(
          (p): p is string => typeof p === 'string'
        )
      : undefined;
    const templateMessageParams =
      template?.params && !Array.isArray(template.params)
        ? template.params
        : undefined;

    // Validate the message shape BEFORE resolveConversationByPhone
    // finds-or-creates a contact + conversation, so a bad payload 400s
    // without leaving an orphan contact/conversation behind.
    // Validated by `validateSendMessageParams` below; the cast just bridges
    // the untyped JSON body to the send-core param type.
    const interactivePayload =
      body.interactive_payload && typeof body.interactive_payload === 'object'
        ? (body.interactive_payload as InteractiveMessagePayload)
        : null;

    validateSendMessageParams({
      messageType: type,
      contentText: typeof body.text === 'string' ? body.text : null,
      mediaUrl: typeof body.media_url === 'string' ? body.media_url : null,
      templateName: typeof template?.name === 'string' ? template.name : null,
      interactivePayload,
    });

    // Find-or-create the conversation for this recipient, then send.
    // Both steps share `SendMessageError`, so one catch maps the whole
    // pipeline to the envelope. `sendMessageToConversation` itself
    // branches to the Instagram sender once it sees
    // `conversation.channel === 'instagram'` — no channel argument
    // needs to be threaded through it explicitly.
    const resolved = isInstagram
      ? await resolveConversationByInstagramId(
          ctx.supabase,
          ctx.accountId,
          toInstagramId,
          typeof body.name === 'string' ? body.name : null
        )
      : await resolveConversationByPhone(
          ctx.supabase,
          ctx.accountId,
          to,
          typeof body.name === 'string' ? body.name : null
        );

    const result = await sendMessageToConversation(
      ctx.supabase,
      ctx.accountId,
      {
        conversationId: resolved.conversationId,
        messageType: type,
        contentText: typeof body.text === 'string' ? body.text : null,
        mediaUrl: typeof body.media_url === 'string' ? body.media_url : null,
        filename: typeof body.filename === 'string' ? body.filename : null,
        templateName: typeof template?.name === 'string' ? template.name : null,
        templateLanguage:
          typeof template?.language === 'string' ? template.language : null,
        templateParams,
        templateMessageParams,
        interactivePayload,
        replyToMessageId:
          typeof body.reply_to_message_id === 'string'
            ? body.reply_to_message_id
            : null,
      }
    );

    return ok(
      {
        message_id: result.messageId,
        whatsapp_message_id: result.whatsappMessageId,
        conversation_id: resolved.conversationId,
        contact_id: resolved.contactId,
        contact_created: resolved.contactCreated,
      },
      201
    );
  } catch (err) {
    if (err instanceof SendMessageError) {
      return fail(err.code, err.message, err.status);
    }
    return toApiErrorResponse(err);
  }
}
