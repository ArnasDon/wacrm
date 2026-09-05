// ============================================================
// Adaptador de envelope da Meta Cloud API.
//
// Traduz `entry[].changes[].value.messages[]` / `.statuses[]` (forma
// crua da Graph API) para os envelopes normalizados `InboundMessage` /
// `InboundStatus` que `processInboundMessage` / `processStatusUpdate`
// consomem. Toda a decisão por `message.type` que vivia em
// `parseMessageContent` está aqui — mas produz `content.kind` + um
// `ProviderMediaRef` opaco, nunca uma URL de mídia.
// ============================================================

import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import type { InboundMessage, InboundStatus } from './types';

export interface WhatsAppMessage {
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
  /**
   * Set when the customer taps a button or list row on an interactive
   * message we sent. `button_reply.id` / `list_reply.id` is whatever id
   * we put on the button/row when sending — the Flows engine uses this
   * to advance the per-contact run.
   */
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  /**
   * Set when the customer taps a QUICK_REPLY button on a *template*
   * message — a broadcast, or any template send. Meta uses a different
   * envelope from `interactive` above: `type: 'button'`, the label in
   * `button.text`, and the payload configured on the template's button
   * in `button.payload` (Meta's own template editor doesn't ask for a
   * payload and mirrors the label into it).
   */
  button?: { text?: string; payload?: string };
  /** Present when the customer swipe-replies to one of our messages. */
  context?: { id: string };
}

export interface WhatsAppWebhookEntry {
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

export interface MetaStatus {
  id: string;
  status: string;
  timestamp: string;
  recipient_id: string;
}

export interface MetaContact {
  profile: { name: string };
  wa_id: string;
}

/** The subset of the matched `whatsapp_connections` row the adapter stamps. */
export interface MetaConnectionRow {
  id: string;
  account_id: string;
  user_id: string;
}

export function metaStatusToInbound(
  status: MetaStatus,
  row: MetaConnectionRow
): InboundStatus {
  return {
    connectionId: row.id,
    accountId: row.account_id,
    providerMessageId: status.id,
    status: status.status,
    timestamp: new Date(parseInt(status.timestamp) * 1000),
  };
}

export function metaMessageToInbound(
  message: WhatsAppMessage,
  contact: MetaContact,
  row: MetaConnectionRow
): InboundMessage {
  return {
    connectionId: row.id,
    accountId: row.account_id,
    configOwnerUserId: row.user_id,
    providerMessageId: message.id,
    from: normalizePhone(message.from),
    senderName: contact?.profile?.name,
    timestamp: new Date(parseInt(message.timestamp) * 1000),
    replyToProviderMessageId: message.context?.id,
    content: metaContent(message),
  };
}

/**
 * The `switch (message.type)` decision lifted from `parseMessageContent`.
 * Every quirk preserved: sticker → media/image, template quick-reply
 * (`button`) → interactive_reply with `replyId = payload || label`,
 * anything unrecognised → `unsupported` carrying the raw type.
 */
function metaContent(message: WhatsAppMessage): InboundMessage['content'] {
  switch (message.type) {
    case 'text':
      return { kind: 'text', text: message.text?.body ?? '' };

    case 'image':
      if (message.image?.id) {
        return {
          kind: 'media',
          mediaKind: 'image',
          caption: message.image.caption || undefined,
          mimeType: message.image.mime_type,
          ref: { provider: 'meta', mediaId: message.image.id },
        };
      }
      return { kind: 'unsupported', rawType: message.type };

    case 'video':
      if (message.video?.id) {
        return {
          kind: 'media',
          mediaKind: 'video',
          caption: message.video.caption || undefined,
          mimeType: message.video.mime_type,
          ref: { provider: 'meta', mediaId: message.video.id },
        };
      }
      return { kind: 'unsupported', rawType: message.type };

    case 'document':
      if (message.document?.id) {
        return {
          kind: 'media',
          mediaKind: 'document',
          // Mirrors parseMessageContent: caption wins, else the sender's
          // own filename, else nothing.
          caption:
            message.document.caption || message.document.filename || undefined,
          filename: message.document.filename,
          mimeType: message.document.mime_type,
          ref: { provider: 'meta', mediaId: message.document.id },
        };
      }
      return { kind: 'unsupported', rawType: message.type };

    case 'audio':
      if (message.audio?.id) {
        return {
          kind: 'media',
          mediaKind: 'audio',
          mimeType: message.audio.mime_type,
          ref: { provider: 'meta', mediaId: message.audio.id },
        };
      }
      return { kind: 'unsupported', rawType: message.type };

    case 'sticker':
      // Stickers are images under the hood — the inbox renders the <img>
      // and the core maps content_type to 'image' for the CHECK.
      if (message.sticker?.id) {
        return {
          kind: 'media',
          mediaKind: 'image',
          mimeType: message.sticker.mime_type,
          ref: { provider: 'meta', mediaId: message.sticker.id },
        };
      }
      return { kind: 'unsupported', rawType: message.type };

    case 'location':
      if (message.location) {
        return {
          kind: 'location',
          latitude: message.location.latitude,
          longitude: message.location.longitude,
          name: message.location.name,
          address: message.location.address,
        };
      }
      return { kind: 'unsupported', rawType: message.type };

    case 'reaction':
      return {
        kind: 'reaction',
        targetProviderMessageId: message.reaction?.message_id ?? '',
        emoji: message.reaction?.emoji ?? '',
      };

    case 'interactive': {
      // The customer tapped a reply button or a list row on a message we
      // sent. Use the human-readable title for display, keep the stable
      // id for the Flows engine to route on.
      const reply =
        message.interactive?.button_reply ?? message.interactive?.list_reply;
      if (reply?.id) {
        return {
          kind: 'interactive_reply',
          replyId: reply.id,
          title: reply.title || reply.id,
        };
      }
      return { kind: 'unsupported', rawType: message.type };
    }

    case 'button': {
      // Quick-reply tap on a TEMPLATE message (issue #478). `payload` is
      // the stable value (analogue of `button_reply.id`); `text` is the
      // visible label. Prefer payload for routing, label for display,
      // each falling back to the other.
      const payload = message.button?.payload || undefined;
      const label = message.button?.text || undefined;
      return {
        kind: 'interactive_reply',
        replyId: payload || label || '',
        title: label || payload || '',
      };
    }

    default:
      return { kind: 'unsupported', rawType: message.type };
  }
}
