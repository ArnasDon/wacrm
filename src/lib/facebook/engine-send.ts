// ============================================================
// Facebook sender for the Automations and Flows engines. Mirrors
// `@/lib/instagram/engine-send`, minus the provider dispatch —
// Facebook is Zernio-only in wacrm, so every send calls
// `@/lib/zernio/api` directly.
// ============================================================

import { sendZernioText, sendZernioMedia, sendZernioQuickReplies, type ZernioMediaKind, type ZernioQuickReplyOption } from '@/lib/zernio/api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import type { SupabaseClient } from '@supabase/supabase-js'

interface CommonArgs {
  /** Account-level tenancy key. Drives contact + facebook_config lookups. */
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
): Promise<{ apiKey: string; zernioAccountId: string; zernioConversationId: string }> {
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, facebook_id')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (contactErr || !contact?.facebook_id) {
    throw new Error('contact has no Facebook identity for this account')
  }

  const { data: config, error: configErr } = await db
    .from('facebook_config')
    .select('*')
    .eq('account_id', accountId)
    .single()
  if (configErr || !config) {
    throw new Error('Facebook not configured for this account')
  }

  const { data: conversation } = await db
    .from('conversations')
    .select('zernio_conversation_id')
    .eq('id', conversationId)
    .maybeSingle()
  if (!conversation?.zernio_conversation_id) {
    throw new Error('No Zernio conversation exists yet for this contact')
  }

  return {
    apiKey: decrypt(config.zernio_api_key),
    zernioAccountId: config.zernio_account_id,
    zernioConversationId: conversation.zernio_conversation_id,
  }
}

interface SendTextArgs extends CommonArgs {
  text: string
  aiGenerated?: boolean
}

export async function engineSendFacebookText(args: SendTextArgs): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()
  const target = await loadSendTarget(db, args.accountId, args.contactId, args.conversationId)

  const { messageId } = await sendZernioText({
    apiKey: target.apiKey,
    conversationId: target.zernioConversationId,
    accountId: target.zernioAccountId,
    text: args.text,
  })

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
    throw new Error(`sent to Zernio but DB insert failed: ${msgErr.message}`)
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
  kind: ZernioMediaKind
  link: string
}

export async function engineSendFacebookMedia(args: SendMediaArgs): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()
  const target = await loadSendTarget(db, args.accountId, args.contactId, args.conversationId)

  const { messageId } = await sendZernioMedia({
    apiKey: target.apiKey,
    conversationId: target.zernioConversationId,
    accountId: target.zernioAccountId,
    kind: args.kind,
    link: args.link,
  })

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
    throw new Error(`sent to Zernio but DB insert failed: ${msgErr.message}`)
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
  options: ZernioQuickReplyOption[]
}

/**
 * Send a text prompt with tappable quick-reply chips — Facebook
 * Messenger's analogue of WhatsApp buttons/lists. Same
 * content_type='text' persistence choice as
 * `engineSendInstagramQuickReplies`: this isn't a WhatsApp-shaped
 * `interactive_payload`, so the inbox re-render is a cosmetic
 * simplification even though the customer sees real tappable chips.
 */
export async function engineSendFacebookQuickReplies(
  args: SendQuickRepliesArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()
  const target = await loadSendTarget(db, args.accountId, args.contactId, args.conversationId)

  const { messageId } = await sendZernioQuickReplies({
    apiKey: target.apiKey,
    conversationId: target.zernioConversationId,
    accountId: target.zernioAccountId,
    text: args.bodyText,
    quickReplies: args.options,
  })

  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: 'text',
    content_text: args.bodyText,
    message_id: messageId,
    status: 'sent',
  })
  if (msgErr) {
    throw new Error(`sent to Zernio but DB insert failed: ${msgErr.message}`)
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
