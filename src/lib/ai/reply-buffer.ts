/**
 * In-memory debounce for the AI auto-reply agent.
 *
 * When a customer sends several messages in quick succession, this
 * collapses them into a single `dispatchInboundToAiReply` call fired
 * `delayMs` after the LAST message in the burst — rather than the
 * agent replying to each message individually. Each new inbound
 * message for the same conversation resets the timer.
 *
 * `dispatchInboundToAiReply` re-reads every message from the DB at
 * fire time (`buildConversationContext`), so this module only needs
 * to track the debounce, not accumulate message text.
 *
 * Same single-instance assumption as `src/lib/rate-limit.ts`: state
 * lives in this process's memory, so it only works when the app runs
 * as a persistent Node process (this repo's documented Hostinger /
 * Docker deployments). Deliberately not awaited by the webhook's
 * `after()` — the timer must outlive the request that scheduled it,
 * which a serverless/multi-instance deploy would not guarantee.
 */

import { dispatchInboundToAiReply, type DispatchArgs } from './auto-reply'

const pending = new Map<string, NodeJS.Timeout>()

export function scheduleAiReply(
  conversationId: string,
  args: DispatchArgs,
  delayMs: number,
): void {
  const existing = pending.get(conversationId)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(() => {
    pending.delete(conversationId)
    dispatchInboundToAiReply(args).catch((err) =>
      console.error('[ai reply buffer] dispatch failed:', err),
    )
  }, delayMs)

  pending.set(conversationId, timer)
}
