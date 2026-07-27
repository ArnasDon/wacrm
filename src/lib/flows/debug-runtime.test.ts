import { describe, expect, it, vi } from "vitest";

import {
  editDebugVariables,
  buildDebugManifest,
  runIsolatedDebugNode,
  sanitizeDebugSession,
  sanitizeDebugValue,
} from "./debug-runtime";
import {
  parseFlowVersionGraph,
  type FlowVersionGraph,
} from "./versions";

const graph = parseFlowVersionGraph({
  schema_version: 1,
  trigger: { type: "manual", config: {} },
  entry_node_key: "source",
  fallback_policy: {
    on_unknown_reply: "ignore",
    max_reprompts: 0,
    on_timeout_hours: 24,
    on_exhaust: "end",
  },
  variable_schema: [
    { key: "name", type: "string", default: "Ada" },
    { key: "count", type: "number", default: 1 },
  ],
  nodes: [
    {
      node_key: "source",
      node_type: "variable_set",
      config: {
        assignments: [{ key: "name", type: "string", value: "upstream" }],
        next_node_key: "send",
      },
      position_x: 0,
      position_y: 0,
    },
    {
      node_key: "send",
      node_type: "send_message",
      config: {
        text: "Hello {{vars.name}}",
        next_node_key: "end",
        _data_inputs: {
          value: { source_node_key: "source", source_handle: "variables" },
        },
      },
      position_x: 0,
      position_y: 0,
    },
    {
      node_key: "end",
      node_type: "end",
      config: {},
      position_x: 0,
      position_y: 0,
    },
  ],
});

