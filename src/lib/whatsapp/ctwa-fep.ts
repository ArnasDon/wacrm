/**
 * Click-to-WhatsApp Ads (CTWA) Free Entry Point (FEP) — the 72h clock
 * that is independent of (and does NOT replace or extend) the regular
 * 24h service window.
 *
 * See migration 059 for the persisted columns and the full rationale.
 * This file owns the only two operations on that clock: activating it
 * once, and reading its current (derived) state.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const FEP_DURATION_HOURS = 72
const SERVICE_WINDOW_HOURS = 24

export interface CtwaFepStatus {
  /** True only while ctwa_fep_expires_at is still in the future. Never
   *  read from the `ctwa_fep_active` column directly — that column is
   *  a historical "was it ever granted" flag, not a live status. */
  active: boolean
  expiresAt: Date | null
}

/**
 * Derive whether the FEP benefit is active RIGHT NOW, purely from the
 * timestamp — no DB write, no sweep job needed to flip anything off at
 * the exact expiry instant. Safe to call with a plain object (e.g. a
 * client-fetched `Conversation`), not just a fresh DB row.
 */
export function getCtwaFepStatus(conversation: {
  ctwa_fep_started_at?: string | null
  ctwa_fep_expires_at?: string | null
}): CtwaFepStatus {
  if (!conversation.ctwa_fep_started_at || !conversation.ctwa_fep_expires_at) {
    return { active: false, expiresAt: null }
  }
  const expiresAt = new Date(conversation.ctwa_fep_expires_at)
  return { active: expiresAt.getTime() > Date.now(), expiresAt }
}

/**
 * Activate the CTWA Free Entry Point 72h clock the first time the
 * business sends an outbound message to a CTWA-eligible lead while its
 * first 24h service window is still open. Linear + immutable: once
 * set, never re-armed or extended by later messages in either
 * direction (spec: "depois de ativado... NÃO reinicia... NÃO estende").
 *
 * Call fire-and-forget from every outbound send path right after the
 * message is persisted — dashboard/agent sends (send-message.ts), the
 * Flow engine and Automation engine (both `bot` sends), and the CTWA
 * rescue job itself (also a `bot` send via the Flow engine's sender).
 * All four are genuine "empresa responde" events per the spec. This
 * must never affect the send response the customer already received,
 * hence the outer try/catch — any failure here is logged and dropped.
 */
export async function maybeActivateCtwaFep(
  db: SupabaseClient,
  conversationId: string,
): Promise<void> {
  try {
    const { data: conversation, error } = await db
      .from('conversations')
      .select('id, ctwa_referral, ctwa_fep_started_at')
      .eq('id', conversationId)
      .maybeSingle()
    if (error || !conversation) return
    if (!conversation.ctwa_referral) return // not a CTWA lead — regular rules apply
    if (conversation.ctwa_fep_started_at) return // already activated — immutable, never re-armed

    // "primeira janela de atendimento de 24h" — same computation as
    // the client-side sessionInfo timer (message-thread.tsx): most
    // recent customer message + 24h.
    const { data: lastCustomerMsg } = await db
      .from('messages')
      .select('created_at')
      .eq('conversation_id', conversationId)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!lastCustomerMsg) return // nothing to respond to yet

    const hoursSinceCustomer =
      (Date.now() - new Date(lastCustomerMsg.created_at).getTime()) / (60 * 60 * 1000)
    if (hoursSinceCustomer >= SERVICE_WINDOW_HOURS) return // window already closed — too late to activate

    const startedAt = new Date()
    const expiresAt = new Date(startedAt.getTime() + FEP_DURATION_HOURS * 60 * 60 * 1000)

    // `.is('ctwa_fep_started_at', null)` closes the race between two
    // near-simultaneous outbound sends (e.g. an automation and an
    // agent replying at the same moment) both trying to be "first".
    await db
      .from('conversations')
      .update({
        ctwa_fep_started_at: startedAt.toISOString(),
        ctwa_fep_expires_at: expiresAt.toISOString(),
        ctwa_fep_active: true,
      })
      .eq('id', conversationId)
      .is('ctwa_fep_started_at', null)
  } catch (err) {
    console.error('[ctwa-fep] activation check failed:', err)
  }
}
