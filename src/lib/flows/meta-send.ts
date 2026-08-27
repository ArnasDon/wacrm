import {
  sendInteractiveButtons,
  sendInteractiveList,
  sendMediaMessage,
  sendTextMessage,
  type InteractiveButton,
  type InteractiveListSection,
  type MediaKind,
} from '@/lib/whatsapp/meta-api'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import { supabaseAdmin } from './admin-client'
import {
  engineSendInstagramText,
  engineSendInstagramMedia,
  engineSendInstagramQuickReplies,
} from '@/lib/instagram/engine-send'
import type { QuickReplyOption } from '@/lib/instagram/api'
import {
  engineSendFacebookText,
  engineSendFacebookMedia,
  engineSendFacebookQuickReplies,
} from '@/lib/facebook/engine-send'
import {
  sendWhatsAppTextViaZernio,
  sendWhatsAppMediaViaZernio,
  sendWhatsAppInteractiveViaZernio,
  type ZernioSendContext,
} from '@/lib/whatsapp/zernio-send'
import { resolveWhatsAppConfig } from '@/lib/whatsapp/resolve-config'

/** `conversations.zernio_conversation_id` for a WhatsApp-via-Zernio send. */
async function loadZernioConversationId(
  db: ReturnType<typeof supabaseAdmin>,
  conversationId: string,
): Promise<string | null> {
  const { data } = await db
    .from('conversations')
    .select('zernio_conversation_id')
    .eq('id', conversationId)
    .maybeSingle()
  return data?.zernio_conversation_id ?? null
}

/**
 * Which channel is `conversationId` on? Every entry point below
 * checks this before running the WhatsApp path (unchanged) or
 * branching into the Instagram/Facebook sender. Same helper,
 * independently defined, as automations/meta-send.ts's — kept local
 * rather than shared per this file's own stated policy of not
 * coupling the two engines' send paths together.
 */
async function resolveConversationChannel(
  db: ReturnType<typeof supabaseAdmin>,
  conversationId: string,
): Promise<'whatsapp' | 'instagram' | 'facebook'> {
  const { data } = await db
    .from('conversations')
    .select('channel')
    .eq('id', conversationId)
    .maybeSingle()
  if (data?.channel === 'instagram') return 'instagram'
  if (data?.channel === 'facebook') return 'facebook'
  return 'whatsapp'
}

/** `conversations.whatsapp_config_id` — which number this thread is pinned to. */
async function loadConversationWhatsAppConfigId(
  db: ReturnType<typeof supabaseAdmin>,
  conversationId: string,
): Promise<string | null> {
  const { data } = await db
    .from('conversations')
    .select('whatsapp_config_id')
    .eq('id', conversationId)
    .maybeSingle()
  return data?.whatsapp_config_id ?? null
}

// ------------------------------------------------------------
// Flows-side Meta sender (interactive variants).
//
// Mirrors src/lib/automations/meta-send.ts (engineSendText /
// engineSendTemplate) but emits interactive button + list messages.
// Kept separate from the automations file so the two engines don't
// fight over each other's shape — once both stabilize, the
// phone-variant retry + DB persistence are obvious extraction
// candidates into a shared base.
//
// PR #1 ships this in isolation: callers don't exist yet. PR #2
// brings the flow runner online and wires it up. Shipping it now
// keeps the foundation PR self-contained and unit-testable.
// ------------------------------------------------------------

interface SendTextEngineArgs {
  /** Account-level tenancy key. Drives contact + whatsapp_config
   *  lookups so a flow authored by user A still sends through the
   *  WhatsApp number user B saved on the same account. */
  accountId: string
  /** Original author of the flow — used for INSERT audit columns
   *  and for resolving the agent's identity in logs. Not consulted
   *  for tenancy. */
  userId: string
  conversationId: string
  contactId: string
  text: string
  /** Marks the persisted message row `ai_generated = true` so the inbox
   *  badges it as an AI reply. Only the auto-reply bot sets this;
   *  deterministic Flow/automation sends leave it false. */
  aiGenerated?: boolean
}

