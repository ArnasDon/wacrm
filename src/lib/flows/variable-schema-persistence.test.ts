import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/049_flow_runtime_primitives.sql"),
  "utf8",
);

describe("migration 049 variable schema persistence", () => {
  it("adds a safe, array-shaped variable schema to flow drafts", () => {
    expect(sql).toMatch(
      /ALTER TABLE flows[\s\S]*ADD COLUMN IF NOT EXISTS variable_schema JSONB NOT NULL DEFAULT '\[\]'::jsonb/i,
    );
    expect(sql).toMatch(
      /CHECK \(jsonb_typeof\(variable_schema\) = 'array'\)/i,
    );
  });

  it("round-trips variable_schema through atomic draft save and restore", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION save_flow_draft[\s\S]*variable_schema[\s\S]*p_patch->'variable_schema'/i,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION restore_flow_version[\s\S]*variable_schema[\s\S]*v_graph->'variable_schema'/i,
    );
  });

  it("keeps mutation RPCs service-role only with a fixed search path", () => {
    expect(sql).toMatch(
      /save_flow_draft[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = public/i,
    );
    expect(sql).toMatch(
      /restore_flow_version[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = public/i,
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION save_flow_draft[\s\S]*FROM PUBLIC/i,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION restore_flow_version[\s\S]*TO service_role/i,
    );
  });
});
