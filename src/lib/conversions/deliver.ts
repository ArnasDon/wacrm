// ============================================================
// conversion/deliver.ts — cola durable de entrega a Google/Meta
//
// El cron /api/conversions/cron reclama filas de conversion_deliveries
// (status pending/failed → claimed) y las envía al adapter de la
// plataforma correspondiente. Cada conversión tiene UNA fila por
// plataforma (UNIQUE conversion_event_id, platform) → nunca se envía
// dos veces la misma.
//
// Backoff: tras un fallo, `due_at` se pospone exponencialmente
// (2^attempts minutos, tope 6h). Tras MAX_ATTEMPTS fallos → permanent
// (se abandona, queda auditado en last_error).
//
// Fail-open: si no hay credenciales para una plataforma, sus filas se
// quedan pending sin procesar (el cron no las reclama) — el sistema
// nunca rompe por reporting.
// ============================================================

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { loadGoogleAdsCreds, sendOfflineConversion } from '@/lib/analytics/google-ads'
import { loadCapiCreds, dispatchWebsiteConversion } from '@/lib/analytics/meta-capi'

// Eventos de conversión del catálogo canónico (los que reportamos a las
// plataformas). Viven aquí, no en track-event-schema: ese enum cubre solo
// los 6 tipos de la API pública anónima; los de conversión los emiten
// RPC/trigger/server con service role.
export type ConversionEventName =
  | 'lead'
  | 'qualified_lead'
  | 'appointment_booked'
  | 'appointment_showed'
  | 'deal_won'
  | 'purchase'

const MAX_ATTEMPTS = 5
const BATCH = 50

export interface DeliveryRow {
  id: string
  account_id: string
  conversion_event_id: string
  platform: 'google_ads' | 'meta_capi'
  payload: {
    event_name: ConversionEventName
    event_id: string
    contact_id?: string
    value?: number
    currency?: string
    created_at?: string
    attribution?: {
      click_ids?: { gclid?: string; gbraid?: string; wbraid?: string; fbclid?: string }
      fbc?: string
      fbp?: string
    }
  }
  attempts: number
}

/** Claim a due rows: pending|failed con due_at <= now → claimed. */
async function claimDue(): Promise<DeliveryRow[]> {
  const db = supabaseAdmin()
  const { data: rows } = await db
    .from('conversion_deliveries')
    .select('*')
    .in('status', ['pending', 'failed'])
    .lte('due_at', new Date().toISOString())
    .order('due_at', { ascending: true })
    .limit(BATCH)

  if (!rows || rows.length === 0) return []

  const claimed: DeliveryRow[] = []
  for (const row of rows) {
    const { data: claim } = await db
      .from('conversion_deliveries')
      .update({ status: 'claimed' })
      .eq('id', row.id)
      .in('status', ['pending', 'failed'])
      .select('id')
      .maybeSingle()
    if (claim) claimed.push(row as unknown as DeliveryRow)
  }
  return claimed
}

/** Marca una entrega como enviada. */
async function markSent(id: string): Promise<void> {
  await supabaseAdmin()
    .from('conversion_deliveries')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', id)
}

/** Marca un fallo con backoff exponencial; abandona tras MAX_ATTEMPTS. */
async function markFailed(id: string, attempts: number, reason: string): Promise<void> {
  const nextAttempts = attempts + 1
  const permanent = nextAttempts >= MAX_ATTEMPTS
  const delayMinutes = permanent ? 0 : Math.min(2 ** nextAttempts, 360)
  await supabaseAdmin()
    .from('conversion_deliveries')
    .update({
      status: permanent ? 'permanent' : 'failed',
      attempts: nextAttempts,
      last_error: reason.slice(0, 1000),
      due_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
    })
    .eq('id', id)
}

/** Carga el contacto (email/phone) para el user_data de los adapters. */
async function loadContactUserData(
  accountId: string,
  contactId: string | undefined,
): Promise<{ email?: string; phone?: string } | undefined> {
  if (!contactId) return undefined
  const { data } = await supabaseAdmin()
    .from('contacts')
    .select('email, phone')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!data) return undefined
  const out: { email?: string; phone?: string } = {}
  if (typeof data.email === 'string' && data.email) out.email = data.email
  if (typeof data.phone === 'string' && data.phone) out.phone = data.phone
  return Object.keys(out).length ? out : undefined
}

/** Entrega una fila a la plataforma que corresponde. */
async function deliverRow(row: DeliveryRow): Promise<boolean> {
  const payload = row.payload
  const attr = payload.attribution
  const clickIds = attr?.click_ids

  // El event_id determinístico es el dedup: Google lo usa como
  // transactionId y Meta como event_id (navegador + servidor).
  const eventTime = payload.created_at ? Date.parse(payload.created_at) : Date.now()

  if (row.platform === 'google_ads') {
    const creds = loadGoogleAdsCreds()
    if (!creds) return false // fail-open: sin credenciales no se envía
    const contact = await loadContactUserData(row.account_id, payload.contact_id as string)
    const res = await sendOfflineConversion(
      {
        event_name: mapEventName(payload.event_name),
        event_id: payload.event_id,
        event_time: eventTime,
        value: payload.value,
        currency: payload.currency,
        click_ids: { gclid: clickIds?.gclid, gbraid: clickIds?.gbraid, wbraid: clickIds?.wbraid },
        user_data: contact,
      },
      creds,
    )
    return res.ok
  }

  // meta_capi
  const creds = loadCapiCreds()
  if (!creds) return false
  const contact = await loadContactUserData(row.account_id, payload.contact_id as string)
  const res = await dispatchWebsiteConversion(
    {
      event_name: mapMetaEventName(payload.event_name),
      event_id: payload.event_id,
      event_time: eventTime,
      value: payload.value,
      currency: payload.currency,
      fbc: attr?.fbc,
      fbp: attr?.fbp,
      user_data: contact,
    },
    creds,
  )
  return res.ok
}

/** Mapea nuestro event_type → nombre de evento Google (purchase para deal_won). */
function mapEventName(name: ConversionEventName): ConversionEventName {
  // deal_won == purchase en WACRM: un trato ganado ES la compra.
  if (name === 'deal_won') return 'deal_won'
  return name
}

/** Mapea nuestro event_type → nombre de evento Meta (PascalCase). */
function mapMetaEventName(name: ConversionEventName): 'Lead' | 'QualifiedLead' | 'AppointmentBooked' | 'AppointmentShowed' | 'Purchase' {
  switch (name) {
    case 'lead':
      return 'Lead'
    case 'qualified_lead':
      return 'QualifiedLead'
    case 'appointment_booked':
      return 'AppointmentBooked'
    case 'appointment_showed':
      return 'AppointmentShowed'
    case 'deal_won':
      return 'Purchase' // deal_won == purchase
    case 'purchase':
      return 'Purchase'
  }
}

/** Drain principal del cron. Devuelve cuántas entregas se procesaron. */
export async function drainDeliveries(): Promise<{ processed: number; sent: number; failed: number }> {
  const rows = await claimDue()
  let sent = 0
  let failed = 0
  for (const row of rows) {
    const ok = await deliverRow(row)
    if (ok) {
      await markSent(row.id)
      sent++
    } else {
      await markFailed(row.id, row.attempts, 'delivery failed (see adapter)')
      failed++
    }
  }
  return { processed: rows.length, sent, failed }
}