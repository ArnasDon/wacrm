import type { SupabaseClient } from '@supabase/supabase-js'
import {
  answeredConversationCount,
  briefCompletionPercent,
  conversationFirstTimes,
  handoffsAdvancedCount,
  medianFirstResponseMinutes,
  recoveredConversationCount,
  temperatureDistribution,
} from './compute'
import type {
  ContactExportRow,
  DateWindow,
  KpiDataset,
  LeadRow,
  SpendEntry,
  TrialMetrics,
  WonDealRow,
} from './types'
import type { BucketGranularity } from '@/lib/dashboard/date-utils'

type DB = SupabaseClient

// Same "client-side aggregation, RLS scopes it automatically" contract
// as src/lib/dashboard/queries.ts — no account_id filters needed here.

/** Every contact created within `window` — the shared row set behind
 *  "leads generados", "leads calificados" and their time series (see
 *  src/lib/kpis/compute.ts). One query, several derived metrics. */
export async function loadLeadsInWindow(db: DB, window: DateWindow): Promise<LeadRow[]> {
  const { data, error } = await db
    .from('contacts')
    .select('id, created_at, lead_temperature')
    .gte('created_at', window.start.toISOString())
    .lt('created_at', endExclusive(window.end))
  if (error) throw error
  return (data ?? []) as LeadRow[]
}

/** Just the count — used for the previous-period comparison, where we
 *  don't need the full rows. */
export async function countLeadsInWindow(db: DB, window: DateWindow): Promise<number> {
  const { count, error } = await db
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', window.start.toISOString())
    .lt('created_at', endExclusive(window.end))
  if (error) throw error
  return count ?? 0
}

/** Every deal that became won within `window` — the shared row set
 *  behind "tasa de conversión", the sales funnel, and CAC. Filters on
 *  `won_at` (migration 064); falls back to `updated_at` only for a
 *  legacy row that predates the backfill (shouldn't happen, but the
 *  OR keeps a stray null from silently vanishing from every chart). */
export async function loadWonDealsInWindow(db: DB, window: DateWindow): Promise<WonDealRow[]> {
  const { data, error } = await db
    .from('deals')
    .select('id, won_at, updated_at, value, currency')
    .eq('status', 'won')
    .or(
      `and(won_at.gte.${window.start.toISOString()},won_at.lt.${endExclusive(window.end)}),` +
        `and(won_at.is.null,updated_at.gte.${window.start.toISOString()},updated_at.lt.${endExclusive(window.end)})`,
    )
  if (error) throw error
  return (data ?? []) as WonDealRow[]
}

export async function countWonDealsInWindow(db: DB, window: DateWindow): Promise<number> {
  const rows = await loadWonDealsInWindow(db, window)
  return rows.length
}

/** Every saved spend entry, oldest first — feeds the CAC-history
 *  chart. Small table (one row per period an admin bothered to log),
 *  no pagination needed. */
export async function loadSpendHistory(db: DB): Promise<SpendEntry[]> {
  const { data, error } = await db
    .from('kpi_period_spend')
    .select('id, period_start, period_end, amount, currency')
    .order('period_start', { ascending: true })
  if (error) throw error
  return (data ?? []) as SpendEntry[]
}

/** The spend entry for exactly this window, if one was already saved
 *  (pre-fills the input instead of showing blank on a revisit). */
export async function loadSpendForWindow(db: DB, window: DateWindow): Promise<SpendEntry | null> {
  const { data, error } = await db
    .from('kpi_period_spend')
    .select('id, period_start, period_end, amount, currency')
    .eq('period_start', dateOnly(window.start))
    .eq('period_end', dateOnly(window.end))
    .maybeSingle()
  if (error) throw error
  return (data as SpendEntry | null) ?? null
}

/** Upserts the spend figure for `window` — re-saving the same window
 *  updates in place (UNIQUE(account_id, period_start, period_end)). */
export async function saveSpendForWindow(
  db: DB,
  accountId: string,
  userId: string,
  window: DateWindow,
  amount: number,
  currency: string,
): Promise<void> {
  const { error } = await db.from('kpi_period_spend').upsert(
    {
      account_id: accountId,
      period_start: dateOnly(window.start),
      period_end: dateOnly(window.end),
      amount,
      currency,
      created_by: userId,
    },
    { onConflict: 'account_id,period_start,period_end' },
  )
  if (error) throw error
}

