import { describe, expect, it } from "vitest";

import {
  buildFlowVersionGraph,
  matchesFlowVersionTrigger,
  parseFlowVersionGraph,
} from "./versions";

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
  it("round-trips every runtime-authoritative draft field", () => {
    const graph = buildFlowVersionGraph(draft, nodes);

    expect(parseFlowVersionGraph(JSON.parse(JSON.stringify(graph)))).toEqual({
      schema_version: 1,
      trigger: {
        type: "keyword",
        config: {
          keywords: ["support"],
          match_type: "contains",
        },
      },
      entry_node_key: "start",
      fallback_policy: draft.fallback_policy,
      nodes,
    });
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
    expect(v1.nodes.map((node) => node.node_key)).toEqual(["start", "end"]);
    expect(v2.nodes.map((node) => node.node_key)).toEqual([
      "start",
      "v2_end",
    ]);
  });
});
