import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = [
  "src/components/flows/forms/node-config-form.tsx",
  "src/components/flows/flow-builder.tsx",
  "src/lib/flows/nodes/collect-input.ts",
].map((path) => readFileSync(join(process.cwd(), path), "utf8")).join("\n");

describe("runtime primitive node forms", () => {
  it("renders dedicated switch and variable assignment editors", () => {
    expect(source).toContain('case "switch"');
    expect(source).toContain("<SwitchForm");
    expect(source).toContain('case "variable_set"');
    expect(source).toContain("<VariableSetForm");
  });

  it("lets authors configure collect_input validation and regex", () => {
    expect(source).toContain("validation");
    expect(source).toContain("Regex pattern");
  });

  it("lets authors declare typed flow variables", () => {
    expect(source).toContain("<VariableSchemaPanel");
    expect(source).toContain("variable_schema");
  });
});
