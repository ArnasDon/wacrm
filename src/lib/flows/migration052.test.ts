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
  it("backfills legacy production payloads before adding idempotent checks", () => {
    const backfill = sql.indexOf("UPDATE flow_node_executions");
    const constraints = sql.indexOf("flow_node_executions_inputs_size");

    expect(backfill).toBeGreaterThan(-1);
    expect(constraints).toBeGreaterThan(backfill);
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS metadata JSONB");
    expect(sql).toContain("legacy_payload_exceeded_limit");
    for (const field of ["inputs", "outputs", "error", "metadata"]) {
      expect(sql).toMatch(
        new RegExp(
          `flow_node_executions_${field}_size[\\s\\S]+?octet_length\\([\\s\\S]*?${field}[\\s\\S]+?<=\\s*61440`,
          "i",
        ),
      );
    }
  });

  it("caps the aggregate production debug result before detail egress", () => {
    expect(sql).toMatch(
      /flow_node_executions_debug_result_size[\s\S]+?jsonb_build_object\([\s\S]+?'inputs'[\s\S]+?'outputs'[\s\S]+?'error'[\s\S]+?'metadata'[\s\S]+?<=\s*262144/i,
    );
  });

  it("backfills and tightens debug execution fields with shape-safe sentinels", () => {
    expect(sql).toContain("UPDATE flow_debug_node_executions");
    expect(sql).toContain("jsonb_build_array");
    for (const field of [
      "inputs",
      "outputs",
      "simulated_effects",
      "metadata",
      "error",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `flow_debug_executions_${field}_bounded[\\s\\S]+?octet_length\\([\\s\\S]*?${field}[\\s\\S]+?<=\\s*32768`,
          "i",
        ),
      );
    }
  });

  it("exposes source variables only through a service-only bounded result", () => {
    expect(sql).toMatch(
      /FUNCTION\s+read_flow_debug_source_variables[\s\S]+?p_max_bytes INTEGER[\s\S]+?RETURNS TABLE\(\s*result_json JSONB,\s*truncated BOOLEAN,\s*original_bytes INTEGER\s*\)[\s\S]+?SECURITY DEFINER/i,
    );
    expect(sql).toContain("source_variables_exceeded_limit");
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION read_flow_debug_source_variables[\s\S]+?FROM authenticated/i,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION read_flow_debug_source_variables[\s\S]+?TO service_role/i,
    );
  });
});
