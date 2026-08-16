import type { SupabaseClient } from '@supabase/supabase-js'
import { isUniqueViolation } from '@/lib/contacts/dedupe'

// ============================================================
// data_deletion_insert_failures repository — the ONLY module allowed
// to call `supabase.from('data_deletion_insert_failures')`. See
// migration 043_data_deletion_insert_failures.sql for the full design
// note. Deliberately mirrors aisdr-approval-forwards.repo.ts (same
// claim/retry/give-up shape) per the instruction to reuse that
// pattern for the RGPD deletion path instead of inventing a new one.
// ============================================================

export type DataDeletionInsertFailureStatus = 'failed' | 'recovered' | 'gave_up'

export interface DataDeletionInsertFailure {
  id: string
  accountId: string
  conversationId: string | null
  contactId: string | null
  phone: string
  profileName: string | null
  status: DataDeletionInsertFailureStatus
  attempts: number
  lastError: string | null
  recoveredAt: Date | null
  createdAt: Date
  updatedAt: Date
}

interface DataDeletionInsertFailureRow {
  id: string
  account_id: string
  conversation_id: string | null
  contact_id: string | null
  phone: string
  profile_name: string | null
  status: DataDeletionInsertFailureStatus
  attempts: number
  last_error: string | null
  recovered_at: string | null
  created_at: string
  updated_at: string
}

const COLUMNS =
  'id, account_id, conversation_id, contact_id, phone, profile_name, status, attempts, last_error, recovered_at, created_at, updated_at'

function toDomain(row: DataDeletionInsertFailureRow): DataDeletionInsertFailure {
  return {
    id: row.id,
    accountId: row.account_id,
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    phone: row.phone,
    profileName: row.profile_name,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    recoveredAt: row.recovered_at ? new Date(row.recovered_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

export interface RecordDeletionInsertFailureInput {
  accountId: string
  conversationId: string | null
  contactId: string | null
  phone: string
  profileName: string | null
  error: string
}

/**
 * Record (or bump) a failed `data_deletion_requests` insert attempt.
 * Idempotent per (account_id, phone): a lead re-sending "APAGAR" while
 * the previous attempt is still `failed` bumps that row's `attempts`
 * instead of creating a duplicate (the partial unique index in
 * migration 043 is the actual backstop for a racing concurrent
 * insert, same pattern as every other repo in this directory).
 */
export async function recordDeletionInsertFailure(
  db: SupabaseClient,
  input: RecordDeletionInsertFailureInput,
): Promise<DataDeletionInsertFailure> {
  const { data, error } = await db
    .from('data_deletion_insert_failures')
    .insert({
      account_id: input.accountId,
      conversation_id: input.conversationId,
      contact_id: input.contactId,
      phone: input.phone,
      profile_name: input.profileName,
      status: 'failed',
      attempts: 1,
      last_error: input.error,
    })
    .select(COLUMNS)
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      // A `failed` row for this (account, phone) already exists — bump
      // its attempts/last_error instead of inserting a duplicate.
      const { data: existing, error: fetchErr } = await db
        .from('data_deletion_insert_failures')
        .select(COLUMNS)
        .eq('account_id', input.accountId)
        .eq('phone', input.phone)
        .eq('status', 'failed')
        .maybeSingle()
      if (fetchErr) throw fetchErr
      if (existing) {
        const row = existing as DataDeletionInsertFailureRow
        const { data: updated, error: updateErr } = await db
          .from('data_deletion_insert_failures')
          .update({ attempts: row.attempts + 1, last_error: input.error })
          .eq('id', row.id)
          .select(COLUMNS)
          .single()
        if (updateErr) throw updateErr
        return toDomain(updated as DataDeletionInsertFailureRow)
      }
    }
    throw error
  }

  return toDomain(data as DataDeletionInsertFailureRow)
}

/** Due `failed` rows for the reprocessing cron, oldest first. */
export async function getFailedDeletionInsertsForRetry(
  db: SupabaseClient,
  opts: { limit?: number } = {},
): Promise<DataDeletionInsertFailure[]> {
  const { limit = 50 } = opts
  const { data, error } = await db
    .from('data_deletion_insert_failures')
    .select(COLUMNS)
    .eq('status', 'failed')
    .order('updated_at', { ascending: true })
    .limit(limit)
  if (error) throw error
  return (data as DataDeletionInsertFailureRow[]).map(toDomain)
}

/** Mark a retried row as `recovered` — the underlying
 *  `data_deletion_requests` insert finally succeeded. */
export async function markDeletionInsertRecovered(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db
    .from('data_deletion_insert_failures')
    .update({ status: 'recovered', recovered_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

/** Mark a retry attempt as failed again — `giveUp` sets the terminal
 *  `gave_up` status once the reprocessing budget is exhausted. */
export async function markDeletionInsertFailedAgain(
  db: SupabaseClient,
  id: string,
  attempts: number,
  errorMessage: string,
  opts: { giveUp?: boolean } = {},
): Promise<void> {
  const { error } = await db
    .from('data_deletion_insert_failures')
    .update({
      status: opts.giveUp ? 'gave_up' : 'failed',
      attempts,
      last_error: errorMessage,
    })
    .eq('id', id)
  if (error) throw error
}
