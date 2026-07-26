import { sendText, sendImage, sendVideo, sendDocument } from '@/lib/whatsapp/zapi-api'
import { buildZapiCredentials } from '@/lib/whatsapp/zapi-config'
import { sanitizePhone, isValidE164 } from '@/lib/whatsapp/phone-utils'
import { supabaseAdmin } from './admin-client'
import { CommittedSideEffectError, NonRetryableExecutionError } from './execution-policy'

export interface CommittedOutboundPersistence {
  conversationId: string
  messageId: string
  contentType: 'text' | 'image' | 'video' | 'document' | 'interactive'
  contentText: string | null
  conversationPreview: string
}

export async function persistCommittedOutbound(
  db: ReturnType<typeof supabaseAdmin>,
  outbound: CommittedOutboundPersistence
): Promise<void> {
  let persistenceStage = 'message_insert'
  try {
    const { error: messageError } = await db.from('messages').insert({
      conversation_id: outbound.conversationId,
      sender_type: 'bot',
      content_type: outbound.contentType,
      content_text: outbound.contentText,
      message_id: outbound.messageId,
      status: 'sent',
    })
    if (messageError) {
      if ((messageError as { code?: string }).code !== '23505') {
        throw messageError
      }
      const { data: existing, error: existingError } = await db
        .from('messages')
        .select('id')
        .eq('message_id', outbound.messageId)
        .eq('conversation_id', outbound.conversationId)
        .maybeSingle()
      if (existingError || !existing) throw messageError
    }

    persistenceStage = 'conversation_update'
    const now = new Date().toISOString()
    const { error: conversationError } = await db
      .from('conversations')
      .update({
        last_message_text: outbound.conversationPreview,
        last_message_at: now,
        updated_at: now,
      })
      .eq('id', outbound.conversationId)
    if (conversationError) throw conversationError
  } catch (error) {
    throw new CommittedSideEffectError(`Z-API message was sent but local ${persistenceStage} failed`, {
      externalReference: outbound.messageId,
      persistenceStage,
      cause: error,
    })
  }
}

type RemoteCommittedCallback = (result: {
  whatsapp_message_id: string
}) => Promise<void>

interface SendTextEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  text: string
  signal?: AbortSignal
  onRemoteCommitted?: RemoteCommittedCallback
}

export async function engineSendText(args: SendTextEngineArgs): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new NonRetryableExecutionError('contact not found for this account')
  }

  const sanitized = sanitizePhone(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new NonRetryableExecutionError('contact phone is invalid')
  }

  const { data: config, error: configErr } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', args.accountId)
    .single()
  if (configErr || !config) {
    throw new NonRetryableExecutionError('WhatsApp not configured for this account')
  }

  const credentials = buildZapiCredentials(config)
  if (!credentials) {
    throw new NonRetryableExecutionError('WhatsApp not configured for this account')
  }

  const result = await sendText({
    credentials,
    phone: sanitized,
    text: args.text,
    signal: args.signal,
  })
  const waMessageId = result.messageId
  await args.onRemoteCommitted?.({ whatsapp_message_id: waMessageId })

  await persistCommittedOutbound(db, {
    conversationId: args.conversationId,
    messageId: waMessageId,
    contentType: 'text',
    contentText: args.text,
    conversationPreview: args.text,
  })

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
  signal?: AbortSignal
  onRemoteCommitted?: RemoteCommittedCallback
}

export async function engineSendMedia(args: SendMediaEngineArgs): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new NonRetryableExecutionError('contact not found for this account')
  }

  const sanitized = sanitizePhone(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new NonRetryableExecutionError('contact phone is invalid')
  }

  const { data: config, error: configErr } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', args.accountId)
    .single()
  if (configErr || !config) {
    throw new NonRetryableExecutionError('WhatsApp not configured for this account')
  }

  const credentials = buildZapiCredentials(config)
  if (!credentials) {
    throw new NonRetryableExecutionError('WhatsApp not configured for this account')
  }

  const sendFn = args.kind === 'image' ? sendImage : args.kind === 'video' ? sendVideo : sendDocument

  const result = await sendFn({
    credentials,
    phone: sanitized,
    url: args.link,
    ...(args.caption ? { caption: args.caption } : {}),
    ...(args.kind === 'document' && args.filename ? { filename: args.filename } : {}),
    signal: args.signal,
  } as Parameters<typeof sendFn>[0])
  const waMessageId = result.messageId
  await args.onRemoteCommitted?.({ whatsapp_message_id: waMessageId })

  const preview = args.caption?.trim() || `[${args.kind}]`
  await persistCommittedOutbound(db, {
    conversationId: args.conversationId,
    messageId: waMessageId,
    contentType: args.kind,
    contentText: args.caption ?? null,
    conversationPreview: preview,
  })

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
  signal?: AbortSignal
  onRemoteCommitted?: RemoteCommittedCallback
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
  signal?: AbortSignal
  onRemoteCommitted?: RemoteCommittedCallback
}

function buttonsToText(
  bodyText: string,
  buttons: InteractiveButton[],
  headerText?: string,
  footerText?: string
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
  footerText?: string
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
  args: SendInteractiveButtonsEngineArgs
): Promise<{ whatsapp_message_id: string }> {
  const text = buttonsToText(args.bodyText, args.buttons, args.headerText, args.footerText)
  return engineSendInteractive({ ...args, text, originalBody: args.bodyText })
}

export async function engineSendInteractiveList(
  args: SendInteractiveListEngineArgs
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
  signal?: AbortSignal
  onRemoteCommitted?: RemoteCommittedCallback
}

async function engineSendInteractive(args: SendInteractiveArgs): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new NonRetryableExecutionError('contact not found for this account')
  }

  const sanitized = sanitizePhone(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new NonRetryableExecutionError('contact phone is invalid')
  }

  const { data: config, error: configErr } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', args.accountId)
    .single()
  if (configErr || !config) {
    throw new NonRetryableExecutionError('WhatsApp not configured for this account')
  }

  const credentials = buildZapiCredentials(config)
  if (!credentials) {
    throw new NonRetryableExecutionError('WhatsApp not configured for this account')
  }

  const result = await sendText({
    credentials,
    phone: sanitized,
    text: args.text,
    signal: args.signal,
  })
  const waMessageId = result.messageId
  await args.onRemoteCommitted?.({ whatsapp_message_id: waMessageId })

  await persistCommittedOutbound(db, {
    conversationId: args.conversationId,
    messageId: waMessageId,
    contentType: 'interactive',
    contentText: args.originalBody,
    conversationPreview: args.originalBody,
  })

  return { whatsapp_message_id: waMessageId }
}
