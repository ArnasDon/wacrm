import type { SqlConnection } from './transaction';
import { queryRows } from './rows';
import type { resumePendingExecution } from '@/lib/automations/engine';
import { resolveFallbackPolicy } from '@/lib/flows/fallback';
type PendingExecution = Parameters<typeof resumePendingExecution>[0];
/** A single statement claims bounded due work, so overlapping cron calls cannot process it twice. */
export function claimDueAutomations(db: SqlConnection) {
  return queryRows<PendingExecution>(
    db,
    `WITH due AS (SELECT id FROM public.automation_pending_executions WHERE status='pending' AND run_at<=now() ORDER BY run_at,id LIMIT 50 FOR UPDATE SKIP LOCKED) UPDATE public.automation_pending_executions p SET status='running' FROM due WHERE p.id=due.id RETURNING p.*`
  );
}
/** Worker-only cross-account sweep; each update rechecks the exact advance time we inspected. */
export async function timeoutFlowRuns(db: SqlConnection) {
  const now = new Date();
  const runs = await queryRows<{
    id: string;
    account_id: string;
    last_advanced_at: string;
    fallback_policy: unknown;
  }>(
    db,
    "SELECT r.id,r.account_id,r.last_advanced_at,f.fallback_policy FROM public.flow_runs r JOIN public.flows f ON f.id=r.flow_id AND f.account_id=r.account_id WHERE r.status='active'",
    []
  );
  let swept = 0;
  for (const run of runs) {
    const policy = resolveFallbackPolicy(run.fallback_policy);
    const age =
      (now.getTime() - new Date(run.last_advanced_at).getTime()) / 3600000;
    if (age < policy.on_timeout_hours) continue;
    const rows = await queryRows(
      db,
      `WITH expired AS (UPDATE public.flow_runs SET status='timed_out',ended_at=$4,end_reason='stale_sweep' WHERE account_id=$1 AND id=$2 AND status='active' AND last_advanced_at=$3 RETURNING id) INSERT INTO public.flow_run_events(flow_run_id,event_type,payload) SELECT id,'timeout',$5::jsonb FROM expired RETURNING id`,
      [
        run.account_id,
        run.id,
        run.last_advanced_at,
        now,
        JSON.stringify({
          age_hours: Math.round(age * 10) / 10,
          policy_hours: policy.on_timeout_hours,
        }),
      ]
    );
    swept += rows.length;
  }
  return swept;
}
