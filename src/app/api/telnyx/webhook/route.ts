import { NextResponse, type NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/telnyx/admin-client'
import { verifyTelnyxWebhook } from '@/lib/telnyx/webhook-signature'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'

// ============================================================
// Telnyx webhook (Fase 1). Sin auth (firma Ed25519 ANTES de DB).
// Bookkeeping best-effort de calls + missed_call + SMS inbound.
//
// Tenancy: se resuelve por `connection_id` → telnyx_config.call_control_app_id
// (voz) o por el número → default_from_number (SMS). Webhooks desconocidos
// se ignoran y se ackean (200) para no provocar reintentos de Telnyx.
// ============================================================

export const runtime = 'nodejs'
export const maxDuration = 30

type Admin = ReturnType<typeof supabaseAdmin>

interface Payload {
  call_control_id?: string
  call_leg_id?: string
  call_session_id?: string
  direction?: string
  connection_id?: string
  hangup_cause?: string
  call_status?: string
  from?: unknown
  to?: unknown
  [k: string]: unknown
}

/** Telnyx envía from/to como objetos `{ phone_number }` (a veces string). */
function numStr(v: unknown): string {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') {
    const o = v as { phone_number?: unknown }
    if (typeof o.phone_number === 'string') return o.phone_number
  }
  return ''
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  const v = verifyTelnyxWebhook(
    req.headers.get('telnyx-timestamp'),
    req.headers.get('telnyx-signature-ed25519'),
    rawBody,
  )
  if (!v.ok) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 403 })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'bad body' }, { status: 400 })
  }

  const event = (parsed as { data?: { event_type?: string; payload?: Payload } })?.data
  const eventType = event?.event_type ?? ''
  const p = event?.payload ?? {}
  const admin = supabaseAdmin()

  const accountId = await resolveAccountId(
    admin,
    typeof p.connection_id === 'string' ? p.connection_id : undefined,
    numStr(p.to) || numStr(p.from),
  )
  if (!accountId) {
    console.warn('[telnyx:webhook] unknown account, ignoring', eventType)
    return NextResponse.json({ ok: true })
  }

  try {
    if (eventType === 'call.initiated') await onCallInitiated(admin, accountId, p)
    else if (eventType === 'call.answered') await onCallAnswered(admin, accountId, p)
    else if (eventType === 'call.hangup') await onCallHangup(admin, accountId, p)
    else if (eventType === 'message.received') await onMessageReceived(admin, accountId, p)
    // Otros eventos (call.machine.*, recording.*) se ignoran en Fase 1.
  } catch (err) {
    console.error('[telnyx:webhook] handler error:', eventType, err)
  }

  return NextResponse.json({ ok: true })
}

// ------------------------------------------------------------
// Tenancy
// ------------------------------------------------------------

async function resolveAccountId(
  admin: Admin,
  connectionId: string | undefined,
  number: string,
): Promise<string | null> {
  if (connectionId) {
    const { data } = await admin
      .from('telnyx_config')
      .select('account_id')
      .eq('call_control_app_id', connectionId)
      .maybeSingle()
    if (data) return data.account_id
  }
  if (number) {
    const { data } = await admin
      .from('telnyx_config')
      .select('account_id')
      .eq('default_from_number', number)
      .maybeSingle()
    if (data) return data.account_id
  }
  return null
}

// ------------------------------------------------------------
// Call lifecycle (máquina de estados §3.2)
// ------------------------------------------------------------

async function onCallInitiated(admin: Admin, accountId: string, p: Payload) {
  const ctrl = p.call_control_id
  if (!ctrl) return
  // Insert dedup manual: la reentrega de Telnyx no debe duplicar la fila.
  // (un upsert con onConflict era frágil de tipar en el cliente untyped;
  // la carrera de doble entrega simultánea es aceptable best-effort.)
  const { data: existing } = await admin
    .from('calls')
    .select('id')
    .eq('telnyx_call_control_id', ctrl)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!existing) {
    // Inbound: resolver contact_id desde el número llamante para que la
    // lista de llamadas del sidebar (contact_id) muestre el historial real.
    const contact =
      p.direction !== 'outbound' ? await findContactByPhone(admin, accountId, numStr(p.from)) : null
    await admin.from('calls').insert({
      account_id: accountId,
      contact_id: contact?.id ?? null,
      direction: p.direction === 'outbound' ? 'outbound' : 'inbound',
      status: 'initiated',
      from_number: numStr(p.from),
      to_number: numStr(p.to),
      telnyx_call_control_id: ctrl,
      telnyx_call_leg_id: p.call_leg_id ?? null,
      telnyx_call_session_id: p.call_session_id ?? null,
    })
  }
  // La señal de "ringing" llega como segundo event por el mismo leg.
  await admin
    .from('calls')
    .update({ status: 'ringing' })
    .eq('telnyx_call_control_id', ctrl)
    .eq('account_id', accountId)
}

