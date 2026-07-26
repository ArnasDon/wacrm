import { describe, expect, it } from "vitest";

import {
  canonicalNodeType,
  getNodeDescriptor,
  isRegisteredNodeType,
} from "./registry";
import {
  collectInputConfigSchema,
  httpRequestConfigSchema,
  switchConfigSchema,
  variableSetConfigSchema,
  waitConfigSchema,
} from "./registry/schemas";

describe("flow runtime primitive descriptors", () => {
  it.each(["wait", "http_request", "switch", "variable_set"])(
    "registers %s as an executable builder node",
    (id) => {
      const descriptor = getNodeDescriptor(id);
      expect(descriptor?.supportsFlowRuntime).toBe(true);
      expect(descriptor?.builder.visible).toBe(true);
      expect(descriptor?.runtimeHook).toBe(id);
    },
  );

  it("keeps http_fetch snapshots compatible with http_request", () => {
    expect(getNodeDescriptor("http_fetch")).toBe(
      getNodeDescriptor("http_request"),
    );
    expect(isRegisteredNodeType("http_fetch")).toBe(true);
    expect(canonicalNodeType("http_fetch")).toBe("http_request");
  });
});

describe("runtime primitive schemas", () => {
  it("bounds durable waits", () => {
    expect(
      waitConfigSchema.safeParse({
        amount: 1,
        unit: "minutes",
        next_node_key: "end",
      }).success,
    ).toBe(true);
    expect(
      waitConfigSchema.safeParse({
        amount: 366,
        unit: "days",
        next_node_key: "end",
      }).success,
    ).toBe(false);
  });

  it("validates HTTP authoring and output variable", () => {
    expect(
      httpRequestConfigSchema.safeParse({
        method: "POST",
        url: "https://api.example.com/v1",
        headers: { Authorization: "Bearer {{vars.token}}" },
        body: '{"id":"{{vars.id}}"}',
        response_var: "response",
        next_node_key: "end",
      }).success,
    ).toBe(true);
    expect(
      httpRequestConfigSchema.safeParse({
        method: "GET",
        url: "http://127.0.0.1/",
        response_var: "response",
        next_node_key: "end",
      }).success,
    ).toBe(false);
  });

  it("requires unique switch case ids and a default edge", () => {
    const base = {
      subject: "var",
      subject_key: "tier",
      cases: [
        {
          id: "gold",
          label: "Gold",
          operator: "equals",
          value: "gold",
          next: "vip",
        },
      ],
      default_next: "standard",
    };
    expect(switchConfigSchema.safeParse(base).success).toBe(true);
    expect(
      switchConfigSchema.safeParse({
        ...base,
        cases: [...base.cases, { ...base.cases[0], next: "other" }],
      }).success,
    ).toBe(false);
  });

  it("validates typed variable assignments", () => {
    expect(
      variableSetConfigSchema.safeParse({
        assignments: [
          { key: "count", type: "number", value: "42" },
          { key: "enabled", type: "boolean", value: true },
        ],
        next_node_key: "end",
      }).success,
    ).toBe(true);
    expect(
      variableSetConfigSchema.safeParse({
        assignments: [{ key: "1bad", type: "string", value: "x" }],
        next_node_key: "end",
      }).success,
    ).toBe(false);
  });

  it("rejects unsafe regex at authoring time", () => {
    expect(
      collectInputConfigSchema.safeParse({
        prompt_text: "Code?",
        var_key: "code",
        validation: "regex",
        regex: "^[A-Z]+-\\d+$",
        next_node_key: "end",
      }).success,
    ).toBe(true);
    expect(
      collectInputConfigSchema.safeParse({
        prompt_text: "Code?",
        var_key: "code",
        validation: "regex",
        regex: "(a+)+$",
        next_node_key: "end",
      }).success,
    ).toBe(false);
  });
});
