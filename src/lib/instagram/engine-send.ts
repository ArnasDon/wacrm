// ============================================================
// Instagram sender for the Automations and Flows engines.
//
// Mirrors the shape of src/lib/automations/meta-send.ts and
// src/lib/flows/meta-send.ts (account-scoped contact + config lookup,
// service-role client, `sender_type: 'bot'` persistence, conversation
// last_message_* update) but targets Instagram instead of WhatsApp.
//
// Unlike the WhatsApp engine senders, this ONE file is shared by both
// automations/engine.ts and flows/engine.ts rather than duplicated per
// engine. That asymmetry is deliberate: the "duplicate instead of
// sharing" call for WhatsApp (see automations/meta-send.ts's own
// comment) exists specifically to avoid touching a working, heavily-
// used, already-duplicated WhatsApp code path. This file has no such
// legacy to protect — it's new code with one shape, so a single
// implementation is the plain YAGNI choice, not a violation of that
// same reasoning.
//
// No template support (Instagram has no template concept) and no
// list-message support (Instagram's closest analogue, quick replies,
// caps at 13 flat options — see sendQuickReplies in
// @/lib/instagram/api). Callers map WhatsApp-shaped "list" payloads
// down to a flat option array before calling engineSendInstagramQuickReplies.
// ============================================================

import type { InstagramMediaKind, QuickReplyOption } from '@/lib/instagram/api'
import { sendInstagramText, sendInstagramMedia, sendInstagramQuickReplies, type SendTarget } from '@/lib/instagram/provider-send'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import type { SupabaseClient } from '@supabase/supabase-js'

interface CommonArgs {
  /** Account-level tenancy key. Drives contact + instagram_config lookups. */
  accountId: string
  /** Original author of the automation/flow — audit only, not tenancy. */
  userId: string
  conversationId: string
  contactId: string
}

async function loadSendTarget(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  conversationId: string,
): Promise<{ contact: { id: string; instagram_id: string }; target: SendTarget }> {
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, instagram_id')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (contactErr || !contact?.instagram_id) {
    throw new Error('contact has no Instagram identity for this account')
  }

  const { data: config, error: configErr } = await db
    .from('instagram_config')
    .select('*')
    .eq('account_id', accountId)
    .single()
  if (configErr || !config) {
    throw new Error('Instagram not configured for this account')
  }

  const { data: conversation } = await db
    .from('conversations')
    .select('zernio_conversation_id')
    .eq('id', conversationId)
    .maybeSingle()

  return {
    contact,
    target: {
      config,
      igsid: contact.instagram_id,
      zernioConversationId: conversation?.zernio_conversation_id ?? null,
    },
  }
}

interface SendTextArgs extends CommonArgs {
  text: string
  /** Marks the persisted row `ai_generated = true` — mirrors the same flag on the flows/WhatsApp text sender. */
  aiGenerated?: boolean
}

export async function engineSendInstagramText(args: SendTextArgs): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()
  const { target } = await loadSendTarget(db, args.accountId, args.contactId, args.conversationId)

  const { messageId } = await sendInstagramText(target, args.text)

  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: 'text',
    content_text: args.text,
    message_id: messageId,
    status: 'sent',
    ai_generated: args.aiGenerated ?? false,
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

  return { whatsapp_message_id: messageId }
}

interface SendMediaArgs extends CommonArgs {
  kind: InstagramMediaKind
  link: string
}

export async function engineSendInstagramMedia(args: SendMediaArgs): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()
  const { target } = await loadSendTarget(db, args.accountId, args.contactId, args.conversationId)

  const { messageId } = await sendInstagramMedia(target, args.kind, args.link)

  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: args.kind,
    content_text: null,
    media_url: args.link,
    message_id: messageId,
    status: 'sent',
  })
  if (msgErr) {
    throw new Error(`sent to Meta but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text: `[${args.kind}]`,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)

  return { whatsapp_message_id: messageId }
}

interface SendQuickRepliesArgs extends CommonArgs {
  bodyText: string
  options: QuickReplyOption[]
}

/**
 * Send a text prompt with tappable quick-reply chips. Used for both
 * WhatsApp-button-shaped ('buttons', ≤3) and WhatsApp-list-shaped
 * ('list', flattened across sections) automation/flow steps when the
 * target conversation is on Instagram — see the callers in
 * automations/meta-send.ts and flows/meta-send.ts for the mapping.
 *
 * The persisted row stores `content_type: 'text'` (not 'interactive')
 * — Instagram quick replies aren't a WhatsApp-shaped
 * `interactive_payload`, and the inbox thread's interactive renderer
 * is WhatsApp-specific. The customer still sees real tappable chips on
 * Instagram itself (Meta renders them from the API payload); this is
 * only a cosmetic simplification of our own re-render of the sent
 * message. Tracked in docs/instagram-integration/PROGRESS.md as a
 * known gap for a future UI pass.
 */
export async function engineSendInstagramQuickReplies(
  args: SendQuickRepliesArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()
  const { target } = await loadSendTarget(db, args.accountId, args.contactId, args.conversationId)

  const { messageId } = await sendInstagramQuickReplies(target, args.bodyText, args.options)

  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: 'text',
    content_text: args.bodyText,
    message_id: messageId,
    status: 'sent',
  })
  if (msgErr) {
    throw new Error(`sent to Meta but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text: args.bodyText,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)

  return { whatsapp_message_id: messageId }
}
