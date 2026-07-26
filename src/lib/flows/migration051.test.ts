import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/051_flow_debug_sessions.sql"),
  "utf8",
);

describe("migration 051 isolated flow debugging", () => {
  it("stores expiring pinned sessions separately from production runs", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS flow_debug_sessions");
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS flow_debug_node_executions",
    );
    expect(sql).toContain("flow_version_id");
    expect(sql).toContain("draft_revision");
    expect(sql).toContain("snapshot_hash");
    expect(sql).toContain("source_run_id");
    expect(sql).toContain("expires_at");
    expect(sql).toContain("simulated_effects");
    expect(sql).not.toMatch(
      /flow_debug_node_executions[\s\S]{0,500}REFERENCES flow_node_executions/i,
    );
  });

  it("uses service-only optimistic CAS RPCs", () => {
    for (const fn of [
      "create_flow_debug_session",
      "edit_flow_debug_session_variables",
      "commit_flow_debug_node_execution",
      "close_flow_debug_session",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `FUNCTION\\s+${fn}[\\s\\S]+?SECURITY DEFINER[\\s\\S]+?SET search_path = public`,
          "i",
        ),
      );
      expect(sql).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION ${fn}[\\s\\S]+?FROM PUBLIC`, "i"),
      );
      expect(sql).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION ${fn}[\\s\\S]+?TO service_role`, "i"),
      );
    }
    expect(sql).toContain("p_expected_revision");
    expect(sql).toContain("debug_revision_conflict");
    expect(sql).toContain("FOR UPDATE");
  });

  it("keeps raw debug storage service-only and tenant scoped", () => {
    for (const table of [
      "flow_debug_sessions",
      "flow_debug_node_executions",
    ]) {
      expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`REVOKE ALL ON TABLE ${table} FROM authenticated`);
      expect(sql).toContain(`GRANT ALL ON TABLE ${table} TO service_role`);
    }
    expect(sql).toContain("is_account_member");
  });

  it("bounds cloned data, active sessions and expiry cleanup", () => {
    expect(sql).toMatch(
      /source_node_outputs JSONB[\s\S]*jsonb_typeof\(source_node_outputs\) = 'object'[\s\S]*octet_length\(source_node_outputs::text\)/i,
    );
    expect(sql).toContain("debug_session_quota");
    expect(sql).toContain("debug_session_rate_limited");
    expect(sql).toContain("debug_edit_rate_limited");
    expect(sql).toContain("flow_debug_executions_variables_size");
    expect(sql).toMatch(/r\.flow_version_id\s*=\s*p_flow_version_id/i);
    expect(sql).toMatch(
      /FUNCTION\s+purge_expired_flow_debug_sessions[\s\S]+?p_limit INTEGER[\s\S]+?SECURITY DEFINER/i,
    );
  });
});
