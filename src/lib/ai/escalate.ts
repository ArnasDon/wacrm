/**
 * Conversation escalation (spec §5: `escalate.ts`, §6, §8).
 *
 * The single place the AI hands a conversation to a human. Called from the
 * orchestrator (`reply.ts`) for every non-reply outcome — keyword match,
 * daily-cap hit, low confidence, or any thrown error — honouring the
 * "fail safe to a human" bias of spec §1.
 *
 * It does two things, in this order:
 *
 *   1. Flips the conversation out of AI control via the service-role admin
 *      client (RLS-bypassing, like the rest of the AI/Flows engine):
 *        - `ai_handling = false`            → AI goes silent on this thread
 *        - `ai_escalated_at = now()`        → drives the "🙋 Needs human" badge
 *        - `ai_escalation_reason = reason`  → audit + inbox surfacing
 *        - `status = 'pending'`             → reuses an existing status value
 *                                             that reads as "needs attention"
 *      (spec §4.3, §8 — no new status value is introduced.)
 *
 *   2. If `config.handoff_message` is set, sends it to the customer over the
 *      SAME Meta path the inbox composer + Flows engine use
 *      (`sendTextMessage` from `src/lib/whatsapp/meta-api.ts`), so the
 *      customer is never left silent.
 *
 * The DB flip is the load-bearing safety step and runs FIRST: if the
 * optional handoff send fails, the conversation is still correctly escalated
 * and silent. The handoff send is therefore best-effort — its failure is
 * logged, not thrown — so a Meta hiccup never leaves the AI "handling" a
 * conversation it has already decided to abandon.
 *
 * Note: the handoff send does NOT persist a `messages` row. It is a system
 * notice to the customer, not part of the agent/bot transcript; keeping it
 * out of `messages` avoids it reading as an AI reply (which carries the
 * `sender_type='bot'` "AI" tag) once a human has taken over.
 */

import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import { sendTextMessage } from '@/lib/whatsapp/meta-api'
import { type AiAssistantConfig, type AiEscalationReason } from '@/types'

import { supabaseAdmin } from './admin-client'

export interface EscalateConversationArgs {
  /** Conversation to hand to a human. */
  conversationId: string
  /** Why we escalated — written to `conversations.ai_escalation_reason`. */
  reason: AiEscalationReason
  /**
   * The account's AI config. Only `handoff_message` is consulted here; the
   * full object is passed so the caller doesn't have to re-shape it.
   */
  config: AiAssistantConfig
  /** Decrypted Meta access token, resolved by the caller. */
  accessToken: string
  /** Meta phone-number id, resolved by the caller. */
  phoneNumberId: string
  /** The customer's phone number, to send the optional handoff message to. */
  customerPhone: string
}

/**
 * Escalate a conversation to a human and optionally notify the customer.
 *
 * Always flips the conversation's AI hand-off columns; sends
 * `config.handoff_message` to the customer only when it is set. Never
 * throws on a handoff-send failure — the escalation itself is what must
 * succeed (spec §1, §6).
 */
export async function escalateConversation(
  args: EscalateConversationArgs,
): Promise<void> {
  const db = supabaseAdmin()

  // 1. Flip the conversation out of AI control. This is the safety-critical
  //    step — do it first so a later handoff-send failure can't leave the
  //    AI still "handling" a conversation it has abandoned.
  const now = new Date().toISOString()
  const { error: updateErr } = await db
    .from('conversations')
    .update({
      ai_handling: false,
      ai_escalated_at: now,
      ai_escalation_reason: args.reason,
      status: 'pending',
      updated_at: now,
    })
    .eq('id', args.conversationId)
  if (updateErr) {
    // The DB flip is load-bearing; surface its failure so the caller logs
    // an `error` decision and a human can be alerted another way.
    throw new Error(`escalation DB update failed: ${updateErr.message}`)
  }

  // 2. Optionally notify the customer. Nothing to send when no handoff
  //    message is configured (nullable = send nothing, spec §4.1).
  const handoff = args.config.handoff_message?.trim()
  if (!handoff) return

  const sanitized = sanitizePhoneForMeta(args.customerPhone)
  if (!isValidE164(sanitized)) {
    // Can't message an invalid number — the conversation is still correctly
    // escalated, so just log and return rather than throwing.
    console.error(
      `[ai] escalate: customer phone invalid, skipping handoff send: ${args.customerPhone}`,
    )
    return
  }

  // Best-effort handoff send over the same Meta path as the composer / flows
  // engine, with the same phone-variant retry. A failure here is logged, not
  // thrown — the escalation has already taken effect.
  try {
    const variants = phoneVariants(sanitized)
    let lastError: unknown = null
    for (const v of variants) {
      try {
        await sendTextMessage({
          phoneNumberId: args.phoneNumberId,
          accessToken: args.accessToken,
          to: v,
          text: handoff,
        })
        lastError = null
        break
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!isRecipientNotAllowedError(msg)) throw err
        lastError = err
      }
    }
    if (lastError) throw lastError
  } catch (err) {
    console.error(
      '[ai] escalate: handoff message send failed:',
      err instanceof Error ? err.message : err,
    )
  }
}
