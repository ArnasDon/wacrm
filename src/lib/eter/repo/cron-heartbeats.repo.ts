import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// cron_heartbeats repository — the ONLY module allowed to call
// `supabase.from('cron_heartbeats')`. See migration
// 044_cron_heartbeats.sql for the full design note.
// ============================================================

export interface CronHeartbeat {
  cronName: string
  lastSuccessAt: Date
  lastResult: unknown
  updatedAt: Date
}

interface CronHeartbeatRow {
  cron_name: string
  last_success_at: string
  last_result: unknown
  updated_at: string
}

function toDomain(row: CronHeartbeatRow): CronHeartbeat {
  return {
    cronName: row.cron_name,
    lastSuccessAt: new Date(row.last_success_at),
    lastResult: row.last_result,
    updatedAt: new Date(row.updated_at),
  }
}

/** Read the current heartbeat for `cronName`, or null if this cron
 *  has never recorded a successful run. */
export async function getCronHeartbeat(
  db: SupabaseClient,
  cronName: string,
): Promise<CronHeartbeat | null> {
  const { data, error } = await db
    .from('cron_heartbeats')
    .select('cron_name, last_success_at, last_result, updated_at')
    .eq('cron_name', cronName)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return toDomain(data as CronHeartbeatRow)
}

/** Upsert the heartbeat for `cronName` to "now", with an optional
 *  small JSON snapshot of the sweep's result. Called at the end of a
 *  successful cron run — see the call site's own try/catch for why a
 *  failure here must never fail the cron response itself. */
export async function recordCronHeartbeat(
  db: SupabaseClient,
  cronName: string,
  lastResult: unknown,
  now: Date = new Date(),
): Promise<void> {
  const { error } = await db
    .from('cron_heartbeats')
    .upsert(
      { cron_name: cronName, last_success_at: now.toISOString(), last_result: lastResult },
      { onConflict: 'cron_name' },
    )
  if (error) throw error
}
