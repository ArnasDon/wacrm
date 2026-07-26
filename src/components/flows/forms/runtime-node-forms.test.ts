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

  it("provides an HTTP header editor and all assignable variable types", () => {
    expect(source).toContain("<HttpRequestForm");
    expect(source).toContain('aria-label="Header name"');
    expect(source).toContain('"contact"');
    expect(source).toContain('"message"');
  });

  it("renders bounded composite and AI reply editors", () => {
    for (const component of ["EachForm", "LoopForm", "SubFlowForm", "AiReplyForm"]) {
      expect(source).toContain(`<${component}`);
    }
    expect(source).toContain("max_iterations");
    expect(source).toContain("output_mapping");
    expect(source).toContain("input_variables");
    expect(source).toContain("max_tokens");
  });
});
