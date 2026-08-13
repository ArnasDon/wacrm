import { supabaseAdmin } from './admin-client'
import { engineSendTemplate, engineSendText } from '@/lib/flows/meta-send'

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
 * Cuenta los mensajes salientes del contact hoy (canal WhatsApp, sender
 * agent/bot) para el account. Null-safe: sin conversación → 0.
 */
async function countSentToday(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  contactId: string,
): Promise<number> {
  const { count, error } = await db
    .from('messages')
    // Tenancy: messages no lleva account_id; filtra por el embebido
    // conversations!inner (precedente webhook/route.ts:488).
    .select('conversations!inner(account_id)', { count: 'exact', head: true })
    .eq('contact_id', contactId)
    .eq('conversations.account_id', accountId)
    .gte('created_at', new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z')
    .in('sender_type', ['agent', 'bot'])
  if (error) {
    console.error('[queue] countSentToday failed:', error)
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

  const { data: rule, error } = await db
    .from('frequency_rules')
    .select('*')
    .eq('account_id', args.accountId)
    .eq('channel', channel)
    .maybeSingle()

  // Fail-open: sin regla configurada → envía directo.
  if (error || !rule || !rule.is_active) {
    if (error) console.error('[queue] frequency_rules lookup failed:', error)
    return { queued: false }
  }

  const sentToday = await countSentToday(db, args.accountId, args.contactId)
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
      if (row.channel === 'whatsapp' && payload.step_type === 'send_template') {
        await engineSendTemplate({
          accountId: row.account_id,
          userId: (payload.user_id as string) ?? row.account_id,
          conversationId: payload.conversation_id as string,
          contactId: row.contact_id as string,
          templateName: payload.template_name as string,
          language: (payload.language as string | undefined) ?? undefined,
          params: (payload.params as string[] | undefined) ?? [],
        })
      } else {
        // Default: texto plano.
        await engineSendText({
          accountId: row.account_id,
          userId: (payload.user_id as string) ?? row.account_id,
          conversationId: payload.conversation_id as string,
          contactId: row.contact_id as string,
          text: String(payload.text ?? ''),
        })
      }
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
