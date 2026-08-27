import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'
import {
  engineSendInteractiveButtons,
  engineSendInteractiveList,
} from '@/lib/flows/meta-send'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import {
  resolveTemplateRow,
  templateContentText,
} from '@/lib/whatsapp/template-body'
import { supabaseAdmin } from './admin-client'
import {
  engineSendInstagramText,
  engineSendInstagramQuickReplies,
} from '@/lib/instagram/engine-send'
import type { QuickReplyOption } from '@/lib/instagram/api'
import {
  engineSendFacebookText,
  engineSendFacebookQuickReplies,
} from '@/lib/facebook/engine-send'
import { sendWhatsAppTextViaZernio, sendWhatsAppTemplateViaZernio, type ZernioSendContext } from '@/lib/whatsapp/zernio-send'
import { resolveWhatsAppConfig } from '@/lib/whatsapp/resolve-config'

/**
 * Which channel is `conversationId` on? Automation steps are written
 * against a conversation, not a channel, so every entry point below
 * checks this before deciding whether to run the WhatsApp path (the
 * rest of this file, unchanged) or branch into the Instagram/Facebook
 * sender.
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

/** `conversations.zernio_conversation_id` for a WhatsApp-via-Zernio send. Same helper, independently defined, as flows/meta-send.ts's. */
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
// Automation-side Meta sender.
//
// Mirrors the logic in src/app/api/whatsapp/send/route.ts but uses
// the service-role client (engine has no cookies) and accepts the
// user / conversation / contact identifiers the engine already has
// on hand. Kept here (rather than refactoring the user-facing send
// route) to avoid risk to the working manual-send path — they can
// converge in a later refactor.
// ------------------------------------------------------------

interface SendTextArgs {
  /** Account-level tenancy key. Drives contact + whatsapp_config
   *  lookups so an automation authored by user A still sends through
   *  the WhatsApp number user B saved on the same account. */
  accountId: string
  /** Original author of the automation/flow — used for INSERT audit
   *  columns (messages.sender_id-ish) and for resolving the agent's
   *  identity in logs. Not consulted for tenancy. */
  userId: string
  conversationId: string
  contactId: string
  text: string
}

interface SendTemplateArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  templateName: string
  language?: string
  params?: string[]
}

export async function engineSendText(args: SendTextArgs): Promise<{ whatsapp_message_id: string }> {
  return sendViaMeta({ ...args, kind: 'text' })
}

export async function engineSendTemplate(
  args: SendTemplateArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendViaMeta({ ...args, kind: 'template' })
}

interface SendInteractiveArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  payload: InteractiveMessagePayload
}

/**
 * Send an interactive (reply-buttons or list) message from the
 * automation engine.
 *
 * Delegates to the Flows interactive senders
 * (`engineSendInteractiveButtons` / `engineSendInteractiveList`), which
 * already own the account-scoped lookup, phone-variant retry, and the
 * `messages` insert with `interactive_payload` + `sender_type='bot'`.
 * Both engines want identical behaviour here, so there's one
 * implementation rather than a second hand-rolled copy that could drift.
 */
export async function engineSendInteractive(
  args: SendInteractiveArgs,
): Promise<{ whatsapp_message_id: string }> {
  const { payload, accountId, userId, conversationId, contactId } = args
  const common = { accountId, userId, conversationId, contactId }

  // Instagram/Facebook have no buttons/list message type — their
  // analogue is a flat set of quick-reply chips (max 13). Map both
  // WhatsApp payload shapes down to that flat option list rather than
  // failing the step: 'buttons' maps 1:1, 'list' flattens every row
  // across every section.
  const engineChannel = await resolveConversationChannel(supabaseAdmin(), conversationId)
  if (engineChannel === 'instagram' || engineChannel === 'facebook') {
    const options: QuickReplyOption[] =
      payload.kind === 'buttons'
        ? payload.buttons.map((b) => ({ title: b.title, payload: b.id }))
        : payload.sections.flatMap((s) => s.rows.map((r) => ({ title: r.title, payload: r.id })))
    return engineChannel === 'instagram'
      ? engineSendInstagramQuickReplies({ ...common, bodyText: payload.body, options })
      : engineSendFacebookQuickReplies({ ...common, bodyText: payload.body, options })
  }

  if (payload.kind === 'buttons') {
    return engineSendInteractiveButtons({
      ...common,
      bodyText: payload.body,
      headerText: payload.header,
      footerText: payload.footer,
      buttons: payload.buttons,
    })
  }
  return engineSendInteractiveList({
    ...common,
    bodyText: payload.body,
    buttonLabel: payload.button_label,
    headerText: payload.header,
    footerText: payload.footer,
    sections: payload.sections,
  })
}

