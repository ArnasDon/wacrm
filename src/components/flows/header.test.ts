import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/components/flows/header.tsx"),
  "utf8",
);

describe("flow publish label UI", () => {
  it("offers an accessible optional label and passes it to publish", () => {
    expect(source).toContain("Publish flow");
    expect(source).toContain('aria-label="Version label"');
    expect(source).toContain("publish(publishLabel)");
    expect(source).toContain("Optional");
  });
});