/** Every contact who wrote in during `window`, with the fields the
 *  "Contacts" export sheet needs — name, phone, derived channel, all
 *  their notes, and their most recent deal's stage. Three queries
 *  (contacts, then notes + deals in parallel, keyed by contact id)
 *  instead of one deep join: notes/deals are one-to-many, and a
 *  Supabase embedded-join would multiply the contact row per note or
 *  deal instead of collapsing it back down. Only called on export
 *  click, never for the on-screen KPIs, so the extra round-trips
 *  don't cost anything on page load. */
export async function loadContactExportRows(db: DB, window: DateWindow): Promise<ContactExportRow[]> {
  const { data: contacts, error } = await db
    .from('contacts')
    .select('id, name, phone, instagram_id, instagram_username, facebook_id, facebook_username, created_at')
    .gte('created_at', window.start.toISOString())
    .lt('created_at', endExclusive(window.end))
    .order('created_at', { ascending: true })
  if (error) throw error
  if (!contacts || contacts.length === 0) return []

  const ids = contacts.map((c) => c.id as string)
  const [notesRes, dealsRes] = await Promise.all([
    db
      .from('contact_notes')
      .select('contact_id, note_text, created_at')
      .in('contact_id', ids)
      .order('created_at', { ascending: true }),
    db
      .from('deals')
      .select('contact_id, created_at, stage:pipeline_stages(name)')
      .in('contact_id', ids)
      .order('created_at', { ascending: false }),
  ])
  if (notesRes.error) throw notesRes.error
  if (dealsRes.error) throw dealsRes.error

  const notesByContact = new Map<string, string[]>()
  for (const n of notesRes.data ?? []) {
    const row = n as Record<string, unknown>
    const contactId = row.contact_id as string
    const arr = notesByContact.get(contactId) ?? []
    arr.push(row.note_text as string)
    notesByContact.set(contactId, arr)
  }

  // Deals came back newest-first, so the first hit per contact is
  // their most recent — later ones for the same contact are ignored.
  const stageByContact = new Map<string, string>()
  for (const d of dealsRes.data ?? []) {
    const row = d as Record<string, unknown>
    const contactId = row.contact_id as string
    if (stageByContact.has(contactId)) continue
    const stage = row.stage as { name?: string } | null
    if (stage?.name) stageByContact.set(contactId, stage.name)
  }

  return contacts.map((c) => {
    const row = c as Record<string, unknown>
    const channel: ContactExportRow['channel'] = row.instagram_id
      ? 'instagram'
      : row.facebook_id
        ? 'facebook'
        : 'whatsapp'
    return {
      id: row.id as string,
      name: (row.name || row.instagram_username || row.facebook_username || row.phone || '') as string,
      phone: (row.phone as string | null) ?? null,
      channel,
      createdAt: row.created_at as string,
      notes: (notesByContact.get(row.id as string) ?? []).join(' | '),
      stage: stageByContact.get(row.id as string) ?? null,
    }
  })
}

/**
 * The operational "trial" metrics (see TrialMetrics). Bounded by the
 * window: everything is measured over messages / nudges / handoffs
 * that happened inside it, not "entities created in it". `leadIds` is
 * passed in (already loaded by `loadKpiDataset`) so brief-completion
 * doesn't re-query contacts.
 */
