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
//   deals         -> <base>
//   quotes        -> <base> - Cotizaciones
//   contacts      -> <base> - Leads
//   appointments  -> <base> - Citas
//   broadcasts    -> <base> - Difusiones
//   brief         -> <base> - Requerimientos  (one column per custom field)
// Every row starts with the event name + an ISO timestamp so a tab is
// still readable if the operator later points two similar events at it.
//
// The "Requerimientos" tab is the one with a variable column set: its
// header is [base columns, ...one per account custom field], so when
// the account adds a spec field the header grows — dispatch.ts detects
// the change and rewrites row 1.
// ============================================================

export interface SheetRow {
  /** Full tab name to append to (base tab + category suffix). */
  tab: string
  /** Column titles — written once per tab (see dispatch.ts). */
  header: string[]
  /** The row itself, aligned to `header`. */
  values: (string | number | null)[]
  /** Present for events that UPDATE an existing row in place rather than
   *  append a new one (`reservation.updated`): the entity id whose
   *  `sheet_row` pointer dispatch.ts reads/sets. The final column (the
   *  hotel-filled "Aprobación") is never overwritten on an update. */
  rowRef?: { table: 'reservation_requests'; id: string }
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

/**
 * A contact's custom-field values as `{ header, values }`, one entry per
 * account custom field (ordered by name so every row lines up). Shared
 * by the "Requerimientos" brief row and — for the hotel vertical — the
 * deal row, so a reservation's dates / room / package land in the sheet
 * even when a person (not the AI) registered it.
 */
async function contactCustomFieldColumns(
  db: Db,
  accountId: string,
  contactId: string,
): Promise<{ header: string[]; values: string[] }> {
  const [{ data: fields }, { data: values }] = await Promise.all([
    db
      .from('custom_fields')
      .select('id, field_name')
      .eq('account_id', accountId)
      .order('field_name', { ascending: true }),
    db
      .from('contact_custom_values')
      .select('custom_field_id, value')
      .eq('contact_id', contactId)
      .order('custom_field_id', { ascending: true }),
  ])
  const fieldList = (fields ?? []) as { id: string; field_name: string }[]
  const valueByField = new Map<string, string>()
  for (const v of (values ?? []) as { custom_field_id: string; value: string | null }[]) {
    valueByField.set(v.custom_field_id, v.value ?? '')
  }
  return {
    header: fieldList.map((f) => f.field_name),
    values: fieldList.map((f) => valueByField.get(f.id) ?? ''),
  }
}

async function accountVertical(db: Db, accountId: string): Promise<string> {
  const { data } = await db
    .from('accounts')
    .select('industry_vertical')
    .eq('id', accountId)
    .maybeSingle()
  return (data?.industry_vertical as string) ?? 'generic'
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

  // Hotel vertical: append the contact's reservation custom fields
  // (Fecha de entrada / salida, Habitación, Ocupación, Paquete…) so the
  // deals tab doubles as a reservations ledger — filter by the date
  // columns to see which rooms are booked for a range. Works on a
  // manual stage move (the admin confirming), unlike contact.brief_ready
  // which only the AI / an automation fires.
  let extraHeader: string[] = []
  let extraValues: string[] = []
  if ((await accountVertical(db, accountId)) === 'hotel' && deal.contact_id) {
    const extra = await contactCustomFieldColumns(db, accountId, deal.contact_id as string)
    extraHeader = extra.header
    extraValues = extra.values
  }

  return {
    tab: base,
    header: [
      'Evento', 'Fecha', 'Negociación', 'Monto', 'Moneda', 'Etapa',
      'Cliente', 'Teléfono', 'Vendedor', 'Estado', 'Ganada el', 'Origen', 'Deal ID',
      ...extraHeader,
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
      ...extraValues,
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
 * The "Requerimientos" (spec brief) row. Fired on `contact.brief_ready`
 * — i.e. when a deal gets registered for a contact — it snapshots the
 * contact's captured custom-field values into one wide row, one column
 * per custom field the account has defined. The column set is the
 * account's full custom-field list (ordered by name) so every row of
 * the tab lines up regardless of which fields a given prospect filled.
 */
async function buildBriefRow(
  db: Db,
  accountId: string,
  data: Record<string, unknown>,
  base: string,
  nowIso: string,
): Promise<SheetRow | null> {
  const contactId = typeof data.contact_id === 'string' ? data.contact_id : null
  if (!contactId) return null

  const [{ data: contact }, custom] = await Promise.all([
    db
      .from('contacts')
      .select('name, phone, email, company')
      .eq('account_id', accountId)
      .eq('id', contactId)
      .maybeSingle(),
    contactCustomFieldColumns(db, accountId, contactId),
  ])
  if (!contact) return null

  return {
    tab: cat(base, 'Requerimientos'),
    header: [
      'Evento',
      'Fecha',
      'Cliente',
      'Teléfono',
      'Correo',
      'Empresa',
      ...custom.header,
    ],
    values: [
      'contact.brief_ready',
      nowIso,
      (contact.name as string) ?? '',
      (contact.phone as string) ?? '',
      (contact.email as string) ?? '',
      (contact.company as string) ?? '',
      ...custom.values,
    ],
  }
}

// ------------------------------------------------------------
// Hotel: one tab per product category, each with its own column set.
// The row is UPDATED in place as the AI / catalog / quote fills fields
// (dispatch.ts tracks `reservation_requests.sheet_row`). "Aprobación"
// is always the last column and the hotel fills it by hand — dispatch
// never rewrites it.
// ------------------------------------------------------------

const RESERVATION_TAB_LABEL: Record<string, string> = {
  habitaciones: 'Habitaciones',
  spa: 'Spa',
  actividades: 'Actividades al aire libre',
  paquetes: 'Paquetes',
  eventos: 'Eventos',
}

const RESERVATION_STATUS_LABEL: Record<string, string> = {
  pending: '',
  approved: 'Aprobado',
  denied: 'Negado',
}

interface ReservationRow {
  id: string
  category: string
  service_name: string | null
  guests: number | null
  check_in: string | null
  check_out: string | null
  use_date: string | null
  duration_minutes: number | null
  hall: string | null
  decoration: string | null
  estimated_price: number | null
  status: string
  contact_id: string | null
}

async function buildReservationRow(
  db: Db,
  accountId: string,
  data: Record<string, unknown>,
  base: string,
  nowIso: string,
): Promise<SheetRow | null> {
  const id = typeof data.reservation_id === 'string' ? data.reservation_id : null
  if (!id) return null
  const { data: r } = await db
    .from('reservation_requests')
    .select(
      'id, category, service_name, guests, check_in, check_out, use_date, duration_minutes, hall, decoration, estimated_price, status, contact_id',
    )
    .eq('account_id', accountId)
    .eq('id', id)
    .maybeSingle<ReservationRow>()
  if (!r) return null

  const contact = await contactRef(db, accountId, r.contact_id)
  const tab = cat(base, RESERVATION_TAB_LABEL[r.category] ?? 'Solicitudes')
  const price =
    r.estimated_price != null && Number.isFinite(Number(r.estimated_price))
      ? Number(r.estimated_price)
      : ''
  const approval = RESERVATION_STATUS_LABEL[r.status] ?? ''

  let header: string[]
  let values: (string | number | null)[]
  switch (r.category) {
    case 'spa':
    case 'actividades':
      header = ['Registrado', 'Servicio', 'Cliente', 'Contacto', 'Personas', 'Fecha de uso', 'Minutos', 'Precio estimado', 'Aprobación']
      values = [nowIso, r.service_name ?? '', contact.name, contact.phone, r.guests ?? '', r.use_date ?? '', r.duration_minutes ?? '', price, approval]
      break
    case 'paquetes':
      header = ['Registrado', 'Paquete', 'Cliente', 'Contacto', 'Personas', 'Fecha de uso', 'Check-in', 'Check-out', 'Precio estimado', 'Aprobación']
      values = [nowIso, r.service_name ?? '', contact.name, contact.phone, r.guests ?? '', r.use_date ?? '', r.check_in ?? '', r.check_out ?? '', price, approval]
      break
    case 'eventos':
      header = ['Registrado', 'Tipo de evento', 'Cliente', 'Contacto', 'Fecha del evento', 'Personas', 'Salón', 'Decoración', 'Precio estimado', 'Aprobación']
      values = [nowIso, r.service_name ?? '', contact.name, contact.phone, r.use_date ?? '', r.guests ?? '', r.hall ?? '', r.decoration ?? '', price, approval]
      break
    case 'habitaciones':
    default:
      header = ['Registrado', 'Habitación', 'Cliente', 'Contacto', 'Huéspedes', 'Check-in', 'Check-out', 'Precio estimado', 'Aprobación']
      values = [nowIso, r.service_name ?? '', contact.name, contact.phone, r.guests ?? '', r.check_in ?? '', r.check_out ?? '', price, approval]
      break
  }

  return { tab, header, values, rowRef: { table: 'reservation_requests', id: r.id } }
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
    case 'contact.brief_ready':
      return buildBriefRow(db, accountId, d, base, nowIso)
    case 'reservation.updated':
      return buildReservationRow(db, accountId, d, base, nowIso)
    default:
      return null
  }
}
