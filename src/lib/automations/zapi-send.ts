import { sendText } from '@/lib/whatsapp/zapi-api'
import { buildZapiCredentials } from '@/lib/whatsapp/zapi-config'
import {
  sanitizePhone,
  isValidE164,
} from '@/lib/whatsapp/phone-utils'
import { interpolateTemplateText } from '@/lib/whatsapp/template-send-builder'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'
import { supabaseAdmin } from './admin-client'

interface SendTextArgs {
  accountId: string
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
  return sendViaZapi({ ...args, kind: 'text' })
}

export async function engineSendTemplate(
  args: SendTemplateArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendViaZapi({ ...args, kind: 'template' })
}

export async function engineSendInteractive(args: {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  payload: InteractiveMessagePayload
}): Promise<{ whatsapp_message_id: string }> {
  return sendViaZapi({
    ...args,
    kind: 'text',
    text: interactivePayloadToText(args.payload),
  })
}

function interactivePayloadToText(payload: InteractiveMessagePayload): string {
  const parts: string[] = []
  if (payload.header) parts.push(payload.header, '')
  parts.push(payload.body, '')

  if (payload.kind === 'buttons') {
    payload.buttons.forEach((button, index) => {
      parts.push(`${index + 1}. ${button.title}`)
    })
  } else {
    let counter = 1
    for (const section of payload.sections) {
      if (section.title) parts.push(`*${section.title}*`)
      for (const row of section.rows) {
        parts.push(
          `${counter}. ${row.title}${row.description ? ` - ${row.description}` : ''}`,
        )
        counter++
      }
    }
  }

  if (payload.footer) parts.push('', payload.footer)
  return parts.join('\n')
}

type SendInput =
  | (SendTextArgs & { kind: 'text' })
  | (SendTemplateArgs & { kind: 'template' })

async function sendViaZapi(input: SendInput): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', input.contactId)
    .eq('account_id', input.accountId)
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
    .eq('account_id', input.accountId)
    .single()
  if (configErr || !config) {
    throw new Error('WhatsApp not configured for this account')
  }

  const credentials = buildZapiCredentials(config)
  if (!credentials) {
    throw new Error('WhatsApp not configured for this account')
  }

  let resolvedText: string
  if (input.kind === 'template') {
    const { data: rawTemplate } = await db
      .from('message_templates')
      .select('*')
      .eq('account_id', input.accountId)
      .eq('name', input.templateName)
      .eq('language', input.language || 'en_US')
      .maybeSingle()
    const bodyText =
      rawTemplate && isMessageTemplate(rawTemplate)
        ? rawTemplate.body_text
        : input.templateName
    resolvedText = interpolateTemplateText(bodyText, input.params || [])
  } else {
    resolvedText = input.text
  }

  const result = await sendText({
    credentials,
    phone: sanitized,
    text: resolvedText,
  })
  const waMessageId = result.messageId

  const content_type = input.kind === 'template' ? 'template' : 'text'
  const content_text = input.kind === 'text' ? input.text : resolvedText
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
    throw new Error(`sent via Z-API but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text:
        input.kind === 'template' ? resolvedText : input.text,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.conversationId)

  return { whatsapp_message_id: waMessageId }
}