export async function loadTrialMetrics(
  db: DB,
  window: DateWindow,
  previousWindow: DateWindow,
  leadIds: string[],
): Promise<TrialMetrics> {
  const winStartIso = window.start.toISOString()
  const winEndExcl = endExclusive(window.end)

  const [msgRes, followupRes, handoffRes] = await Promise.all([
    // One contiguous fetch spanning both windows (previousWindow ends
    // right before window starts) — split in JS by `winStartIso`.
    db
      .from('messages')
      .select('conversation_id, sender_type, created_at')
      .gte('created_at', previousWindow.start.toISOString())
      .lt('created_at', winEndExcl)
      .limit(50000),
    db
      .from('ai_followup_log')
      .select('conversation_id, sent_at, error')
      .gte('sent_at', previousWindow.start.toISOString())
      .lt('sent_at', winEndExcl)
      .limit(20000),
    db
      .from('conversations')
      .select('contact_id, ai_handoff_at')
      .not('ai_handoff_at', 'is', null)
      .gte('ai_handoff_at', winStartIso)
      .lt('ai_handoff_at', winEndExcl)
      .limit(20000),
  ])
  if (msgRes.error) throw msgRes.error
  if (followupRes.error) throw followupRes.error
  if (handoffRes.error) throw handoffRes.error

  type MsgRow = { conversation_id: string; sender_type: string; created_at: string }
  const allMsgs = (msgRes.data ?? []) as MsgRow[]
  const curMsgs = allMsgs.filter((m) => m.created_at >= winStartIso)
  const prevMsgs = allMsgs.filter((m) => m.created_at < winStartIso)

  const curTimes = conversationFirstTimes(curMsgs)
  const prevTimes = conversationFirstTimes(prevMsgs)

  type FollowupRow = { conversation_id: string; sent_at: string; error: string | null }
  const allFollowups = (followupRes.data ?? []) as FollowupRow[]
  const curFollowups = allFollowups.filter((f) => f.sent_at >= winStartIso && !f.error)
  const prevFollowups = allFollowups.filter((f) => f.sent_at < winStartIso && !f.error)

  const curCustomerMsgs = curMsgs
    .filter((m) => m.sender_type === 'customer')
    .map((m) => ({ conversation_id: m.conversation_id, created_at: m.created_at }))

  const handoffs = (handoffRes.data ?? []) as {
    contact_id: string | null
    ai_handoff_at: string
  }[]

  let handoffsAdvanced = 0
  const handoffContactIds = [...new Set(handoffs.map((h) => h.contact_id).filter((x): x is string => !!x))]
  if (handoffContactIds.length > 0) {
    const { data: deals } = await db
      .from('deals')
      .select('contact_id, status, won_at, updated_at')
      .in('contact_id', handoffContactIds)
    handoffsAdvanced = handoffsAdvancedCount(
      handoffs,
      (deals ?? []) as { contact_id: string; status: string; won_at: string | null; updated_at: string }[],
    )
  }

  // Brief completion — chunk the .in() so a big lead set stays under
  // PostgREST's IN-clause cap (same pattern as fetchCustomValueIndex).
  const withValues = new Set<string>()
  const PAGE = 400
  for (let i = 0; i < leadIds.length; i += PAGE) {
    const slice = leadIds.slice(i, i + PAGE)
    const { data } = await db
      .from('contact_custom_values')
      .select('contact_id')
      .in('contact_id', slice)
    for (const row of (data ?? []) as { contact_id: string }[]) withValues.add(row.contact_id)
  }

  return {
    conversationsActive: curTimes.size,
    conversationsAnswered: answeredConversationCount(curTimes),
    medianFirstResponseMin: medianFirstResponseMinutes(curTimes),
    prevMedianFirstResponseMin: medianFirstResponseMinutes(prevTimes),
    followupsSent: curFollowups.length,
    prevFollowupsSent: prevFollowups.length,
    opportunitiesRecovered: recoveredConversationCount(
      curFollowups.map((f) => ({ conversation_id: f.conversation_id, sent_at: f.sent_at })),
      curCustomerMsgs,
    ),
    handoffs: handoffs.length,
    handoffsAdvanced,
    briefCompletionPct: briefCompletionPercent(leadIds, withValues),
  }
}

/**
 * Fetches everything the KPIs page needs for one render in a single
 * batch — the page component's only query entry point. Individual
 * `load*`/`count*` functions above stay exported for direct reuse
 * (e.g. a future "just the funnel" widget) and unit-friendliness.
 */
export async function loadKpiDataset(
  db: DB,
  window: DateWindow,
  previousWindow: DateWindow,
  granularity: BucketGranularity,
): Promise<KpiDataset> {
  const [leads, previousLeadsCount, wonDeals, previousWonCount, spendHistory, currentPeriodSpend] =
    await Promise.all([
      loadLeadsInWindow(db, window),
      countLeadsInWindow(db, previousWindow),
      loadWonDealsInWindow(db, window),
      countWonDealsInWindow(db, previousWindow),
      loadSpendHistory(db),
      loadSpendForWindow(db, window),
    ])

  // Needs the lead ids from the batch above, so it runs after.
  const trial = await loadTrialMetrics(
    db,
    window,
    previousWindow,
    leads.map((l) => l.id),
  )

  return {
    granularity,
    window,
    previousWindow,
    leads,
    previousLeadsCount,
    wonDeals,
    previousWonCount,
    temperature: temperatureDistribution(leads),
    spendHistory,
    currentPeriodSpend,
    trial,
  }
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** `window.end` is inclusive by convention everywhere in this module
 *  (matches how the KPIs page's date pickers work — "last 30 days"
 *  includes today) — Postgres range queries need an exclusive upper
 *  bound, so every `.lt(...)` call uses this: midnight the day AFTER
 *  `end`. */
function endExclusive(end: Date): string {
  const out = new Date(end)
  out.setHours(0, 0, 0, 0)
  out.setDate(out.getDate() + 1)
  return out.toISOString()
}
