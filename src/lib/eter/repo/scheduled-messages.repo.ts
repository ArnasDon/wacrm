import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// agent_scheduled_messages repository — the ONLY module allowed to call
// `supabase.from('agent_scheduled_messages')`. Every function that
// isn't the cron sweep takes `accountId` as its first explicit
// argument and filters on it, same invariant as every other repo in
// this directory. See migration 039_eter_agent_scheduled_messages.sql
// for the full design note.
//
// `getDueScheduledMessages` is the one exception — it's the cron
// sweep's entry point, runs cross-tenant under the service-role
// client (exactly like `automation_pending_executions`'s equivalent
// query in /api/automations/cron), and every row it returns already
// carries its own `accountId` for the caller to scope subsequent work.
// ============================================================

export type ScheduledMessageKind =
  | 'follow_up_1d'
  | 'follow_up_3d'
  | 'follow_up_7d'
  | 'reminder_24h'
  | 'reminder_2h'

export type ScheduledMessageStatus = 'pending' | 'processing' | 'sent' | 'cancelled' | 'failed'

export const FOLLOW_UP_KINDS: readonly ScheduledMessageKind[] = [
  'follow_up_1d',
  'follow_up_3d',
  'follow_up_7d',
]

export const REMINDER_KINDS: readonly ScheduledMessageKind[] = ['reminder_24h', 'reminder_2h']

export interface ScheduledMessagePayload {
  /** Pre-generated free-text copy, used when send time is still
   *  within Meta's 24h customer-service window. */
  freeText?: string
  [key: string]: unknown
}

export interface ScheduledMessage {
  id: string
  accountId: string
  conversationId: string | null
  contactId: string | null
  bookingId: string | null
  kind: ScheduledMessageKind
  sendAt: Date
  status: ScheduledMessageStatus
  payload: ScheduledMessagePayload
  error: string | null
  sentAt: Date | null
  createdAt: Date
}

export interface ScheduleMessageInput {
  conversationId?: string | null
  contactId?: string | null
  bookingId?: string | null
  kind: ScheduledMessageKind
  sendAt: Date
  payload?: ScheduledMessagePayload
}

interface ScheduledMessageRow {
  id: string
  account_id: string
  conversation_id: string | null
  contact_id: string | null
  booking_id: string | null
  kind: ScheduledMessageKind
  send_at: string
  status: ScheduledMessageStatus
  payload: ScheduledMessagePayload
  error: string | null
  sent_at: string | null
  created_at: string
}

const COLUMNS =
  'id, account_id, conversation_id, contact_id, booking_id, kind, send_at, status, payload, error, sent_at, created_at'

function toDomain(row: ScheduledMessageRow): ScheduledMessage {
  return {
    id: row.id,
    accountId: row.account_id,
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    bookingId: row.booking_id,
    kind: row.kind,
    sendAt: new Date(row.send_at),
    status: row.status,
    payload: row.payload ?? {},
    error: row.error,
    sentAt: row.sent_at ? new Date(row.sent_at) : null,
    createdAt: new Date(row.created_at),
  }
}

/**
 * Queue one or more messages. Callers that need "at most one pending
 * row per (conversation|booking, kind)" — the followup cadence and the
 * meeting-reminder pair — get that from the partial unique indexes in
 * migration 039; the recommended caller pattern is cancel-then-insert
 * (see `cancelScheduledMessagesForConversation` /
 * `cancelRemindersForBooking` below) rather than relying on this to
 * silently no-op a duplicate.
 */
export async function scheduleMessages(
  db: SupabaseClient,
  accountId: string,
  inputs: ScheduleMessageInput[],
): Promise<ScheduledMessage[]> {
  if (inputs.length === 0) return []
  const rows = inputs.map((input) => ({
    account_id: accountId,
    conversation_id: input.conversationId ?? null,
    contact_id: input.contactId ?? null,
    booking_id: input.bookingId ?? null,
    kind: input.kind,
    send_at: input.sendAt.toISOString(),
    payload: input.payload ?? {},
    status: 'pending',
  }))
  const { data, error } = await db.from('agent_scheduled_messages').insert(rows).select(COLUMNS)
  if (error) throw error
  return (data as ScheduledMessageRow[]).map(toDomain)
}

/** Cancel every still-`pending` scheduled message for a conversation,
 *  optionally restricted to specific kinds (e.g. only the follow-up
 *  cadence, leaving meeting reminders untouched — an inbound reply
 *  cancels follow-ups, not the reminders for an already-confirmed
 *  meeting). Returns the number of rows cancelled. */
