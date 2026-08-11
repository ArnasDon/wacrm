// ============================================================
// Reporting — queries server-side (DAD §7.6, Item 15).
//
// Agregaciones por rango sobre el esquema 047: contacts.attribution
// (canales/campañas/ads), deals.won_at/lost_at (fechas reales de
// cierre, sin proxy updated_at), email_sends (persistido por 048) y
// calls (039). Todas son SELECT de solo lectura con service_role;
// el cliente NUNCA toca estas tablas directo.
//
// TENENCIA — leer antes de añadir un cargador nuevo.
//
// `supabaseAdmin()` usa la service-role key, que salta RLS por diseño. Aquí
// no hay ninguna política que nos proteja: si una consulta no lleva
// `.eq('account_id', …)`, devuelve las filas de TODAS las cuentas. Con una
// sola cuenta no se nota; en cuanto existe una segunda, /reports enseña los
// datos de las dos.
//
// Por eso los ocho cargadores reciben `accountId` como PRIMER parámetro y
// lo aplican a cada tabla que tocan (`contacts`, `deals`, `calls`,
// `email_sends`, `tracking_events` — todas la tienen). Los tres helpers
// internos lo reciben igual: un helper sin filtrar reabre el agujero por
// detrás aunque el cargador que lo llama sí filtre.
// ============================================================

import { supabaseAdmin } from '@/lib/automations/admin-client'

export interface DateRange {
  from: string // ISO
  to: string // ISO
}

