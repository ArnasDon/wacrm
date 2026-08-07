import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Read-only slice of `message_templates` for the EterWA agent domain.
// The rest of the app (templates CRUD, Meta sync) reads/writes this
// table directly (src/app/api/whatsapp/templates/**) — out of scope to
// refactor. This module exists only so the eter-agent cron
// (`/api/eter-agent/cron`) can look up an APPROVED template by name
// through the repo layer instead of an inline `.from('message_templates')`.
// ============================================================

export interface ApprovedTemplateSummary {
  name: string
  language: string
}

/**
 * Look up an APPROVED template by exact name for `accountId`. Used by
 * the eter-agent cron when a scheduled follow-up/reminder's send time
 * falls outside Meta's 24h customer-service window — free text is not
 * allowed there, only an approved template. Returns null (not an
 * error) when no such template exists; callers must treat that as "do
 * not send" rather than falling back to free text.
 */
export async function findApprovedTemplateByName(
  db: SupabaseClient,
  accountId: string,
  name: string,
): Promise<ApprovedTemplateSummary | null> {
  const { data, error } = await db
    .from('message_templates')
    .select('name, language')
    .eq('account_id', accountId)
    .eq('name', name)
    .eq('status', 'APPROVED')
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return { name: data.name as string, language: (data.language as string) ?? 'en_US' }
}
