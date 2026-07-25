import { describe, expect, it } from "vitest";

import { flowToCanonicalGraph } from "./canonicalize";

describe("flowToCanonicalGraph", () => {
  it("turns the compatibility flow-level trigger into the graph entry node", () => {
    const graph = flowToCanonicalGraph(
      {
        trigger_type: "keyword",
        trigger_config: {
          keywords: ["support"],
          match_type: "contains",
        },
        entry_node_id: "start",
      },
      [
        {
          node_key: "start",
          node_type: "start",
          config: { next_node_key: "end" },
        },
        { node_key: "end", node_type: "end", config: {} },
      ],
    );

    expect(graph.entry_node_key).toBe("trigger_keyword_match");
    expect(graph.nodes[0]).toEqual({
      node_key: "trigger_keyword_match",
      node_type: "trigger_keyword_match",
      config: {
        keywords: ["support"],
        match_type: "contains",
        next_node_key: "start",
      },
      source: "flow",
      runtime_hook: "trigger_keyword_match",
    });
    expect(graph.nodes.slice(1)).toEqual([
      expect.objectContaining({ node_key: "start", node_type: "start" }),
      expect.objectContaining({ node_key: "end", node_type: "end" }),
    ]);
  });
});
