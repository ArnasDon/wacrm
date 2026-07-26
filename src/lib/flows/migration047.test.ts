import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/047_flow_versions.sql"),
  "utf8",
);

describe("migration 047 flow versions", () => {
  it("adds immutable versions, published pointers, and run pinning", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS flow_versions/i);
    expect(sql).toMatch(/UNIQUE\s*\(\s*flow_id\s*,\s*version\s*\)/i);
    expect(sql).toMatch(/published_version_id/i);
    expect(sql).toMatch(
      /ALTER TABLE flow_runs[\s\S]*ADD COLUMN IF NOT EXISTS flow_version_id/i,
    );
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION publish_flow_version/i);
    expect(sql).toMatch(/FOR UPDATE/i);
    expect(sql).toMatch(
      /FOREIGN KEY \(id, published_version_id\)[\s\S]*REFERENCES flow_versions\(flow_id, id\)/i,
    );
    expect(sql).toMatch(
      /FOREIGN KEY \(flow_id, flow_version_id\)[\s\S]*REFERENCES flow_versions\(flow_id, id\)/i,
    );
  });

  it("backfills active flows and pins existing runs where possible", () => {
    expect(sql).toMatch(/WHERE f\.status = 'active'/i);
    expect(sql).toMatch(/UPDATE flows[\s\S]*published_version_id/i);
    expect(sql).toMatch(/UPDATE flow_runs[\s\S]*flow_version_id/i);
  });

  it("keeps mutation RPCs service-role only", () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION publish_flow_version[\s\S]*FROM PUBLIC/i,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION publish_flow_version[\s\S]*TO service_role/i,
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION restore_flow_version[\s\S]*FROM PUBLIC/i,
    );
  });

  it("limits version history reads to the flow creator", () => {
    expect(sql).toMatch(
      /CREATE POLICY flow_versions_select[\s\S]*f\.user_id = auth\.uid\(\)/i,
    );
  });
});
