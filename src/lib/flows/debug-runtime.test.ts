import { describe, expect, it, vi } from "vitest";

import {
  editDebugVariables,
  runIsolatedDebugNode,
  sanitizeDebugSession,
  sanitizeDebugValue,
} from "./debug-runtime";
import type { FlowVersionGraph } from "./versions";

const graph: FlowVersionGraph = {
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
};

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
});
