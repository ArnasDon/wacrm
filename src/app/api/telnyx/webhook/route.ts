import { NextResponse, type NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/telnyx/admin-client'
import { verifyTelnyxWebhook } from '@/lib/telnyx/webhook-signature'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { buildMediaPath } from '@/lib/storage/upload-media'
import { createTelnyxClient, loadTelnyxInboundConfig } from '@/lib/telnyx/api'

// ============================================================
// Telnyx webhook. Sin auth (firma Ed25519 ANTES de DB).
// Contabilidad de `calls` + missed_call + SMS inbound, MÁS el control de
// llamada del entrante (patrón de dos patas, migración 057).
//
// Tenancy: se resuelve por `connection_id` → telnyx_config.call_control_app_id
// (pata A, entra por la Call Control App) o credential_connection_id (pata B,
// que se crea sobre la conexión de credenciales), o por el número →
// default_from_number (SMS). Webhooks desconocidos se ignoran y se ackean
// (200) para no provocar reintentos de Telnyx.
//
// ── Entrante: las tres transiciones ──────────────────────────
//
//   call.initiated  direction=incoming  → answer sobre la pata A,
//                                         client_state {leg:'pstn'}
//   call.answered   client_state.leg='pstn'   → POST /v2/calls hacia
//                                         agent_sip_uri con
//                                         credential_connection_id →
//                                         pata B, client_state
//                                         {leg:'webrtc', peer:<pata A>}
//   call.answered   client_state.leg='webrtc' → bridge pata B ↔ pata A
//   call.hangup                          → cuelga la pata huérfana
//
// El emparejamiento viaja en el `client_state`, que Telnyx devuelve íntegro
// en cada evento: nunca en un Map en memoria, que se rompería al reiniciar
// el proceso o con más de una instancia. La pata A se contesta antes de que
// exista la pata B, así que su client_state no puede nombrarla — esa
// dirección se guarda en `calls.bridge_peer_control_id` (057), que también
// sobrevive a reinicios.
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
  client_state?: string
  from?: unknown
  to?: unknown
  recording_urls?: { mp3?: string; wav?: string } | unknown
  [k: string]: unknown
}

// ------------------------------------------------------------
// client_state — el emparejamiento de patas
//
// Telnyx acepta un base64 arbitrario al contestar o al crear una llamada y
// lo devuelve tal cual en todos los eventos de esa pata. Es lo que permite
// saber, al recibir `call.answered`, cuál de las dos contestó: sin él las
// dos son indistinguibles y el puente se hace al revés o no se hace.
// ------------------------------------------------------------

type LegRole = 'pstn' | 'webrtc'

interface LegState {
  /** Versión del sobre, por si el formato cambia con llamadas en vuelo. */
  v: 1
  leg: LegRole
  /** call_control_id de la otra pata. Solo lo lleva la pata B. */
  peer?: string
}

function encodeLegState(state: LegState): string {
  return Buffer.from(JSON.stringify(state)).toString('base64')
}

function decodeLegState(encoded?: string): LegState | null {
  if (!encoded) return null
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64').toString()) as LegState
    return parsed?.leg === 'pstn' || parsed?.leg === 'webrtc' ? parsed : null
  } catch {
    return null
  }
}

/**
 * Los eventos de la pata B llegan por la conexión de credenciales, no por la
 * Call Control App, así que hay que decirle a Telnyx explícitamente que los
 * mande al mismo endpoint. Si no, `call.answered` de la pata B nunca llega y
 * el bridge no ocurre nunca.
 */
function webhookUrl(): string | undefined {
  const base = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL
  return base ? `${base.replace(/\/$/, '')}/api/telnyx/webhook` : undefined
}

/**
 * Telnyx envía from/to como objetos `{ phone_number }` (a veces string),
 * pero en `message.received` el campo `to` es un ARRAY de destinatarios
 * `[{ phone_number }]` (doc oficial Message Object, verificado context7).
 * Se maneja la rama array ANTES del objeto para no romper la tenancy por
 * número (el SMS entrante se ignoraría si `to` cae a string vacío).
 */
