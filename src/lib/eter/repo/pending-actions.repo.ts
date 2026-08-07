import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// agent_pending_actions repository — the ONLY module allowed to call
// `supabase.from('agent_pending_actions')`. Every function takes
// `accountId` as its first explicit argument and filters on it, same
// invariant as every other repo in this directory.
//
// This table is the persistence half of the write gate
// (src/lib/ai/tools/write-gate.ts) — see migration
// 038_eter_agent_pending_actions.sql for the full design note.
// ============================================================

export type PendingActionToolName = 'book_meeting' | 'reschedule' | 'cancel_booking'
export type PendingActionStatus = 'pending' | 'confirmed' | 'rejected' | 'expired'

export interface PendingAction {
  id: string
  accountId: string
  conversationId: string | null
  contactId: string | null
  toolName: PendingActionToolName
  toolInput: Record<string, unknown>
  status: PendingActionStatus
  resolvedAt: Date | null
  resultingBookingId: string | null
  createdAt: Date
}

export interface CreatePendingActionInput {
  conversationId?: string | null
  contactId?: string | null
  toolName: PendingActionToolName
  toolInput: Record<string, unknown>
}

interface PendingActionRow {
  id: string
  account_id: string
  conversation_id: string | null
  contact_id: string | null
  tool_name: PendingActionToolName
  tool_input: Record<string, unknown>
  status: PendingActionStatus
  resolved_at: string | null
  resulting_booking_id: string | null
  created_at: string
}

const COLUMNS =
  'id, account_id, conversation_id, contact_id, tool_name, tool_input, status, resolved_at, resulting_booking_id, created_at'

function toDomain(row: PendingActionRow): PendingAction {
  return {
    id: row.id,
    accountId: row.account_id,
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    toolName: row.tool_name,
    toolInput: row.tool_input ?? {},
    status: row.status,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null,
    resultingBookingId: row.resulting_booking_id,
    createdAt: new Date(row.created_at),
  }
}

/**
 * Record a proposed write. A partial unique index enforces at most one
 * *pending* row per conversation — the caller should resolve (confirm
 * or reject) any existing pending proposal for the thread before
 * creating a new one; a 23505 unique-violation from this insert means
 * that invariant was skipped.
 */
export async function createPendingAction(
  db: SupabaseClient,
  accountId: string,
  input: CreatePendingActionInput,
): Promise<PendingAction> {
  const { data, error } = await db
    .from('agent_pending_actions')
    .insert({
      account_id: accountId,
      conversation_id: input.conversationId ?? null,
      contact_id: input.contactId ?? null,
      tool_name: input.toolName,
      tool_input: input.toolInput,
      status: 'pending',
    })
    .select(COLUMNS)
    .single()
  if (error) throw error
  return toDomain(data as PendingActionRow)
}

export async function getPendingAction(
  db: SupabaseClient,
  accountId: string,
  pendingActionId: string,
): Promise<PendingAction | null> {
  const { data, error } = await db
    .from('agent_pending_actions')
    .select(COLUMNS)
    .eq('account_id', accountId)
    .eq('id', pendingActionId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return toDomain(data as PendingActionRow)
}

/** The single pending (not yet confirmed/rejected/expired) proposal for
 *  a conversation, if any — this is what a "sim, confirmo" reply from
 *  the lead resolves against. */
export async function getPendingActionForConversation(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<PendingAction | null> {
  const { data, error } = await db
    .from('agent_pending_actions')
    .select(COLUMNS)
    .eq('account_id', accountId)
    .eq('conversation_id', conversationId)
    .eq('status', 'pending')
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return toDomain(data as PendingActionRow)
}

/**
 * Move a pending action to a terminal status. Only transitions rows
 * that are still `pending` (the `.eq('status', 'pending')` filter) —
 * calling this twice on an already-resolved action is a no-op that
 * throws (no matching row for `.single()`), rather than silently
 * double-applying a write.
 */
export async function resolvePendingAction(
  db: SupabaseClient,
  accountId: string,
  pendingActionId: string,
  resolution: { status: 'confirmed' | 'rejected' | 'expired'; resultingBookingId?: string | null },
): Promise<PendingAction> {
  const { data, error } = await db
    .from('agent_pending_actions')
    .update({
      status: resolution.status,
      resolved_at: new Date().toISOString(),
      resulting_booking_id: resolution.resultingBookingId ?? null,
    })
    .eq('account_id', accountId)
    .eq('id', pendingActionId)
    .eq('status', 'pending')
    .select(COLUMNS)
    .single()
  if (error) throw error
  return toDomain(data as PendingActionRow)
}

/**
 * Attach the booking id an already-confirmed action resulted in. Split
 * out from `resolvePendingAction` on purpose: `confirmPendingAction`
 * (confirm-pending-action.ts) must atomically CLAIM the row — flip it
 * to `confirmed` — *before* touching Google Calendar, so two concurrent
 * confirmation attempts (e.g. a duplicate webhook delivery) can't both
 * pass the `status === 'pending'` check and both create a real
 * calendar event. At claim time the resulting booking doesn't exist
 * yet (creating it is the next step), so this second, unconditional
 * update fills it in afterwards. Not scoped by `.eq('status', ...)` —
 * by the time this runs the row is already `confirmed`.
 */
export async function attachResultingBooking(
  db: SupabaseClient,
  accountId: string,
  pendingActionId: string,
  bookingId: string,
): Promise<void> {
  const { error } = await db
    .from('agent_pending_actions')
    .update({ resulting_booking_id: bookingId })
    .eq('account_id', accountId)
    .eq('id', pendingActionId)
  if (error) throw error
}
