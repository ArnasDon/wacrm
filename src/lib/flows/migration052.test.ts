import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/052_bound_flow_execution_payloads.sql",
  ),
  "utf8",
);

describe("migration 052 bounded flow execution payloads", () => {
  it("adds idempotent NOT VALID checks without deployment-time table rewrites", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS metadata JSONB");
    expect(sql).not.toMatch(/\bUPDATE\s+flow_(?:debug_)?node_executions\b/i);
    expect(sql).toContain("NOT VALID");
    expect(sql).toContain("Validate during a maintenance window");

    for (const constraint of [
      "flow_node_executions_inputs_size",
      "flow_node_executions_outputs_size",
      "flow_node_executions_error_size",
      "flow_node_executions_metadata_size",
      "flow_node_executions_debug_result_size",
      "flow_debug_executions_inputs_bounded",
      "flow_debug_executions_outputs_bounded",
      "flow_debug_executions_simulated_effects_bounded",
      "flow_debug_executions_metadata_bounded",
      "flow_debug_executions_error_bounded",
      "flow_debug_executions_result_json_bounded",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `ADD\\s+CONSTRAINT\\s+${constraint}[\\s\\S]+?NOT\\s+VALID`,
          "i",
        ),
      );
    }
  });

  it("reads an owner-bound source snapshot with latest-per-node and pre-egress sentinels", () => {
    expect(sql).toMatch(
      /FUNCTION\s+read_flow_debug_source_snapshot[\s\S]+?p_created_by UUID[\s\S]+?SECURITY DEFINER/i,
    );
    expect(sql).toContain("DISTINCT ON (e.node_key)");
    expect(sql).toContain("ORDER BY e.node_key, e.started_at DESC, e.id DESC");
    expect(sql).toContain("legacy_payload_exceeded_limit");
    expect(sql).toContain("source_clone_budget_exceeded");
    expect(sql).toMatch(/f\.user_id\s*=\s*p_created_by/i);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION read_flow_debug_source_snapshot[\s\S]+?FROM authenticated/i,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION read_flow_debug_source_snapshot[\s\S]+?TO service_role/i,
    );
  });

  it("reads one debug execution through a service-only owner/session/flow-bound RPC", () => {
    expect(sql).toMatch(
      /FUNCTION\s+read_flow_debug_execution_detail[\s\S]+?p_flow_id UUID[\s\S]+?p_session_id UUID[\s\S]+?p_execution_id UUID[\s\S]+?p_created_by UUID[\s\S]+?SECURITY DEFINER/i,
    );
    expect(sql).toMatch(/s\.created_by\s*=\s*p_created_by/i);
    expect(sql).toMatch(/s\.flow_id\s*=\s*p_flow_id/i);
    expect(sql).toMatch(/e\.session_id\s*=\s*p_session_id/i);
    expect(sql).toContain("legacy_payload_exceeded_limit");
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION read_flow_debug_execution_detail[\s\S]+?FROM authenticated/i,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION read_flow_debug_execution_detail[\s\S]+?TO service_role/i,
    );
  });

  it("hardens security-definer lookup paths and keeps RPCs service-only", () => {
    const definitions =
      sql.match(
        /CREATE OR REPLACE FUNCTION read_flow_debug_(?:source_snapshot|execution_detail)[\s\S]+?\$\$;/gi,
      ) ?? [];
    expect(definitions).toHaveLength(2);
    for (const definition of definitions) {
      expect(definition).toContain(
        "SET search_path = pg_catalog, public, pg_temp",
      );
    }
  });
});
