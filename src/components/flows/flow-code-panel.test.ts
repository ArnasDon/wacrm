import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/components/flows/flow-code-panel.tsx"),
  "utf8",
);

describe("flow code panel replacement preview", () => {
  it("previews edits against the flow being replaced", () => {
    expect(source).toContain(
      "fetch(`/api/flows/${flow.id}/import/preview`",
    );
    expect(source).not.toContain('fetch("/api/flows/import/preview"');
  });

  it("lets users replace or clear stale invalid resource bindings", () => {
    expect(source).toContain(
      '["RESOURCE_AMBIGUOUS", "RESOURCE_BINDING_INVALID"].includes(',
    );
    expect(source).toContain("delete next[ref]");
    expect(source).toContain("[ref]: selectedResourceId");
  });
});