function numStr(v: unknown): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) {
    const first = v[0]
    if (first === undefined) return ''
    return numStr(first)
  }
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
    else if (eventType === 'call.recording.saved') await onRecordingSaved(admin, accountId, p)
    // Otros eventos (call.machine.*, etc.) se ignoran.
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

    // La pata B se crea sobre la conexión de credenciales, así que sus
    // eventos traen ESE connection_id. Sin este segundo lookup se
    // descartarían como "unknown account" y el bridge nunca se haría.
    const { data: byCredential } = await admin
      .from('telnyx_config')
      .select('account_id')
      .eq('credential_connection_id', connectionId)
      .maybeSingle()
    if (byCredential) return byCredential.account_id
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
  // Upsert atómico sobre telnyx_call_control_id (UNIQUE constraint
  // calls_telnyx_call_control_id_key, verificada en schema). Antes era un
  // select+insert manual: dos reentregas simultáneas de Telnyx podían
  // insertar filas duplicadas (race). on_conflict no-op si ya existe →
  // la reentrega nunca duplica; a lo sumo la fila ya iniciada gana.
  const contact =
    p.direction !== 'outbound'
      ? await findContactByPhone(admin, accountId, numStr(p.from))
      : null
  await admin
    .from('calls')
    .upsert(
      {
        account_id: accountId,
        contact_id: contact?.id ?? null,
        direction: p.direction === 'outbound' ? 'outbound' : 'inbound',
        status: 'initiated',
        from_number: numStr(p.from),
        to_number: numStr(p.to),
        telnyx_call_control_id: ctrl,
        telnyx_call_leg_id: p.call_leg_id ?? null,
        telnyx_call_session_id: p.call_session_id ?? null,
      },
      { onConflict: 'telnyx_call_control_id', ignoreDuplicates: true },
    )
  // La señal de "ringing" llega como segundo event por el mismo leg.
  await admin
    .from('calls')
    .update({ status: 'ringing' })
    .eq('telnyx_call_control_id', ctrl)
    .eq('account_id', accountId)

  // ── Control de llamada: contestar la pata A ──────────────
  // Solo el entrante de verdad. La pata B que creamos nosotros es
  // `outgoing` para Telnyx, así que no entra por aquí y no se contesta
  // sola — la contesta el navegador.
  if (p.direction !== 'incoming') return
  if (decodeLegState(p.client_state)) return // ya marcada: reentrega

  const cfg = await loadTelnyxInboundConfig(accountId)
  if (!cfg?.credentialConnectionId || !cfg.agentSipUri) {
    // Entrante sin configurar: se queda en contabilidad, como antes.
    return
  }

  await admin
    .from('calls')
    .update({ leg_role: 'pstn' })
    .eq('telnyx_call_control_id', ctrl)
    .eq('account_id', accountId)

  await createTelnyxClient(cfg.apiKey).answerCall(
    ctrl,
    encodeLegState({ v: 1, leg: 'pstn' }),
  )
}

