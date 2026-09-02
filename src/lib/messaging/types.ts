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
  /**
   * Instagram/Facebook only — send with Meta's `HUMAN_AGENT` message
   * tag so a human agent can reply outside the standard 24-hour
   * messaging window (7-day extension). Meta requires this be a real
   * human support reply — never automated content — so this must only
   * ever be set from the dashboard compose box (a human clicking
   * send), never from a Flow, Automation, or the AI auto-reply bot.
   * Only actually applied when the conversation's window has in fact
   * expired (`isWithinMessagingWindow`); a stray true on an otherwise
   * normal send is a harmless no-op. Ignored for WhatsApp, which uses
   * templates for this instead.
   */
  humanAgentTag?: boolean;
  /**
   * Persisted `messages.sender_type` for the outbound row. Defaults to
   * `'agent'` (a human/API send). The follow-up sweep passes `'bot'` so
   * an automated nudge is not mistaken for a teammate's reply. WhatsApp
   * send core only — the Instagram/Facebook cores ignore it.
   */
  senderType?: 'agent' | 'bot';
}

export interface SendMessageResult {
  /** Our `messages.id` (the persisted row). */
  messageId: string;
  /** The provider's message id for the delivered message (Meta's `wamid` for WhatsApp, Instagram's `message_id` for Instagram). */
  whatsappMessageId: string;
}