describe("isolated flow debugger", () => {
  it("simulates a send without invoking an upstream node or side-effect adapter", async () => {
    const invokeRemote = vi.fn();
    const invokeUpstream = vi.fn();

    const result = await runIsolatedDebugNode({
      graph,
      nodeKey: "send",
      variables: { name: "Grace" },
      savedOutputs: {},
      clonedOutputs: {},
      overrides: {},
      adapters: { invokeRemote, invokeUpstream },
    });

    expect(invokeRemote).not.toHaveBeenCalled();
    expect(invokeUpstream).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "completed",
      outputs: { preview: "Hello Grace" },
      simulatedEffects: [
        { kind: "whatsapp_text", payload: { text: "Hello Grace" } },
      ],
    });
  });

  it("resolves bound inputs with override, session output, cloned output precedence", async () => {
    const result = await runIsolatedDebugNode({
      graph: {
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.node_key === "send"
            ? {
                ...node,
                node_type: "variable_set",
                config: {
                  assignments: [
                    { key: "name", type: "string", value: "configured" },
                  ],
                  next_node_key: "end",
                  _data_inputs: {
                    value: {
                      source_node_key: "source",
                      source_handle: "variables",
                    },
                  },
                },
              }
            : node,
        ),
      },
      nodeKey: "send",
      variables: { name: "initial" },
      clonedOutputs: {
        source: { variables: "cloned" },
      },
      savedOutputs: {
        source: { variables: "session" },
      },
      overrides: { value: "override" },
    });

    expect(result.variables.name).toBe("override");
    expect(result.metadata.input_sources).toEqual({ value: "override" });
  });

  it("resolves registry data ports with config as the final fallback", async () => {
    const dataGraph = {
      ...graph,
      entry_node_key: "each",
      variable_schema: [
        ...graph.variable_schema,
        { key: "items", type: "json", default: ["one"] },
        { key: "done", type: "boolean", default: true },
      ],
      nodes: [
        {
          node_key: "each",
          node_type: "each",
          config: {
            array_variable: "items",
            item_variable: "item",
            index_variable: "index",
            max_iterations: 10,
            body_next: "end",
            done_next: "end",
          },
          position_x: 0,
          position_y: 0,
        },
        {
          node_key: "loop",
          node_type: "loop",
          config: {
            subject: "var",
            subject_key: "done",
            operator: "equals",
            value: true,
            max_iterations: 10,
            body_next: "end",
            done_next: "end",
          },
          position_x: 0,
          position_y: 0,
        },
        graph.nodes[2],
      ],
    } satisfies FlowVersionGraph;

    const eachResult = await runIsolatedDebugNode({
      graph: dataGraph,
      nodeKey: "each",
      variables: { items: ["one"], done: true },
      savedOutputs: {},
      clonedOutputs: {},
      overrides: {},
    });
    const loopResult = await runIsolatedDebugNode({
      graph: dataGraph,
      nodeKey: "loop",
      variables: { items: ["one"], done: true },
      savedOutputs: {},
      clonedOutputs: {},
      overrides: {},
    });

    expect(eachResult.inputs).toEqual({ items: ["one"] });
    expect(eachResult.metadata.input_sources).toEqual({ items: "config" });
    expect(loopResult.inputs).toEqual({ subject: true });
    expect(loopResult.metadata.input_sources).toEqual({ subject: "config" });
  });

  it("uses session outputs before cloned outputs and config fallbacks", async () => {
    const switchGraph = {
      ...graph,
      entry_node_key: "switch",
      nodes: [
        {
          node_key: "switch",
          node_type: "switch",
          config: {
            subject: "var",
            subject_key: "name",
            cases: [
              {
                id: "case_1",
                label: "Session",
                operator: "equals",
                value: "session",
                next: "end",
              },
            ],
            default_next: "end",
            _data_inputs: {
              subject: {
                source_node_key: "source",
                source_handle: "variables",
              },
            },
          },
          position_x: 0,
          position_y: 0,
        },
        graph.nodes[2],
      ],
    } satisfies FlowVersionGraph;

    const result = await runIsolatedDebugNode({
      graph: switchGraph,
      nodeKey: "switch",
      variables: { name: "configured" },
      savedOutputs: { source: { variables: "session" } },
      clonedOutputs: { source: { variables: "source" } },
      overrides: {},
    });

    expect(result.inputs).toEqual({ subject: "session" });
    expect(result.metadata.input_sources).toEqual({ subject: "session" });
  });

  it("rejects overrides for unknown registry input ports", async () => {
    await expect(
      runIsolatedDebugNode({
        graph,
        nodeKey: "send",
        variables: { name: "Ada" },
        savedOutputs: {},
        clonedOutputs: {},
        overrides: { typo_port: "unsafe" },
      }),
    ).rejects.toThrow("debug_override_invalid:unknown_port");
  });

  it("rejects non-JSON override values for a JSON registry port", async () => {
    const eachGraph = {
      ...graph,
      entry_node_key: "each",
      nodes: [
        {
          node_key: "each",
          node_type: "each",
          config: {
            array_variable: "items",
            item_variable: "item",
            max_iterations: 10,
            body_next: "end",
            done_next: "end",
          },
          position_x: 0,
          position_y: 0,
        },
        graph.nodes[2],
      ],
    } satisfies FlowVersionGraph;

    await expect(
      runIsolatedDebugNode({
        graph: eachGraph,
        nodeKey: "each",
        variables: { items: [] },
        savedOutputs: {},
        clonedOutputs: {},
        overrides: { items: { unsupported: BigInt(1) } },
      }),
    ).rejects.toThrow("debug_override_invalid:type");
  });

  it("accepts a valid bounded override for a JSON registry port", async () => {
    const eachGraph = {
      ...graph,
      entry_node_key: "each",
      nodes: [
        {
          node_key: "each",
          node_type: "each",
          config: {
            array_variable: "items",
            item_variable: "item",
            max_iterations: 10,
            body_next: "end",
            done_next: "end",
          },
          position_x: 0,
          position_y: 0,
        },
        graph.nodes[2],
      ],
    } satisfies FlowVersionGraph;

    const result = await runIsolatedDebugNode({
      graph: eachGraph,
      nodeKey: "each",
      variables: { items: [] },
      savedOutputs: {},
      clonedOutputs: {},
      overrides: { items: ["one"] },
    });

    expect(result.status).toBe("completed");
    expect(result.inputs).toEqual({ items: ["one"] });
  });

  it("returns a planned transition for durable control nodes", async () => {
    const waitGraph: FlowVersionGraph = {
      ...graph,
      nodes: [
        {
          node_key: "wait",
          node_type: "wait",
          config: { amount: 1, unit: "minutes", next_node_key: "end" },
          position_x: 0,
          position_y: 0,
        },
        graph.nodes[2],
      ],
      entry_node_key: "wait",
    };

    const result = await runIsolatedDebugNode({
      graph: waitGraph,
      nodeKey: "wait",
      variables: {},
      savedOutputs: {},
      clonedOutputs: {},
      overrides: {},
    });

    expect(result.outputs).toMatchObject({
      preview: true,
      planned_transition: { kind: "wait", next_node_key: "end" },
    });
  });

  it("simulates legacy template and webhook nodes by node identity without adapters", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const invokeRemote = vi.fn();
    const legacyGraph = {
      ...graph,
      entry_node_key: "template",
      nodes: [
        {
          node_key: "template",
          node_type: "send_template",
          config: {
            template_name: "order_ready",
            language: "en_US",
            variables: { name: "{{vars.name}}" },
            next_node_key: "webhook",
          },
          position_x: 0,
          position_y: 0,
        },
        {
          node_key: "webhook",
          node_type: "send_webhook",
          config: {
            url: "https://example.com/hook",
            headers: { Authorization: "Bearer secret" },
            body_template: '{"name":"{{vars.name}}"}',
            next_node_key: "end",
          },
          position_x: 0,
          position_y: 0,
        },
        graph.nodes[2],
      ],
    } satisfies FlowVersionGraph;

    const template = await runIsolatedDebugNode({
      graph: legacyGraph,
      nodeKey: "template",
      variables: { name: "Ada" },
      savedOutputs: {},
      clonedOutputs: {},
      overrides: {},
      adapters: { invokeRemote },
    });
    const webhook = await runIsolatedDebugNode({
      graph: legacyGraph,
      nodeKey: "webhook",
      variables: { name: "Ada" },
      savedOutputs: {},
      clonedOutputs: {},
      overrides: {},
      adapters: { invokeRemote },
    });

    expect(template.simulatedEffects[0]).toMatchObject({
      kind: "whatsapp_template",
      payload: { template_name: "order_ready" },
    });
    expect(webhook.simulatedEffects[0]).toMatchObject({
      kind: "http_request",
      payload: {
        url: "https://example.com/hook",
        headers: { Authorization: "[REDACTED]" },
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(invokeRemote).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("coerces editable variables but keeps contact and message values read-only", () => {
    expect(
      editDebugVariables(
        [
          { key: "count", type: "number" },
          { key: "contact", type: "contact" },
        ],
        { count: 1, contact: { id: "c1" } },
        { count: "2", contact: { id: "c2" } },
      ),
    ).toEqual({ count: 2, contact: { id: "c1" } });
  });

  it("rejects undeclared variable edits instead of silently ignoring them", () => {
    expect(() =>
      editDebugVariables(
        [{ key: "known", type: "string" }],
        { known: "value" },
        { unknown: "unsafe" },
      ),
    ).toThrow('unknown debug variable "unknown"');
  });

  it("builds a client-safe pinned manifest from registry metadata", () => {
    const manifest = buildDebugManifest(graph);
    expect(manifest.variable_schema).toEqual(graph.variable_schema);
    expect(
      manifest.nodes.find((node) => node.node_key === "send"),
    ).toMatchObject({
      node_key: "send",
      node_type: "send_message",
      label: "Send message",
      inputs: expect.any(Array),
      outputs: expect.any(Array),
    });
    expect(JSON.stringify(manifest)).not.toContain("Hello");
  });
});

describe("debug record sanitization", () => {
  it("redacts secret fields and bounds nested output", () => {
    const sanitized = sanitizeDebugValue({
      headers: { Authorization: "Bearer secret", "X-Api-Key": "abc" },
      password: "pw",
      ok: "visible",
    }) as Record<string, unknown>;

    expect(sanitized).toEqual({
      headers: { Authorization: "[REDACTED]", "X-Api-Key": "[REDACTED]" },
      password: "[REDACTED]",
      ok: "visible",
    });
    expect(JSON.stringify(sanitized).length).toBeLessThan(10_000);
  });

  it("removes query strings and fragments from URL values at any nesting level", () => {
    const sanitized = sanitizeDebugValue({
      callback:
        "https://api-user:api-password@example.com/hooks/receive?token=super-secret#step-2",
      nested: [
        {
          location:
            "http://internal.example.test/path?customer_email=ada%40example.com",
        },
      ],
      ordinary: "not a URL?keep=this#too",
    });

    expect(sanitized).toEqual({
      callback: "https://example.com/hooks/receive",
      nested: [{ location: "http://internal.example.test/path" }],
      ordinary: "not a URL?keep=this#too",
    });
    expect(JSON.stringify(sanitized)).not.toContain("super-secret");
    expect(JSON.stringify(sanitized)).not.toContain("ada%40example.com");
    expect(JSON.stringify(sanitized)).not.toContain("api-user");
    expect(JSON.stringify(sanitized)).not.toContain("api-password");
  });

  it("never exposes the pinned graph or internal output cache to the client", () => {
    expect(
      sanitizeDebugSession({
        id: "session-1",
        revision: 2,
        graph_snapshot: { nodes: [{ config: { api_key: "secret" } }] },
        node_outputs: { send: { token: "secret" } },
        source_node_outputs: { send: { token: "secret" } },
        snapshot_hash: "hash",
        variables: { visible: true },
      }),
    ).toEqual({
      id: "session-1",
      revision: 2,
      variables: { visible: true },
    });
  });

  it("preserves the result envelope when an effect exceeds 64 KiB", async () => {
    const httpGraph = {
      ...graph,
      entry_node_key: "request",
      nodes: [
        {
          node_key: "request",
          node_type: "http_request",
          config: {
            method: "POST",
            url: "https://example.com",
            body: "x".repeat(70_000),
            response_var: "response",
            next_node_key: "end",
          },
          position_x: 0,
          position_y: 0,
        },
        graph.nodes[2],
      ],
    } satisfies FlowVersionGraph;

    const result = await runIsolatedDebugNode({
      graph: httpGraph,
      nodeKey: "request",
      variables: { name: "Ada" },
      savedOutputs: {},
      clonedOutputs: {},
      overrides: {},
    });

    expect(result.status).toBe("completed");
    expect(result.variables).toEqual({ name: "Ada" });
    expect(result.simulatedEffects[0]?.kind).toBe("http_request");
    expect(
      String(result.simulatedEffects[0]?.payload.body).length,
    ).toBeLessThan(5_000);
  });

  it("fails closed when session variables exceed 64 KiB", async () => {
    await expect(
      runIsolatedDebugNode({
        graph,
        nodeKey: "send",
        variables: { huge: "x".repeat(70_000) },
        savedOutputs: {},
        clonedOutputs: {},
        overrides: {},
      }),
    ).rejects.toThrow("debug_variables_too_large");
  });

  it("preserves the required session envelope when variables and manifest are near their limits", () => {
    const variable_schema = Array.from({ length: 15 }, (_, index) => ({
      key: `field_${index}`,
      type: "string" as const,
      default: "",
    }));
    const variables = Object.fromEntries(
      variable_schema.map(({ key }) => [key, "x".repeat(4_096)]),
    );
    const boundedGraph = {
      ...graph,
      variable_schema,
      nodes: Array.from({ length: 100 }, (_, index) => ({
        node_key: `end_${index}`,
        node_type: "end" as const,
        config: {},
        position_x: index,
        position_y: 0,
      })),
    };

    const result = sanitizeDebugSession({
      id: "session-near-limit",
      revision: 7,
      status: "active",
      variables,
      graph_snapshot: boundedGraph,
    });

    expect(result).toMatchObject({
      id: "session-near-limit",
      revision: 7,
      status: "active",
      variables: expect.any(Object),
      manifest: {
        variable_schema: expect.any(Array),
        nodes: expect.any(Array),
      },
    });
    expect(result).not.toHaveProperty("truncated");
    expect((result.variables as Record<string, unknown>).field_0).toBe(
      "x".repeat(4_096),
    );
  });

  it("fails instead of replacing required session variables with a truncation envelope", () => {
    expect(() =>
      sanitizeDebugSession({
        id: "session-too-large",
        revision: 1,
        status: "active",
        variables: Object.fromEntries(
          Array.from({ length: 20 }, (_, index) => [
            `field_${index}`,
            "x".repeat(4_096),
          ]),
        ),
        graph_snapshot: graph,
      }),
    ).toThrow("debug_response_too_large");
  });

  it("omits defaults whose declared variable key is sensitive", () => {
    const source = {
      ...graph,
      variable_schema: [
        { key: "display_name", type: "string" as const, default: "Ada" },
        {
          key: "api_token",
          type: "string" as const,
          default: "production-token",
        },
        {
          key: "webhook_secret",
          type: "string" as const,
          default: "production-secret",
        },
      ],
    };

    const manifest = buildDebugManifest(source);

    expect(manifest.variable_schema).toEqual([
      { key: "display_name", type: "string", default: "Ada" },
      { key: "api_token", type: "string" },
      { key: "webhook_secret", type: "string" },
    ]);
    expect(JSON.stringify(manifest)).not.toContain("production-token");
    expect(JSON.stringify(manifest)).not.toContain("production-secret");
    expect(source.variable_schema[1]).toHaveProperty(
      "default",
      "production-token",
    );
  });
});