async function onCallAnswered(admin: Admin, accountId: string, p: Payload) {
  const ctrl = p.call_control_id
  if (!ctrl) return
  await admin
    .from('calls')
    .update({ status: 'answered', answered_at: new Date().toISOString() })
    .eq('telnyx_call_control_id', ctrl)
    .eq('account_id', accountId)

  const state = decodeLegState(p.client_state)
  if (!state) return // llamada saliente normal: nada que puentear

  const cfg = await loadTelnyxInboundConfig(accountId)
  if (!cfg) return
  const client = createTelnyxClient(cfg.apiKey)

  // ── Pata A contestada → crear la pata B hacia el softphone ──
  if (state.leg === 'pstn') {
    if (!cfg.credentialConnectionId || !cfg.agentSipUri) return

    const legB = await client.dial({
      to: cfg.agentSipUri,
      // El DID como caller id, y quién llama de verdad en el display.
      from: numStr(p.to),
      fromDisplayName: numStr(p.from) || undefined,
      // ESTE es el punto del 486: la pata B va sobre la conexión de
      // credenciales (la que autentica al softphone), NO sobre la Call
      // Control App. La CCA no sabe enrutar a registros SIP y el SIP
      // responde ocupado.
      connectionId: cfg.credentialConnectionId,
      webhookUrl: webhookUrl(),
      timeoutSecs: 30,
      clientState: encodeLegState({ v: 1, leg: 'webrtc', peer: ctrl }),
    })

    // La pata B queda registrada en `calls` como cualquier otra llamada, y
    // el emparejamiento se guarda en las dos direcciones: la pata B lleva a
    // la A en su client_state, y la A apunta a la B aquí — que es lo que
    // permite colgar la pata huérfana si quien llama cuelga mientras el
    // navegador todavía suena.
    await admin.from('calls').upsert(
      {
        account_id: accountId,
        direction: 'outbound',
        status: 'initiated',
        from_number: numStr(p.to),
        to_number: cfg.agentSipUri,
        telnyx_call_control_id: legB.callControlId,
        telnyx_call_leg_id: legB.callLegId,
        telnyx_call_session_id: legB.callSessionId,
        leg_role: 'webrtc',
        bridge_peer_control_id: ctrl,
      },
      { onConflict: 'telnyx_call_control_id', ignoreDuplicates: true },
    )

    await admin
      .from('calls')
      .update({ bridge_peer_control_id: legB.callControlId })
      .eq('telnyx_call_control_id', ctrl)
      .eq('account_id', accountId)

    return
  }

  // ── Pata B contestada (el navegador cogió) → unir las dos ──
  if (state.leg === 'webrtc' && state.peer) {
    await client.bridgeCalls(ctrl, state.peer)
  }
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

  await hangupOrphanLeg(admin, accountId, ctrl, p)
}

/**
 * Anti-486. Cuando una pata cuelga, la otra tiene que morir con ella.
 *
 * Si ya estaban puenteadas Telnyx suele cerrar las dos, pero el caso que de
 * verdad deja el registro SIP ocupado es el otro: quien llama cuelga
 * mientras el navegador todavía está sonando. Ahí la pata B se queda viva,
 * el softphone sigue "en llamada" y la siguiente entrante recibe 486
 * `user_busy`. Colgarla explícitamente es lo que hace que la tercera
 * llamada seguida entre igual que la primera.
 *
 * La pareja sale del client_state (pata B → pata A) o de
 * `calls.bridge_peer_control_id` (pata A → pata B, migración 057). Nunca de
 * un Map en memoria.
 */
