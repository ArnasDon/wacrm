import type { SupabaseClient } from '@supabase/supabase-js'
import { OFFLINE_AFTER_MS } from '@/lib/presence'

const DEFAULT_TIMEOUT_MINUTES = 10
/** Bounds the initial candidate fetch to conversations idle at least
 *  this long, so an account with the minimum (1 min) configured
 *  timeout is still caught without scanning the entire unassigned-open
 *  set on every sweep. */
const CANDIDATE_STALENESS_FLOOR_MS = 60_000
const MAX_CANDIDATES = 200
const MAX_PROCESSED = 50

export interface ReassignResult {
  /** Conversations that had aged past their account's timeout. */
  processed: number
  /** Of those, how many were actually claimed (some may have had no
   *  online advisor to assign to). */
  assigned: number
}

/**
 * Auto-assigns open, unassigned conversations that have sat idle past
 * the account's configured `ai_configs.unclaimed_conversation_timeout_minutes`
 * (default 10 when the account has no row, mirrors the migration's
 * column default) to an available advisor for that account — the
 * account member with the fewest currently-assigned open conversations
 * among everyone reporting `member_presence.status = 'online'` and not
 * stale. Accounts with nobody online are left untouched for the next
 * sweep; nothing is ever assigned to someone offline.
 */
export async function reassignUnclaimedConversations(
  db: SupabaseClient,
  now: number = Date.now(),
): Promise<ReassignResult> {
  const { data: candidates, error } = await db
    .from('conversations')
    .select('id, account_id, updated_at')
    .eq('status', 'open')
    .is('assigned_agent_id', null)
    .lte('updated_at', new Date(now - CANDIDATE_STALENESS_FLOOR_MS).toISOString())
    .order('updated_at', { ascending: true })
    .limit(MAX_CANDIDATES)
  if (error || !candidates || candidates.length === 0) return { processed: 0, assigned: 0 }

  const accountIds = [...new Set(candidates.map((c) => c.account_id as string))]
  const { data: configs } = await db
    .from('ai_configs')
    .select('account_id, unclaimed_conversation_timeout_minutes')
    .in('account_id', accountIds)
  const timeoutByAccount = new Map<string, number>()
  for (const row of configs ?? []) {
    const minutes = row.unclaimed_conversation_timeout_minutes
    timeoutByAccount.set(
      row.account_id as string,
      typeof minutes === 'number' && minutes > 0 ? minutes : DEFAULT_TIMEOUT_MINUTES,
    )
  }

  const due = candidates
    .filter((c) => {
      const timeoutMinutes = timeoutByAccount.get(c.account_id as string) ?? DEFAULT_TIMEOUT_MINUTES
      const staleMs = now - new Date(c.updated_at as string).getTime()
      return staleMs >= timeoutMinutes * 60_000
    })
    .slice(0, MAX_PROCESSED)

  let assigned = 0
  // Cached per this run so several stale conversations for the same
  // account load-balance against each other, not just against
  // assignments that already existed when the sweep started.
  const loadByAdvisor = new Map<string, number>()
  const advisorsByAccount = new Map<string, string[]>()

  for (const conv of due) {
    const accountId = conv.account_id as string
    let advisors = advisorsByAccount.get(accountId)
    if (!advisors) {
      advisors = await loadOnlineAdvisors(db, accountId, now)
      advisorsByAccount.set(accountId, advisors)
      if (advisors.length > 0) {
        const counts = await loadOpenAssignedCounts(db, accountId, advisors)
        for (const advisorId of advisors) loadByAdvisor.set(advisorId, counts.get(advisorId) ?? 0)
      }
    }
    if (advisors.length === 0) continue // nobody online — leave for the next sweep

    let pick = advisors[0]
    let pickLoad = loadByAdvisor.get(pick) ?? 0
    for (const advisorId of advisors) {
      const load = loadByAdvisor.get(advisorId) ?? 0
      if (load < pickLoad) {
        pick = advisorId
        pickLoad = load
      }
    }

    const { data: claimed } = await db
      .from('conversations')
      .update({ assigned_agent_id: pick })
      .eq('id', conv.id)
      .is('assigned_agent_id', null)
      .select('id')
      .maybeSingle()
    if (claimed) {
      assigned++
      loadByAdvisor.set(pick, pickLoad + 1)
    }
  }

  return { processed: due.length, assigned }
}

async function loadOnlineAdvisors(
  db: SupabaseClient,
  accountId: string,
  now: number,
): Promise<string[]> {
  const { data } = await db
    .from('member_presence')
    .select('user_id, last_seen_at')
    .eq('account_id', accountId)
    .eq('status', 'online')
  return (data ?? [])
    .filter((row) => now - new Date(row.last_seen_at as string).getTime() <= OFFLINE_AFTER_MS)
    .map((row) => row.user_id as string)
}

async function loadOpenAssignedCounts(
  db: SupabaseClient,
  accountId: string,
  advisorIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  const { data } = await db
    .from('conversations')
    .select('assigned_agent_id')
    .eq('account_id', accountId)
    .eq('status', 'open')
    .in('assigned_agent_id', advisorIds)
  for (const row of data ?? []) {
    const id = row.assigned_agent_id as string
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}
