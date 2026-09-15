import { sendTypingIndicator } from './meta-api'

// ============================================================
// "escribiendo…" (typing) indicator for direct WhatsApp Cloud API
// conversations only — NOT Zernio/Instagram/Facebook, which use a
// different provider and a different mechanism entirely. This module
// is only ever wired up from src/app/api/whatsapp/webhook/route.ts,
// Meta's own direct webhook, so that scoping is structural rather than
// an explicit provider check here.
//
// Meta's typing_indicator auto-dismisses after 25s or as soon as a
// real reply is sent, whichever comes first (see sendTypingIndicator's
// own doc comment) — nowhere near long enough to cover this app's own
// reply latency (up to 30s debounce, aiDebounceMs, plus up to ~40s of
// generation with one retry, aiRequestTimeoutMs). So this owns a
// repeating loop, not a single call.
//
// In-memory, single-process — same tradeoff already accepted for
// debounce.ts and the shared rate limiter: correct for this app's
// current single-instance deployment.
// ============================================================

/** Wait this long after the customer's message before the first
 *  "escribiendo…" appears — showing it immediately would read as the
 *  bot pouncing on every message; a beat first reads more human. */
const START_DELAY_MS = 7_000

/** Re-send comfortably before Meta's 25s auto-dismiss window closes. */
const REFRESH_MS = 20_000

/** Hard ceiling so a bug that skips calling the returned stop function
 *  (a crash outside the normal finally, a future code path that
 *  forgets to wire it) can't leave a loop calling the Meta API forever
 *  for one stale conversation. Comfortably covers the worst realistic
 *  case (debounce + generation + one retry) with room to spare. */
const MAX_DURATION_MS = 120_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** conversationId → the stop function of its currently-running loop.
 *  A burst of rapid-fire inbound messages each calls
 *  `startTypingIndicatorLoop` independently (same as debounce.ts's
 *  own per-message calls) — only the first actually starts a loop;
 *  every other call gets back that SAME stop function, so whichever
 *  one turns out to be the debounce's eventual winner correctly stops
 *  the one shared loop instead of each racing its own. */
const activeLoops = new Map<string, () => void>()

export interface StartTypingIndicatorLoopArgs {
  phoneNumberId: string
  accessToken: string
  conversationId: string
  /** The inbound message that should trigger this — its own Meta id. */
  messageId: string
  /** Override the module defaults — tests only. */
  startDelayMs?: number
  refreshMs?: number
  maxDurationMs?: number
}

/**
 * Starts (or joins an already-running) "escribiendo…" loop for this
 * conversation. Returns a `stop` function — safe to call multiple
 * times, and safe to never call at all (the `maxDurationMs` ceiling
 * guarantees the loop ends on its own either way).
 */
export function startTypingIndicatorLoop(args: StartTypingIndicatorLoopArgs): () => void {
  const existing = activeLoops.get(args.conversationId)
  if (existing) return existing

  const startDelayMs = args.startDelayMs ?? START_DELAY_MS
  const refreshMs = args.refreshMs ?? REFRESH_MS
  const maxDurationMs = args.maxDurationMs ?? MAX_DURATION_MS

  let stopped = false
  const stop = (): void => {
    stopped = true
  }
  activeLoops.set(args.conversationId, stop)

  void (async () => {
    await sleep(startDelayMs)
    const deadline = Date.now() + maxDurationMs
    while (!stopped && Date.now() < deadline) {
      try {
        await sendTypingIndicator({
          phoneNumberId: args.phoneNumberId,
          accessToken: args.accessToken,
          messageId: args.messageId,
        })
      } catch (err) {
        // A broken token/number would otherwise get hammered every
        // refreshMs for the full maxDurationMs on every inbound
        // message — one failure is enough signal, stop this loop.
        console.error('[typing-indicator] send failed, stopping loop:', err)
        break
      }
      if (stopped) break
      await sleep(refreshMs)
    }
  })().finally(() => {
    if (activeLoops.get(args.conversationId) === stop) {
      activeLoops.delete(args.conversationId)
    }
  })

  return stop
}
