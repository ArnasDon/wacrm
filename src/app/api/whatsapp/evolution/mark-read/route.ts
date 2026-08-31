// ============================================================
// POST /api/whatsapp/evolution/mark-read
//
// Sends the WhatsApp read receipt (blue double-check, shown to the
// customer) for a conversation's inbound messages — called when an
// agent actually opens the thread in wacrm. Evolution Go's instance-
// level `readMessages` auto-ack is disabled (see evolution-api.ts's
// ADVANCED_SETTINGS) specifically so this explicit, human-triggered
// call is the only thing that marks messages read, instead of it
// happening the instant a message reaches this server.
//
// No-op (200, `{ skipped: true }`) for a Meta-provider account — this
// route only exists for Evolution Go's read-receipt model.
// ============================================================

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { markMessagesRead } from '@/lib/whatsapp/evolution-api'
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent')

    const body = await request.json().catch(() => null)
    const conversationId = body?.conversation_id
    if (typeof conversationId !== 'string' || !conversationId) {
      return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 })
    }

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('provider, evolution_api_url, evolution_instance_token')
      .eq('account_id', accountId)
      .maybeSingle()

    if (!config || config.provider !== 'evolution') {
      return NextResponse.json({ skipped: true })
    }

    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, contact:contacts(phone)')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (convError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    const phone = (conversation as { contact?: { phone?: string } | null }).contact?.phone
    if (!phone) {
      return NextResponse.json({ skipped: true })
    }

    // Recent customer messages only — anything older was either already
    // seen by the customer's own client in a prior session or, before
    // this fix shipped, already auto-acked by Evolution Go. Re-sending a
    // receipt for an already-read message is a harmless no-op on
    // WhatsApp's side, so this doesn't need to track which ids were
    // marked before.
    const { data: rows, error: msgError } = await supabase
      .from('messages')
      .select('message_id')
      .eq('conversation_id', conversationId)
      .eq('sender_type', 'customer')
      .not('message_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100)

    if (msgError) {
      console.error('[evolution mark-read] message lookup failed:', msgError)
      return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 })
    }

    const messageIds = (rows ?? [])
      .map((r) => r.message_id as string | null)
      .filter((id): id is string => Boolean(id))
    if (messageIds.length === 0) {
      return NextResponse.json({ skipped: true })
    }

    const apiUrl = config.evolution_api_url as string
    const instanceToken = decrypt(config.evolution_instance_token as string)

    await markMessagesRead({
      apiUrl,
      instanceToken,
      number: sanitizePhoneForMeta(phone),
      messageIds,
    })

    console.log(
      `[evolution mark-read] sent read receipt for ${messageIds.length} message(s), conversation ${conversationId}`
    )
    return NextResponse.json({ success: true, marked: messageIds.length })
  } catch (err) {
    return toErrorResponse(err)
  }
}
