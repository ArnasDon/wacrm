import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/049_flow_runtime_primitives.sql",
  ),
  "utf8",
);

describe("migration 049 durable waits", () => {
  it("adds a waiting run state and blocks competing active or waiting runs", () => {
    expect(sql).toContain("'waiting'");
    expect(sql).toMatch(
      /WHERE\s+status\s+IN\s*\(\s*'active'\s*,\s*'waiting'\s*\)/i,
    );
  });

  it("uses service-role-only, search-path-safe atomic wait RPCs", () => {
    for (const name of [
      "schedule_flow_wait",
      "claim_due_flow_waits",
      "resume_flow_wait",
    ]) {
      expect(sql).toContain(`FUNCTION ${name}`);
      expect(sql).toMatch(
        new RegExp(
          `FUNCTION\\s+${name}[\\s\\S]+?SECURITY DEFINER[\\s\\S]+?SET search_path = public`,
          "i",
        ),
      );
      expect(sql).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION ${name}[\\s\\S]+?FROM PUBLIC`, "i"),
      );
      expect(sql).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION ${name}[\\s\\S]+?TO service_role`, "i"),
      );
    }
  });

  it("pins waits to immutable versions and uses idempotent claims", () => {
    expect(sql).toContain("flow_version_id");
    expect(sql).toContain("claim_token");
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("UNIQUE (flow_run_id)");
    expect(sql).toMatch(
      /IF\s+v_run\.status\s*=\s*'waiting'[\s\S]+?wait\.status\s+IN\s*\(\s*'pending'\s*,\s*'claimed'\s*\)[\s\S]+?IF FOUND THEN[\s\S]+?RETURN;/i,
    );
  });
});
