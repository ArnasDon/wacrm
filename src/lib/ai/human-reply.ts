import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'

/**
 * "A human already answered" handling for hotel AI auto-reply: the bot
 * never pauses itself, but a customer message a teammate already answered
 * is theirs — the AI stays quiet on it (owner, 2026-10-07; it used to
 * fill in whatever the teammate left out).
 *
 * A "human" message is an outbound `sender_type = 'agent'` row — inbox
 * sends, the business's own WhatsApp app (echoes) and the public API.
 * Everything the platform sends on its own (AI replies, system lines,
 * follow-ups, reminders) is persisted as `sender_type = 'bot'`.
 */

/** Known WhatsApp Business greeting/away text, recognized by content even
 * when an echo is delayed. Anchored matches avoid hiding a teammate's
 * substantive reply that happens to start with a greeting. */
export function isBusinessAutoReply(text: string | null | undefined): boolean {
  const normalized = (text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return normalized === 'gracias por comunicarse con villa san ricardo como podemos ayudarle'
    || normalized === 'gracias por su mensaje nuestro horario de atencion es de 8 00am a 8 00pm todos los dias cuentenos como podemos ayudarle y le atenderemos lo mas pronto posible'
}

export interface OutboundRow {
  sender_type: string
  content_type: string
  content_text: string | null
  created_at: string
}

export type TrailingState =
  /** Nothing outbound after the customer's latest message — reply normally. */
  | { kind: 'unanswered' }
  /** The bot/platform already answered it — stand down (duplicate guard). */
  | { kind: 'bot_answered' }
  /** Only humans answered it — check whether their reply covers it. */
  | { kind: 'human_answered'; humanTexts: string[] }

/**
 * Classify the outbound rows that came AFTER the customer's latest
 * message (oldest-first). Any platform row means it was already answered
 * by the bot; otherwise the human rows (with text) are what the check
 * needs to read.
 */
export function classifyTrailingOutbound(rows: OutboundRow[]): TrailingState {
  const outbound = rows.filter((r) => r.content_type !== 'internal_note' && r.sender_type !== 'customer' && !(r.sender_type === 'agent' && isBusinessAutoReply(r.content_text)))
  if (outbound.length === 0) return { kind: 'unanswered' }
  if (outbound.some((r) => r.sender_type === 'bot')) return { kind: 'bot_answered' }
  const humanTexts = outbound
    .map((r) => r.content_text?.trim() ?? '')
    .filter((t) => t.length > 0)
  // A human sent something without text (a photo, a document): still a
  // human answer — let the check read a placeholder rather than ignore it.
  if (humanTexts.length === 0) return { kind: 'human_answered', humanTexts: ['(El asesor envió un archivo o imagen.)'] }
  return { kind: 'human_answered', humanTexts }
}

/**
 * Read the outbound rows after the customer's latest message.
 * `sinceISO` is `conversations.ai_context_reset_at` (same bound the
 * context builder uses). Returns the customer message's timestamp too so
 * the caller can re-check for a human reply that lands mid-generation.
 */
export async function loadTrailingOutbound(
  db: SupabaseClient,
  conversationId: string,
  sinceISO: string | null,
): Promise<{ lastCustomerAt: string | null; humanSince: string | null; rows: OutboundRow[] }> {
  let lastQ = db
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
  if (sinceISO) lastQ = lastQ.gt('created_at', sinceISO)
  const { data: last, error: lastErr } = await lastQ
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (lastErr) throw lastErr
  const lastCustomerAt = (last?.created_at as string | undefined) ?? null
  if (!lastCustomerAt) return { lastCustomerAt: null, humanSince: null, rows: [] }

  // A brand-new conversation (nothing ever sent by the hotel before this
  // customer message) is the only place the business app's greeting/away
  // echo is ignored; in an active thread every teammate reply counts.
  const { data: prior, error: priorErr } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .in('sender_type', ['agent', 'bot'])
    .neq('content_type', 'internal_note')
    .lt('created_at', lastCustomerAt)
    .limit(1)
  if (priorErr) throw priorErr
  const humanSince = humanReplySince(lastCustomerAt, (prior ?? []).length === 0)

  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_type, content_text, created_at')
    .eq('conversation_id', conversationId)
    .in('sender_type', ['agent', 'bot'])
    .neq('content_type', 'internal_note')
    .gt('created_at', lastCustomerAt)
    .order('created_at', { ascending: true })
  if (error) throw error
  const rows = ((data ?? []) as OutboundRow[]).filter(
    (r) => r.sender_type !== 'agent' || (!isBusinessAutoReply(r.content_text) && Date.parse(r.created_at) > Date.parse(humanSince)),
  )
  return { lastCustomerAt, humanSince, rows }
}

/** Count human (`agent`) outbound rows after `afterISO`. */
export async function countHumanRepliesAfter(
  db: SupabaseClient,
  conversationId: string,
  afterISO: string,
): Promise<number> {
  const { data, error } = await db
    .from('messages')
    .select('content_text')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'agent')
    .neq('content_type', 'internal_note')
    .gt('created_at', afterISO)
  if (error) throw error
  return (data ?? []).filter((r) => !isBusinessAutoReply(r.content_text)).length
}