async function onCallAnswered(admin: Admin, accountId: string, p: Payload) {
  const ctrl = p.call_control_id
  if (!ctrl) return
  await admin
    .from('calls')
    .update({ status: 'answered', answered_at: new Date().toISOString() })
    .eq('telnyx_call_control_id', ctrl)
    .eq('account_id', accountId)
}

async function onCallHangup(admin: Admin, accountId: string, p: Payload) {
  const ctrl = p.call_control_id
  if (!ctrl) return

  const durationSec =
    typeof p.call_duration === 'number'
      ? p.call_duration
      : null

  const { data: cur } = await admin
    .from('calls')
    .select('disposition')
    .eq('telnyx_call_control_id', ctrl)
    .eq('account_id', accountId)
    .maybeSingle()

  const isMissed = isMissedInbound(p)
  const alreadyMissed = cur?.disposition === 'missed'

  await admin
    .from('calls')
    .update({
      status: 'ended',
      ended_at: new Date().toISOString(),
      duration_sec: durationSec,
      hangup_cause: (p.hangup_cause as string) ?? null,
      disposition: isMissed ? 'missed' : (cur?.disposition ?? null),
    })
    .eq('telnyx_call_control_id', ctrl)
    .eq('account_id', accountId)

  if (isMissed && !alreadyMissed) {
    await dispatchMissed(admin, accountId, ctrl, p)
  }
  // Anti-486: en Fase 1 (forwarding nativo) cada leg es un call_control_id
  // distinto y el webhook no conoce el de la leg opuesta de forma fiable;
  // colgar la leg 2 (softphone) se hace client-side en Fase 2 (§3.3).
}

/** Criterio ÚNICO de missed (§3.4): inbound + leg del agente que no contestó. */
function isMissedInbound(p: Payload): boolean {
  if (p.direction !== 'inbound') return false
  const cause = p.hangup_cause as string | undefined
  if (!cause || !['no_answer', 'user_busy', 'normal'].includes(cause)) return false
  // En forwarding nativo, el leg que importa es el del celular del operador.
  if (p.hangup_leg && p.hangup_leg !== 'agent') return false
  return true
}

async function dispatchMissed(admin: Admin, accountId: string, callId: string, p: Payload) {
  const caller = numStr(p.from)
  const found = await findContactByPhone(admin, accountId, caller)
  await runAutomationsForTrigger({
    accountId,
    triggerType: 'missed_call',
    contactId: found?.id ?? null,
    context: {
      call_id: p.call_session_id ?? callId,
      call_direction: 'inbound',
      call_hangup_cause: (p.hangup_cause as string) ?? undefined,
      missed_call_number: caller || undefined,
    },
  }).catch((err) => console.error('[automations] missed_call dispatch failed:', err))
}

/** Colgar la leg opuesta está out of scope en Fase 1 (ver onCallHangup). */

// ------------------------------------------------------------
// SMS inbound (channel='sms', migración 041)
// ------------------------------------------------------------

async function onMessageReceived(admin: Admin, accountId: string, p: Payload) {
  const from = numStr(p.from)
  if (!from) return

  let contactId: string | null = null
  const found = await findContactByPhone(admin, accountId, from)
  if (found) {
    contactId = found.id
  } else {
    const { data: inserted } = await admin
      .from('contacts')
      .insert({ account_id: accountId, phone: from, name: null })
      .select('id')
      .single()
    contactId = inserted?.id ?? null
  }
  if (!contactId) return

  const conversation = await findOrCreateConversation(admin, accountId, contactId)

  const text = (p.text as string) ?? ''
  const telnyxMsgId = (p.id as string) ?? (p.message_id as string) ?? `${from}:${Date.now()}`

  const { error } = await admin.from('messages').insert({
    conversation_id: conversation.id,
    sender_type: 'customer',
    content_type: 'text',
    content_text: text,
    channel: 'sms',
    status: 'delivered',
    metadata: { telnyx_message_id: telnyxMsgId },
    created_at: new Date().toISOString(),
  })
  if (error) {
    console.error('[telnyx:webhook] sms insert failed:', error)
    return
  }

  await admin.from('conversations').update({
    last_message_text: text,
    last_message_at: new Date().toISOString(),
  }).eq('id', conversation.id)
}

async function findContactByPhone(
  admin: Admin,
  accountId: string,
  phone: string,
): Promise<{ id: string } | null> {
  if (!phone) return null
  const { data } = await admin
    .from('contacts')
    .select('id')
    .eq('account_id', accountId)
    .eq('phone_normalized', normalizePhone(phone))
    .maybeSingle()
  return data
}

async function findOrCreateConversation(
  admin: Admin,
  accountId: string,
  contactId: string,
): Promise<{ id: string }> {
  const { data: existing } = await admin
    .from('conversations')
    .select('id')
    .eq('contact_id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (existing) return existing
  const { data: created } = await admin
    .from('conversations')
    .insert({ contact_id: contactId, account_id: accountId, status: 'open' })
    .select('id')
    .single()
  return created ?? { id: '' }
}