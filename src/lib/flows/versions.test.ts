import { describe, expect, it } from "vitest";

import {
  buildFlowVersionGraph,
  getFlowEntryTrigger,
  matchesFlowVersionTrigger,
  parseFlowVersionGraph,
} from "./versions";
import type { FlowVariableDeclaration } from "./runtime-primitives";

const draft = {
  trigger_type: "keyword" as const,
  trigger_config: {
    keywords: ["support"],
    match_type: "contains" as const,
  },
  entry_node_id: "start",
  fallback_policy: {
    on_unknown_reply: "reprompt" as const,
    max_reprompts: 2,
    on_timeout_hours: 24,
    on_exhaust: "handoff" as const,
  },
  variable_schema: [
    {
      key: "customer_name",
      type: "string" as const,
      required: true,
      default: "Customer",
    },
    {
      key: "retry_count",
      type: "number" as const,
      required: false,
      default: 0,
    },
  ],
};

const nodes = [
  {
    node_key: "start",
    node_type: "start",
    config: { next_node_key: "end" },
    position_x: 10,
    position_y: 20,
  },
  {
    node_key: "end",
    node_type: "end",
    config: {},
    position_x: 30,
    position_y: 40,
  },
] as const;

describe("flow version graph", () => {
  it("publishes schema v2 with the trigger as the single entry node", () => {
    const graph = buildFlowVersionGraph(draft, nodes);

    expect(graph.schema_version).toBe(2);
    expect(graph.entry_node_key).toBe("trigger");
    expect(graph.nodes.filter((node) => node.node_type.startsWith("trigger_"))).toEqual([
      expect.objectContaining({
        node_key: "trigger",
        node_type: "trigger_keyword_match",
        config: expect.objectContaining({
          keywords: ["support"],
          next_node_key: "start",
        }),
      }),
    ]);
  });

  it("normalizes a v1 snapshot in memory without changing the input object", () => {
    const legacy = {
      schema_version: 1,
      trigger: { type: "manual", config: {} },
      entry_node_key: "start",
      fallback_policy: draft.fallback_policy,
      nodes,
    } as const;
    const before = JSON.parse(JSON.stringify(legacy));

    const normalized = parseFlowVersionGraph(legacy);

    expect(normalized.schema_version).toBe(2);
    expect(normalized.entry_node_key).toBe("trigger");
    expect(normalized.nodes[0]).toEqual(
      expect.objectContaining({
        node_key: "trigger",
        node_type: "trigger_manual",
        config: { next_node_key: "start" },
      }),
    );
    expect(legacy).toEqual(before);
  });

  it.each([
    {
      name: "more than one trigger",
      nodes: [
        {
          node_key: "trigger",
          node_type: "trigger_manual",
          config: { next_node_key: "start" },
          position_x: 0,
          position_y: 0,
        },
        {
          node_key: "trigger_2",
          node_type: "trigger_manual",
          config: { next_node_key: "start" },
          position_x: 0,
          position_y: 0,
        },
        ...nodes,
      ],
    },
    {
      name: "an inbound edge to the trigger",
      nodes: [
        {
          node_key: "trigger",
          node_type: "trigger_manual",
          config: { next_node_key: "start" },
          position_x: 0,
          position_y: 0,
        },
        {
          ...nodes[0],
          config: { next_node_key: "trigger" },
        },
        nodes[1],
      ],
    },
  ])("rejects schema v2 with $name", ({ nodes: invalidNodes }) => {
    expect(() =>
      parseFlowVersionGraph({
        schema_version: 2,
        entry_node_key: "trigger",
        fallback_policy: draft.fallback_policy,
        nodes: invalidNodes,
      }),
    ).toThrow(/trigger|inbound/i);
  });

  it("round-trips every runtime-authoritative draft field", () => {
    const graph = buildFlowVersionGraph(draft, nodes);

    expect(parseFlowVersionGraph(JSON.parse(JSON.stringify(graph)))).toEqual({
      schema_version: 2,
      entry_node_key: "trigger",
      fallback_policy: draft.fallback_policy,
      variable_schema: draft.variable_schema,
      nodes: [
        {
          node_key: "trigger",
          node_type: "trigger_keyword_match",
          config: {
            keywords: ["support"],
            match_type: "contains",
            next_node_key: "start",
          },
          position_x: -310,
          position_y: 20,
        },
        ...nodes,
      ],
    });
    expect(getFlowEntryTrigger(graph)).toEqual({
      node_key: "trigger",
      type: "keyword",
      config: {
        keywords: ["support"],
        match_type: "contains",
        next_node_key: "start",
      },
      next_node_key: "start",
    });
  });

  it("normalizes legacy snapshots without variable declarations to an empty schema", () => {
    const graph = buildFlowVersionGraph(draft, nodes);
    const legacyGraph = JSON.parse(
      JSON.stringify({ ...graph, variable_schema: undefined }),
    );

    expect(parseFlowVersionGraph(legacyGraph).variable_schema).toEqual([]);
  });

  it("preserves explicit variable sensitivity in immutable versions", () => {
    const graph = buildFlowVersionGraph(
      {
        ...draft,
        variable_schema: [
          {
            key: "api_result",
            type: "string",
            required: false,
            sensitive: true,
          },
        ],
      },
      nodes,
    );

    expect(parseFlowVersionGraph(graph).variable_schema).toEqual([
      {
        key: "api_result",
        type: "string",
        required: false,
        sensitive: true,
      },
    ]);
  });

  it.each([
    [null],
    [[{ key: "bad", type: "number", required: false, default: "not-a-number" }]],
    [[{ key: "not a valid key", type: "string", required: false }]],
    [[{ key: "bad", type: "unsupported", required: false }]],
    [
      [
        { key: "duplicate", type: "string", required: false },
        { key: "duplicate", type: "number", required: false },
      ],
    ],
  ])("rejects an invalid variable schema %#", (variable_schema) => {
    expect(() =>
      buildFlowVersionGraph(
        {
          ...draft,
          variable_schema:
            variable_schema as unknown as FlowVariableDeclaration[],
        },
        nodes,
      ),
    ).toThrow(/variable schema/i);
  });

  it.each([
    null,
    {},
    { schema_version: 2 },
    {
      schema_version: 1,
      trigger: { type: "keyword", config: { keywords: [] } },
      entry_node_key: "missing",
      fallback_policy: draft.fallback_policy,
      nodes,
    },
    {
      schema_version: 1,
      trigger: { type: "keyword", config: draft.trigger_config },
      entry_node_key: "start",
      fallback_policy: draft.fallback_policy,
      nodes: [...nodes, nodes[0]],
    },
    {
      schema_version: 1,
      trigger: { type: "keyword", config: draft.trigger_config },
      entry_node_key: "start",
      fallback_policy: draft.fallback_policy,
      nodes: [
        {
          node_key: "start",
          node_type: "wait",
          config: { amount: 1, unit: "minutes", next_node_key: "end" },
          position_x: 0,
          position_y: 0,
        },
      ],
    },
  ])("rejects a corrupt or non-runtime graph %#", (value) => {
    expect(() => parseFlowVersionGraph(value)).toThrow(
      /Invalid flow version graph/,
    );
  });

  it("matches triggers from the published snapshot, not an edited draft", () => {
    const v1 = buildFlowVersionGraph(draft, nodes);
    const editedDraft = {
      ...draft,
      trigger_config: { keywords: ["sales"] },
    };

    expect(
      matchesFlowVersionTrigger(v1, { kind: "text", text: "support" }, false),
    ).toBe(true);
    expect(
      matchesFlowVersionTrigger(v1, { kind: "text", text: "sales" }, false),
    ).toBe(false);
    expect(editedDraft.trigger_config).toEqual({ keywords: ["sales"] });
  });

  it("rejects invalid global node execution defaults at activation", () => {
    expect(() =>
      buildFlowVersionGraph(
        {
          ...draft,
          fallback_policy: {
            ...draft.fallback_policy,
            execution: {
              retry: {
                max_attempts: 99,
                interval_ms: 0,
                backoff: "fixed" as const,
              },
            },
          },
        },
        nodes,
      ),
    ).toThrow(/execution policy/i);
  });

  it("rejects a snapshot that uses default_value on a multi-exit node", () => {
    expect(() =>
      buildFlowVersionGraph(draft, [
        {
          node_key: "start",
          node_type: "start",
          config: { next_node_key: "menu" },
          position_x: 0,
          position_y: 0,
        },
        {
          node_key: "menu",
          node_type: "send_buttons",
          config: {
            text: "Choose",
            buttons: [
              { reply_id: "yes", title: "Yes", next_node_key: "end" },
              { reply_id: "no", title: "No", next_node_key: "end" },
            ],
            on_error: "default_value",
            default_value: {
              key: "delivery",
              type: "string",
              value: "skipped",
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
      ]),
    ).toThrow(/default value|deterministic|config/i);
  });

  it("new matching uses V2 while an in-flight V1 keeps V1 nodes", () => {
    const v1 = buildFlowVersionGraph(draft, nodes);
    const v2 = buildFlowVersionGraph(
      {
        ...draft,
        trigger_config: { keywords: ["sales"] },
      },
      [
        {
          node_key: "start",
          node_type: "start",
          config: { next_node_key: "v2_end" },
          position_x: 0,
          position_y: 0,
        },
        {
          node_key: "v2_end",
          node_type: "end",
          config: {},
          position_x: 0,
          position_y: 0,
        },
      ],
    );

    expect(
      matchesFlowVersionTrigger(v2, { kind: "text", text: "sales" }, false),
    ).toBe(true);
    expect(v1.nodes.map((node) => node.node_key)).toEqual([
      "trigger",
      "start",
      "end",
    ]);
    expect(getFlowEntryTrigger(v1).next_node_key).toBe("start");
    expect(v2.nodes.map((node) => node.node_key)).toEqual([
      "trigger",
      "start",
      "v2_end",
    ]);
    expect(getFlowEntryTrigger(v2).next_node_key).toBe("start");
  });
});
