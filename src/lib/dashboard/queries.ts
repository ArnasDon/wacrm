import type { SupabaseClient } from '@supabase/supabase-js'
import type { CurrencyTotal } from '@/lib/currency'
import {
  daysAgoStart,
  DOW_SHORT_MON_FIRST,
  lastNDayKeys,
  localDayKey,
  mondayIndex,
  startOfLocalDay,
} from './date-utils'
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  HandoffWaitSummary,
  MetricsBundle,
  PipelineStageSlice,
  PipelineSummary,
  ResponseTimeBucket,
  ResponseTimeSummary,
} from './types'

// Accumulates per-currency totals without ever summing across
// currencies. Shared by the open-deals metric and the pipeline
// breakdown so both use the exact same (correct) aggregation.
function addToCurrencyTotals(totals: Map<string, number>, currency: string | null, amount: number) {
  const code = currency || 'USD'
  totals.set(code, (totals.get(code) ?? 0) + amount)
}
function toCurrencyTotalsArray(totals: Map<string, number>): CurrencyTotal[] {
  return Array.from(totals.entries())
    .map(([currency, value]) => ({ currency, value }))
    .sort((a, b) => b.value - a.value)
}

// ------------------------------------------------------------
// All client-side aggregation. RLS scopes every query to the
// signed-in user automatically, so we never pass user_id explicitly
// here. Perf is acceptable for the current scale (low thousands of
// messages) — if a tenant's dataset outgrows this, we'd migrate the
// heavy aggregations to SQL RPCs. Noted in the PR.
// ------------------------------------------------------------

type DB = SupabaseClient

// --- 1. Metric cards ---------------------------------------------------

export async function loadMetrics(db: DB): Promise<MetricsBundle> {
  const todayStart = startOfLocalDay().toISOString()
  const yesterdayStart = daysAgoStart(1).toISOString()

  const [
    openConvCur,
    newConvToday,
    newConvYesterday,
    newContactsToday,
    newContactsYesterday,
    openDeals,
    messagesToday,
    messagesYesterday,
  ] = await Promise.all([
    db.from('conversations').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    db
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .gte('created_at', todayStart),
    db
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .gte('created_at', yesterdayStart)
      .lt('created_at', todayStart),
    db.from('contacts').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
    db
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', yesterdayStart)
      .lt('created_at', todayStart),
    db.from('deals').select('value, currency, status').eq('status', 'open'),
    db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('sender_type', 'agent')
      .gte('created_at', todayStart),
    db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('sender_type', 'agent')
      .gte('created_at', yesterdayStart)
      .lt('created_at', todayStart),
  ])

  const openDealsRows = (openDeals.data ?? []) as { value: number | null; currency: string | null }[]
  const openDealsTotals = new Map<string, number>()
  for (const d of openDealsRows) addToCurrencyTotals(openDealsTotals, d.currency, d.value ?? 0)

  return {
    activeConversations: {
      current: openConvCur.count ?? 0,
      // "vs yesterday" on a current-state count has no clean answer
      // without snapshots — we show the delta in NEW open conversations
      // today vs yesterday. That's the business-meaningful daily signal.
      previous: (newConvToday.count ?? 0) - (newConvYesterday.count ?? 0),
    },
    newContactsToday: {
      current: newContactsToday.count ?? 0,
      previous: newContactsYesterday.count ?? 0,
    },
    openDealsByCurrency: toCurrencyTotalsArray(openDealsTotals),
    openDealsCount: openDealsRows.length,
    messagesSentToday: {
      current: messagesToday.count ?? 0,
      previous: messagesYesterday.count ?? 0,
    },
  }
}

// --- 2. Conversations over time ---------------------------------------

export async function loadConversationsSeries(
  db: DB,
  rangeDays: number,
): Promise<ConversationsSeriesPoint[]> {
  const start = daysAgoStart(rangeDays - 1).toISOString()
  const { data, error } = await db
    .from('messages')
    .select('created_at, sender_type')
    .gte('created_at', start)
    .order('created_at', { ascending: true })
  if (error) throw error

  const keys = lastNDayKeys(rangeDays)
  const buckets = new Map<string, { incoming: number; outgoing: number }>()
  for (const k of keys) buckets.set(k, { incoming: 0, outgoing: 0 })

  for (const row of (data ?? []) as { created_at: string; sender_type: string }[]) {
    const key = localDayKey(row.created_at)
    const bucket = buckets.get(key)
    if (!bucket) continue
    if (row.sender_type === 'customer') bucket.incoming += 1
    else bucket.outgoing += 1 // agent + bot both count as outgoing
  }

  return keys.map((day) => ({ day, ...(buckets.get(day) ?? { incoming: 0, outgoing: 0 }) }))
}

