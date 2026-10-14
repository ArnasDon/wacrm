// ============================================================
// Recover customer messages whose AI reply was lost.
//
// The auto-reply runs in the background of the webhook request and first
// waits a ~20s quiet period (debounce.ts) in memory. If the container is
// restarted inside that window — every deploy does it — the pending reply
// dies with the process and the customer gets silence. Real incident
// 2026-09-24 (Villa San Ricardo): a "hola" arrived one second before a
// deploy swapped the container and was never answered.
//
// This sweep (run from the conversations cron) finds open conversations
// whose LAST message is a customer text that has sat unanswered for a few
// minutes — long past any legitimate in-flight reply (debounce + a
// provider call + one retry is ~2 minutes) — and re-runs the normal AI
// dispatch once per message. The dispatch re-checks every eligibility
// rule itself (auto-reply off for the account, or switched off on the
// thread by a person), so a conversation the bot should stay out of stays
// silent. An assigned teammate no longer mutes the bot (2026-09-26).
// Each message is attempted at most MAX_ATTEMPTS times (ai_action_log claims).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { dispatchInboundToAiReply } from './auto-reply'
import { loadTrailingOutbound, teammateRepliedRecently, TEAMMATE_QUIET_MS } from './human-reply'
import { contactMutesAi } from './muted-contact'

const MIN_AGE_MS = 4 * 60_000
/** Older than this, a late automatic reply would read as odd — leave it
 *  to a human. */
const MAX_AGE_MS = 60 * 60_000
// A hotel customer may wait behind the intentional three-hour staff window.
const HOTEL_MAX_AGE_MS = TEAMMATE_QUIET_MS + MAX_AGE_MS
const MAX_PER_RUN = 20
/** Attempts per customer message. More than one because the usual cause
 *  is a provider outage lasting minutes — VSR 2026-10-08: Zernio timed out
 *  on the reply, its fallback AND the single retry 4 min later, and the
 *  guest never got that answer. The sweep runs every 5 min. */
const MAX_ATTEMPTS = 3

export interface InboundRecoveryResult {
  scanned: number
  recovered: number
}

interface ConversationRow {
  id: string
  account_id: string
  contact_id: string | null
  last_message_at: string
}

