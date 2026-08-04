import type { SupabaseClient } from '@supabase/supabase-js'
import { daysAgoStart, startOfLocalDay } from './date-utils'
import type { FirstResponseMetric, LeadsTodayMetric } from './types'

// ------------------------------------------------------------
// Client-side aggregation, same tradeoff noted in the previous
// version of this file: fine at the current scale (low thousands of
// messages), RLS scopes every query to the signed-in account
// automatically. count_unanswered_conversations is the one query that
// can't be time-windowed (an unanswered lead from weeks ago must
// still count), so that one is a real SQL RPC instead.
// ------------------------------------------------------------

type DB = SupabaseClient

// --- Card 1: Leads Hoje -------------------------------------------------

export async function loadLeadsToday(db: DB): Promise<LeadsTodayMetric> {
  const todayStart = startOfLocalDay().toISOString()
  const yesterdayStart = daysAgoStart(1).toISOString()

  const [today, yesterday] = await Promise.all([
    db.from('contacts').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
    db
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', yesterdayStart)
      .lt('created_at', todayStart),
  ])

  return { current: today.count ?? 0, previous: yesterday.count ?? 0 }
}

// --- Card 2: Leads Não Respondidos --------------------------------------

export async function loadUnansweredCount(db: DB): Promise<number> {
  const { data, error } = await db.rpc('count_unanswered_conversations')
  if (error) throw error
  return (data as number) ?? 0
}

// --- Card 3: Tempo Médio de Primeira Resposta ---------------------------

export async function loadFirstResponseAvg(db: DB): Promise<FirstResponseMetric> {
  // Trailing 7 days (today + 6 prior) — long enough to almost always
  // have samples, short enough to reflect current pace rather than a
  // stale average from months ago.
  const start = daysAgoStart(6).toISOString()
  const { data, error } = await db
    .from('messages')
    .select('conversation_id, sender_type, created_at')
    .gte('created_at', start)
    .order('conversation_id', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error

  const rows = (data ?? []) as {
    conversation_id: string
    sender_type: string
    created_at: string
  }[]

  // Pair each unreplied customer message with the next outbound
  // message in the same conversation — a customer message only counts
  // once, so a double-text while the agent is slow doesn't inflate
  // the average.
  const diffsMin: number[] = []
  let currentConv = ''
  let pendingCustomerAt: Date | null = null
  for (const row of rows) {
    if (row.conversation_id !== currentConv) {
      currentConv = row.conversation_id
      pendingCustomerAt = null
    }
    const ts = new Date(row.created_at)
    if (row.sender_type === 'customer') {
      if (!pendingCustomerAt) pendingCustomerAt = ts
    } else if (pendingCustomerAt) {
      const diffMin = (ts.getTime() - pendingCustomerAt.getTime()) / 60_000
      if (diffMin >= 0) diffsMin.push(diffMin)
      pendingCustomerAt = null
    }
  }

  if (diffsMin.length === 0) return { avgMinutes: null, sampleCount: 0 }
  const avgMinutes = diffsMin.reduce((a, b) => a + b, 0) / diffsMin.length
  return { avgMinutes, sampleCount: diffsMin.length }
}