// --- 3. Pipelines overview ----------------------------------------------
//
// One breakdown per pipeline (accounts can run more than one — e.g. a
// separate pipeline per market/language) instead of pooling every
// pipeline's stages into a single ring. Totals are kept per currency:
// a deal's `value` is only ever added to other deals sharing its exact
// `currency`, never blended across currencies.

export async function loadPipelinesOverview(db: DB): Promise<PipelineSummary[]> {
  const [pipelinesRes, stagesRes, dealsRes] = await Promise.all([
    db.from('pipelines').select('id, name').order('created_at'),
    db.from('pipeline_stages').select('id, name, color, pipeline_id, position').order('position'),
    db.from('deals').select('pipeline_id, stage_id, contact_id, value, currency, status').eq('status', 'open'),
  ])

  const pipelines = (pipelinesRes.data ?? []) as { id: string; name: string }[]
  const stages =
    (stagesRes.data ?? []) as { id: string; name: string; color: string; pipeline_id: string }[]
  const deals =
    (dealsRes.data ?? []) as {
      pipeline_id: string
      stage_id: string
      contact_id: string | null
      value: number | null
      currency: string | null
    }[]

  const dealsByStage = new Map<string, typeof deals>()
  for (const d of deals) {
    const bucket = dealsByStage.get(d.stage_id) ?? []
    bucket.push(d)
    dealsByStage.set(d.stage_id, bucket)
  }

  return pipelines.map((p): PipelineSummary => {
    const pipelineStages = stages.filter((s) => s.pipeline_id === p.id)
    const pipelineTotals = new Map<string, number>()
    // Distinct contacts across the whole pipeline, not a sum of each
    // stage's count — a contact with deals in two stages of the same
    // pipeline is still one person.
    const pipelinePeople = new Set<string>()

    const stageSlices: PipelineStageSlice[] = pipelineStages.map((s) => {
      const stageDeals = dealsByStage.get(s.id) ?? []
      const stageTotals = new Map<string, number>()
      // People, not deal rows: a contact with two open deals in the
      // same stage is still one person waiting there.
      const stagePeople = new Set<string>()
      for (const d of stageDeals) {
        addToCurrencyTotals(stageTotals, d.currency, d.value ?? 0)
        addToCurrencyTotals(pipelineTotals, d.currency, d.value ?? 0)
        if (d.contact_id) {
          stagePeople.add(d.contact_id)
          pipelinePeople.add(d.contact_id)
        }
      }
      return {
        id: s.id,
        name: s.name,
        color: s.color || '#64748b',
        peopleCount: stagePeople.size,
        totalsByCurrency: toCurrencyTotalsArray(stageTotals),
      }
    })

    return {
      id: p.id,
      name: p.name,
      // Hide stages with no open deals — keeps the breakdown focused on
      // where the pipeline's value actually sits.
      stages: stageSlices.filter((s) => s.peopleCount > 0),
      peopleCount: pipelinePeople.size,
      totalsByCurrency: toCurrencyTotalsArray(pipelineTotals),
    }
  })
}

// --- 4. Response time by day of week ----------------------------------

