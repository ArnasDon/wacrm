import type { SupabaseClient } from '@supabase/supabase-js'
import { IGNORED_SUGGESTION_RETENTION_DAYS } from '@/lib/ai-suggestion-status'

/**
 * Permanently deletes `ignored` suggestions once they've sat past the
 * retention window (default 10 days from `resolved_at`, the moment
 * "Ignorar" was clicked). Before that window closes, the suggestion
 * still exists in the `ignored` view and "Restaurar" (PATCH
 * status:'pending') brings it back — this is the point where an
 * accidental ignore stops being recoverable.
 *
 * Global, not per-account — one cheap DELETE regardless of how many
 * accounts exist. Called from both AI cron routes (followups/learning)
 * so it runs on whichever schedule the operator actually configured;
 * harmless to run from both, and harmless if it finds nothing.
 */
export async function deleteExpiredIgnoredSuggestions(db: SupabaseClient): Promise<number> {
  const cutoff = new Date(
    Date.now() - IGNORED_SUGGESTION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()

  const { data, error } = await db
    .from('ai_suggestions')
    .delete()
    .eq('status', 'ignored')
    .lt('resolved_at', cutoff)
    .select('id')

  if (error) {
    console.error('[suggestions cleanup] delete failed:', error)
    return 0
  }
  return data?.length ?? 0
}
