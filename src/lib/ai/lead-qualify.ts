import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { generateReply } from './generate'
import { logAiUsage } from './usage'

// ============================================================
// AI-powered lead qualification.
//
// Reads the recent conversation, asks the configured LLM to
// classify the lead as hot / warm / cold, and persists the
// score on the conversation row.  The result is **separate from
// the pipeline** — it's a quick-glance indicator so the team
// knows who to prioritise.
//
// Called from:
//   1. The inbound webhook (auto-qualify after every customer
//      message, throttled to avoid redundant calls).
//   2. The `/api/ai/qualify` route (manual re-score from the UI).
// ============================================================

export type LeadScore = 'hot' | 'warm' | 'cold'

const LEAD_QUALIFY_SYSTEM_PROMPT = `You are a lead-qualification analyst for a business that uses WhatsApp to talk to customers.

You are given the recent WhatsApp conversation between the business (assistant) and a potential customer (user).

Analyse the customer's messages and classify the lead into exactly one of these three categories:

HOT — The customer is clearly ready to buy, has asked about pricing / payment / delivery, wants to place an order, or has expressed strong intent ("I want to purchase", "send me the invoice", "how do I pay", "can I get this tomorrow?").

WARM — The customer is interested but still exploring. They ask questions about features, availability, or comparisons, but have not committed. They may say things like "tell me more", "do you have X?", "what are my options?".

COLD — The customer is unresponsive, giving one-word answers, only said "hi" or "hello" with no follow-up, is clearly not interested ("just browsing", "not right now", "no thanks"), or the conversation has gone stale with no customer reply for a long time.

Reply with EXACTLY one word: hot, warm, or cold.
Do not add any explanation, punctuation, or extra text — just the single lowercase word.`

/** Minimum number of customer messages before we bother scoring. */
const MIN_CUSTOMER_MESSAGES = 1

/**
 * Qualify (or re-qualify) the lead for one conversation.
 *
 * Returns the new score, or null if qualification was skipped
 * (AI not configured, too few messages, provider error).
 *
 * Never throws — a failing or slow LLM must not break any
 * calling flow.
 */
export async function qualifyLead(args: {
  accountId: string
  conversationId: string
}): Promise<LeadScore | null> {
  const { accountId, conversationId } = args

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config) return null

    const messages = await buildConversationContext(db, conversationId)

    // Need at least one customer message to have anything to qualify.
    const customerMessages = messages.filter((m) => m.role === 'user')
    if (customerMessages.length < MIN_CUSTOMER_MESSAGES) return null

    const { text, usage } = await generateReply({
      config,
      systemPrompt: LEAD_QUALIFY_SYSTEM_PROMPT,
      messages,
    })

    // Record the token spend.  Fire-and-forget.
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'lead_qualify',
      provider: config.provider,
      model: config.model,
      usage,
    })

    const score = parseScore(text)
    if (!score) {
      console.warn(
        `[lead-qualify] model returned unexpected value: "${text}"`,
      )
      return null
    }

    await persistScore(db, conversationId, score)
    return score
  } catch (err) {
    console.error('[lead-qualify] failed:', err)
    return null
  }
}

/**
 * Parse the LLM's raw output into a valid LeadScore.
 * Tolerates surrounding whitespace and mixed case.
 */
function parseScore(raw: string): LeadScore | null {
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z]/g, '')
  if (cleaned === 'hot' || cleaned === 'warm' || cleaned === 'cold') {
    return cleaned
  }
  return null
}

/**
 * Write the score to the conversation row.
 */
async function persistScore(
  db: SupabaseClient,
  conversationId: string,
  score: LeadScore,
): Promise<void> {
  const { error } = await db
    .from('conversations')
    .update({ lead_score: score })
    .eq('id', conversationId)

  if (error) {
    console.error('[lead-qualify] persist failed:', error)
  }
}

/**
 * Lightweight gate: should we re-qualify this conversation?
 *
 * We skip if the last qualification was < 3 customer messages ago
 * to avoid burning tokens on every single inbound.  The counter
 * resets after each score so heavy chatters get re-evaluated
 * periodically.
 *
 * Returns `true` when the conversation should be (re-)scored.
 */
export async function shouldRequalify(
  conversationId: string,
): Promise<boolean> {
  const db = supabaseAdmin()

  // Check if the conversation already has a score.  If it does,
  // only re-qualify when the customer has sent ≥3 more messages
  // since the last score.  We approximate this cheaply: count
  // customer messages after the last update.
  const { data: conv } = await db
    .from('conversations')
    .select('lead_score, updated_at')
    .eq('id', conversationId)
    .maybeSingle()

  if (!conv) return false

  // No score yet → always qualify (after the first customer msg).
  if (!conv.lead_score) return true

  // Has a score → only re-qualify every N customer messages.
  const { count } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .gt('created_at', conv.updated_at)

  return (count ?? 0) >= 3
}