export async function loadResponseTime(db: DB): Promise<ResponseTimeSummary> {
  // Pull the last 14 days of messages in one shot, then walk per
  // conversation to find each "first inbound" → "first subsequent
  // outbound" pair. 14 days gives us both "this week" + "last week"
  // with enough overlap if the user opens the dashboard late on a
  // Monday.
  const fourteenDaysAgo = daysAgoStart(13).toISOString()
  const { data, error } = await db
    .from('messages')
    .select('conversation_id, sender_type, created_at')
    .gte('created_at', fourteenDaysAgo)
    .order('conversation_id', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error

  const rows = (data ?? []) as {
    conversation_id: string
    sender_type: string
    created_at: string
  }[]

  // Group per conversation, pair unreplied customer messages with the
  // next outbound message from the agent/bot. A single customer message
  // can only count once (avoids inflating averages if the customer
  // double-messages while the agent takes time to reply).
  interface Sample {
    customerAt: Date
    responseAt: Date
  }
  const samples: Sample[] = []

  let currentConv = ''
  let pendingCustomer: Date | null = null
  for (const row of rows) {
    if (row.conversation_id !== currentConv) {
      currentConv = row.conversation_id
      pendingCustomer = null
    }
    const ts = new Date(row.created_at)
    if (row.sender_type === 'customer') {
      if (!pendingCustomer) pendingCustomer = ts
    } else if (pendingCustomer) {
      samples.push({ customerAt: pendingCustomer, responseAt: ts })
      pendingCustomer = null
    }
  }

  const now = new Date()
  const thisWeekStart = daysAgoStart(mondayIndex(now))
  const lastWeekStart = daysAgoStart(mondayIndex(now) + 7)

  // Per-day-of-week buckets, averaged over both weeks' worth of data
  // so each bar has more samples to stand on. If a day has no samples
  // its avgMinutes stays null and the chart renders the bar muted.
  const byDow = new Map<number, number[]>()
  for (let i = 0; i < 7; i++) byDow.set(i, [])
  const thisWeekMins: number[] = []
  const lastWeekMins: number[] = []

  for (const s of samples) {
    const diffMin = (s.responseAt.getTime() - s.customerAt.getTime()) / 60_000
    if (diffMin < 0) continue
    const dow = mondayIndex(s.customerAt)
    byDow.get(dow)!.push(diffMin)
    if (s.customerAt >= thisWeekStart) {
      thisWeekMins.push(diffMin)
    } else if (s.customerAt >= lastWeekStart && s.customerAt < thisWeekStart) {
      lastWeekMins.push(diffMin)
    }
  }

  const avg = (arr: number[]) =>
    arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length

  const buckets: ResponseTimeBucket[] = Array.from({ length: 7 }, (_, dow) => {
    const samples = byDow.get(dow) ?? []
    return {
      dow,
      avgMinutes: avg(samples),
      samples: samples.length,
    }
  })

  // Silence unused-label warnings — keep the arrays explicitly named
  // for readability above.
  void DOW_SHORT_MON_FIRST

  return {
    buckets,
    thisWeekAvg: avg(thisWeekMins),
    lastWeekAvg: avg(lastWeekMins),
  }
}

// --- 5. Human handoff wait time -----------------------------------------
//
// Distinct from `loadResponseTime` above: this only looks at
// conversations the AI itself handed off (`ai_handoff_at`, migration
// 070), and measures how long a human took to actually pick one up —
// the first `messages` row after the handoff with `sender_type =
// 'agent' AND ai_generated = false` (a genuine human reply, the bot
// stays silent on a handed-off thread by design). Two queries rather
// than a join: PostgREST can't filter "messages after this specific
// conversation's own timestamp" server-side, so we pull both sets and
// pair them client-side, same approach as `loadResponseTime`.

export async function loadHandoffWait(db: DB): Promise<HandoffWaitSummary> {
  const windowStart = daysAgoStart(29).toISOString() // last 30 days

  const { data: handoffs, error: handoffErr } = await db
    .from('conversations')
    .select('id, ai_handoff_at')
    .not('ai_handoff_at', 'is', null)
    .gte('ai_handoff_at', windowStart)
  if (handoffErr) throw handoffErr

  const rows = (handoffs ?? []) as { id: string; ai_handoff_at: string }[]
  if (rows.length === 0) return { avgMinutes: null, samples: 0, pendingCount: 0 }

  const handoffAtByConv = new Map(rows.map((r) => [r.id, new Date(r.ai_handoff_at).getTime()]))

  const { data: msgs, error: msgErr } = await db
    .from('messages')
    .select('conversation_id, created_at')
    .in('conversation_id', rows.map((r) => r.id))
    .eq('sender_type', 'agent')
    .eq('ai_generated', false)
    .order('created_at', { ascending: true })
  if (msgErr) throw msgErr

  // First human reply strictly after that conversation's own handoff
  // time. Rows arrive sorted ascending, so the first match per
  // conversation is already the earliest one.
  const firstReplyAt = new Map<string, number>()
  for (const m of (msgs ?? []) as { conversation_id: string; created_at: string }[]) {
    if (firstReplyAt.has(m.conversation_id)) continue
    const handoffAt = handoffAtByConv.get(m.conversation_id)
    if (handoffAt === undefined) continue
    const ts = new Date(m.created_at).getTime()
    if (ts > handoffAt) firstReplyAt.set(m.conversation_id, ts)
  }

  const waitMinutes: number[] = []
  let pendingCount = 0
  for (const row of rows) {
    const replyAt = firstReplyAt.get(row.id)
    if (replyAt === undefined) {
      pendingCount += 1
      continue
    }
    waitMinutes.push((replyAt - handoffAtByConv.get(row.id)!) / 60_000)
  }

  return {
    avgMinutes: waitMinutes.length
      ? waitMinutes.reduce((a, b) => a + b, 0) / waitMinutes.length
      : null,
    samples: waitMinutes.length,
    pendingCount,
  }
}

// --- 6. Activity feed --------------------------------------------------

export async function loadActivity(db: DB, limit = 20): Promise<ActivityItem[]> {
  // Pull ~10 from each source (plenty of headroom after merge-sort),
  // then interleave by timestamp. The individual per-table limits
  // keep the payload small; the final limit is enforced after sort.
  const [msgs, contacts, deals, broadcasts, autoLogs] = await Promise.all([
    db
      .from('messages')
      .select('id, content_text, sender_type, created_at, conversation_id, conversations(contact_id, contacts(name, phone))')
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(10),
    db
      .from('contacts')
      .select('id, name, phone, created_at')
      .order('created_at', { ascending: false })
      .limit(10),
    db
      .from('deals')
      .select('id, title, updated_at, stage:pipeline_stages(name)')
      .order('updated_at', { ascending: false })
      .limit(10),
    db
      .from('broadcasts')
      .select('id, name, status, total_recipients, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
    db
      .from('automation_logs')
      .select('id, trigger_event, status, created_at, automation:automations(name), contact:contacts(name, phone)')
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const items: ActivityItem[] = []

  // PostgREST returns nested selections as arrays by default, even when
  // the foreign key is 1:1. We normalise by taking [0] on each level.
  for (const m of (msgs.data ?? []) as unknown as Array<{
    id: string
    content_text: string | null
    created_at: string
    conversation_id: string
    conversations:
      | { contact_id: string | null; contacts: { name: string | null; phone: string }[] | { name: string | null; phone: string } | null }[]
      | { contact_id: string | null; contacts: { name: string | null; phone: string }[] | { name: string | null; phone: string } | null }
      | null
  }>) {
    const conv = Array.isArray(m.conversations) ? m.conversations[0] : m.conversations
    const contact = Array.isArray(conv?.contacts) ? conv?.contacts[0] : conv?.contacts
    const who = contact?.name || contact?.phone || 'Unknown'
    items.push({
      id: `msg-${m.id}`,
      kind: 'message',
      text: `New message from ${who}`,
      at: m.created_at,
      href: `/inbox?c=${m.conversation_id}`,
    })
  }

  for (const c of (contacts.data ?? []) as Array<{ id: string; name: string | null; phone: string; created_at: string }>) {
    items.push({
      id: `contact-${c.id}`,
      kind: 'contact',
      text: `New contact: ${c.name || c.phone}`,
      at: c.created_at,
      href: '/contacts',
    })
  }

  for (const d of (deals.data ?? []) as unknown as Array<{
    id: string
    title: string
    updated_at: string
    stage: { name: string }[] | { name: string } | null
  }>) {
    const stage = Array.isArray(d.stage) ? d.stage[0] : d.stage
    items.push({
      id: `deal-${d.id}`,
      kind: 'deal',
      text: stage?.name
        ? `Deal "${d.title}" in ${stage.name}`
        : `Deal "${d.title}" updated`,
      at: d.updated_at,
      href: '/pipelines',
    })
  }

  for (const b of (broadcasts.data ?? []) as Array<{
    id: string
    name: string
    status: string
    total_recipients: number
    created_at: string
  }>) {
    const label =
      b.status === 'sent'
        ? `sent to ${b.total_recipients} contacts`
        : `${b.status} (${b.total_recipients} recipients)`
    items.push({
      id: `broadcast-${b.id}`,
      kind: 'broadcast',
      text: `Broadcast "${b.name}" ${label}`,
      at: b.created_at,
      href: '/broadcasts',
    })
  }

  for (const l of (autoLogs.data ?? []) as unknown as Array<{
    id: string
    trigger_event: string
    status: string
    created_at: string
    automation: { name: string }[] | { name: string } | null
    contact: { name: string | null; phone: string }[] | { name: string | null; phone: string } | null
  }>) {
    const automation = Array.isArray(l.automation) ? l.automation[0] : l.automation
    const contact = Array.isArray(l.contact) ? l.contact[0] : l.contact
    const who = contact?.name || contact?.phone || 'a contact'
    const autoName = automation?.name || 'Automation'
    items.push({
      id: `auto-${l.id}`,
      kind: 'automation',
      text: `Automation "${autoName}" ${l.status === 'failed' ? 'failed for' : 'triggered for'} ${who}`,
      at: l.created_at,
    })
  }

  return items
    .sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0))
    .slice(0, limit)
}
