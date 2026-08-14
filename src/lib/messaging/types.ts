// ============================================================
// Channel-neutral types shared by the WhatsApp and Instagram send
// cores (`@/lib/whatsapp/send-message`, `@/lib/instagram/send-message`).
//
// Lives in its own module — rather than on either channel's
// send-message.ts — specifically to avoid a circular import: the
// WhatsApp core imports the Instagram sender (to branch into it for
// `conversation.channel === 'instagram'`), and the Instagram sender
// needs this same error/param/result shape. Two files importing
// directly from each other works in most bundlers but is fragile;
// a shared leaf module with no imports of its own is not.
//
// `@/lib/whatsapp/send-message` re-exports these under their original
// names so every existing import site (`SendMessageError` from the
// WhatsApp module) keeps working unchanged.
// ============================================================

import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';

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

export interface SendMessageParams {
  conversationId: string;
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  /** Legacy positional body params (only used if messageParams.body unset). WhatsApp-only. */
  templateParams?: string[];
  /** Structured template params (header/body/buttons). WhatsApp-only. */
  templateMessageParams?: unknown;
  /** Structured payload for `messageType === 'interactive'`. WhatsApp-only. */
  interactivePayload?: InteractiveMessagePayload | null;
  replyToMessageId?: string | null;
}

export interface SendMessageResult {
  /** Our `messages.id` (the persisted row). */
  messageId: string;
  /** The provider's message id for the delivered message (Meta's `wamid` for WhatsApp, Instagram's `message_id` for Instagram). */
  whatsappMessageId: string;
}
