import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/048_flow_node_executions.sql"),
  "utf8",
);

describe("migration 048 flow node executions", () => {
  it("creates an idempotent per-attempt execution table with version provenance", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS flow_node_executions/i);
    expect(sql).toMatch(
      /flow_run_id UUID NOT NULL REFERENCES flow_runs\(id\)/i,
    );
    expect(sql).toMatch(
      /flow_version_id UUID NOT NULL REFERENCES flow_versions\(id\)/i,
    );
    expect(sql).toMatch(/attempt INTEGER NOT NULL CHECK \(attempt > 0\)/i);
    expect(sql).toMatch(/status TEXT NOT NULL CHECK \(status IN \(/i);
    expect(sql).toMatch(/inputs JSONB NOT NULL/i);
    expect(sql).toMatch(/outputs JSONB/i);
    expect(sql).toMatch(/error JSONB/i);
    expect(sql).toMatch(/duration_ms INTEGER/i);
  });

  it("adds useful indexes and owner visibility through flow_runs", () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS[\s\S]*flow_run_id/i);
    expect(sql).toMatch(
      /ALTER TABLE flow_node_executions ENABLE ROW LEVEL SECURITY/i,
    );
    expect(sql).toMatch(
      /CREATE POLICY flow_node_executions_select[\s\S]*flow_runs[\s\S]*is_account_member/i,
    );
  });
});
