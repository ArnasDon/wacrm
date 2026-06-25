/**
 * Outbound AI reply sender (spec §5: `send.ts`).
 *
 * Sends one autonomous AI reply to the customer over the SAME Meta Cloud
 * API path the inbox composer (`POST /api/whatsapp/send`) and the Flows
 * engine (`src/lib/flows/meta-send.ts`) already use — `sendTextMessage`
 * from `src/lib/whatsapp/meta-api.ts` — then persists the outgoing row to
 * `messages` with `sender_type='bot'` so the inbox renders it with the
 * "AI" tag (spec §8) and the conversation list preview updates.
 *
 * The orchestrator (`reply.ts`) has already loaded + decrypted the account's
 * `whatsapp_config`, so the resolved `accessToken` + `phoneNumberId` are
 * passed in directly rather than re-fetched here. This keeps the single
 * config read on the hot path in one place and lets the handoff send in
 * `escalate.ts` reuse the same already-decrypted token.
 *
 * Mirrors `engineSendText` in `src/lib/flows/meta-send.ts`: same
 * phone-variant retry (`phoneVariants` + `isRecipientNotAllowedError`),
 * the same auto-correct-contact-phone-on-success step, and the same
 * "sent to Meta but DB insert failed" hard error. The only differences
 * are the pre-resolved credentials and `sender_type='bot'` for an AI send.
 *
 * Throws on any failure (contact missing, all phone variants rejected,
 * DB insert failed) so the caller's try/catch can fall back to escalation
 * — the "fail safe to a human" bias of spec §1 / §6.
 */

import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import { sendTextMessage } from '@/lib/whatsapp/meta-api'

import { supabaseAdmin } from './admin-client'

export interface SendAiReplyArgs {
  /** Account-level tenancy key — scopes the contact lookup + auto-correct. */
  accountId: string
  /** Conversation the reply belongs to; the outgoing row + preview attach here. */
  conversationId: string
  /** Contact whose phone the message is sent to (resolved + validated here). */
  contactId: string
  /** The reply text to send the customer (already decided non-empty upstream). */
  text: string
  /** Decrypted Meta access token, resolved by the caller from whatsapp_config. */
  accessToken: string
  /** Meta phone-number id, resolved by the caller from whatsapp_config. */
  phoneNumberId: string
}

/**
 * Send an AI-authored text reply to the customer and persist it.
 *
 * Returns the Meta message id on success. The bot's message lands in
 * `messages` with `sender_type='bot'`, `content_type='text'`,
 * `status='sent'`, exactly like the Flows engine's text sends — so the
 * "AI" tag in the inbox keys off the same `sender_type='bot'` discriminator.
 */
export async function sendAiReply(
  args: SendAiReplyArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  // Resolve + validate the contact phone. Scoped by account_id for the
  // same defense-in-depth reason as flows/automations meta-send.
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  const attempt = async (phone: string): Promise<string> => {
    const r = await sendTextMessage({
      phoneNumberId: args.phoneNumberId,
      accessToken: args.accessToken,
      to: phone,
      text: args.text,
    })
    return r.messageId
  }

  // Phone-variant retry: numbers registered with/without a trunk 0 plus
  // Meta's sandbox quirks need this to reliably land. Only the specific
  // "recipient not in allowed list" failure is retried; any other error
  // (bad token, invalid recipient) bubbles up so the caller escalates.
  const variants = phoneVariants(sanitized)
  let workingPhone = sanitized
  let waMessageId = ''
  let lastError: unknown = null
  for (const v of variants) {
    try {
      waMessageId = await attempt(v)
      workingPhone = v
      lastError = null
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) throw err
      lastError = err
    }
  }
  if (lastError) throw lastError

  // Persist the working variant back to the contact so future sends go
  // straight through on the first attempt.
  if (workingPhone !== sanitized) {
    await db.from('contacts').update({ phone: workingPhone }).eq('id', contact.id)
  }

  // Persist the bot's reply. sender_type='bot' is what the inbox keys the
  // "AI" tag off (spec §8); content_type='text'/status='sent' match the
  // composer + flows text sends (migration 001 messages schema).
  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: 'text',
    content_text: args.text,
    message_id: waMessageId,
    status: 'sent',
  })
  if (msgErr) {
    throw new Error(`sent to Meta but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text: args.text,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)

  return { whatsapp_message_id: waMessageId }
}