/**
 * Send a plain-text WhatsApp message from the Flows engine.
 *
 * Used by the runner's `send_message` and `collect_input` nodes —
 * both prompt the customer with text and either auto-advance (the
 * send_message case) or suspend awaiting a text reply (collect_input).
 *
 * Wraps the same phone-variant retry + DB persistence pattern as the
 * interactive senders; the duplication will be DRY'd into a shared
 * `engineSendBase` once the v2 features (templates with variables,
 * media sends) settle.
 */
export async function engineSendText(
  args: SendTextEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  const engineChannel = await resolveConversationChannel(db, args.conversationId)
  if (engineChannel === 'instagram') {
    return engineSendInstagramText(args)
  }
  if (engineChannel === 'facebook') {
    return engineSendFacebookText(args)
  }

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

  const config = await resolveWhatsAppConfig(
    db,
    args.accountId,
    await loadConversationWhatsAppConfigId(db, args.conversationId),
  )
  if (!config) {
    throw new Error('WhatsApp not configured for this account')
  }

  if (config.provider === 'zernio') {
    const zernioCtx: ZernioSendContext = {
      config: { zernio_api_key: config.zernio_api_key, zernio_account_id: config.zernio_account_id },
      zernioConversationId: await loadZernioConversationId(db, args.conversationId),
    }
    const { messageId } = await sendWhatsAppTextViaZernio(zernioCtx, args.text)

    const { error: msgErr } = await db.from('messages').insert({
      conversation_id: args.conversationId,
      sender_type: 'bot',
      content_type: 'text',
      content_text: args.text,
      message_id: messageId,
      status: 'sent',
      ai_generated: args.aiGenerated ?? false,
    })
    if (msgErr) throw new Error(`sent to Zernio but DB insert failed: ${msgErr.message}`)

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

  const accessToken = decrypt(config.access_token)

  const attempt = async (phone: string): Promise<string> => {
    const r = await sendTextMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      text: args.text,
    })
    return r.messageId
  }

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

  if (workingPhone !== sanitized) {
    await db.from('contacts').update({ phone: workingPhone }).eq('id', contact.id).eq('account_id', args.accountId)
  }

  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: 'text',
    content_text: args.text,
    message_id: waMessageId,
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

  return { whatsapp_message_id: waMessageId }
}

interface SendMediaEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  kind: MediaKind
  /** Public URL Meta fetches at send time. */
  link: string
  caption?: string
  /** Document-only; ignored by Meta for image/video. */
  filename?: string
}

/**
 * Send an image / video / document from the Flows engine.
 *
 * Used by the runner's `send_media` node. Auto-advances after the
 * send lands (same suspend semantics as send_message). Same
 * phone-variant retry + DB persistence as the text/interactive
 * senders; persists the outgoing message with `content_type` matching
 * the media kind so the inbox renders the right preview.
 */
