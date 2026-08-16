import type { SupabaseClient } from '@supabase/supabase-js'
import { isUniqueViolation } from '@/lib/contacts/dedupe'

// ============================================================
// aisdr_approval_forwards repository — the ONLY module allowed to call
// `supabase.from('aisdr_approval_forwards')`. See migration
// 042_aisdr_approval_forward_queue.sql for the full design note
// (idempotency guards, status lifecycle).
// ============================================================

export type AisdrForwardStatus = 'pending' | 'forwarded' | 'failed' | 'gave_up' | 'skipped_duplicate'
export type AisdrForwardDecision = 'send' | 'discard'

export interface AisdrApprovalForward {
  id: string
  accountId: string
  waMessageId: string
  approvalId: number
  decision: AisdrForwardDecision
  status: AisdrForwardStatus
  attempts: number
  lastError: string | null
  forwardedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

interface AisdrApprovalForwardRow {
  id: string
  account_id: string
  wa_message_id: string
  approval_id: number
  decision: AisdrForwardDecision
  status: AisdrForwardStatus
  attempts: number
  last_error: string | null
  forwarded_at: string | null
  created_at: string
  updated_at: string
}

const COLUMNS =
  'id, account_id, wa_message_id, approval_id, decision, status, attempts, last_error, forwarded_at, created_at, updated_at'

function toDomain(row: AisdrApprovalForwardRow): AisdrApprovalForward {
  return {
    id: row.id,
    accountId: row.account_id,
    waMessageId: row.wa_message_id,
    approvalId: row.approval_id,
    decision: row.decision,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    forwardedAt: row.forwarded_at ? new Date(row.forwarded_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

/**
 * Idempotency guard #2 (double-tap, see migration 042): the most recent
 * `forwarded` row for this approval_id, if any. A caller finding a hit
 * here must NOT attempt a new forward — the decision already reached
 * the AI SDR successfully under a different wa_message_id.
 */
export async function findForwardedByApprovalId(
  db: SupabaseClient,
  approvalId: number,
): Promise<AisdrApprovalForward | null> {
  const { data, error } = await db
    .from('aisdr_approval_forwards')
    .select(COLUMNS)
    .eq('approval_id', approvalId)
    .eq('status', 'forwarded')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return toDomain(data as AisdrApprovalForwardRow)
}

export interface ClaimForwardInput {
  accountId: string
  waMessageId: string
  approvalId: number
  decision: AisdrForwardDecision
}

export interface ClaimForwardResult {
  /** False when a row for this exact `waMessageId` already existed
   *  (idempotency guard #1, Meta redelivery) — `row` is the pre-existing
   *  one and the caller must not attempt a new forward. */
  created: boolean
  row: AisdrApprovalForward
}

/**
 * Claim a `wa_message_id` for forwarding by inserting a `pending` row
 * BEFORE the outbound HTTP call. The UNIQUE index on `wa_message_id`
 * (migration 042) is the actual invariant backstop for a redelivered
 * webhook racing this same insert; `isUniqueViolation` re-resolves the
 * existing row instead of throwing, mirroring every other
 * check-then-insert repo in this directory.
 */
export async function claimForwardAttempt(
  db: SupabaseClient,
  input: ClaimForwardInput,
): Promise<ClaimForwardResult> {
  const { data, error } = await db
    .from('aisdr_approval_forwards')
    .insert({
      account_id: input.accountId,
      wa_message_id: input.waMessageId,
      approval_id: input.approvalId,
      decision: input.decision,
      status: 'pending',
      attempts: 1,
    })
    .select(COLUMNS)
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      const { data: existing, error: fetchErr } = await db
        .from('aisdr_approval_forwards')
        .select(COLUMNS)
        .eq('wa_message_id', input.waMessageId)
        .maybeSingle()
      if (fetchErr) throw fetchErr
      if (existing) return { created: false, row: toDomain(existing as AisdrApprovalForwardRow) }
    }
    throw error
  }

  return { created: true, row: toDomain(data as AisdrApprovalForwardRow) }
}

/** Best-effort audit row for idempotency guard #2 (double-tap) — never
 *  throws, a failure here must not affect the caller's `skipped_duplicate`
 *  outcome, which is already decided by the time this is called. */
export async function insertSkippedDuplicateForward(
  db: SupabaseClient,
  input: ClaimForwardInput,
): Promise<void> {
  const { error } = await db.from('aisdr_approval_forwards').insert({
    account_id: input.accountId,
    wa_message_id: input.waMessageId,
    approval_id: input.approvalId,
    decision: input.decision,
    status: 'skipped_duplicate',
    attempts: 0,
  })
  // A unique violation here means this exact wa_message_id somehow got
  // claimed by a concurrent request between the caller's lookup and this
  // insert — harmless, the other request's row already tells the same
  // story. Any other error is logged but still swallowed: this is an
  // audit trail, not a source of truth the caller depends on.
  if (error && !isUniqueViolation(error)) {
    console.error('[aisdr-approval-forwards] failed to record skipped_duplicate row:', error)
  }
}

export async function markForwardForwarded(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db
    .from('aisdr_approval_forwards')
    .update({ status: 'forwarded', forwarded_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

/**
 * Mark a forward attempt as failed. `giveUp` (attempts crossed the
 * reprocessing budget, see AISDR_FORWARD_MAX_QUEUE_ATTEMPTS in
 * aisdr-approval-forward.ts) sets the terminal `gave_up` status instead
 * of `failed`, so the reprocessing cron stops picking the row up.
 */
export async function markForwardFailed(
  db: SupabaseClient,
  id: string,
  errorMessage: string,
  opts: { giveUp?: boolean } = {},
): Promise<void> {
  const { error } = await db
    .from('aisdr_approval_forwards')
    .update({ status: opts.giveUp ? 'gave_up' : 'failed', last_error: errorMessage })
    .eq('id', id)
  if (error) throw error
}

/** Due `failed` rows for the reprocessing cron, oldest first. */
export async function getFailedForwardsForRetry(
  db: SupabaseClient,
  opts: { limit?: number } = {},
): Promise<AisdrApprovalForward[]> {
  const { limit = 50 } = opts
  const { data, error } = await db
    .from('aisdr_approval_forwards')
    .select(COLUMNS)
    .eq('status', 'failed')
    .order('updated_at', { ascending: true })
    .limit(limit)
  if (error) throw error
  return (data as AisdrApprovalForwardRow[]).map(toDomain)
}

/** Atomically claim a `failed` row for a reprocessing attempt —
 *  `failed` -> `pending`, guarded by `.eq('status', 'failed')` so
 *  overlapping cron invocations can't both retry the same row. Bumps
 *  `attempts` in the same update. Returns null if another invocation
 *  already claimed it. */
export async function claimFailedForwardForRetry(
  db: SupabaseClient,
  id: string,
  currentAttempts: number,
): Promise<AisdrApprovalForward | null> {
  const { data, error } = await db
    .from('aisdr_approval_forwards')
    .update({ status: 'pending', attempts: currentAttempts + 1 })
    .eq('id', id)
    .eq('status', 'failed')
    .select(COLUMNS)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return toDomain(data as AisdrApprovalForwardRow)
}
