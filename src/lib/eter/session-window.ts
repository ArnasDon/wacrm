import type { SupabaseClient } from '@supabase/supabase-js'
import { getLastInboundMessageAt } from './repo/messages.repo'

// ============================================================
// Meta's 24h customer-service session window: free-text (non-template)
// messages may only be sent within 24h of the customer's last inbound
// message. It resets on every inbound message from the lead — NOT on
// outbound sends. Used by the confirmation-detection reply (always
// inside the window, since it's a same-turn reaction to an inbound
// message — see pending-confirmation.ts) and by the eter-agent cron
// (follow-ups / reminders, which may fire long after the last inbound
// message).
// ============================================================

export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000

/** True when a free-text send to `conversationId` is currently allowed
 *  under Meta's policy. False (never send free text) when there has
 *  been no inbound message at all, or the last one is 24h+ old. */
export async function isWithinSessionWindow(
  db: SupabaseClient,
  conversationId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const lastInboundAt = await getLastInboundMessageAt(db, conversationId)
  if (!lastInboundAt) return false
  return now.getTime() - lastInboundAt.getTime() < SESSION_WINDOW_MS
}
