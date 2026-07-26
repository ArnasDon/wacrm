import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/053_flow_approvals.sql"),
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

  it("rechecks current tenant membership and expiry under the decision row lock", () => {
    const decision = sql.match(
      /CREATE OR REPLACE FUNCTION decide_flow_approval[\s\S]+?\$\$;/i,
    )?.[0];
    expect(decision).toBeTruthy();
    expect(decision).toMatch(
      /SELECT \* INTO v_request[\s\S]+?FOR UPDATE;[\s\S]+?v_actor\s*=\s*v_request\.assignee_user_id[\s\S]+?is_account_member\s*\(\s*v_request\.account_id,\s*'agent'\s*\)/i,
    );
    expect(decision).toMatch(
      /is_account_member\s*\(\s*v_request\.account_id,\s*'admin'\s*\)/i,
    );
    expect(decision).toMatch(
      /v_request\.expires_at\s*<=\s*clock_timestamp\(\)[\s\S]+?approval_expired/i,
    );
    expect(decision?.indexOf("approval_expired")).toBeLessThan(
      decision?.indexOf("UPDATE public.flow_approval_requests") ?? -1,
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

  it("adds approval notifications without exposing contact channels", () => {
    expect(sql).toContain("'flow_approval'");
    expect(sql).toContain("approval_request_id");
    expect(sql).not.toMatch(/\b(?:email|phone|telephone)\b/i);
  });

  it("appends bounded run audit events for human decisions and timeouts", () => {
    expect(sql).toContain("'approval_decision'");
    expect(sql).toContain("'approval_timeout'");
    expect(sql).not.toMatch(/flow_run_events[\s\S]{0,500}decision_note/i);
  });
});
