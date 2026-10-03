import type { Automation, TimeBasedTriggerConfig } from '@/types'
import { supabaseAdmin } from './admin-client'
import { runAutomationsForTrigger } from './engine'
import { isScheduleDue } from './schedule'

/** Fire every active time-based automation whose schedule matches now. */
export async function runDueTimeBasedAutomations(now: Date = new Date()): Promise<number> {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('automations')
    .select('*')
    .eq('trigger_type', 'time_based')
    .eq('is_active', true)

  if (error) {
    console.error('[automations] time_based scan failed:', error)
    return 0
  }

  let fired = 0
  for (const row of (data ?? []) as Automation[]) {
    const cfg = row.trigger_config as TimeBasedTriggerConfig
    if (!cfg?.schedule) continue
    if (!isScheduleDue(cfg.schedule, cfg.timezone, row.last_executed_at ?? null, now)) {
      continue
    }
    await runAutomationsForTrigger({
      accountId: row.account_id,
      triggerType: 'time_based',
      contactId: undefined,
      context: {},
    }).catch((err) => console.error('[automations] time_based dispatch failed:', err))
    fired++
  }
  return fired
}