/**
 * Hotel "a teammate is here" signal (owner, 2026-10-07): once a teammate
 * has replied in a conversation, follow-up nudges stop and the AI keeps
 * assisting but is told not to offer to connect the guest with the team
 * (it used to, while one was already chatting). Cleared by "Reanudar IA"
 * (writes a note with this prefix) or "Reiniciar IA" (moves
 * `ai_context_reset_at`).
 */
export const AI_RESUMED_NOTE_PREFIX = '▶️'

/** WhatsApp Business app greeting / away messages are echoed as `agent`
 *  rows (Coexistence) seconds after the customer writes; a person takes
 *  longer. Anything faster than this is treated as automatic. */
const AUTO_REPLY_MAX_MS = 15_000

/** Pure: from when an `agent` row counts as a teammate answering the
 *  customer message at `customerAtISO`. In a new conversation the
 *  business app's greeting/away echo lands within AUTO_REPLY_MAX_MS and is
 *  not a person (VSR, 2026-10-08); in an active thread every reply counts. */
export function humanReplySince(customerAtISO: string, isNewConversation: boolean): string {
  if (!isNewConversation) return customerAtISO
  return new Date(Date.parse(customerAtISO) + AUTO_REPLY_MAX_MS).toISOString()
}

/** Pure: given customer + agent rows oldest-first, did a real teammate
 *  answer the customer? Agent rows before the customer's first message
 *  (a campaign or template the team started with) don't count. */
export function hasTeammateReply(rows: { sender_type: string; content_text?: string | null; created_at: string }[]): boolean {
  let lastCustomerAt: number | null = null
  for (const r of rows) {
    const at = Date.parse(r.created_at)
    if (r.sender_type === 'customer') lastCustomerAt = at
    else if (r.sender_type === 'agent' && !isBusinessAutoReply(r.content_text) && lastCustomerAt !== null && at - lastCustomerAt > AUTO_REPLY_MAX_MS) return true
  }
  return false
}

/** Has a teammate taken this conversation over since the AI was last
 *  reset (`resetAtISO`) or reactivated? */
export async function teammateTookOver(
  db: SupabaseClient,
  conversationId: string,
  resetAtISO: string | null,
): Promise<boolean> {
  const since = [resetAtISO, await lastResumedAt(db, conversationId)]
    .filter((s): s is string => !!s)
    .sort()
    .pop()

  let q = db
    .from('messages')
    .select('sender_type, content_text, created_at')
    .eq('conversation_id', conversationId)
    .in('sender_type', ['customer', 'agent'])
    .neq('content_type', 'internal_note')
  if (since) q = q.gt('created_at', since)
  // ponytail: newest 500 rows is plenty for a WhatsApp thread; page if one ever outgrows it.
  const { data, error } = await q.order('created_at', { ascending: false }).limit(500)
  if (error) throw error
  return hasTeammateReply((data ?? []).reverse())
}

/** When "Reanudar IA" was last pressed in this conversation, if ever. */
async function lastResumedAt(db: SupabaseClient, conversationId: string): Promise<string | null> {
  const { data } = await db
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .eq('content_type', 'internal_note')
    .like('content_text', `${AI_RESUMED_NOTE_PREFIX}%`)
    .order('created_at', { ascending: false })
    .limit(1)
  return (data?.[0]?.created_at as string | undefined) ?? null
}

