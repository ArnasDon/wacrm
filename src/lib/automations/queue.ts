import { supabaseAdmin } from './admin-client'
import {
  engineSendInteractive,
  engineSendTemplate,
  engineSendText,
} from '@/lib/flows/meta-send'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'
import { deliverAutomationEmail } from './send-email-step'

// ------------------------------------------------------------
// Fase 2 Mautic P1.4 — frequency_rules + message_queue (DAD §8.3)
//
// Anti-spam: cada envío saliente por automatización consulta la
// frecuencia del account ANTES de llamar a Meta. Si el contacto ya
// recibió `max_per_day` mensajes hoy (canal), el envío NO se descarta:
// se encola en `message_queue` con `due_at` en la próxima ventana
// horaria de la clínica. El cron (route.ts) drena la cola.
//
// Fail-open: sin fila en frequency_rules → envío directo (default
// permisivo, nunca rompe la automatización).
// ------------------------------------------------------------

export type QueueChannel = 'whatsapp' | 'sms' | 'email'

interface FrequencyRuleRow {
  id: string
  account_id: string
  channel: QueueChannel
  max_per_day: number
  window_start: string
  window_end: string
  is_active: boolean
}

/**
 * Cuenta los envíos salientes del contact hoy en `channel` para el account.
 * Null-safe: sin filas → 0. Fail-open: ante error → 0 (nunca bloquea).
 *
 * Cada canal se cuenta contra su propia tabla; una cuota de email que
 * midiera volumen de WhatsApp no sería una cuota de email.
 *
 * OJO `sms`: el SMS ENTRANTE se persiste en `messages` con channel='sms'
 * (041), pero el SALIENTE del engine va directo a Telnyx sin guardarse.
 * Este contador es correcto por construcción y devolverá 0 hasta que el
 * envío se persista — ver la nota en el paso `send_sms` de engine.ts.
 */
async function countSentToday(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  contactId: string,
  channel: QueueChannel,
): Promise<number> {
  const since = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z'

  if (channel === 'email') {
    const { count, error } = await db
      .from('email_sends')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .gte('sent_at', since)
    if (error) {
      console.error('[queue] countSentToday(email) failed:', error)
      return 0
    }
    return count ?? 0
  }

  const { count, error } = await db
    .from('messages')
    // Tenancy: messages no lleva account_id; filtra por el embebido
    // conversations!inner (precedente webhook/route.ts:488).
    .select('conversations!inner(account_id)', { count: 'exact', head: true })
    .eq('contact_id', contactId)
    .eq('conversations.account_id', accountId)
    .eq('channel', channel)
    .gte('created_at', since)
    .in('sender_type', ['agent', 'bot'])
  if (error) {
    console.error(`[queue] countSentToday(${channel}) failed:`, error)
    return 0
  }
  return count ?? 0
}

/** True si `hhmm` ("HH:MM") cae dentro de [windowStart, windowEnd). */
export function withinWindow(
  windowStart: string,
  windowEnd: string,
  hhmm: string,
): boolean {
  return hhmm >= windowStart && hhmm < windowEnd
}

/**
 * Dado un envío saliente: si la regla activa del account dice que el
 * contacto ya agotó su cuota diaria → encola y devuelve `queued: true`.
 * Si no hay regla, o no se excede → `queued: false` (envío directo).
 */
export async function checkFrequencyOrEnqueue(args: {
  accountId: string
  contactId: string
  channel?: QueueChannel
  payload: Record<string, unknown>
  /** Hora de entrega preferida; si no, due_at = próxima ventana. */
  preferAt?: string
}): Promise<{ queued: boolean; reason?: string }> {
  const db = supabaseAdmin()
  const channel = args.channel ?? 'whatsapp'

  const { data, error } = await db
    .from('frequency_rules')
    .select('*')
    .eq('account_id', args.accountId)
    .eq('channel', channel)
    .maybeSingle()
  const rule = data as FrequencyRuleRow | null

  // Fail-open: sin regla configurada → envía directo.
  if (error || !rule || !rule.is_active) {
    if (error) console.error('[queue] frequency_rules lookup failed:', error)
    return { queued: false }
  }

  const sentToday = await countSentToday(
    db,
    args.accountId,
    args.contactId,
    channel,
  )
  if (sentToday < rule.max_per_day) return { queued: false }

  // Excede la cuota → re-agendar, no descartar. Fuera de ventana →
  // due_at = mañana a window_start; dentro → ahora + 30 min (backoff).
  // OJO TZ: `hhmm` se compara en hora LOCAL del servidor (zona del
  // negocio), así que due_at también se construye en hora local — nunca
  // mezclar con toISOString() directo (UTC) o la ventana se desplaza.
  const now = new Date()
  const hhmm = now.toTimeString().slice(0, 5)
  let dueAt: string
  if (!withinWindow(rule.window_start, rule.window_end, hhmm)) {
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const [h, m] = rule.window_start.split(':').map(Number)
    tomorrow.setHours(h, m, 0, 0)
    dueAt = tomorrow.toISOString()
  } else {
    dueAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()
  }

  const { error: insErr } = await db.from('message_queue').insert({
    account_id: args.accountId,
    contact_id: args.contactId,
    channel,
    payload: {
      ...args.payload,
      _queued_reason: 'frequency_limit',
      _sent_today: sentToday,
      _max_per_day: rule.max_per_day,
    },
    due_at: args.preferAt ?? dueAt,
    status: 'pending',
    attempts: 0,
  })

  if (insErr) {
    console.error('[queue] enqueue failed:', insErr)
    // Fail-open: no pudimos encolar → dejamos pasar (mejor un envío de
    // más que un lead perdido).
    return { queued: false }
  }
  return {
    queued: true,
    reason: `frequency limit ${sentToday}/${rule.max_per_day}`,
  }
}