export async function engineSendMedia(
  args: SendMediaEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  // Instagram/Facebook media messages carry no caption/filename
  // (unlike WhatsApp) — both are silently dropped rather than failing
  // the step, since the media itself is still the point of this node.
  const engineChannel = await resolveConversationChannel(db, args.conversationId)
  if (engineChannel === 'instagram') {
    return engineSendInstagramMedia({
      accountId: args.accountId,
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      kind: args.kind,
      link: args.link,
    })
  }
  if (engineChannel === 'facebook') {
    return engineSendFacebookMedia({
      accountId: args.accountId,
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      kind: args.kind,
      link: args.link,
    })
  }

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

  const config = await resolveWhatsAppConfig(
    db,
    args.accountId,
    await loadConversationWhatsAppConfigId(db, args.conversationId),
  )
  if (!config) {
    throw new Error('WhatsApp not configured for this account')
  }

  if (config.provider === 'zernio') {
    const zernioCtx: ZernioSendContext = {
      config: { zernio_api_key: config.zernio_api_key, zernio_account_id: config.zernio_account_id },
      zernioConversationId: await loadZernioConversationId(db, args.conversationId),
    }
    const { messageId } = await sendWhatsAppMediaViaZernio(zernioCtx, args.kind, args.link, args.caption, args.filename)

    const preview = args.caption?.trim() || `[${args.kind}]`
    const { error: msgErr } = await db.from('messages').insert({
      conversation_id: args.conversationId,
      sender_type: 'bot',
      content_type: args.kind,
      content_text: args.caption ?? null,
      message_id: messageId,
      status: 'sent',
    })
    if (msgErr) throw new Error(`sent to Zernio but DB insert failed: ${msgErr.message}`)

    await db
      .from('conversations')
      .update({
        last_message_text: preview,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', args.conversationId)

    return { whatsapp_message_id: messageId }
  }

  const accessToken = decrypt(config.access_token)

  const attempt = async (phone: string): Promise<string> => {
    const r = await sendMediaMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      kind: args.kind,
      link: args.link,
      caption: args.caption,
      filename: args.filename,
    })
    return r.messageId
  }

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

  if (workingPhone !== sanitized) {
    await db.from('contacts').update({ phone: workingPhone }).eq('id', contact.id).eq('account_id', args.accountId)
  }

  // content_type='image'|'video'|'document' — these are already in the
  // messages_content_type_check constraint (migration 001 + 010).
  // content_text carries the caption (or empty) so the conversation
  // list preview shows something meaningful when the user glances at it.
  const preview = args.caption?.trim() || `[${args.kind}]`
  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: args.kind,
    content_text: args.caption ?? null,
    message_id: waMessageId,
    status: 'sent',
  })
  if (msgErr) {
    throw new Error(`sent to Meta but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text: preview,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)

  return { whatsapp_message_id: waMessageId }
}

interface SendInteractiveButtonsEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttons: InteractiveButton[]
  headerText?: string
  footerText?: string
}

interface SendInteractiveListEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttonLabel: string
  sections: InteractiveListSection[]
  headerText?: string
  footerText?: string
}

/**
 * Send an interactive-button WhatsApp message from the Flows engine.
 *
 * Persists the outgoing message to `messages` with
 * `content_type='interactive'` and `sender_type='bot'` so the inbox
 * surfaces it with the "Button reply" affordance and the conversation
 * thread reflects the bot's prompt.
 *
 * Returns the Meta message id so the caller (engine) can stash it on
 * the `flow_runs.last_prompt_message_id` field for later reference.
 */
export async function engineSendInteractiveButtons(
  args: SendInteractiveButtonsEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendInteractiveViaMeta({ ...args, kind: 'buttons' })
}

/**
 * Send an interactive-list WhatsApp message from the Flows engine.
 * Used when the flow needs more than 3 options (Meta's button cap).
 */
export async function engineSendInteractiveList(
  args: SendInteractiveListEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendInteractiveViaMeta({ ...args, kind: 'list' })
}

type SendInput =
  | (SendInteractiveButtonsEngineArgs & { kind: 'buttons' })
  | (SendInteractiveListEngineArgs & { kind: 'list' })

async function sendInteractiveViaMeta(
  input: SendInput,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  // Instagram/Facebook's closest analogue to buttons/list is a flat
  // set of quick-reply chips (max 13) — same mapping as
  // automations/meta-send.ts's engineSendInteractive.
  const engineChannel = await resolveConversationChannel(db, input.conversationId)
  if (engineChannel === 'instagram' || engineChannel === 'facebook') {
    const options: QuickReplyOption[] =
      input.kind === 'buttons'
        ? input.buttons.map((b) => ({ title: b.title, payload: b.id }))
        : input.sections.flatMap((s) => s.rows.map((r) => ({ title: r.title, payload: r.id })))
    const sendArgs = {
      accountId: input.accountId,
      userId: input.userId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      bodyText: input.bodyText,
      options,
    }
    return engineChannel === 'instagram'
      ? engineSendInstagramQuickReplies(sendArgs)
      : engineSendFacebookQuickReplies(sendArgs)
  }

  // Scope the contact + whatsapp_config lookups by account_id —
  // same defense-in-depth rationale as automations/meta-send.ts.
  // Migration 017 moved both tables to account-scoped tenancy.
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', input.contactId)
    .eq('account_id', input.accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  const config = await resolveWhatsAppConfig(
    db,
    input.accountId,
    await loadConversationWhatsAppConfigId(db, input.conversationId),
  )
  if (!config) {
    throw new Error('WhatsApp not configured for this account')
  }

  if (config.provider === 'zernio') {
    const zernioCtx: ZernioSendContext = {
      config: { zernio_api_key: config.zernio_api_key, zernio_account_id: config.zernio_account_id },
      zernioConversationId: await loadZernioConversationId(db, input.conversationId),
    }
    const payload: InteractiveMessagePayload =
      input.kind === 'buttons'
        ? { kind: 'buttons', body: input.bodyText, header: input.headerText, footer: input.footerText, buttons: input.buttons }
        : {
            kind: 'list',
            body: input.bodyText,
            button_label: input.buttonLabel,
            header: input.headerText,
            footer: input.footerText,
            sections: input.sections,
          }
    const { messageId } = await sendWhatsAppInteractiveViaZernio(zernioCtx, payload)

    const { error: msgErr } = await db.from('messages').insert({
      conversation_id: input.conversationId,
      sender_type: 'bot',
      content_type: 'interactive',
      content_text: input.bodyText,
      interactive_payload: payload,
      message_id: messageId,
      status: 'sent',
    })
    if (msgErr) throw new Error(`sent to Zernio but DB insert failed: ${msgErr.message}`)

    await db
      .from('conversations')
      .update({
        last_message_text: input.bodyText,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.conversationId)

    return { whatsapp_message_id: messageId }
  }

  const accessToken = decrypt(config.access_token)

  const attempt = async (phone: string): Promise<string> => {
    if (input.kind === 'buttons') {
      const r = await sendInteractiveButtons({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        bodyText: input.bodyText,
        buttons: input.buttons,
        headerText: input.headerText,
        footerText: input.footerText,
      })
      return r.messageId
    }
    const r = await sendInteractiveList({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      bodyText: input.bodyText,
      buttonLabel: input.buttonLabel,
      sections: input.sections,
      headerText: input.headerText,
      footerText: input.footerText,
    })
    return r.messageId
  }

  // Same phone-variant retry as automations/meta-send.ts. Numbers
  // registered with/without a trunk 0 + Meta's sandbox quirks all
  // need this to reliably land a message.
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

  if (workingPhone !== sanitized) {
    await db.from('contacts').update({ phone: workingPhone }).eq('id', contact.id).eq('account_id', input.accountId)
  }

  // Persist the bot's prompt to the messages table so it appears in
  // the inbox. content_type='interactive' is supported as of
  // migration 010; sender_type='bot' distinguishes flow sends from
  // manual agent sends (the conversation list preview will pick up
  // last_message_text as a sensible summary).
  //
  // We do NOT set interactive_reply_id here — that column is reserved
  // for the customer's tap on this message, populated by the webhook
  // when their reply arrives. We DO persist the structured payload so
  // the inbox thread re-renders the buttons/rows the bot sent (round-
  // trip), matching the composer + automation send paths.
  const interactivePayload: InteractiveMessagePayload =
    input.kind === 'buttons'
      ? {
          kind: 'buttons',
          body: input.bodyText,
          header: input.headerText,
          footer: input.footerText,
          buttons: input.buttons,
        }
      : {
          kind: 'list',
          body: input.bodyText,
          header: input.headerText,
          footer: input.footerText,
          button_label: input.buttonLabel,
          sections: input.sections,
        }

  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: input.conversationId,
    sender_type: 'bot',
    content_type: 'interactive',
    content_text: input.bodyText,
    interactive_payload: interactivePayload,
    message_id: waMessageId,
    status: 'sent',
  })
  if (msgErr) {
    throw new Error(`sent to Meta but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text: input.bodyText,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.conversationId)

  return { whatsapp_message_id: waMessageId }
}
