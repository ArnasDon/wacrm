import type { SupabaseClient } from '@supabase/supabase-js'
import type { WebhookEvent } from '@/lib/webhooks/events'

// ============================================================
// Turn a CRM event (+ its thin dispatch payload) into a Google Sheets
// row, enriching from the DB — the internal path has full read access,
// unlike the outbound webhook payload which only carries ids.
//
// One `google_sheets_config` has one base `sheet_tab`; each event
// CATEGORY routes to its own tab so a "deal.won" row and a
// "quote.created" row never fight over the same columns:
//   deals        -> <base>
//   quotes       -> <base> - Cotizaciones
//   contacts     -> <base> - Leads
//   appointments -> <base> - Citas
//   broadcasts   -> <base> - Difusiones
// Every row starts with the event name + an ISO timestamp so a tab is
// still readable if the operator later points two similar events at it.
// ============================================================

export interface SheetRow {
  /** Full tab name to append to (base tab + category suffix). */
  tab: string
  /** Column titles — written once per tab (see dispatch.ts). */
  header: string[]
  /** The row itself, aligned to `header`. */
  values: (string | number | null)[]
}

type Db = SupabaseClient

function cat(base: string, suffix: string): string {
  return suffix ? `${base} - ${suffix}` : base
}

async function contactRef(
  db: Db,
  accountId: string,
  contactId: string | null | undefined,
): Promise<{ name: string; phone: string }> {
  if (!contactId) return { name: '', phone: '' }
  const { data } = await db
    .from('contacts')
    .select('name, phone')
    .eq('account_id', accountId)
    .eq('id', contactId)
    .maybeSingle()
  return { name: (data?.name as string) ?? '', phone: (data?.phone as string) ?? '' }
}

async function agentName(
  db: Db,
  accountId: string,
  userId: string | null | undefined,
): Promise<string> {
  if (!userId) return ''
  const { data } = await db
    .from('profiles')
    .select('full_name, email')
    .eq('account_id', accountId)
    .eq('user_id', userId)
    .maybeSingle()
  return (data?.full_name as string) || (data?.email as string) || ''
}

async function buildDealRow(
  db: Db,
  accountId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
  base: string,
  nowIso: string,
): Promise<SheetRow | null> {
  const dealId = typeof data.deal_id === 'string' ? data.deal_id : null
  if (!dealId) return null
  const { data: deal } = await db
    .from('deals')
    .select('id, title, value, currency, stage_id, contact_id, assigned_to, status, won_at')
    .eq('account_id', accountId)
    .eq('id', dealId)
    .maybeSingle()
  if (!deal) return null

  let stageName = ''
  if (deal.stage_id) {
    const { data: stage } = await db
      .from('pipeline_stages')
      .select('name')
      .eq('id', deal.stage_id as string)
      .maybeSingle()
    stageName = (stage?.name as string) ?? ''
  }
  const contact = await contactRef(db, accountId, deal.contact_id as string | null)
  const agent = await agentName(db, accountId, deal.assigned_to as string | null)

  return {
    tab: base,
    header: [
      'Evento', 'Fecha', 'Negociación', 'Monto', 'Moneda', 'Etapa',
      'Cliente', 'Teléfono', 'Vendedor', 'Estado', 'Ganada el', 'Origen', 'Deal ID',
    ],
    values: [
      event,
      nowIso,
      (deal.title as string) ?? '',
      typeof deal.value === 'number' ? deal.value : Number(deal.value ?? 0),
      (deal.currency as string) ?? '',
      stageName,
      contact.name,
      contact.phone,
      agent,
      (deal.status as string) ?? '',
      (deal.won_at as string) ?? '',
      typeof data.source === 'string' ? data.source : '',
      deal.id as string,
    ],
  }
}

async function buildQuoteRow(
  db: Db,
  accountId: string,
  data: Record<string, unknown>,
  base: string,
  nowIso: string,
): Promise<SheetRow | null> {
  const quoteId = typeof data.quote_id === 'string' ? data.quote_id : null
  if (!quoteId) return null
  const { data: quote } = await db
    .from('quotes')
    .select('id, contact_id, currency, subtotal, total, status, customer_nit, customer_email')
    .eq('account_id', accountId)
    .eq('id', quoteId)
    .maybeSingle()
  if (!quote) return null

  const { data: items } = await db
    .from('quote_items')
    .select('description, quantity, line_total')
    .eq('account_id', accountId)
    .eq('quote_id', quoteId)
    .order('position', { ascending: true })
  const itemList = (items ?? []) as { description: string; quantity: number; line_total: number }[]
  const summary = itemList
    .map((it) => `${it.quantity}x ${it.description}`)
    .join(' | ')
    .slice(0, 500)
  const contact = await contactRef(db, accountId, quote.contact_id as string | null)

  return {
    tab: cat(base, 'Cotizaciones'),
    header: [
      'Evento', 'Fecha', 'Cliente', 'Teléfono', 'NIT', 'Ítems', 'Detalle',
      'Subtotal', 'Total', 'Moneda', 'Estado', 'Origen', 'Quote ID',
    ],
    values: [
      'quote.created',
      nowIso,
      contact.name,
      contact.phone,
      (quote.customer_nit as string) ?? '',
      itemList.length,
      summary,
      typeof quote.subtotal === 'number' ? quote.subtotal : Number(quote.subtotal ?? 0),
      typeof quote.total === 'number' ? quote.total : Number(quote.total ?? 0),
      (quote.currency as string) ?? '',
      (quote.status as string) ?? '',
      typeof data.source === 'string' ? data.source : '',
      quote.id as string,
    ],
  }
}

