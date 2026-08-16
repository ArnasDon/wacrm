import type { SupabaseClient } from '@supabase/supabase-js'
import { isUniqueViolation } from '@/lib/contacts/dedupe'

// ============================================================
// data_deletion_requests repository, the ONLY module allowed to call
// `supabase.from('data_deletion_requests')`. Every function takes
// `accountId` as its first explicit argument and filters on it, same
// invariant as every other repo in this directory. See migration
// 041_data_deletion_requests.sql for the full design note.
// ============================================================

export type DataDeletionRequestStatus = 'pending' | 'cancelled' | 'completed'

export interface DataDeletionRequest {
  id: string
  accountId: string
  conversationId: string | null
  contactId: string | null
  phone: string
  profileName: string | null
  status: DataDeletionRequestStatus
  requestedAt: Date
  cancelledAt: Date | null
  completedAt: Date | null
  notifiedAt: Date | null
  createdAt: Date
}

interface DataDeletionRequestRow {
  id: string
  account_id: string
  conversation_id: string | null
  contact_id: string | null
  phone: string
  profile_name: string | null
  status: DataDeletionRequestStatus
  requested_at: string
  cancelled_at: string | null
  completed_at: string | null
  notified_at: string | null
  created_at: string
}

const COLUMNS =
  'id, account_id, conversation_id, contact_id, phone, profile_name, status, requested_at, cancelled_at, completed_at, notified_at, created_at'

function toDomain(row: DataDeletionRequestRow): DataDeletionRequest {
  return {
    id: row.id,
    accountId: row.account_id,
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    phone: row.phone,
    profileName: row.profile_name,
    status: row.status,
    requestedAt: new Date(row.requested_at),
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    notifiedAt: row.notified_at ? new Date(row.notified_at) : null,
    createdAt: new Date(row.created_at),
  }
}

/** The pending (not yet cancelled/completed) deletion request for a
 *  phone number within an account, if any. */
export async function getPendingDeletionRequestForPhone(
  db: SupabaseClient,
  accountId: string,
  phone: string,
): Promise<DataDeletionRequest | null> {
  const { data, error } = await db
    .from('data_deletion_requests')
    .select(COLUMNS)
    .eq('account_id', accountId)
    .eq('phone', phone)
    .eq('status', 'pending')
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return toDomain(data as DataDeletionRequestRow)
}

export interface CreateDeletionRequestInput {
  conversationId: string | null
  contactId: string | null
  phone: string
  profileName: string | null
}

export interface CreateDeletionRequestResult {
  request: DataDeletionRequest
  /** False when an existing pending request for this phone was
   *  returned instead of inserting a new row, idempotency guard,
   *  either from the pre-check or from losing a race on the partial
   *  unique index (23505). */
  created: boolean
}

/**
 * Record a new deletion request, idempotently. If a pending request
 * already exists for this (account, phone) it is returned unchanged
 * (`created: false`) instead of inserting a duplicate, the caller
 * (data-deletion.ts) uses this to decide whether to send the
 * "already registered" reply or the first-time confirmation.
 */
export async function createDeletionRequest(
  db: SupabaseClient,
  accountId: string,
  input: CreateDeletionRequestInput,
): Promise<CreateDeletionRequestResult> {
  const existing = await getPendingDeletionRequestForPhone(db, accountId, input.phone)
  if (existing) {
    return { request: existing, created: false }
  }

  const { data, error } = await db
    .from('data_deletion_requests')
    .insert({
      account_id: accountId,
      conversation_id: input.conversationId,
      contact_id: input.contactId,
      phone: input.phone,
      profile_name: input.profileName,
      status: 'pending',
    })
    .select(COLUMNS)
    .single()

  if (error) {
    // Lost a race: a concurrent inbound delivery (duplicate webhook,
    // or the lead double-sending APAGAR) created the pending row
    // between our pre-check and this insert, and the partial unique
    // index (migration 041) rejected the duplicate. Re-resolve the
    // winning row instead of throwing, mirrors findOrCreateContact /
    // createPendingAction's sibling patterns in this codebase.
    if (isUniqueViolation(error)) {
      const raced = await getPendingDeletionRequestForPhone(db, accountId, input.phone)
      if (raced) return { request: raced, created: false }
    }
    throw error
  }

  return { request: toDomain(data as DataDeletionRequestRow), created: true }
}

/**
 * Cancel the pending deletion request for a phone number, if any.
 * Returns null when there was nothing pending to cancel (the caller
 * uses this to send a "nothing to cancel" reply instead of a
 * confirmation).
 */
export async function cancelPendingDeletionRequest(
  db: SupabaseClient,
  accountId: string,
  phone: string,
): Promise<DataDeletionRequest | null> {
  const { data, error } = await db
    .from('data_deletion_requests')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('account_id', accountId)
    .eq('phone', phone)
    .eq('status', 'pending')
    .select(COLUMNS)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return toDomain(data as DataDeletionRequestRow)
}

/** Mark a request as having triggered the geral@/devs@ notification
 *  email, best-effort bookkeeping, never blocks the request itself. */
export async function markDeletionRequestNotified(
  db: SupabaseClient,
  accountId: string,
  requestId: string,
): Promise<void> {
  const { error } = await db
    .from('data_deletion_requests')
    .update({ notified_at: new Date().toISOString() })
    .eq('account_id', accountId)
    .eq('id', requestId)
  if (error) throw error
}