type SendInput =
  | (SendTextArgs & { kind: 'text' })
  | (SendTemplateArgs & { kind: 'template' })

async function sendViaMeta(input: SendInput): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  // Instagram/Facebook conversations branch off here — templates are
  // a WhatsApp-only concept, so a template step targeting one of them
  // fails loudly rather than silently mis-sending.
  const engineChannel = await resolveConversationChannel(db, input.conversationId)
  if (engineChannel === 'instagram' || engineChannel === 'facebook') {
    if (input.kind === 'template') {
      throw new Error(
        `Message templates are a WhatsApp-only concept and are not supported for ${engineChannel} conversations.`,
      )
    }
    const textArgs = {
      accountId: input.accountId,
      userId: input.userId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      text: input.text,
    }
    return engineChannel === 'instagram' ? engineSendInstagramText(textArgs) : engineSendFacebookText(textArgs)
  }

  // Scope the contact + config lookups by account_id, not user_id.
  // The engine uses the service-role client (bypassing RLS); without
  // this filter, an authenticated user could fire their own
  // automations against another tenant's contact UUID and send via
  // their own WhatsApp config to that contact's phone. The 017
  // migration moved both tables to account-scoped tenancy, so the
  // check is the same defense-in-depth as before, just keyed on the
  // new tenancy column.
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

  const accessToken = config.provider !== 'zernio' ? decrypt(config.access_token) : ''

  // Local template row — read for the body we persist below, not for
  // the Meta payload (the wire shape is deliberately unchanged here).
  // A missing row is fine: the send still goes out, we just can't
  // reconstruct the text the customer saw.
  const templateRow =
    input.kind === 'template'
      ? (
          await resolveTemplateRow(
            db,
            input.accountId,
            input.templateName,
            input.language,
            config.id,
          )
        ).row
      : null

  // Zernio addresses a conversation by its own opaque id, not by
  // phone — no phone-variant concept here, same as send-message.ts's
  // identical branch.
  const attempt = async (phone: string): Promise<string> => {
    if (config.provider === 'zernio') {
      const zernioCtx: ZernioSendContext = {
        config: { zernio_api_key: config.zernio_api_key, zernio_account_id: config.zernio_account_id },
        zernioConversationId: await loadZernioConversationId(db, input.conversationId),
      }
      if (input.kind === 'template') {
        const r = await sendWhatsAppTemplateViaZernio(zernioCtx, {
          templateName: input.templateName,
          language: input.language || 'en_US',
          template: templateRow ?? undefined,
          params: input.params,
        })
        return r.messageId
      }
      const r = await sendWhatsAppTextViaZernio(zernioCtx, input.text)
      return r.messageId
    }
    if (input.kind === 'template') {
      const r = await sendTemplateMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        templateName: input.templateName,
        language: input.language,
        params: input.params,
      })
      return r.messageId
    }
    const r = await sendTextMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      text: input.text,
    })
    return r.messageId
  }

  // Same phone-variant retry as /api/whatsapp/send — Meta sandbox and
  // numbers registered with/without a trunk 0 both require this to
  // reliably land a message.
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

  // Persist the sent message so it appears in the inbox with a real
  // Meta message id. sender_type='bot' distinguishes automation sends
  // from manual agent sends.
  const content_type = input.kind === 'template' ? 'template' : 'text'
  // Templates persist the substituted body, same as the manual and
  // public-API send paths. This was unconditionally null, so every
  // automation template send rendered as an empty bubble (issue #483).
  const content_text =
    input.kind === 'text'
      ? input.text
      : templateContentText(templateRow, input.params ?? [])
  const template_name = input.kind === 'template' ? input.templateName : null

  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: input.conversationId,
    sender_type: 'bot',
    content_type,
    content_text,
    template_name,
    message_id: waMessageId,
    status: 'sent',
  })
  if (msgErr) {
    // Meta already has the message; record the DB error but don't pretend
    // the send failed. The engine wraps this in a log line.
    throw new Error(`sent to Meta but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text:
        input.kind === 'template'
          ? (content_text ?? `[template:${input.templateName}]`)
          : input.text,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.conversationId)

  return { whatsapp_message_id: waMessageId }
}
