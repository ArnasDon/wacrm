import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'

let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

export async function POST(request: Request) {
  try {
    const body = await request.json()

    // Evolution API sends { event: 'messages.upsert', instance: '...', data: { ... } }
    if (body.event === 'messages.upsert' && body.data) {
      await processEvolutionMessage(body.instance, body.data)
    }

    // Acknowledge receipt
    return NextResponse.json({ status: 'received' }, { status: 200 })
  } catch (error) {
    console.error('Error processing Evolution webhook:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function processEvolutionMessage(instanceName: string, data: any) {
  // If fromMe is true, it's a message sent by the user/bot, not inbound
  if (data.key?.fromMe) return

  const remoteJid = data.key?.remoteJid
  if (!remoteJid || remoteJid.includes('@g.us')) return // Ignore groups for now

  const phone = remoteJid.split('@')[0]
  const messageId = data.key?.id
  const pushName = data.pushName || phone

  // Extract text content from Baileys message object
  const messageObj = data.message
  if (!messageObj) return

  let contentText = null
  let contentType = 'text'

  if (messageObj.conversation) {
    contentText = messageObj.conversation
  } else if (messageObj.extendedTextMessage?.text) {
    contentText = messageObj.extendedTextMessage.text
  } else if (messageObj.imageMessage) {
    contentType = 'image'
    contentText = messageObj.imageMessage.caption || null
  } else if (messageObj.videoMessage) {
    contentType = 'video'
    contentText = messageObj.videoMessage.caption || null
  } else if (messageObj.documentMessage) {
    contentType = 'document'
    contentText = messageObj.documentMessage.caption || messageObj.documentMessage.fileName || null
  } else if (messageObj.audioMessage) {
    contentType = 'audio'
  } else if (messageObj.locationMessage) {
    contentType = 'location'
  } else if (messageObj.reactionMessage) {
    contentType = 'reaction'
    contentText = messageObj.reactionMessage.text || null
  }

  // Find the user config by instance name
  const { data: config, error: configError } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('user_id')
    .eq('evolution_instance_name', instanceName)
    .single()

  if (configError || !config) {
    console.error('No config found for Evolution instance:', instanceName)
    return
  }

  const userId = config.user_id
  const senderPhone = normalizePhone(phone)

  // Find or create contact
  const { findOrCreateContact } = await import('@/lib/whatsapp/contact-utils') // Assuming this is extracted or accessible. Wait, it's inside webhook route in Meta.
  // Actually, let's just inline or copy the findOrCreateContact logic here to avoid importing from webhook/route.ts
  
  const contactOutcome = await findOrCreateContactEvo(userId, senderPhone, pushName)
  if (!contactOutcome) return
  const contactRecord = contactOutcome.contact

  // Find or create conversation
  const conversation = await findOrCreateConversationEvo(userId, contactRecord.id)
  if (!conversation) return

  if (contentType === 'reaction') {
    // Basic reaction support
    return
  }

  // Insert message into DB
  const { error: msgError } = await supabaseAdmin().from('messages').insert({
    conversation_id: conversation.id,
    sender_type: 'customer',
    content_type: contentType,
    content_text: contentText,
    message_id: messageId,
    status: 'delivered',
    created_at: new Date().toISOString(),
  })

  if (msgError) {
    console.error('Error inserting Evolution message:', msgError)
    return
  }

  // Determine if it's first inbound
  const { count: priorCustomerMsgCount } = await supabaseAdmin()
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
  
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) <= 1 // including the one we just inserted

  // Update conversation
  await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: contentText || `[${contentType}]`,
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)

  // Dispatch to flows
  const flowResult = await dispatchInboundToFlows({
    userId,
    contactId: contactRecord.id,
    conversationId: conversation.id,
    message: {
      kind: 'text',
      text: contentText ?? '',
      meta_message_id: messageId,
    },
    isFirstInboundMessage,
  })

  // Automations
  const automationTriggers: any[] = []
  if (!flowResult.consumed) {
    automationTriggers.push('new_message_received', 'keyword_match')
  }
  if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created')
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')

  for (const triggerType of automationTriggers) {
    runAutomationsForTrigger({
      userId,
      triggerType,
      contactId: contactRecord.id,
      context: {
        message_text: contentText ?? '',
        conversation_id: conversation.id,
      },
    }).catch((err) => console.error('[automations evo] dispatch failed:', err))
  }
}

// Helpers copied from webhook/route.ts
async function findOrCreateContactEvo(userId: string, phone: string, name: string) {
  const db = supabaseAdmin()
  const { data: existing } = await db
    .from('contacts')
    .select('*')
    .eq('user_id', userId)
    .eq('phone', phone)
    .maybeSingle()

  if (existing) return { contact: existing, wasCreated: false }

  const { data: newContact, error } = await db
    .from('contacts')
    .insert({ user_id: userId, phone, name })
    .select()
    .single()

  if (error || !newContact) {
    console.error('Error creating contact:', error)
    return null
  }
  return { contact: newContact, wasCreated: true }
}

async function findOrCreateConversationEvo(userId: string, contactId: string) {
  const db = supabaseAdmin()
  const { data: existing } = await db
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .eq('status', 'open')
    .maybeSingle()

  if (existing) return existing

  const { data: newConv, error } = await db
    .from('conversations')
    .insert({ user_id: userId, contact_id: contactId, status: 'open', unread_count: 0 })
    .select()
    .single()

  if (error || !newConv) {
    console.error('Error creating conversation:', error)
    return null
  }
  return newConv
}
