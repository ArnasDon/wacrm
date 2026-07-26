import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/053_flow_approvals.sql"),
  "utf8",
);
const memberRpcsSql = readFileSync(
  join(process.cwd(), "supabase/migrations/018_account_member_rpcs.sql"),
  "utf8",
);
const invitationRpcsSql = readFileSync(
  join(process.cwd(), "supabase/migrations/019_invitation_rpcs.sql"),
  "utf8",
);
const engineSource = readFileSync(
  join(process.cwd(), "src/lib/flows/engine.ts"),
  "utf8",
);
const runHistorySource = readFileSync(
  join(
    process.cwd(),
    "src/app/(dashboard)/flows/[id]/runs/page.tsx",
  ),
  "utf8",
);

describe("migration 053 durable flow approvals", () => {
  it("stores account/version/run/visit-bound requests with bounded payloads and retention", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS flow_approval_requests");
    for (const column of [
      "account_id",
      "flow_id",
      "flow_version_id",
      "flow_run_id",
      "node_key",
      "visit_id",
      "attempt",
      "assignee_user_id",
      "expires_at",
      "revision",
    ]) {
      expect(sql).toMatch(new RegExp(`\\b${column}\\b`, "i"));
    }
    expect(sql).toContain("octet_length");
    expect(sql).toContain("retention_expires_at");
    expect(sql).toMatch(/UNIQUE\s*\(\s*flow_run_id,\s*visit_id,\s*node_key,\s*attempt\s*\)/i);
  });

  it("keeps raw rows immutable and account-scoped", () => {
    expect(sql).toContain("ALTER TABLE flow_approval_requests ENABLE ROW LEVEL SECURITY");
    expect(sql).toMatch(
      /auth\.uid\(\)\s*=\s*assignee_user_id[\s\S]+?is_account_member\s*\(\s*account_id,\s*'agent'\s*\)/i,
    );
    expect(sql).toMatch(/is_account_member\s*\(\s*account_id,\s*'admin'\s*\)/i);
    expect(sql).toMatch(
      /REVOKE\s+(?:ALL|INSERT,\s*UPDATE,\s*DELETE)[\s\S]+?flow_approval_requests[\s\S]+?FROM authenticated/i,
    );
    expect(sql).not.toMatch(/GRANT\s+(?:INSERT|UPDATE|DELETE)[\s\S]+?flow_approval_requests[\s\S]+?TO authenticated/i);
  });

  it("provides hardened schedule, CAS decision, SKIP LOCKED claim, ack, and purge RPCs", () => {
    for (const name of [
      "end_flow_run_if_owned",
      "schedule_flow_approval",
      "decide_flow_approval",
      "claim_flow_approval_resolutions",
      "complete_flow_approval_resolution",
      "purge_expired_flow_approvals",
    ]) {
      const definition = sql.match(
        new RegExp(
          `CREATE OR REPLACE FUNCTION ${name}[\\s\\S]+?\\$\\$;`,
          "i",
        ),
      )?.[0];
      expect(definition, name).toBeTruthy();
      expect(definition).toContain(
        "SET search_path = pg_catalog, public, pg_temp",
      );
    }
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("approval_revision_conflict");
    expect(sql).toContain("p_expected_revision");
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION decide_flow_approval[\s\S]+?TO authenticated/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION schedule_flow_approval[\s\S]+?TO service_role/i);
    const decision = sql.match(
      /CREATE OR REPLACE FUNCTION decide_flow_approval[\s\S]+?\$\$;/i,
    )?.[0];
    expect(decision).toContain("RETURNS JSONB");
    expect(decision).not.toContain("'resolution_token'");
    expect(decision).not.toContain("'resume_id'");
  });

  it("locks the request then the actor membership row before authorizing", () => {
    const decision = sql.match(
      /CREATE OR REPLACE FUNCTION decide_flow_approval[\s\S]+?\$\$;/i,
    )?.[0];
    expect(decision).toBeTruthy();
    expect(decision).toMatch(
      /SELECT \* INTO v_request[\s\S]+?flow_approval_requests[\s\S]+?FOR UPDATE;[\s\S]+?SELECT \* INTO v_actor_profile[\s\S]+?profiles[\s\S]+?user_id\s*=\s*v_actor[\s\S]+?FOR SHARE;/i,
    );
    expect(decision).toMatch(
      /v_actor_profile\.account_id\s+IS DISTINCT FROM\s+v_request\.account_id[\s\S]+?v_actor\s*=\s*v_request\.assignee_user_id[\s\S]+?v_actor_profile\.account_role\s+IN\s*\(\s*'owner',\s*'admin',\s*'agent'\s*\)[\s\S]+?v_actor_profile\.account_role\s+IN\s*\(\s*'owner',\s*'admin'\s*\)/i,
    );
    expect(decision).toContain(
      "Lock order: approval request first, then the actor profile.",
    );
  });

  it("serializes approval authorization with every membership removal, demotion, and transfer write", () => {
    const setRole = memberRpcsSql.match(
      /CREATE OR REPLACE FUNCTION public\.set_member_role[\s\S]+?\$\$;/i,
    )?.[0];
    const removeMember = memberRpcsSql.match(
      /CREATE OR REPLACE FUNCTION public\.remove_account_member[\s\S]+?\$\$;/i,
    )?.[0];
    const transferOwner = memberRpcsSql.match(
      /CREATE OR REPLACE FUNCTION public\.transfer_account_ownership[\s\S]+?\$\$;/i,
    )?.[0];
    const redeemInvitation = invitationRpcsSql.match(
      /CREATE OR REPLACE FUNCTION public\.redeem_invitation[\s\S]+?\$\$;/i,
    )?.[0];

    expect(setRole).toMatch(
      /UPDATE profiles[\s\S]+?SET account_role\s*=\s*p_new_role[\s\S]+?WHERE user_id\s*=\s*p_user_id/i,
    );
    expect(removeMember).toMatch(
      /UPDATE profiles[\s\S]+?SET account_id\s*=\s*v_new_account_id[\s\S]+?account_role\s*=\s*'owner'[\s\S]+?WHERE user_id\s*=\s*p_user_id/i,
    );
    expect(transferOwner).toMatch(
      /UPDATE profiles SET account_role\s*=\s*'admin'[\s\S]+?WHERE user_id\s*=\s*auth\.uid\(\)/i,
    );
    expect(redeemInvitation).toMatch(
      /UPDATE profiles[\s\S]+?SET account_id\s*=\s*v_inv\.account_id[\s\S]+?account_role\s*=\s*v_inv\.role[\s\S]+?WHERE user_id\s*=\s*v_caller_id/i,
    );
  });

  it("allows an exact authorized replay after expiry but blocks a first decision at the deadline", () => {
    const decision = sql.match(
      /CREATE OR REPLACE FUNCTION decide_flow_approval[\s\S]+?\$\$;/i,
    )?.[0] ?? "";
    const replayAt = decision.indexOf("IF v_request.decision = p_decision");
    const expiryAt = decision.indexOf(
      "v_request.expires_at <= clock_timestamp()",
    );
    const mutationAt = decision.indexOf(
      "UPDATE public.flow_approval_requests",
    );

    expect(replayAt).toBeGreaterThan(-1);
    expect(expiryAt).toBeGreaterThan(replayAt);
    expect(mutationAt).toBeGreaterThan(expiryAt);
    expect(decision).toMatch(
      /IF v_request\.decision\s*=\s*p_decision[\s\S]+?p_expected_revision\s*=\s*v_request\.revision\s*-\s*1[\s\S]+?v_request\.decision_note\s+IS NOT DISTINCT FROM\s+NULLIF\(BTRIM\(p_note\),\s*''\)[\s\S]+?RETURN jsonb_build_object/i,
    );
    expect(decision).toMatch(
      /v_request\.expires_at\s*<=\s*clock_timestamp\(\)[\s\S]+?approval_expired/i,
    );
  });

  it("hardens notification reads and read receipts against removed or transferred users", () => {
    expect(sql).toMatch(
      /DROP POLICY IF EXISTS notifications_select[\s\S]+?CREATE POLICY notifications_select[\s\S]+?auth\.uid\(\)\s*=\s*user_id[\s\S]+?is_account_member\s*\(\s*account_id,\s*'viewer'\s*\)/i,
    );
    expect(sql).toMatch(
      /DROP POLICY IF EXISTS notifications_update[\s\S]+?CREATE POLICY notifications_update[\s\S]+?USING\s*\([\s\S]+?auth\.uid\(\)\s*=\s*user_id[\s\S]+?is_account_member\s*\(\s*account_id,\s*'viewer'\s*\)[\s\S]+?WITH CHECK\s*\([\s\S]+?auth\.uid\(\)\s*=\s*user_id[\s\S]+?is_account_member\s*\(\s*account_id,\s*'viewer'\s*\)/i,
    );
  });

  it("returns durable evidence when a reclaimed resolution already opened a second approval", () => {
    const claim = sql.match(
      /CREATE OR REPLACE FUNCTION claim_flow_approval_resolutions[\s\S]+?\$\$;/i,
    )?.[0];
    expect(claim).toContain("chained_approval_ready BOOLEAN");
    expect(claim).toMatch(
      /chained_approval_ready\s*:=\s*[\s\S]+?v_run\.status\s*=\s*'paused_by_agent'[\s\S]+?EXISTS\s*\([\s\S]+?flow_approval_requests[\s\S]+?id\s*<>\s*v_request\.id[\s\S]+?visit_id\s*=\s*v_run\.current_visit_id/i,
    );
  });

  it("normalizes only the owned approval continuation after prompt, wait, chained, or terminal outcomes", () => {
    const ack = sql.match(
      /CREATE OR REPLACE FUNCTION complete_flow_approval_resolution[\s\S]+?\$\$;/i,
    )?.[0] ?? "";
    expect(ack).toMatch(
      /SELECT \* INTO v_request[\s\S]+?flow_approval_requests[\s\S]+?FOR UPDATE;[\s\S]+?SELECT \* INTO v_run[\s\S]+?flow_runs[\s\S]+?FOR UPDATE;/i,
    );
    expect(ack).toMatch(
      /SET status\s*=\s*CASE[\s\S]+?WHEN status\s*=\s*'resuming' THEN 'active'[\s\S]+?ELSE status[\s\S]+?continuation_id\s*=\s*NULL[\s\S]+?continuation_phase\s*=\s*'idle'/i,
    );
    expect(ack).toMatch(
      /WHERE id\s*=\s*v_request\.flow_run_id[\s\S]+?continuation_id\s*=\s*v_request\.resume_id[\s\S]+?continuation_phase IN\s*\(\s*'running',\s*'completed'\s*\)/i,
    );
    for (const preserved of [
      "waiting",
      "paused_by_agent",
      "completed",
      "handed_off",
      "timed_out",
      "failed",
    ]) {
      expect(ack).not.toMatch(
        new RegExp(`WHEN status\\s*=\\s*'${preserved}'\\s+THEN`, "i"),
      );
    }
  });

  it("locks approval requests before runs in schedule, claim, and ack", () => {
    const schedule = sql.match(
      /CREATE OR REPLACE FUNCTION schedule_flow_approval[\s\S]+?\$\$;/i,
    )?.[0] ?? "";
    const claim = sql.match(
      /CREATE OR REPLACE FUNCTION claim_flow_approval_resolutions[\s\S]+?\$\$;/i,
    )?.[0] ?? "";
    const ack = sql.match(
      /CREATE OR REPLACE FUNCTION complete_flow_approval_resolution[\s\S]+?\$\$;/i,
    )?.[0] ?? "";
    const scheduleInsertAt = schedule.indexOf(
      "INSERT INTO public.flow_approval_requests",
    );
    const scheduleRequestLockAt = schedule.indexOf(
      "FROM public.flow_approval_requests",
      scheduleInsertAt,
    );
    const scheduleRunLockAt = schedule.indexOf(
      "FROM public.flow_runs",
      scheduleRequestLockAt,
    );

    expect(sql).toContain(
      "UNIQUE (flow_run_id, visit_id, node_key, attempt)",
    );
    expect(schedule).toContain(
      "ON CONFLICT (flow_run_id, visit_id, node_key, attempt) DO NOTHING",
    );
    expect(scheduleRequestLockAt).toBeGreaterThan(scheduleInsertAt);
    expect(scheduleRunLockAt).toBeGreaterThan(scheduleRequestLockAt);
    expect(
      schedule.slice(scheduleRequestLockAt, scheduleRunLockAt),
    ).toContain("FOR UPDATE");
    expect(schedule.slice(scheduleRunLockAt)).toContain("FOR UPDATE");
    expect(claim).toMatch(
      /flow_approval_requests[\s\S]+?FOR UPDATE SKIP LOCKED[\s\S]+?FROM public\.flow_runs[\s\S]+?FOR UPDATE/i,
    );
    expect(ack).toMatch(
      /FROM public\.flow_approval_requests[\s\S]+?FOR UPDATE;[\s\S]+?FROM public\.flow_runs[\s\S]+?FOR UPDATE;/i,
    );
  });

  it("validates every idempotent schedule argument and the locked run cursor", () => {
    const schedule = sql.match(
      /CREATE OR REPLACE FUNCTION schedule_flow_approval[\s\S]+?\$\$;/i,
    )?.[0] ?? "";
    for (const pair of [
      ["flow_version_id", "p_flow_version_id"],
      ["flow_id", "p_flow_id"],
      ["node_key", "p_node_key"],
      ["visit_id", "p_visit_id"],
      ["attempt", "p_attempt"],
      ["assignee_user_id", "p_assignee_user_id"],
      ["title", "BTRIM(p_title)"],
      ["message", "BTRIM(p_message)"],
      ["expires_at", "p_expires_at"],
      ["approved_next", "p_approved_next"],
      ["rejected_next", "p_rejected_next"],
      ["timeout_action", "p_timeout_action"],
      ["timeout_next", "p_timeout_next"],
    ]) {
      expect(schedule).toContain(
        `v_request.${pair[0]} IS DISTINCT FROM ${pair[1]}`,
      );
    }
    expect(schedule).toMatch(
      /SELECT \* INTO v_run[\s\S]+?FROM public\.flow_runs[\s\S]+?FOR UPDATE;[\s\S]+?current_node_key IS DISTINCT FROM p_node_key[\s\S]+?current_visit_id IS DISTINCT FROM p_visit_id[\s\S]+?active_flow_version_id[\s\S]+?p_flow_version_id/i,
    );
  });

  it("ends a run only through cursor and continuation CAS ownership", () => {
    const endRun = sql.match(
      /CREATE OR REPLACE FUNCTION end_flow_run_if_owned[\s\S]+?\$\$;/i,
    )?.[0] ?? "";
    for (const precondition of [
      "p_expected_status",
      "p_expected_node_key",
      "p_expected_visit_id",
      "p_expected_continuation_id",
      "p_active_flow_version_id",
    ]) {
      expect(endRun).toContain(precondition);
    }
    expect(endRun).toContain("IS NOT DISTINCT FROM");
    expect(engineSource).toContain('db.rpc("end_flow_run_if_owned"');
    expect(engineSource).not.toMatch(
      /async function endRun[\s\S]+?from\("flow_runs"\)[\s\S]+?\.update\(/i,
    );
  });

  it("adds approval notifications without exposing contact channels", () => {
    expect(sql).toContain("'flow_approval'");
    expect(sql).toContain("approval_request_id");
    expect(sql).not.toMatch(/\b(?:email|phone|telephone)\b/i);
  });

  it("appends bounded run audit events for human decisions and timeouts", () => {
    expect(sql).toMatch(
      /event_type IN\s*\([\s\S]+?'approval_decision'[\s\S]+?'approval_timeout'[\s\S]+?\)/i,
    );
    const decision = sql.match(
      /CREATE OR REPLACE FUNCTION decide_flow_approval[\s\S]+?\$\$;/i,
    )?.[0] ?? "";
    const claim = sql.match(
      /CREATE OR REPLACE FUNCTION claim_flow_approval_resolutions[\s\S]+?\$\$;/i,
    )?.[0] ?? "";
    expect(decision).toMatch(
      /INSERT INTO public\.flow_run_events[\s\S]+?'approval_decision'/i,
    );
    expect(decision).not.toMatch(
      /INSERT INTO public\.flow_run_events[\s\S]+?'node_entered'/i,
    );
    expect(claim).toMatch(
      /INSERT INTO public\.flow_run_events[\s\S]+?'approval_timeout'/i,
    );
    expect(sql).not.toMatch(/flow_run_events[\s\S]{0,500}decision_note/i);
    expect(runHistorySource).toMatch(
      /approval_decision:\s*"[^"]+"[\s\S]+?approval_timeout:\s*"[^"]+"/i,
    );
  });
});