export async function cancelScheduledMessagesForConversation(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  opts: { kinds?: readonly ScheduledMessageKind[] } = {},
): Promise<number> {
  let query = db
    .from('agent_scheduled_messages')
    .update({ status: 'cancelled' })
    .eq('account_id', accountId)
    .eq('conversation_id', conversationId)
    .eq('status', 'pending')
  if (opts.kinds && opts.kinds.length > 0) {
    query = query.in('kind', opts.kinds as string[])
  }
  const { data, error } = await query.select('id')
  if (error) throw error
  return (data as unknown[])?.length ?? 0
}

/** Cancel every still-`pending` reminder queued for a booking (e.g. the
 *  booking was cancelled, or is being rescheduled and will get fresh
 *  reminders). */
export async function cancelRemindersForBooking(
  db: SupabaseClient,
  accountId: string,
  bookingId: string,
  opts: { kinds?: readonly ScheduledMessageKind[] } = {},
): Promise<number> {
  const { data, error } = await db
    .from('agent_scheduled_messages')
    .update({ status: 'cancelled' })
    .eq('account_id', accountId)
    .eq('booking_id', bookingId)
    .eq('status', 'pending')
    .in('kind', (opts.kinds ?? REMINDER_KINDS) as string[])
    .select('id')
  if (error) throw error
  return (data as unknown[])?.length ?? 0
}

/** Cross-tenant sweep for the cron route: every `pending` row whose
 *  `send_at` has passed, oldest first. Mirrors the equivalent query in
 *  `/api/automations/cron`. */
export async function getDueScheduledMessages(
  db: SupabaseClient,
  opts: { limit?: number; now?: Date } = {},
): Promise<ScheduledMessage[]> {
  const { limit = 50, now = new Date() } = opts
  const { data, error } = await db
    .from('agent_scheduled_messages')
    .select(COLUMNS)
    .eq('status', 'pending')
    .lte('send_at', now.toISOString())
    .order('send_at', { ascending: true })
    .limit(limit)
  if (error) throw error
  return (data as ScheduledMessageRow[]).map(toDomain)
}

/** Atomically claim a due row before sending — 'pending' -> 'processing'
 *  guarded by `.eq('status', 'pending')`, same two-step pattern
 *  `/api/automations/cron` uses so overlapping cron invocations can't
 *  both send the same message. Returns null if another invocation
 *  already claimed it. */
export async function claimScheduledMessage(
  db: SupabaseClient,
  id: string,
): Promise<ScheduledMessage | null> {
  const { data, error } = await db
    .from('agent_scheduled_messages')
    .update({ status: 'processing' })
    .eq('id', id)
    .eq('status', 'pending')
    .select(COLUMNS)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return toDomain(data as ScheduledMessageRow)
}

export async function markScheduledMessageSent(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db
    .from('agent_scheduled_messages')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function markScheduledMessageFailed(
  db: SupabaseClient,
  id: string,
  errorMessage: string,
): Promise<void> {
  const { error } = await db
    .from('agent_scheduled_messages')
    .update({ status: 'failed', error: errorMessage })
    .eq('id', id)
  if (error) throw error
}

/**
 * Recover rows stuck in `processing` beyond `olderThanMs` (default 10
 * minutes) — cross-tenant, same shape as `getDueScheduledMessages`.
 *
 * A row only ever sits in `processing` between `claimScheduledMessage`
 * and the matching `markScheduledMessageSent` / `markScheduledMessageFailed`
 * call in the cron route. Without this sweep, a function crash/timeout
 * between those two steps (or `markScheduledMessageFailed` itself
 * throwing on a transient DB error) leaves the row invisible to BOTH
 * `getDueScheduledMessages` (only selects `pending`) and any
 * operator dashboard querying `failed` — a silent, permanent leak
 * where a lead's follow-up/reminder simply never sends and nothing
 * says why. `updated_at` (bumped by the table's own trigger on every
 * UPDATE, including the claim) is what ages a `processing` row here —
 * reclaimed straight to `failed` with an explicit reason rather than
 * back to `pending`, so a message that's repeatedly getting stuck
 * doesn't retry forever against the same failure; it surfaces as a
 * `failed` row an operator can find and act on.
 */
export async function reclaimStaleProcessingMessages(
  db: SupabaseClient,
  opts: { olderThanMs?: number; now?: Date } = {},
): Promise<number> {
  const { olderThanMs = 10 * 60 * 1000, now = new Date() } = opts
  const cutoff = new Date(now.getTime() - olderThanMs).toISOString()
  const { data, error } = await db
    .from('agent_scheduled_messages')
    .update({
      status: 'failed',
      error: `stuck in "processing" past ${Math.round(olderThanMs / 60000)}min — reclaimed by cron sweep`,
    })
    .eq('status', 'processing')
    .lt('updated_at', cutoff)
    .select('id')
  if (error) throw error
  return (data as unknown[])?.length ?? 0
}
