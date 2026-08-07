import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// lead_qualification repository — the ONLY module allowed to call
// `supabase.from('lead_qualification')`. Every function takes
// `accountId` as its first explicit argument and filters on it, same
// rationale as calendar-config.repo.ts / bookings.repo.ts: the
// service-role tool-executor path has no RLS to fall back on.
// ============================================================

export type LeadUrgency = 'low' | 'medium' | 'high' | 'urgent'

export interface LeadQualification {
  id: string
  accountId: string
  contactId: string
  score: number | null
  stage: string | null
  urgency: LeadUrgency | null
  answers: Record<string, unknown>
  qualifiedAt: Date | null
}

export interface UpsertLeadQualificationInput {
  score?: number | null
  stage?: string | null
  urgency?: LeadUrgency | null
  /** Merged into the existing `answers` map (shallow), never replaces it
   *  wholesale — the qualification conversation adds one answer at a
   *  time across many tool calls, so a blind overwrite would lose
   *  earlier answers on every subsequent call. */
  answers?: Record<string, unknown>
  /** `true` sets `qualified_at = now()`; omitted/false leaves it as-is
   *  (never un-sets a previously recorded qualification timestamp). */
  qualified?: boolean
}

interface LeadQualificationRow {
  id: string
  account_id: string
  contact_id: string
  score: number | null
  stage: string | null
  urgency: LeadUrgency | null
  answers: Record<string, unknown>
  qualified_at: string | null
}

const COLUMNS = 'id, account_id, contact_id, score, stage, urgency, answers, qualified_at'

function toDomain(row: LeadQualificationRow): LeadQualification {
  return {
    id: row.id,
    accountId: row.account_id,
    contactId: row.contact_id,
    score: row.score,
    stage: row.stage,
    urgency: row.urgency,
    answers: row.answers ?? {},
    qualifiedAt: row.qualified_at ? new Date(row.qualified_at) : null,
  }
}

export async function getLeadQualification(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<LeadQualification | null> {
  const { data, error } = await db
    .from('lead_qualification')
    .select(COLUMNS)
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return toDomain(data as LeadQualificationRow)
}

/**
 * Create-or-merge the qualification row for `contactId` within
 * `accountId`. `answers` is merged (not replaced) with whatever is
 * already stored, so the agent can call this incrementally as it learns
 * things during the conversation rather than only once at the end (per
 * the tool's own description in schema.ts).
 */
export async function upsertLeadQualification(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  input: UpsertLeadQualificationInput,
): Promise<LeadQualification> {
  const existing = await getLeadQualification(db, accountId, contactId)
  const mergedAnswers = { ...(existing?.answers ?? {}), ...(input.answers ?? {}) }

  const row: Record<string, unknown> = {
    account_id: accountId,
    contact_id: contactId,
    answers: mergedAnswers,
  }
  if (input.score !== undefined) row.score = input.score
  if (input.stage !== undefined) row.stage = input.stage
  if (input.urgency !== undefined) row.urgency = input.urgency
  if (input.qualified) row.qualified_at = new Date().toISOString()

  const { data, error } = await db
    .from('lead_qualification')
    .upsert(row, { onConflict: 'account_id,contact_id' })
    .select(COLUMNS)
    .single()
  if (error) throw error
  return toDomain(data as LeadQualificationRow)
}
