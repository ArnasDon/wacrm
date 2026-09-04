// ============================================================
// Coalesces a burst of rapid-fire inbound messages into a single AI
// reply.
//
// WhatsApp (and Instagram/Facebook) deliver each message as its own
// webhook event — a customer typing two or three bubbles within a few
// seconds used to trigger one full LLM call + reply PER bubble.
// Confirmed live 2026-08-21: a customer sent two short messages ~7s
// apart and got two separate, structurally-similar replies back to
// back, which read as the bot answering the same thing twice.
//
// `waitForQuietPeriod` lets every inbound call race for the same
// conversation: each claims the "latest" token, waits out a quiet
// period, and only the one still holding that token when it wakes up
// proceeds — every earlier call in the same burst was superseded and
// stands down without generating anything. The winning call runs
// after the wait, so its own fresh read of conversation history
// (`buildConversationContext`) already includes every message from
// the whole burst — nothing is lost, it's just answered once,
// together.
//
// In-memory, single-process — same tradeoff already accepted for the
// shared rate limiter (src/lib/rate-limit.ts): correct for this app's
// current single-instance deployment; a future multi-instance
// deployment would need a shared store (e.g. Redis) instead.
//
// The default quiet period is a full minute (see `aiDebounceMs` in
// defaults.ts) — long enough for a customer typing across several
// bubbles at their own pace to finish before the bot answers what
// might otherwise be a half-finished thought. Every inbound message
// still lands in the inbox immediately either way; this only delays
// the *bot's* reply, never the human view of the conversation.
// ============================================================

import { aiDebounceMs } from './defaults'

const latestToken = new Map<string, symbol>()

/**
 * Resolves `true` for the last caller standing after `delayMs` of
 * inbound quiet on this conversation, `false` for every earlier caller
 * in the same burst (which should stand down and do nothing).
 */
export async function waitForQuietPeriod(
  conversationId: string,
  delayMs: number = aiDebounceMs(),
): Promise<boolean> {
  const token = Symbol()
  latestToken.set(conversationId, token)

  await new Promise((resolve) => setTimeout(resolve, delayMs))

  if (latestToken.get(conversationId) !== token) return false
  latestToken.delete(conversationId)
  return true
}