async function hangupOrphanLeg(
  admin: Admin,
  accountId: string,
  ctrl: string,
  p: Payload,
) {
  const state = decodeLegState(p.client_state)

  let peer = state?.peer ?? null
  if (!peer) {
    const { data: row } = await admin
      .from('calls')
      .select('bridge_peer_control_id')
      .eq('telnyx_call_control_id', ctrl)
      .eq('account_id', accountId)
      .maybeSingle()
    peer = row?.bridge_peer_control_id ?? null
  }
  if (!peer) return

  // Si la otra pata ya terminó, no hay nada que colgar — y evitamos un 422
  // de Telnyx por actuar sobre una llamada muerta.
  const { data: peerRow } = await admin
    .from('calls')
    .select('status')
    .eq('telnyx_call_control_id', peer)
    .eq('account_id', accountId)
    .maybeSingle()
  if (peerRow?.status === 'ended') return

  const cfg = await loadTelnyxInboundConfig(accountId)
  if (!cfg) return

  try {
    await createTelnyxClient(cfg.apiKey).hangupCall(peer)
  } catch (err) {
    // Carrera normal: Telnyx ya la había colgado. No es un fallo.
    console.warn('[telnyx:webhook] hangup de la pata pareja falló (probablemente ya colgada):', err)
  }
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


// ------------------------------------------------------------
// Grabaciones (Fase 2, DAD §2.4 / call.recording.saved)
// Descarga el mp3 de la URL temporal de Telnyx, lo sube al bucket
// privado `call-recordings` (service-role, sin RLS de cliente) con el
// path account-scoped de `buildMediaPath`, y guarda en `calls`:
//   recording_storage_path = path en storage
//   recording_url          = URL del proxy autenticado
//                            GET /api/telnyx/recordings/[callId]
// ------------------------------------------------------------

async function onRecordingSaved(admin: Admin, accountId: string, p: Payload) {
  const urls = p.recording_urls as { mp3?: string } | undefined
  const mp3 = urls?.mp3
  if (!mp3) {
    console.warn('[telnyx:webhook] call.recording.saved sin mp3, ignorado')
    return
  }

  // SSRF guard: Telnyx firma la URL de media en el payload del webhook,
  // pero el webhook puede apuntar a cualquier host si el payload fuera
  // manipulado. Solo descargamos desde https: sobre el dominio oficial de
  // grabaciones de Telnyx (media-cdn.telnyx.com / recordings.telnyx.com).
  // Además limitamos el tamaño para evitar un DoS por un archivo enorme.
  const URL_MAX_MP3_BYTES = 200 * 1024 * 1024 // 200 MB (línea defensiva)
  const TELNYX_MEDIA_HOSTS = new Set([
    'media-cdn.telnyx.com',
    'recordings.telnyx.com',
  ])
  let mp3Url: URL | null = null
  try {
    mp3Url = new URL(mp3)
  } catch {
    console.warn('[telnyx:webhook] recording URL no válida, ignorado')
    return
  }
  if (
    mp3Url.protocol !== 'https:' ||
    !TELNYX_MEDIA_HOSTS.has(mp3Url.hostname)
  ) {
    console.warn(
      `[telnyx:webhook] recording URL host no permitido: ${mp3Url.hostname}, ignorado`,
    )
    return
  }

  // Matchear la fila de calls por leg/session/control id (el payload de
  // Telnyx no trae el id de nuestra fila).
  const legId = p.call_leg_id ?? null
  const sessionId = p.call_session_id ?? null
  const ctrlId = p.call_control_id ?? null

  const lookup = legId
    ? { col: 'telnyx_call_leg_id' as const, val: legId }
    : sessionId
      ? { col: 'telnyx_call_session_id' as const, val: sessionId }
      : ctrlId
        ? { col: 'telnyx_call_control_id' as const, val: ctrlId }
        : null
  if (!lookup) return

  const { data: callRow } = await admin
    .from('calls')
    .select('id')
    .eq(lookup.col, lookup.val)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!callRow?.id) {
    console.warn('[telnyx:webhook] call.recording.saved sin fila calls, ignorado')
    return
  }

  // Descargar el mp3 (URL temporal firmada de Telnyx, host verificado arriba).
  const res = await fetch(mp3Url.toString(), { cache: 'no-store' })
  if (!res.ok) {
    console.error('[telnyx:webhook] descarga de grabación falló:', res.status)
    return
  }
  const contentLength = Number(res.headers?.get?.('content-length') ?? 0)
  if (contentLength > URL_MAX_MP3_BYTES) {
    console.error('[telnyx:webhook] grabación excede tamaño máximo, ignorado')
    return
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.byteLength > URL_MAX_MP3_BYTES) {
    console.error('[telnyx:webhook] grabación excede tamaño máximo, ignorado')
    return
  }

  const path = buildMediaPath(accountId, 'recording.mp3')
  const { error: upErr } = await admin.storage
    .from('call-recordings')
    .upload(path, buffer, { contentType: 'audio/mpeg', upsert: false })

  if (upErr) {
    console.error('[telnyx:webhook] upload grabación falló:', upErr.message)
    return
  }

  const proxyUrl = `/api/telnyx/recordings/${callRow.id}`
  await admin
    .from('calls')
    .update({ recording_storage_path: path, recording_url: proxyUrl })
    .eq('id', callRow.id)
    .eq('account_id', accountId)
}

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

  // Dedupe (DAD §3.2): Telnyx puede reentregar el mismo evento; un telnyx_message_id
  // ya persistido no debe duplicar el mensaje en el inbox del cliente.
  if (telnyxMsgId) {
    const { data: existing } = await admin
      .from('messages')
      .select('id')
      .eq('metadata->telnyx_message_id', telnyxMsgId)
      .maybeSingle()
    if (existing) return
  }

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