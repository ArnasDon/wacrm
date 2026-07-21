import { sendText, sendImage, sendVideo, sendDocument } from '@/lib/whatsapp/zapi-api'
import { buildZapiCredentials } from '@/lib/whatsapp/zapi-config'
import {
  sanitizePhone,
  isValidE164,
} from '@/lib/whatsapp/phone-utils'
import { supabaseAdmin } from './admin-client'

interface SendTextEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  text: string
}

export async function engineSendText(
  args: SendTextEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }

  const sanitized = sanitizePhone(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  const { data: config, error: configErr } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', args.accountId)
    .single()
  if (configErr || !config) {
    throw new Error('WhatsApp not configured for this account')
  }

  const credentials = buildZapiCredentials(config)
  if (!credentials) {
    throw new Error('WhatsApp not configured for this account')
  }

  const result = await sendText({
    credentials,
    phone: sanitized,
    text: args.text,
  })
  const waMessageId = result.messageId

  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: 'text',
    content_text: args.text,
    message_id: waMessageId,
    status: 'sent',
  })
  if (msgErr) {
    throw new Error(`sent via Z-API but DB insert failed: ${msgErr.message}`)
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
  kind: 'image' | 'video' | 'document'
  link: string
  caption?: string
  filename?: string
}

export async function engineSendMedia(
  args: SendMediaEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }

  const sanitized = sanitizePhone(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  const { data: config, error: configErr } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', args.accountId)
    .single()
  if (configErr || !config) {
    throw new Error('WhatsApp not configured for this account')
  }

  const credentials = buildZapiCredentials(config)
  if (!credentials) {
    throw new Error('WhatsApp not configured for this account')
  }

  const sendFn =
    args.kind === 'image' ? sendImage :
    args.kind === 'video' ? sendVideo :
    sendDocument

  const result = await sendFn({
    credentials,
    phone: sanitized,
    url: args.link,
    ...(args.caption ? { caption: args.caption } : {}),
    ...(args.kind === 'document' && args.filename ? { filename: args.filename } : {}),
  } as Parameters<typeof sendFn>[0])
  const waMessageId = result.messageId

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
    throw new Error(`sent via Z-API but DB insert failed: ${msgErr.message}`)
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

interface InteractiveButton {
  id: string
  title: string
}

interface InteractiveListRow {
  id: string
  title: string
  description?: string
}

interface InteractiveListSection {
  title?: string
  rows: InteractiveListRow[]
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

function buttonsToText(
  bodyText: string,
  buttons: InteractiveButton[],
  headerText?: string,
  footerText?: string,
): string {
  const parts: string[] = []
  if (headerText) parts.push(headerText, '')
  parts.push(bodyText, '')
  buttons.forEach((b, i) => parts.push(`${i + 1}. ${b.title}`))
  if (footerText) parts.push('', footerText)
  return parts.join('\n')
}

function listToText(
  bodyText: string,
  sections: InteractiveListSection[],
  headerText?: string,
  footerText?: string,
): string {
  const parts: string[] = []
  if (headerText) parts.push(headerText, '')
  parts.push(bodyText, '')
  let counter = 1
  for (const section of sections) {
    if (section.title) parts.push(`*${section.title}*`)
    for (const row of section.rows) {
      parts.push(`${counter}. ${row.title}${row.description ? ` — ${row.description}` : ''}`)
      counter++
    }
  }
  if (footerText) parts.push('', footerText)
  return parts.join('\n')
}

export async function engineSendInteractiveButtons(
  args: SendInteractiveButtonsEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const text = buttonsToText(args.bodyText, args.buttons, args.headerText, args.footerText)
  return engineSendInteractive({ ...args, text, originalBody: args.bodyText })
}

export async function engineSendInteractiveList(
  args: SendInteractiveListEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const text = listToText(args.bodyText, args.sections, args.headerText, args.footerText)
  return engineSendInteractive({ ...args, text, originalBody: args.bodyText })
}

interface SendInteractiveArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  text: string
  originalBody: string
}

async function engineSendInteractive(
  args: SendInteractiveArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }

  const sanitized = sanitizePhone(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  const { data: config, error: configErr } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', args.accountId)
    .single()
  if (configErr || !config) {
    throw new Error('WhatsApp not configured for this account')
  }

  const credentials = buildZapiCredentials(config)
  if (!credentials) {
    throw new Error('WhatsApp not configured for this account')
  }

  const result = await sendText({
    credentials,
    phone: sanitized,
    text: args.text,
  })
  const waMessageId = result.messageId

  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: 'interactive',
    content_text: args.originalBody,
    message_id: waMessageId,
    status: 'sent',
  })
  if (msgErr) {
    throw new Error(`sent via Z-API but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text: args.originalBody,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)

  return { whatsapp_message_id: waMessageId }
}
