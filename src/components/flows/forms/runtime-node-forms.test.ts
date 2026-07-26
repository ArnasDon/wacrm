import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = [
  "src/components/flows/forms/node-config-form.tsx",
  "src/components/flows/flow-builder.tsx",
  "src/lib/flows/nodes/collect-input.ts",
].map((path) => readFileSync(join(process.cwd(), path), "utf8")).join("\n");
const messages = Object.fromEntries(
  ["en", "ko"].map((locale) => [
    locale,
    JSON.parse(
      readFileSync(join(process.cwd(), `messages/${locale}.json`), "utf8"),
    ) as {
      Flows: {
        builder: {
          form: Record<string, string>;
          nodes: Record<string, { label: string; blurb: string }>;
        };
      };
    },
  ]),
);

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

  it("stores numeric loop comparisons as numbers and localizes composite forms", () => {
    expect(source).toContain('type={numericComparison ? "number" : "text"}');
    expect(source).toContain("event.target.valueAsNumber");
    for (const key of [
      "eachArrayVariable",
      "loopExitSubject",
      "subFlowPublished",
      "aiSystemPrompt",
    ]) {
      expect(source).toContain(`t("${key}")`);
    }
    for (const key of [
      "eachArrayVariable",
      "loopExitSubject",
      "subFlowPublished",
      "aiSystemPrompt",
    ]) {
      expect(messages.en.Flows.builder.form[key]).toBeTruthy();
      expect(messages.ko.Flows.builder.form[key]).toBeTruthy();
      expect(messages.ko.Flows.builder.form[key]).not.toBe(
        messages.en.Flows.builder.form[key],
      );
    }
    for (const node of [
      "wait",
      "http_request",
      "switch",
      "variable_set",
      "each",
      "loop",
      "sub_flow",
      "ai_reply",
    ]) {
      expect(messages.ko.Flows.builder.nodes[node].label).not.toBe(
        messages.en.Flows.builder.nodes[node].label,
      );
    }
  });
});
