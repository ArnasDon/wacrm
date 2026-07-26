import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(
    process.cwd(),
    "src/app/(dashboard)/approvals/[id]/page.tsx",
  ),
  "utf8",
);

describe("approval detail conflict recovery", () => {
  it("closes the stale dialog, refetches the detail, and replaces its revision on 409", () => {
    expect(source).toMatch(
      /response\.status\s*===\s*409[\s\S]+?setPendingDecision\(null\)[\s\S]+?fetchApprovalDetail[\s\S]+?setApproval\(/i,
    );
    expect(source).toMatch(
      /fetchApprovalDetail[\s\S]+?cache:\s*"no-store"/i,
    );
  });

  it("announces errors inside the active accessible tree", () => {
    const dialog = source.match(/<DialogContent>[\s\S]+?<\/DialogContent>/)?.[0];
    expect(dialog).toMatch(/role="alert"[\s\S]+?aria-live="assertive"/i);
    expect(source).toMatch(
      /setPendingDecision\(null\)[\s\S]+?<p role="alert"/i,
    );
  });
});
