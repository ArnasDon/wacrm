import type { ChatMessage } from './types'
import { getT, type Translate } from '@/lib/i18n/translate'

/** Longest the quoted customer message runs before we ellipsize it —
 *  keeps the internal note to a glanceable one-liner. */
const MAX_QUOTE_LEN = 160

/**
 * Build the short internal note the auto-reply bot leaves on a
 * conversation when it hands off to a human. Deterministic — composed
 * from context we already have (no extra LLM call / token spend), so it
 * can't fail or add latency to the handoff.
 *
 * Reads as, e.g.:
 *   "🤖 AI agent handed off after 2 replies. Last customer message:
 *    “can I speak to a manager about my refund?”"
 *
 * `replyCount` is the bot's auto-reply tally for the thread (0 when it
 * bailed on the very first inbound without answering).
 */
export function buildHandoffSummary(args: {
  messages: ChatMessage[]
  replyCount: number
}, t: Translate = getT('Handoff')): string {
  const { messages, replyCount } = args

  const lastCustomer = [...messages]
    .reverse()
    .find((m) => m.role === 'user' && m.content.trim())

  const base = t('summary', { count: replyCount })

  if (!lastCustomer) return base

  const quote = truncate(lastCustomer.content.trim(), MAX_QUOTE_LEN)
  return base + t('lastMessage', { message: quote })
}

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ')
  if (collapsed.length <= max) return collapsed
  return `${collapsed.slice(0, max - 1).trimEnd()}…`
}