/** Hotel: after a teammate replies, the conversation is theirs for this
 *  long — the AI stays quiet (owner meeting, 2026-10-09). */
export const TEAMMATE_QUIET_MS = 3 * 60 * 60 * 1000

/** Pure: customer + agent rows oldest-first. Did a person reply after
 *  `sinceISO`? An agent row within AUTO_REPLY_MAX_MS of a customer
 *  message may be the business app's greeting/away echo — returned as
 *  `possibleEchoes` for the caller to confirm (canned text). */
export function classifyRecentAgentRows(
  rows: { sender_type: string; content_text: string | null; created_at: string }[],
  sinceISO: string,
): { humanReply: boolean; possibleEchoes: string[] } {
  const since = Date.parse(sinceISO)
  const echoes = new Set<string>()
  let lastCustomerAt: number | null = null
  for (const r of rows) {
    const at = Date.parse(r.created_at)
    if (r.sender_type === 'customer') {
      lastCustomerAt = at
      continue
    }
    if (r.sender_type !== 'agent' || at <= since || isBusinessAutoReply(r.content_text)) continue
    const text = r.content_text?.trim() ?? ''
    if (text && lastCustomerAt !== null && at - lastCustomerAt <= AUTO_REPLY_MAX_MS) echoes.add(text)
    else return { humanReply: true, possibleEchoes: [] }
  }
  return { humanReply: false, possibleEchoes: [...echoes] }
}

/**
 * Has a teammate replied in this conversation within TEAMMATE_QUIET_MS?
 * "Reanudar IA" / "Reiniciar IA" end the window early. The business's
 * automatic WhatsApp messages (greeting / away) don't count: a fast
 * agent row whose exact text the account also sent in another
 * conversation is canned, not a person.
 */
export async function teammateRepliedRecently(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  resetAtISO: string | null,
  now: Date = new Date(),
  lookbackMs: number = TEAMMATE_QUIET_MS,
): Promise<boolean> {
  const windowStart = new Date(now.getTime() - lookbackMs).toISOString()
  const since = [windowStart, resetAtISO, await lastResumedAt(db, conversationId)]
    .filter((s): s is string => !!s)
    .sort()
    .pop() as string
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_text, created_at')
    .eq('conversation_id', conversationId)
    .in('sender_type', ['customer', 'agent'])
    .neq('content_type', 'internal_note')
    .gt('created_at', new Date(Date.parse(since) - AUTO_REPLY_MAX_MS).toISOString())
    .order('created_at', { ascending: true })
    .limit(500)
  if (error) throw error
  const { humanReply, possibleEchoes } = classifyRecentAgentRows(data ?? [], since)
  if (humanReply) return true
  for (const text of possibleEchoes) {
    // ponytail: unindexed content_text match; fine at today's volume, index or cache canned texts if messages grows large.
    const { data: elsewhere, error: e2 } = await db
      .from('messages')
      .select('id, conversations!inner(account_id)')
      .eq('conversations.account_id', accountId)
      .eq('sender_type', 'agent')
      .eq('content_text', text)
      .neq('conversation_id', conversationId)
      .limit(1)
    if (e2) throw e2
    if ((elsewhere ?? []).length === 0) return true
  }
  return false
}

/** Drop the trailing assistant turns so the transcript ends on the
 *  customer's turn — used when those turns are the business app's
 *  greeting/away echo, which is not an answer (see humanReplySince). */
export function trimTrailingAssistant(messages: ChatMessage[]): ChatMessage[] {
  let end = messages.length
  while (end > 0 && messages[end - 1].role === 'assistant') end -= 1
  return messages.slice(0, end)
}

/** The customer's consecutive trailing turns (what the human answered). */
export function trailingCustomerTurns(messages: ChatMessage[], max = 4): string[] {
  const out: string[] = []
  for (let i = messages.length - 1; i >= 0 && out.length < max; i--) {
    if (messages[i].role !== 'user') break
    out.unshift(messages[i].content)
  }
  return out
}