async function buildContactRow(
  db: Db,
  accountId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
  base: string,
  nowIso: string,
): Promise<SheetRow | null> {
  const contactId = typeof data.contact_id === 'string' ? data.contact_id : null
  if (!contactId) return null
  const { data: c } = await db
    .from('contacts')
    .select('name, phone, email, company, lead_temperature, created_at')
    .eq('account_id', accountId)
    .eq('id', contactId)
    .maybeSingle()
  if (!c) return null

  return {
    tab: cat(base, 'Leads'),
    header: ['Evento', 'Fecha', 'Nombre', 'Teléfono', 'Correo', 'Empresa', 'Temperatura', 'Origen'],
    values: [
      event,
      nowIso,
      (c.name as string) ?? '',
      (c.phone as string) ?? '',
      (c.email as string) ?? '',
      (c.company as string) ?? '',
      (typeof data.to === 'string' ? data.to : (c.lead_temperature as string)) ?? '',
      (typeof data.source === 'string' ? data.source : '') || '',
    ],
  }
}

async function buildAppointmentRow(
  db: Db,
  accountId: string,
  data: Record<string, unknown>,
  base: string,
  nowIso: string,
): Promise<SheetRow | null> {
  const contactId = typeof data.contact_id === 'string' ? data.contact_id : null
  const contact = await contactRef(db, accountId, contactId)
  return {
    tab: cat(base, 'Citas'),
    header: ['Evento', 'Fecha', 'Cliente', 'Teléfono', 'Inicio', 'Fin', 'Correo invitado'],
    values: [
      'appointment.scheduled',
      nowIso,
      contact.name,
      contact.phone,
      (typeof data.start === 'string' ? data.start : '') || (typeof data.start_time === 'string' ? data.start_time : ''),
      (typeof data.end === 'string' ? data.end : '') || (typeof data.end_time === 'string' ? data.end_time : ''),
      typeof data.attendee_email === 'string' ? data.attendee_email : '',
    ],
  }
}

async function buildBroadcastRow(
  db: Db,
  accountId: string,
  data: Record<string, unknown>,
  base: string,
  nowIso: string,
): Promise<SheetRow | null> {
  const broadcastId = typeof data.broadcast_id === 'string' ? data.broadcast_id : null
  if (!broadcastId) return null
  const { data: b } = await db
    .from('broadcasts')
    .select('name, template_name, status, total_recipients, sent_count, delivered_count, read_count, replied_count, failed_count')
    .eq('account_id', accountId)
    .eq('id', broadcastId)
    .maybeSingle()
  if (!b) return null
  return {
    tab: cat(base, 'Difusiones'),
    header: ['Evento', 'Fecha', 'Nombre', 'Plantilla', 'Estado', 'Destinatarios', 'Enviados', 'Entregados', 'Leídos', 'Respondidos', 'Fallidos'],
    values: [
      'broadcast.completed',
      nowIso,
      (b.name as string) ?? '',
      (b.template_name as string) ?? '',
      (b.status as string) ?? '',
      Number(b.total_recipients ?? 0),
      Number(b.sent_count ?? 0),
      Number(b.delivered_count ?? 0),
      Number(b.read_count ?? 0),
      Number(b.replied_count ?? 0),
      Number(b.failed_count ?? 0),
    ],
  }
}

/**
 * Build the sheet row for `event`. Returns null when the event has no
 * mapping or the referenced entity no longer exists.
 */
export async function buildRowForEvent(
  db: Db,
  accountId: string,
  event: WebhookEvent,
  data: unknown,
  baseTab: string,
): Promise<SheetRow | null> {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const nowIso = new Date().toISOString()
  const base = baseTab || 'Ventas'

  switch (event) {
    case 'deal.won':
    case 'deal.stage_changed':
      return buildDealRow(db, accountId, event, d, base, nowIso)
    case 'quote.created':
      return buildQuoteRow(db, accountId, d, base, nowIso)
    case 'contact.created':
    case 'contact.lead_temperature_changed':
      return buildContactRow(db, accountId, event, d, base, nowIso)
    case 'appointment.scheduled':
      return buildAppointmentRow(db, accountId, d, base, nowIso)
    case 'broadcast.completed':
      return buildBroadcastRow(db, accountId, d, base, nowIso)
    default:
      return null
  }
}