/** Fila de `message_queue` que el drenaje reproduce. */
interface QueuedRow {
  account_id: string
  contact_id: string
}

/** Pasos que saben reproducirse desde la cola. */
type ReplayableStepType =
  | 'send_message'
  | 'send_template'
  | 'send_buttons'
  | 'send_list'
  | 'send_email'

/**
 * Cómo re-enviar cada tipo de paso aplazado.
 *
 * Es un `Record` sobre la unión a propósito: añadir un tipo encolable sin
 * enseñarle al drenaje a reproducirlo es un error de compilación. Antes
 * esto era `if (send_template) … else texto plano`, así que cualquier otro
 * tipo se drenaba como `String(payload.text ?? '')` — un mensaje vacío.
 *
 * Los payloads llegan ya renderizados desde el engine; aquí NO se vuelve a
 * consultar la cuota, o un envío aplazado se re-encolaría para siempre.
 */
const QUEUE_REPLAYERS: Record<
  ReplayableStepType,
  (row: QueuedRow, payload: Record<string, unknown>) => Promise<void>
> = {
  send_message: async (row, p) => {
    await engineSendText({
      accountId: row.account_id,
      userId: (p.user_id as string) ?? row.account_id,
      conversationId: p.conversation_id as string,
      contactId: row.contact_id,
      text: String(p.text ?? ''),
    })
  },
  send_template: async (row, p) => {
    await engineSendTemplate({
      accountId: row.account_id,
      userId: (p.user_id as string) ?? row.account_id,
      conversationId: p.conversation_id as string,
      contactId: row.contact_id,
      templateName: p.template_name as string,
      language: (p.language as string | undefined) ?? undefined,
      params: (p.params as string[] | undefined) ?? [],
    })
  },
  send_buttons: (row, p) => replayInteractive(row, p),
  send_list: (row, p) => replayInteractive(row, p),
  send_email: async (row, p) => {
    await deliverAutomationEmail({
      accountId: row.account_id,
      contactId: row.contact_id,
      // El vínculo con la automatización no sobrevive a la cola; la fila
      // de email_sends queda sin automation_id, no huérfana de account.
      automationId: null,
      templateName: p.template_name as string,
      recipient: p.recipient as string,
      subject: String(p.subject ?? ''),
      html: String(p.html ?? ''),
    })
  },
}

async function replayInteractive(
  row: QueuedRow,
  p: Record<string, unknown>,
): Promise<void> {
  await engineSendInteractive({
    accountId: row.account_id,
    userId: (p.user_id as string) ?? row.account_id,
    conversationId: p.conversation_id as string,
    contactId: row.contact_id,
    payload: p.interactive as InteractiveMessagePayload,
  })
}

/**
 * Drain: re-envía los mensajes en cola cuyo `due_at` llegó. Claim por
 * id (status → claimed) para que dos crons solapados no dupliquen.
 * Devuelve { processed, sent, failed }.
 */
export async function drainMessageQueue(limit = 50): Promise<{
  processed: number
  sent: number
  failed: number
}> {
  const db = supabaseAdmin()
  const { data: due, error } = await db
    .from('message_queue')
    .select('*')
    .eq('status', 'pending')
    .lte('due_at', new Date().toISOString())
    .order('due_at', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('[queue] drain fetch failed:', error)
    return { processed: 0, sent: 0, failed: 0 }
  }
  if (!due || due.length === 0) return { processed: 0, sent: 0, failed: 0 }

  let sent = 0
  let failed = 0
  for (const row of due) {
    // Claim atómico — el primero que gana el UPDATE procesa.
    const { data: claim } = await db
      .from('message_queue')
      .update({ status: 'claimed' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claim) continue

    try {
      const payload = (row.payload ?? {}) as Record<string, unknown>
      const stepType = String(payload.step_type ?? '')
      const replay = QUEUE_REPLAYERS[stepType as ReplayableStepType]
      // Sin reproductor preferimos fallar visiblemente (reintento y, a las
      // 3, `failed` con last_error) antes que entregar un mensaje vacío.
      if (!replay) {
        throw new Error(`queued step_type not replayable: ${stepType || '(none)'}`)
      }
      await replay(
        { account_id: row.account_id, contact_id: row.contact_id as string },
        payload,
      )
      await db
        .from('message_queue')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', row.id)
      sent++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Reintentos: hasta 3, después failed. El cron reintenta claimed
      // con due_at desplazado vía update — ver `retryClaimed`.
      const attempts = (row.attempts ?? 0) + 1
      await db
        .from('message_queue')
        .update({
          status: attempts >= 3 ? 'failed' : 'pending',
          attempts,
          last_error: msg,
          due_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        })
      .eq('id', row.id)
      failed++
    }
  }
  return { processed: due.length, sent, failed }
}
