import type { SupabaseClient } from '@supabase/supabase-js';
import { loadKpiDataset } from '@/lib/kpis/queries';
import { conversionRate, countQualifiedLeads } from '@/lib/kpis/compute';
import type { KpiDataset } from '@/lib/kpis/types';

// ============================================================
// The `generate_report` assistant tool's data source. A compact,
// period-scoped snapshot the model narrates in chat — a subset of what
// the /kpis page shows, flattened to plain numbers so the model
// doesn't have to reason about series or row arrays.
// ============================================================

export interface AssistantReport {
  period_days: number;
  from: string;
  to: string;
  leads_generated: number;
  leads_generated_prev: number;
  leads_qualified: number;
  qualification_rate_pct: number | null;
  deals_won: number;
  deals_won_prev: number;
  won_value_total: number;
  currency: string | null;
  conversion_pct: number | null;
  first_response_median_minutes: number | null;
  followups_sent: number;
  opportunities_recovered: number;
  handoffs: number;
  handoffs_advanced: number;
  brief_completion_pct: number | null;
  temperature: { hot: number; warm: number; cold: number; unclassified: number };
}

const DAY_MS = 86_400_000;
const MIN_DAYS = 7;
const MAX_DAYS = 365;
const DEFAULT_DAYS = 30;

const round1 = (n: number | null): number | null =>
  n == null ? null : Math.round(n * 10) / 10;

/** Pure: flatten an already-loaded `KpiDataset` into the report shape. */
export function shapeReport(d: KpiDataset, days: number): AssistantReport {
  const leadsGenerated = d.leads.length;
  const leadsQualified = countQualifiedLeads(d.leads);
  const wonValue = d.wonDeals.reduce((sum, w) => sum + (w.value ?? 0), 0);
  const currency = d.wonDeals.find((w) => w.currency)?.currency ?? null;

  return {
    period_days: days,
    from: d.window.start.toISOString().slice(0, 10),
    to: d.window.end.toISOString().slice(0, 10),
    leads_generated: leadsGenerated,
    leads_generated_prev: d.previousLeadsCount,
    leads_qualified: leadsQualified,
    qualification_rate_pct: leadsGenerated
      ? round1((leadsQualified / leadsGenerated) * 100)
      : null,
    deals_won: d.wonDeals.length,
    deals_won_prev: d.previousWonCount,
    won_value_total: Math.round(wonValue * 100) / 100,
    currency,
    conversion_pct: round1(conversionRate(d.wonDeals.length, leadsGenerated)),
    first_response_median_minutes: d.trial.medianFirstResponseMin,
    followups_sent: d.trial.followupsSent,
    opportunities_recovered: d.trial.opportunitiesRecovered,
    handoffs: d.trial.handoffs,
    handoffs_advanced: d.trial.handoffsAdvanced,
    brief_completion_pct: round1(d.trial.briefCompletionPct),
    temperature: d.temperature,
  };
}

/**
 * Load the report for the last `days` days (clamped 7–365, default 30),
 * with the equally-long window before it as the comparison baseline.
 * Uses UTC-day boundaries — a monthly-ish summary doesn't need
 * timezone-exact edges.
 */
export async function loadAssistantReport(
  db: SupabaseClient,
  days: number,
): Promise<AssistantReport> {
  const clamped = Math.min(
    Math.max(Math.floor(days) || DEFAULT_DAYS, MIN_DAYS),
    MAX_DAYS,
  );
  const to = new Date();
  const start = new Date(to.getTime() - clamped * DAY_MS);
  const prevStart = new Date(start.getTime() - clamped * DAY_MS);

  const dataset = await loadKpiDataset(
    db,
    { start, end: to },
    { start: prevStart, end: start },
    'week',
  );
  return shapeReport(dataset, clamped);
}