export async function recoverUnansweredInbound(
  db: SupabaseClient,
  opts: {
    now?: number
    dispatch?: typeof dispatchInboundToAiReply
  } = {},
): Promise<InboundRecoveryResult> {
  const now = opts.now ?? Date.now()
  const dispatch = opts.dispatch ?? dispatchInboundToAiReply

  const oldestRecent = new Date(now - MAX_AGE_MS).toISOString()
  const newestEligible = new Date(now - MIN_AGE_MS).toISOString()
  // Keep ordinary recovery in its one-hour window. Scan older hotel
  // threads separately so stale traffic from other accounts cannot fill
  // the candidate limit and starve messages waiting behind staff.
  const [recent, hotelWaiting] = await Promise.all([
    db.from('conversations')
      .select('id, account_id, contact_id, last_message_at')
      .eq('status', 'open')
      .or('ai_autoreply_disabled.is.null,ai_autoreply_disabled.is.false')
      .gte('last_message_at', oldestRecent)
      .lte('last_message_at', newestEligible)
      .order('last_message_at', { ascending: true })
      .limit(MAX_PER_RUN * 3),
    db.from('conversations')
      .select('id, account_id, contact_id, last_message_at, accounts!inner(industry_vertical)')
      .eq('accounts.industry_vertical', 'hotel')
      .eq('status', 'open')
      .or('ai_autoreply_disabled.is.null,ai_autoreply_disabled.is.false')
      .gte('last_message_at', new Date(now - HOTEL_MAX_AGE_MS).toISOString())
      .lte('last_message_at', oldestRecent)
      .order('last_message_at', { ascending: true })
      .limit(MAX_PER_RUN * 3),
  ])
  if (recent.error) throw recent.error
  if (hotelWaiting.error) throw hotelWaiting.error
  const data = [...new Map(
    [...(recent.data ?? []), ...(hotelWaiting.data ?? [])].map((row) => [row.id, row]),
  ).values()]

  const result: InboundRecoveryResult = { scanned: 0, recovered: 0 }
  for (const conv of (data ?? []) as ConversationRow[]) {
    if (result.recovered >= MAX_PER_RUN) break
    if (!conv.contact_id) continue
    result.scanned++

    // The customer's latest message must be a plain text — the only
    // inbound the webhooks hand to the AI (interactive replies and media
    // go elsewhere).
    const { data: lastCustomer } = await db
      .from('messages')
      .select('id, sender_type, content_type, created_at')
      .eq('conversation_id', conv.id)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const msg = lastCustomer as { id: string; sender_type: string; content_type: string; created_at: string } | null
    if (!msg || msg.content_type !== 'text') continue

    // Answered = some TEXT we sent after it. Images alone don't count: the
    // hotel bot sends the banner/photos BEFORE its text, so a restart
    // between the two left a thread whose last message is our photo and
    // no reply at all — and this sweep skipped it as "answered" (test run
    // 2026-09-24, prueba #27, killed by a deploy mid-reply).
    // The business app's greeting/away echo on a new conversation is
    // not an answer (loadTrailingOutbound drops it — VSR 2026-10-08).
    const { rows: repliesAfter } = await loadTrailingOutbound(db, conv.id, null)
    if (repliesAfter.some((r) => r.content_type === 'text')) continue
    const age = now - Date.parse(msg.created_at)
    if (age < MIN_AGE_MS || age > HOTEL_MAX_AGE_MS) continue

    const { data: account, error: accountError } = await db
      .from('accounts')
      .select('owner_user_id, industry_vertical')
      .eq('id', conv.account_id)
      .maybeSingle()
    if (accountError) continue
    const ownerId = (account as { owner_user_id?: string | null } | null)?.owner_user_id
    if (!ownerId) continue
    const isHotel = account?.industry_vertical === 'hotel'
    if (!isHotel && age > MAX_AGE_MS) continue
    if (await contactMutesAi(db, conv.contact_id)) continue

    let staffWindowElapsed = false
    if (isHotel) {
      try {
        // Do not spend the recovery attempts while staff still own the thread.
        // Dispatch repeats this check to handle a human reply arriving mid-sweep.
        if (await teammateRepliedRecently(db, conv.account_id, conv.id, null, new Date(now))) continue
        // Only extend the age limit for a message delayed by the staff window.
        // Ordinary stale inquiries retain the existing one-hour cutoff.
        staffWindowElapsed = await teammateRepliedRecently(
          db, conv.account_id, conv.id, null, new Date(now), HOTEL_MAX_AGE_MS,
        )
        if (age > MAX_AGE_MS && !staffWindowElapsed) continue
      } catch {
        // Unknown staff state: leave the conversation alone until the next sweep.
        continue
      }
    }

    // A flow owns the conversation (still active) or touched it after this
    // message (advanced or ended): the flow consumed it — flows win over
    // the AI — so it isn't "unanswered".
    const since = new Date(msg.created_at).toISOString()
    const { count: flowTouches, error: flowError } = await db
      .from('flow_runs')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conv.id)
      .or(`status.eq.active,last_advanced_at.gte.${since},ended_at.gte.${since}`)
    if (flowError || (flowTouches ?? 0) > 0) continue

    // Claim this attempt — a message is re-dispatched at most
    // MAX_ATTEMPTS times, however many sweeps see it unanswered.
    let priorQuery = db
      .from('ai_action_log')
      .select('id')
      .eq('account_id', conv.account_id)
      .eq('action', 'inbound_recovery')
      .eq('target_id', conv.id)
      .eq('input->>message_id', msg.id)
    // Earlier versions spent retries during the pause. Give a pending
    // message a bounded recovery budget AFTER the window has elapsed.
    if (staffWindowElapsed) priorQuery = priorQuery.eq('input->>staff_window_elapsed', 'true')
    const { data: prior } = await priorQuery.limit(MAX_ATTEMPTS)
    if (prior && prior.length >= MAX_ATTEMPTS) continue

    const { error: claimError } = await db.from('ai_action_log').insert({
      account_id: conv.account_id,
      actor_user_id: ownerId,
      action: 'inbound_recovery',
      target_id: conv.id,
      input: { message_id: msg.id, age_seconds: Math.round(age / 1000), staff_window_elapsed: staffWindowElapsed },
      result: { conversation_id: conv.id },
    })
    if (claimError) {
      console.error('[inbound-recovery] claim failed, skipping', conv.id, claimError.message)
      continue
    }

    await dispatch({
      accountId: conv.account_id,
      conversationId: conv.id,
      contactId: conv.contact_id,
      configOwnerUserId: ownerId,
      skipDebounce: true,
    })
    result.recovered++
  }
  return result
}
