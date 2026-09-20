import { engineSendText } from '@/lib/flows/meta-send'
import type { ChatMessage } from './types'

/** Longest the quoted customer message runs before we ellipsize it —
 *  keeps the internal note to a glanceable one-liner. */
const MAX_QUOTE_LEN = 160

/**
 * Fixed message sent to the customer immediately BEFORE the AI goes
 * silent and hands the conversation off to a human — in either
 * persona (commercial or internal). Used whenever the account hasn't
 * set its own `ai_configs.handoff_message`.
 *
 * A silent handoff previously left the customer talking to no one: the
 * bot would stop replying with zero warning. This message closes that
 * gap and is sent unconditionally on every handoff, not just the
 * commercial one.
 */
export const DEFAULT_HANDOFF_MESSAGE =
  'Vou pedir a alguém da equipa que lhe responda. Fica atento, respondemos por aqui.'

interface HandoffNoticeArgs {
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
  handoffMessage: string | null | undefined
}

/**
 * Send the "a human is taking over" notice to the customer before the
 * bot goes silent. Never throws — a failed send here must not block
 * the rest of the handoff (pausing auto-reply, assigning the agent),
 * same discipline as sendCommercialWelcomeIfNeeded /
 * sendCommercialFallback in commercial.ts.
 */
export async function sendHandoffNotice(args: HandoffNoticeArgs): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId, handoffMessage } = args
  try {
    const text =
      handoffMessage && handoffMessage.trim() ? handoffMessage.trim() : DEFAULT_HANDOFF_MESSAGE
    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text,
      aiGenerated: false,
    })
  } catch (err) {
    console.error(
      '[ai auto-reply] handoff notice send failed:',
      err instanceof Error ? err.message : err,
    )
  }
}

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
}): string {
  const { messages, replyCount } = args

  const lastCustomer = [...messages]
    .reverse()
    .find((m) => m.role === 'user' && m.content.trim())

  const replies =
    replyCount === 0
      ? 'without replying'
      : `after ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`

  const base = `🤖 AI agent handed off ${replies}.`

  if (!lastCustomer) return base

  const quote = truncate(lastCustomer.content.trim(), MAX_QUOTE_LEN)
  return `${base} Last customer message: “${quote}”`
}

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ')
  if (collapsed.length <= max) return collapsed
  return `${collapsed.slice(0, max - 1).trimEnd()}…`
}
