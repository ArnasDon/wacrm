// ============================================================
// AI auto-reply liveness check — a symptom-based safety net.
//
// The `ai_dispatch_error` / `ai_generate_error` / `ai_key_invalid`
// alerts (see auto-reply.ts) fire when the dispatch *throws*. This
// catches the other shape: the dispatch silently produces nothing —
// a routing regression, a bad `.select()` column (the 2026-09-06
// `messages.media_type` outage), the webhook stopping, a config that
// looks fine but isn't. If real, AI-eligible customer traffic is
// flowing and NOT ONE `ai_usage_log` row appears for that account, the
// bot is down for that account, full stop.
//
// Called from the conversations cron (~every 5 min). Best-effort:
// throwing here must never break the cron's real work.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { dispatchSystemAlert } from '@/lib/observability/alerts'
import { TEAMMATE_QUIET_MS } from './human-reply'

/** Look-back window. Long enough that a healthy bot (30s debounce +
 *  seconds of generation) would definitely have logged usage for any
 *  inbound in it; short enough to catch an outage within the hour. */
const WINDOW_MINUTES = 60

/** Only alert when the evidence is unambiguous: several inbound messages,
 *  spread over more than one conversation (so a single thread that hit
 *  its per-conversation reply cap can't trip it), and zero AI calls. */
const MIN_ELIGIBLE_INBOUND = 3
const MIN_DISTINCT_CONVERSATIONS = 2

export interface AiLivenessResult {
  checkedAccounts: number
  deadAccounts: { accountId: string; eligibleInbound: number; conversations: number }[]
}

export async function checkAiLiveness(db: SupabaseClient): Promise<AiLivenessResult> {
  const sinceIso = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString()

  // Accounts whose bot is supposed to be answering right now.
  const { data: cfgRows } = await db
    .from('ai_configs')
    .select('account_id')
    .eq('is_active', true)
    .eq('auto_reply_enabled', true)
  const accountIds = [...new Set((cfgRows ?? []).map((r) => r.account_id as string))]
  if (accountIds.length === 0) return { checkedAccounts: 0, deadAccounts: [] }

  // AI provider calls per account in the window (any successful reply
  // logs one — see logAiUsage).
  const { data: usageRows } = await db
    .from('ai_usage_log')
    .select('account_id')
    .gte('created_at', sinceIso)
    .in('account_id', accountIds)
  const calledAccounts = new Set((usageRows ?? []).map((r) => r.account_id as string))

  // AI-eligible inbound in the window: a customer message on an
  // unassigned, non-paused conversation. (An approximation of the real
  // eligibility gates in dispatchInboundToAiReply, deliberately loose —
  // the point is "was there traffic the bot should have answered".)
  const { data: eligConvs } = await db
    .from('conversations')
    .select('id, account_id')
    .in('account_id', accountIds)
    .is('assigned_agent_id', null)
    .or('ai_autoreply_disabled.is.null,ai_autoreply_disabled.is.false')
    .gte('last_message_at', sinceIso)
  const convByAccount = new Map<string, string[]>()
  for (const c of eligConvs ?? []) {
    const arr = convByAccount.get(c.account_id as string) ?? []
    arr.push(c.id as string)
    convByAccount.set(c.account_id as string, arr)
  }

  const deadAccounts: AiLivenessResult['deadAccounts'] = []

  for (const accountId of accountIds) {
    if (calledAccounts.has(accountId)) continue // bot is alive here
    let convIds = convByAccount.get(accountId) ?? []
    if (convIds.length < MIN_DISTINCT_CONVERSATIONS) continue

    // A teammate answered recently → the AI is quiet there on purpose
    // (TEAMMATE_QUIET_MS), not down. Loose on purpose: any human agent row.
    const { data: staffRows } = await db
      .from('messages')
      .select('conversation_id')
      .in('conversation_id', convIds)
      .eq('sender_type', 'agent')
      .eq('ai_generated', false)
      .gte('created_at', new Date(Date.now() - TEAMMATE_QUIET_MS).toISOString())
    const staffConvs = new Set((staffRows ?? []).map((r) => r.conversation_id as string))
    convIds = convIds.filter((id) => !staffConvs.has(id))
    if (convIds.length < MIN_DISTINCT_CONVERSATIONS) continue

    const { count } = await db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .in('conversation_id', convIds)
      .eq('sender_type', 'customer')
      .gte('created_at', sinceIso)
    const eligibleInbound = count ?? 0
    if (eligibleInbound >= MIN_ELIGIBLE_INBOUND) {
      deadAccounts.push({ accountId, eligibleInbound, conversations: convIds.length })
    }
  }

  if (deadAccounts.length > 0) {
    await dispatchSystemAlert({
      severity: 'critical',
      source: 'ai_liveness',
      title: `AI auto-reply produced ZERO replies for ${deadAccounts.length} account(s) despite live customer traffic`,
      detail: {
        window_minutes: WINDOW_MINUTES,
        dead_accounts: deadAccounts,
      },
      // One key for the whole condition — a sustained outage sends one
      // alert, not one per cron tick.
      dedupKey: 'ai_liveness',
      throttleMinutes: 60,
    })
  }

  return { checkedAccounts: accountIds.length, deadAccounts }
}
