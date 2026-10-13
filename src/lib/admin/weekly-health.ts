import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email/send'

/**
 * Weekly per-company health: the /admin "Salud semanal" tab and the
 * Monday email. Numbers come from the `platform_weekly_health` RPC
 * (migration 165, aggregated in SQL so the 1000-row cap can't skew a
 * count); this module only grades them and picks chats worth reading.
 */

export const WEEKLY_HEALTH_INBOX = 'angelduran.management@gmail.com'

export interface HealthRow {
  account_id: string
  name: string
  industry_vertical: string
  suspended: boolean
  inbound: number
  inbound_prev: number
  conversations: number
  ai_replies: number
  staff_replies: number
  first_response_median_min: number | null
  waiting_over_2h: number
  handoffs: number
  handoffs_unattended: number
  ai_records: number
  followups_sent: number
  followups_failed: number
  ai_tokens: number
  alerts_critical: number
  alerts_other: number
}

export type HealthStatus = 'red' | 'yellow' | 'green'

export interface GradedHealth extends HealthRow {
  status: HealthStatus
  reasons: string[]
}

const RANK: Record<HealthStatus, number> = { red: 0, yellow: 1, green: 2 }

/** Pure: thresholds from the onboarding plan (12 Oct 2026). */
export function gradeHealth(row: HealthRow): GradedHealth {
  const red: string[] = []
  const yellow: string[] = []

  if (row.alerts_critical > 0) red.push(`${row.alerts_critical} alerta(s) crítica(s) abierta(s)`)
  if (row.handoffs_unattended > 0) red.push(`${row.handoffs_unattended} pase(s) al equipo sin atender por más de 24 h`)
  if (row.followups_failed > 0) red.push(`${row.followups_failed} seguimiento(s) fallido(s)`)
  if (row.inbound_prev >= 20 && row.inbound < row.inbound_prev * 0.5) {
    red.push(`mensajes recibidos cayeron de ${row.inbound_prev} a ${row.inbound}`)
  }

  if (row.inbound === 0) yellow.push('sin mensajes esta semana')
  if (row.alerts_other > 0) yellow.push(`${row.alerts_other} advertencia(s) abierta(s)`)
  if (row.waiting_over_2h >= 5) yellow.push(`${row.waiting_over_2h} chats con el cliente esperando más de 2 h`)
  if (row.first_response_median_min != null && row.first_response_median_min > 5) {
    yellow.push(`primera respuesta tarda ${row.first_response_median_min} min (mediana)`)
  }

  const status: HealthStatus = red.length ? 'red' : yellow.length ? 'yellow' : 'green'
  return { ...row, status, reasons: [...red, ...yellow] }
}

export async function loadWeeklyHealth(db: SupabaseClient): Promise<GradedHealth[]> {
  const { data, error } = await db.rpc('platform_weekly_health')
  if (error) throw error
  return ((data ?? []) as HealthRow[])
    .filter((r) => !r.suspended)
    .map((r) =>
      gradeHealth({
        ...r,
        first_response_median_min:
          r.first_response_median_min == null ? null : Number(r.first_response_median_min),
      }),
    )
    .sort((a, b) => RANK[a.status] - RANK[b.status] || b.inbound - a.inbound)
}

export interface ChatToRead {
  conversation_id: string
  why: string
  contact_name: string | null
  messages: { sender_type: string; ai_generated: boolean; text: string; created_at: string }[]
}

/**
 * Up to 2 chats per company for a human read: the latest hand-off to the
 * team and a random AI-answered thread from this week.
 */
export async function pickChatsToRead(db: SupabaseClient, accountId: string): Promise<ChatToRead[]> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const [handoff, aiThreads] = await Promise.all([
    db.from('conversations').select('id, contact:contacts(name)')
      .eq('account_id', accountId).gte('ai_handoff_at', since)
      .order('ai_handoff_at', { ascending: false }).limit(1),
    db.from('conversations').select('id, contact:contacts(name)')
      .eq('account_id', accountId).gte('last_message_at', since).gt('ai_reply_count', 0)
      .order('last_message_at', { ascending: false }).limit(20),
  ])
  if (handoff.error) throw handoff.error
  if (aiThreads.error) throw aiThreads.error

  type Conv = { id: string; contact: { name: string | null } | { name: string | null }[] | null }
  const picks: { conv: Conv; why: string }[] = []
  const h = (handoff.data ?? []) as Conv[]
  if (h[0]) picks.push({ conv: h[0], why: 'Pase al equipo más reciente' })
  const pool = ((aiThreads.data ?? []) as Conv[]).filter((c) => c.id !== h[0]?.id)
  if (pool.length) picks.push({ conv: pool[Math.floor(Math.random() * pool.length)], why: 'Chat al azar atendido por la IA' })

  return Promise.all(
    picks.map(async ({ conv, why }) => {
      const { data, error } = await db.from('messages')
        .select('sender_type, ai_generated, content_text, created_at')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false }).limit(12)
      if (error) throw error
      const contact = Array.isArray(conv.contact) ? conv.contact[0] : conv.contact
      return {
        conversation_id: conv.id,
        why,
        contact_name: contact?.name ?? null,
        messages: (data ?? []).reverse().map((m) => ({
          sender_type: m.sender_type as string,
          ai_generated: Boolean(m.ai_generated),
          text: (m.content_text as string | null) ?? '[archivo]',
          created_at: m.created_at as string,
        })),
      }
    }),
  )
}

const DOT: Record<HealthStatus, string> = { red: '🔴', yellow: '🟡', green: '🟢' }

/** Pure: plain-text body of the Monday email. */
export function renderWeeklyHealthEmail(rows: GradedHealth[], siteUrl: string): { subject: string; text: string } {
  const red = rows.filter((r) => r.status === 'red').length
  const yellow = rows.filter((r) => r.status === 'yellow').length
  const subject = `SANDÍA salud semanal: ${red} en rojo, ${yellow} en amarillo, ${rows.length - red - yellow} en verde`
  const lines = rows.map((r) => {
    const head = `${DOT[r.status]} ${r.name}: ${r.conversations} conversaciones, ${r.inbound} mensajes recibidos (semana anterior ${r.inbound_prev}), ` +
      `${r.handoffs} pases al equipo, ${r.ai_records} registros de la IA`
    return r.reasons.length ? `${head}\n   → ${r.reasons.join('\n   → ')}` : head
  })
  const text = `Resumen de los últimos 7 días.\n\n${lines.join('\n\n')}\n\nDetalle y chats para leer: ${siteUrl}/admin\n\n— SANDÍA`
  return { subject, text }
}

export async function sendWeeklyHealthEmail(db: SupabaseClient, siteUrl: string) {
  const rows = await loadWeeklyHealth(db)
  const { subject, text } = renderWeeklyHealthEmail(rows, siteUrl)
  await sendEmail({ account: 'support', to: WEEKLY_HEALTH_INBOX, subject, text })
  return { accounts: rows.length, subject }
}
