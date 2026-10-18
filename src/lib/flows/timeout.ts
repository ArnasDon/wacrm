import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveFallbackPolicy } from "./fallback";

const MS_PER_HOUR = 1000 * 60 * 60;

export interface RunTimeoutCheck {
  timedOut: boolean;
  ageHours: number;
  policyHours: number;
}

export function checkRunTimeout(
  lastAdvancedAt: string,
  fallbackPolicy: unknown,
  now: Date,
): RunTimeoutCheck {
  const policyHours = resolveFallbackPolicy(fallbackPolicy).on_timeout_hours;
  const lastAdvancedMs = new Date(lastAdvancedAt).getTime();
  const ageHours = Number.isFinite(lastAdvancedMs)
    ? (now.getTime() - lastAdvancedMs) / MS_PER_HOUR
    : 0;
  return { timedOut: ageHours >= policyHours, ageHours, policyHours };
}

export async function markRunTimedOut(
  db: SupabaseClient,
  runId: string,
  check: RunTimeoutCheck,
  reason: string,
  now: Date,
): Promise<boolean> {
  const { data: updated } = await db
    .from("flow_runs")
    .update({
      status: "timed_out",
      ended_at: now.toISOString(),
      end_reason: reason,
    })
    .eq("id", runId)
    .eq("status", "active")
    .select("id");

  if (!Array.isArray(updated) || updated.length === 0) return false;

  await db.from("flow_run_events").insert({
    flow_run_id: runId,
    event_type: "timeout",
    payload: {
      age_hours: Math.round(check.ageHours * 10) / 10,
      policy_hours: check.policyHours,
    },
  });
  return true;
}
