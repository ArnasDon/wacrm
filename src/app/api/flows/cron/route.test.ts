import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/app/api/flows/cron/route.ts"),
  "utf8",
);

describe("flow timeout version pinning", () => {
  it("reads timeout policy from each run's pinned snapshot", () => {
    expect(source).toContain("flow_versions");
    expect(source).toContain("flow_version_id");
    expect(source).toContain("parseFlowVersionGraph");
    expect(source).not.toContain("flows ( fallback_policy )");
  });

  it("resumes durable waits before sweeping abandoned input runs", () => {
    expect(source).toContain("resumeDueFlowWaits");
    expect(source).toContain("resumed");
  });
});
