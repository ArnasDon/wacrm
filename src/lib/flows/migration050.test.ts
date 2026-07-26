import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/050_flow_composite_nodes.sql"),
  "utf8",
);

describe("migration 050 composite flow state", () => {
  it("persists loop state and call frames pinned to versions", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS flow_loop_states");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS flow_call_frames");
    expect(sql).toMatch(
      /UNIQUE\s*\(flow_run_id,\s*flow_version_id,\s*node_key,\s*visit_id\)/i,
    );
    expect(sql).toContain("child_flow_version_id");
    expect(sql).toContain("parent_flow_version_id");
    expect(sql).toContain("error_policy");
    expect(sql).toContain("failure_reason");
    expect(sql).toContain("depth");
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*flow_run_id,\s*depth[\s\S]*WHERE state IN \('active', 'returning'\)/i,
    );
  });

  it("uses atomic service-only CAS RPCs", () => {
    for (const fn of [
      "begin_flow_loop_iteration",
      "advance_flow_loop_iteration",
      "push_flow_call_frame",
      "pop_flow_call_frame",
      "fail_flow_call_frame",
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
    expect(sql).toContain("p_expected_visit_id");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toMatch(
      /jsonb_typeof\(p_child_vars\) IS DISTINCT FROM 'object'/i,
    );
  });

  it("keeps tenant data read-only for account members", () => {
    for (const table of [
      "flow_loop_states",
      "flow_call_frames",
      "flow_ai_reply_credit_receipts",
    ]) {
      expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`GRANT SELECT ON TABLE ${table} TO authenticated`);
      expect(sql).toContain(`GRANT ALL ON TABLE ${table} TO service_role`);
    }
  });

  it("claims AI reply credit idempotently through the effect ledger", () => {
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS flow_ai_reply_credit_receipts",
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION claim_flow_ai_reply_credit[\s\S]*p_effect_id[\s\S]*p_operation_id[\s\S]*p_claim_token[\s\S]*FOR UPDATE[\s\S]*ai_reply_count = ai_reply_count \+ 1/i,
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION claim_flow_ai_reply_credit[\s\S]*FROM PUBLIC/i,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION claim_flow_ai_reply_credit[\s\S]*TO service_role/i,
    );
  });
});
