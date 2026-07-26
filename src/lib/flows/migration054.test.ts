import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/054_flow_node_analytics.sql'
);
const engineSource = readFileSync(
  join(process.cwd(), 'src/lib/flows/engine.ts'),
  'utf8'
);
const primitivesSql = readFileSync(
  join(process.cwd(), 'supabase/migrations/049_flow_runtime_primitives.sql'),
  'utf8'
);
const compositesSql = readFileSync(
  join(process.cwd(), 'supabase/migrations/050_flow_composite_nodes.sql'),
  'utf8'
);
const approvalsSql = readFileSync(
  join(process.cwd(), 'supabase/migrations/053_flow_approvals.sql'),
  'utf8'
);

function migration(): string {
  return readFileSync(migrationPath, 'utf8');
}

describe('migration 054 exact flow node analytics', () => {
  it('models one payload-free visit per run/version/visit and links attempts', () => {
    const sql = migration();

    expect(sql).toContain(
      'ALTER TABLE public.flow_node_executions ADD COLUMN IF NOT EXISTS visit_id UUID'
    );
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.flow_node_visits');
    expect(sql).toMatch(
      /UNIQUE\s*\(\s*flow_run_id,\s*flow_version_id,\s*visit_id\s*\)/i
    );
    for (const column of [
      'node_key',
      'node_type',
      'entered_at',
      'resolved_at',
      'outcome',
      'next_flow_version_id',
      'next_node_key',
      'next_visit_id',
    ]) {
      expect(sql).toMatch(new RegExp(`\\b${column}\\b`, 'i'));
    }
    expect(sql).not.toMatch(/\b(?:inputs|outputs|vars|payload|message)\b/i);
  });

  it('records only durable cursor transitions and preserves suspended visits', () => {
    const sql = migration();
    const recorder =
      sql.match(
        /CREATE OR REPLACE FUNCTION public\.record_flow_node_visit_transition[\s\S]+?\$\$;/i
      )?.[0] ?? '';

    expect(recorder).toContain('OLD.current_visit_id');
    expect(recorder).toContain('NEW.current_visit_id');
    expect(recorder).toContain('flow_call_frames');
    expect(recorder).toContain('flow_approval_requests');
    expect(recorder).toMatch(/NEW\.status\s*=\s*'waiting'[\s\S]+?RETURN NEW/i);
    expect(recorder).toMatch(
      /NEW\.status\s*=\s*'paused_by_agent'[\s\S]+?flow_approval_requests[\s\S]+?RETURN NEW/i
    );
    expect(recorder).toMatch(
      /ON CONFLICT\s*\(\s*flow_run_id,\s*flow_version_id,\s*visit_id\s*\)\s*DO NOTHING/i
    );
    expect(recorder).toMatch(
      /UPDATE public\.flow_node_visits[\s\S]+?resolved_at IS NULL/i
    );
  });

  it('keeps viewer reads account scoped and all writes service-only', () => {
    const sql = migration();

    expect(sql).toContain(
      'ALTER TABLE public.flow_node_visits ENABLE ROW LEVEL SECURITY'
    );
    expect(sql).toMatch(
      /CREATE POLICY flow_node_visits_select[\s\S]+?public\.is_account_member\s*\(\s*account_id,\s*'viewer'\s*\)/i
    );
    expect(sql).toMatch(
      /REVOKE ALL ON TABLE public\.flow_node_visits FROM PUBLIC, anon, authenticated/i
    );
    expect(sql).toMatch(
      /GRANT SELECT ON TABLE public\.flow_node_visits TO authenticated/i
    );
    expect(sql).toMatch(
      /GRANT ALL ON TABLE public\.flow_node_visits TO service_role/i
    );
  });

  it('exposes a hardened bounded analytics RPC over production visits only', () => {
    const sql = migration();
    const rpc =
      sql.match(
        /CREATE OR REPLACE FUNCTION public\.get_flow_node_analytics[\s\S]+?\$\$;/i
      )?.[0] ?? '';

    expect(rpc).toContain('SECURITY DEFINER');
    expect(rpc).toContain('SET search_path = pg_catalog, public, pg_temp');
    expect(rpc).toContain('auth.uid()');
    expect(rpc).toContain('public.is_account_member');
    expect(rpc).toContain('published_version_id');
    expect(rpc).toContain("INTERVAL '30 days'");
    expect(rpc).toContain("INTERVAL '366 days'");
    expect(rpc).toContain('analytics_node_limit');
    expect(rpc).toContain('LIMIT 500');
    expect(rpc).toContain('LEFT JOIN');
    expect(rpc).toContain('public.flow_node_visits');
    expect(rpc).toContain('public.flow_node_executions');
    expect(rpc).not.toContain('flow_debug');
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_flow_node_analytics[\s\S]+?FROM PUBLIC, anon/i
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_flow_node_analytics[\s\S]+?TO authenticated, service_role/i
    );
  });

  it('defines exact funnel metrics, branch distribution, and coverage disclosure', () => {
    const sql = migration();
    for (const metric of [
      'entries',
      'unique_runs',
      'open',
      'resolved',
      'advanced',
      'dropoff',
      'completed',
      'handed_off',
      'advance_rate',
      'dropoff_rate',
      'avg_duration_ms',
      'avg_processing_ms',
      'next_nodes',
      'biggest_dropoff',
      'coverage_started_at',
      'legacy_attempts_excluded',
    ]) {
      expect(sql).toContain(`'${metric}'`);
    }
    expect(sql).toMatch(/COUNT\s*\(\s*DISTINCT\s+visit\.visit_id\s*\)/i);
    expect(sql).toMatch(/COUNT\s*\(\s*DISTINCT\s+visit\.flow_run_id\s*\)/i);
    expect(sql).toMatch(
      /outcome IN\s*\(\s*'failed',\s*'timed_out',\s*'paused_by_agent'\s*\)/i
    );
    expect(sql).toMatch(/resolved[^;]+NULLIF[^;]+resolved/i);
    expect(sql).toMatch(
      /node_type NOT IN\s*\(\s*'end',\s*'handoff'\s*\)[\s\S]+?ORDER BY[\s\S]+?dropoff DESC[\s\S]+?dropoff_rate DESC[\s\S]+?entries DESC/i
    );
  });

  it('does not backfill legacy attempts or visits heuristically', () => {
    const sql = migration();

    expect(sql).not.toMatch(
      /UPDATE\s+public\.flow_node_executions\s+SET\s+visit_id/i
    );
    expect(sql).not.toMatch(
      /INSERT INTO public\.flow_node_visits\s*\([^;]+\)\s*SELECT[^;]+FROM public\.flow_node_executions/i
    );
  });

  it('excludes pre-deploy and in-flight runs as one explicit rollout cohort', () => {
    const sql = migration();
    const recorder =
      sql.match(
        /CREATE OR REPLACE FUNCTION public\.record_flow_node_visit_transition[\s\S]+?\$\$;/i
      )?.[0] ?? '';
    const rpc =
      sql.match(
        /CREATE OR REPLACE FUNCTION public\.get_flow_node_analytics[\s\S]+?\$\$;/i
      )?.[0] ?? '';
    const selectedVisits =
      rpc.match(
        /selected_visits AS \([\s\S]+?\n  \),\n  attempt_totals AS/i
      )?.[0] ?? '';
    const addColumn = sql.search(
      /ADD COLUMN IF NOT EXISTS analytics_eligible BOOLEAN NOT NULL DEFAULT FALSE/i
    );
    const newRunDefault = sql.search(
      /ALTER COLUMN analytics_eligible SET DEFAULT TRUE/i
    );

    expect(addColumn).toBeGreaterThanOrEqual(0);
    expect(newRunDefault).toBeGreaterThan(addColumn);
    expect(sql).not.toMatch(
      /UPDATE\s+public\.flow_runs\s+SET\s+analytics_eligible/i
    );
    expect(recorder).toMatch(
      /IF NOT NEW\.analytics_eligible THEN[\s\S]+?RETURN NEW/i
    );
    expect(rpc).toMatch(
      /JOIN public\.flow_runs run[\s\S]+?NOT run\.analytics_eligible/i
    );
    expect(rpc).toMatch(
      /LEFT JOIN public\.flow_node_visits visit[\s\S]+?visit\.id IS NULL/i
    );
    expect(selectedVisits).toMatch(
      /JOIN public\.flow_runs run[\s\S]+?run\.analytics_eligible/i
    );
    expect(rpc).toContain(
      "'coverage_cohort', 'runs_started_after_tracking_enabled'"
    );
  });

  it('keeps processing unknown until at least one duration is observed', () => {
    const sql = migration();
    const attemptTotals =
      sql.match(/attempt_totals AS \([\s\S]+?\n  \),\n  processing AS/i)?.[0] ??
      '';

    expect(attemptTotals).toContain('SUM(execution.duration_ms)::NUMERIC');
    expect(attemptTotals).not.toMatch(
      /COALESCE\s*\(\s*SUM\(execution\.duration_ms\),\s*0\s*\)/i
    );
    expect(sql).toMatch(
      /processing AS \([\s\S]+?AVG\(processing_ms\) AS avg_processing_ms/i
    );
  });

  it('aligns coverage predicates with partial indexes for a static explain contract', () => {
    const sql = migration();

    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_flow_node_executions_analytics_orphan_null[\s\S]+?ON public\.flow_node_executions\s*\(\s*flow_version_id,\s*started_at\s*\)[\s\S]+?WHERE visit_id IS NULL/i
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_flow_node_executions_analytics_orphan_linked[\s\S]+?ON public\.flow_node_executions\s*\(\s*flow_version_id,\s*started_at,\s*flow_run_id,\s*visit_id\s*\)[\s\S]+?WHERE visit_id IS NOT NULL/i
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_flow_runs_analytics_ineligible[\s\S]+?ON public\.flow_runs\s*\(\s*id\s*\)[\s\S]+?WHERE analytics_eligible = FALSE/i
    );
    expect(sql).toMatch(
      /execution\.flow_version_id = v_version\.id[\s\S]+?execution\.started_at >= v_from[\s\S]+?execution\.started_at < v_to[\s\S]+?execution\.visit_id IS NULL/i
    );
    expect(sql).toMatch(
      /execution\.flow_version_id = v_version\.id[\s\S]+?execution\.started_at >= v_from[\s\S]+?execution\.started_at < v_to[\s\S]+?execution\.visit_id IS NOT NULL/i
    );
  });

  it('keeps error-then-success retries on one visit while storing every attempt', () => {
    const sql = migration();
    const executionInsert =
      engineSource.match(
        /async function startNodeExecutionRecord[\s\S]+?\.insert\(\{[\s\S]+?\}\)/i
      )?.[0] ?? '';

    expect(executionInsert).toContain('visit_id: run.current_visit_id ?? null');
    expect(executionInsert).toContain('attempt');
    expect(sql).toMatch(/COUNT\s*\(\s*DISTINCT\s+visit\.visit_id\s*\)/i);
    expect(sql).toMatch(/SUM\(execution\.duration_ms\)/i);
  });

  it('counts fail-run as dropoff but an error branch as an advanced visit', () => {
    const sql = migration();

    expect(sql).toMatch(
      /NEW\.status IN\s*\([\s\S]+?'failed'[\s\S]+?\)\s*THEN NEW\.status[\s\S]+?ELSE 'advanced'/i
    );
    expect(sql).toMatch(
      /visit\.outcome IN\s*\(\s*'failed',\s*'timed_out',\s*'paused_by_agent'\s*\)/i
    );
    expect(sql).toMatch(
      /WHERE visit\.outcome = 'advanced'[\s\S]+?next_node_key/i
    );
  });

  it('counts loop passages as separate visits but one unique run', () => {
    const sql = migration();

    expect(compositesSql).toMatch(
      /advance_flow_loop_iteration[\s\S]+?current_visit_id\s*=\s*p_next_visit_id/i
    );
    expect(sql).toMatch(
      /COUNT\(DISTINCT visit\.visit_id\)[\s\S]+?COUNT\(DISTINCT visit\.flow_run_id\)/i
    );
  });

  it('keeps wait and approval visits open through suspension and times them to resume', () => {
    const sql = migration();
    const schedule =
      sql.match(
        /CREATE OR REPLACE FUNCTION public\.schedule_flow_wait[\s\S]+?\$\$;/i
      )?.[0] ?? '';

    expect(sql).toMatch(/NEW\.status\s*=\s*'waiting'[\s\S]+?RETURN NEW/i);
    expect(schedule).toBeTruthy();
    expect(schedule).toMatch(
      /v_run\.current_node_key IS DISTINCT FROM p_node_key[\s\S]+?v_run\.current_visit_id IS NULL/i
    );
    expect(schedule).toMatch(
      /UPDATE public\.flow_runs[\s\S]+?status = 'waiting'[\s\S]+?current_node_key = p_node_key/i
    );
    expect(schedule).not.toMatch(
      /current_visit_id\s*=\s*(?:public\.)?uuid_generate_v4\(\)/i
    );
    expect(sql).toMatch(
      /NEW\.status\s*=\s*'paused_by_agent'[\s\S]+?flow_approval_requests[\s\S]+?RETURN NEW/i
    );
    expect(primitivesSql).toMatch(
      /prepare_flow_wait_resume[\s\S]+?current_visit_id\s*=\s*v_wait\.resume_id/i
    );
    expect(approvalsSql).toMatch(
      /claim_flow_approval_resolutions[\s\S]+?current_visit_id\s*=\s*v_request\.resume_id/i
    );
    expect(sql).toContain('visit.resolved_at - visit.entered_at');
  });

  it('keeps wait scheduling idempotent while correlating attempts to the open visit', () => {
    const sql = migration();
    const schedule =
      sql.match(
        /CREATE OR REPLACE FUNCTION public\.schedule_flow_wait[\s\S]+?\$\$;/i
      )?.[0] ?? '';

    expect(schedule).toMatch(
      /IF v_run\.status = 'waiting'[\s\S]+?RETURN QUERY[\s\S]+?IF FOUND THEN[\s\S]+?RETURN/i
    );
    expect(schedule).toContain('ON CONFLICT (flow_run_id) DO UPDATE');
    expect(schedule).toMatch(
      /current_visit_id = v_run\.current_visit_id[\s\S]+?status IN \('active', 'resuming', 'needs_recovery'\)/i
    );
    expect(engineSource).toContain('visit_id: run.current_visit_id ?? null');
  });

  it('attributes child visits separately and resolves the parent only on return or failure', () => {
    const sql = migration();

    expect(sql).toMatch(
      /Entering a child graph does not finish[\s\S]+?v_entering_child/i
    );
    expect(sql).toMatch(
      /completed_child_visit_id\s*=\s*OLD\.current_visit_id[\s\S]+?frame\.state IN \('completed', 'failed'\)/i
    );
    expect(sql).toMatch(
      /flow_version_id = v_frame\.parent_flow_version_id[\s\S]+?visit_id = v_frame\.parent_visit_id/i
    );
  });

  it('makes crash replay idempotent and never mixes debug facts', () => {
    const sql = migration();

    expect(sql).toMatch(
      /UNIQUE\s*\(\s*flow_run_id,\s*flow_version_id,\s*visit_id\s*\)/i
    );
    expect(sql).toMatch(
      /ON CONFLICT\s*\(\s*flow_run_id,\s*flow_version_id,\s*visit_id\s*\)\s*DO NOTHING/i
    );
    expect(sql).toMatch(/resolved_at IS NULL/i);
    expect(sql).not.toContain('flow_debug');
  });
});