/** PostgREST serializa numeric/bigint como string en JSON — normaliza. */
function toNumber(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

export interface ReportOverview {
  revenue_won: number
  pipeline_value: number
  leads: number
  conversion_rate: number
  calls: number
  emails_sent: number
  emails_delivered: number
}

export interface CampaignRow {
  campaign: string
  leads: number
  deals: number
  revenue: number
}

export interface ChannelRow {
  channel: string
  leads: number
  revenue: number
}

export interface AdsRow {
  click_id: string
  click_type: string
  leads: number
  revenue: number
}



export interface TopLeadRow {
  id: string
  name: string
  score: number
  priority: string
  status: string
  value: number | null
  won_at: string | null
  lost_at: string | null
  /** Canal de origen del contacto (first-touch, DAD §8.2 P2.1): channel
   *  si existe, si no ref_code, si no null. */
  source_channel: string | null
}

export interface LostDealRow {
  id: string
  name: string
  contact_name: string
  lost_at: string
  tags: Record<string, unknown> | null
  score: number
  reason: string | null
  /** Canal de origen del contacto (first-touch). */
  source_channel: string | null
}

/** Overview — KPIs del rango. revenue usa won_at real (no updated_at). */
export async function loadOverview(
  accountId: string,
  range: DateRange,
): Promise<ReportOverview> {
  const db = supabaseAdmin()

  const [won, pipeline, leads, calls, email] = await Promise.all([
    db
      .from('deals')
      .select('value, won_at')
      .eq('account_id', accountId)
      .eq('status', 'won')
      .gte('won_at', range.from)
      .lte('won_at', range.to),
    db
      .from('deals')
      .select('value')
      .eq('account_id', accountId)
      .eq('status', 'open'),
    db
      .from('contacts')
      .select('id, created_at')
      .eq('account_id', accountId)
      .gte('created_at', range.from)
      .lte('created_at', range.to),
    db
      .from('calls')
      // La columna es `duration_sec` (migración 039), no `duration_seconds`.
      // Con el nombre viejo PostgREST devolvía 400 `column calls.duration_seconds
      // does not exist`, así que este KPI contaba siempre 0 llamadas.
      .select('id, duration_sec')
      .eq('account_id', accountId)
      .gte('created_at', range.from)
      .lte('created_at', range.to),
    db
      .from('email_sends')
      .select('status')
      .eq('account_id', accountId)
      .gte('sent_at', range.from)
      .lte('sent_at', range.to),
  ])

  const wonRows = won.data ?? []
  const pipelineRows = pipeline.data ?? []
  const leadRows = leads.data ?? []
  const callRows = calls.data ?? []
  const emailRows = email.data ?? []

  const revenue_won = wonRows.reduce((acc, d) => acc + toNumber(d.value), 0)
  const pipeline_value = pipelineRows.reduce((acc, d) => acc + toNumber(d.value), 0)
  const withDeal = leadRows.length ? await countLeadsWithDeal(accountId, range) : 0
  const conversion_rate =
    leadRows.length === 0 ? 0 : Math.round((withDeal / leadRows.length) * 1000) / 10

  return {
    revenue_won,
    pipeline_value,
    leads: leadRows.length,
    conversion_rate,
    calls: callRows.length,
    emails_sent: emailRows.filter((e) => e.status !== 'failed').length,
    emails_delivered: emailRows.filter((e) => e.status === 'delivered').length,
  }
}

async function countLeadsWithDeal(
  accountId: string,
  range: DateRange,
): Promise<number> {
  // Contacts con >=1 deal (FK real deals.contact_id → contacts.id).
  // Embedded !inner = INNER JOIN en PostgREST (precedente webhook/route.ts:488).
  const { count } = await supabaseAdmin()
    .from('contacts')
    .select('id, deals!inner(id)', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .gte('created_at', range.from)
    .lte('created_at', range.to)
  return count ?? 0
}

/** Campañas — agrupado por attribution->utm->campaign. */
export async function loadCampaigns(
  accountId: string,
  range: DateRange,
): Promise<CampaignRow[]> {
  const db = supabaseAdmin()
  // deals!inner trae los contactos CON deal (contamos cuántos deals tiene
  // cada contacto del rango vía la relación deals.contact_id → contacts.id).
  const { data } = await db
    .from('contacts')
    .select('attribution, id, deals!inner(id)')
    .eq('account_id', accountId)
    .gte('created_at', range.from)
    .lte('created_at', range.to)

  const rows = data ?? []
  const byCampaign = new Map<string, CampaignRow>()
  for (const c of rows) {
    const campaign = (c.attribution as { utm?: { campaign?: string } } | null)?.utm?.campaign
    const key = campaign && campaign !== '' ? campaign : '(sin campaña)'
    const cur = byCampaign.get(key) ?? { campaign: key, leads: 0, deals: 0, revenue: 0 }
    cur.leads += 1
    const dealList = c.deals as Array<{ id: string }> | null
    cur.deals += dealList?.length ?? 0
    byCampaign.set(key, cur)
  }
  // Revenue por campaña: deals del rango ganados, cruzados por contacto.
  await attachRevenueByContact(accountId, byCampaign, range, 'campaign')
  return [...byCampaign.values()].sort((a, b) => b.leads - a.leads)
}

/** Canales — agrupado por attribution->channel. */
export async function loadChannels(
  accountId: string,
  range: DateRange,
): Promise<ChannelRow[]> {
  const db = supabaseAdmin()
  const { data } = await db
    .from('contacts')
    .select('attribution, id')
    .eq('account_id', accountId)
    .gte('created_at', range.from)
    .lte('created_at', range.to)

  const rows = data ?? []
  const byChannel = new Map<string, ChannelRow>()
  for (const c of rows) {
    const channel = (c.attribution as { channel?: string } | null)?.channel ?? 'direct'
    const cur = byChannel.get(channel) ?? { channel, leads: 0, revenue: 0 }
    cur.leads += 1
    byChannel.set(channel, cur)
  }
  await attachRevenueByContact(accountId, byChannel, range, 'channel')
  return [...byChannel.values()].sort((a, b) => b.leads - a.leads)
}

/** Ads — agrupado por click_id (gclid/fbclid/ctwa_clid/...). */
export async function loadAds(
  accountId: string,
  range: DateRange,
): Promise<AdsRow[]> {
  const db = supabaseAdmin()
  const { data } = await db
    .from('contacts')
    .select('attribution, id')
    .eq('account_id', accountId)
    .gte('created_at', range.from)
    .lte('created_at', range.to)

  const rows = data ?? []
  const byClick = new Map<string, AdsRow>()
  for (const c of rows) {
    const clickIds = (c.attribution as { click_ids?: Record<string, string> } | null)?.click_ids ?? {}
    const entries = Object.entries(clickIds).filter(([k, v]) => (k !== 'ctwa_clid' || v) && v)
    if (entries.length === 0) continue
    for (const [k, v] of entries) {
      const key = `${k}:${v}`
      const cur = byClick.get(key) ?? { click_id: v, click_type: k, leads: 0, revenue: 0 }
      cur.leads += 1
      byClick.set(key, cur)
    }
  }
  await attachRevenueByContact(accountId, byClick, range, 'ads')
  return [...byClick.values()].sort((a, b) => b.leads - a.leads)
}



/**
 * Top leads — por score desc, fallback value, dentro del rango.
 *
 * Antes el parámetro se recibía y se tiraba (`_range`), así que el selector
 * de fechas de la cabecera no hacía nada en esta pestaña. Ahora acota por
 * `created_at` del deal, que es la fecha que el resto de pestañas usa para
 * "entró en el rango".
 */
export async function loadTopLeads(
  accountId: string,
  range: DateRange,
): Promise<TopLeadRow[]> {
  const db = supabaseAdmin()
  const { data } = await db
    .from('deals')
    // La columna es `title`; `deals.name` no existe y hacía que la consulta
    // devolviera 400, dejando la pestaña siempre vacía. Se expone como
    // `name` más abajo para no cambiar el contrato con la UI.
    .select('id, title, contact_id, score, priority, status, value, won_at, lost_at')
    .eq('account_id', accountId)
    .gte('created_at', range.from)
    .lte('created_at', range.to)
    .order('score', { ascending: false })
    .order('value', { ascending: false, nullsFirst: false })
    .limit(20)

  const rows = (data ?? []) as Array<
    Omit<TopLeadRow, 'name' | 'source_channel'> & {
      title: string
      contact_id: string | null
    }
  >
  const channels = await loadSourceChannels(accountId, rows.map((r) => r.contact_id))
  return rows.map((r) => ({
    ...r,
    name: r.title,
    // PostgREST devuelve numeric como string — normalizar para fmtMoney.
    value: r.value == null ? null : toNumber(r.value),
    source_channel: channels.get(r.contact_id ?? '') ?? null,
  }))
}

/** Perdidos — status=lost con lost_at real + razón del último state_changed. */
export async function loadLost(
  accountId: string,
  range: DateRange,
): Promise<LostDealRow[]> {
  const db = supabaseAdmin()
  const { data } = await db
    .from('deals')
    // `title`, no `name` — ver la nota en loadTopLeads.
    .select('id, title, contact_id, lost_at, tags, score')
    .eq('account_id', accountId)
    .eq('status', 'lost')
    .gte('lost_at', range.from)
    .lte('lost_at', range.to)
    .order('lost_at', { ascending: false })

  const rows = (data ?? []) as Array<{
    id: string
    title: string
    contact_id: string | null
    lost_at: string
    tags: Record<string, unknown> | null
    score: number
  }>

  // Razón del último estado: tracking_events state_changed con override_reason.
  const ids = rows.map((r) => r.id)
  const reasons = new Map<string, string | null>()
  if (ids.length) {
    const { data: events } = await db
      .from('tracking_events')
      .select('payload')
      .eq('account_id', accountId)
      .eq('event_type', 'state_changed')
      .in('payload->>deal_id', ids)
      .order('created_at', { ascending: false })
    for (const e of events ?? []) {
      const dealId = (e.payload as { deal_id?: string } | null)?.deal_id
      const reason = (e.payload as { override_reason?: string } | null)?.override_reason ?? null
      if (dealId && !reasons.has(dealId)) reasons.set(dealId, reason)
    }
  }

  const channels = await loadSourceChannels(accountId, rows.map((r) => r.contact_id))
  return rows.map((r) => ({
    id: r.id,
    name: r.title,
    contact_name: r.title,
    lost_at: r.lost_at,
    tags: r.tags,
    score: r.score,
    reason: reasons.get(r.id) ?? null,
    source_channel: channels.get(r.contact_id ?? '') ?? null,
  }))
}

// ------------------------------------------------------------------
// First-touch attribution (DAD §8.2 P2.1): canal de origen del
// contacto. Resuelve el `attribution` de N contactos en UNA query.
// Prioridad: channel → ref_code (opaco, es el first-touch del
// landing) → null (directo/manual).
// ------------------------------------------------------------------
async function loadSourceChannels(
  accountId: string,
  contactIds: (string | null)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(contactIds.filter(Boolean) as string[])]
  const map = new Map<string, string>()
  if (ids.length === 0) return map

  const { data } = await supabaseAdmin()
    .from('contacts')
    .select('id, attribution')
    .eq('account_id', accountId)
    .in('id', ids)

  for (const c of data ?? []) {
    const attr = c.attribution as {
      channel?: string
      ref_code?: string
    } | null
    if (attr?.channel && attr.channel !== '') map.set(c.id, attr.channel)
    else if (attr?.ref_code) map.set(c.id, `ref:${attr.ref_code}`)
    else map.set(c.id, 'direct')
  }
  return map
}

// ------------------------------------------------------------------
// Helper: atar revenue de deals ganados a las filas agregadas por
// contacto (campaign/channel/ads). Consulta los deals del rango por
// won_at y los cruza con el contacto via deal_id.
// ------------------------------------------------------------------
async function attachRevenueByContact(
  accountId: string,
  byKey: Map<string, { revenue: number }>,
  range: DateRange,
  kind: 'campaign' | 'channel' | 'ads',
): Promise<void> {
  const { data } = await supabaseAdmin()
    .from('deals')
    .select('value, contact_id')
    .eq('account_id', accountId)
    .eq('status', 'won')
    .gte('won_at', range.from)
    .lte('won_at', range.to)
  const wonDeals = data ?? []
  if (wonDeals.length === 0) return

  // Contacto → campaign/channel/ads: cargamos la atribución de los
  // contactos ganadores una sola vez.
  const contactIds = [...new Set(wonDeals.map((d) => d.contact_id).filter(Boolean))]
  if (contactIds.length === 0) return
  const { data: contacts } = await supabaseAdmin()
    .from('contacts')
    .select('id, attribution')
    .eq('account_id', accountId)
    .in('id', contactIds)
  const contactAttr = new Map<string, { campaign?: string; channel?: string; click_ids?: Record<string, string> }>()
  for (const c of contacts ?? []) {
    const attr = c.attribution as { utm?: { campaign?: string }; channel?: string; click_ids?: Record<string, string> } | null
    contactAttr.set(c.id, {
      campaign: attr?.utm?.campaign,
      channel: attr?.channel,
      click_ids: attr?.click_ids,
    })
  }

  for (const d of wonDeals) {
    const attr = contactAttr.get(d.contact_id)
    const value = toNumber(d.value)
    let key: string | null = null
    if (kind === 'campaign') key = attr?.campaign && attr.campaign !== '' ? attr.campaign : '(sin campaña)'
    else if (kind === 'channel') key = attr?.channel ?? 'direct'
    else {
      const clickIds = attr?.click_ids ?? {}
      const entries = Object.entries(clickIds).filter(([, v]) => v)
      if (entries.length) {
        const [k, v] = entries[0]
        key = `${k}:${v}`
      }
    }
    if (!key) continue
    const row = byKey.get(key)
    if (row) row.revenue += value
  }
}
