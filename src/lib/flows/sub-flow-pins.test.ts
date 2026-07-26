import { describe, expect, it } from "vitest";

import { pinSubFlowNodesFromCatalog } from "./sub-flow-pins";

const graph = (
  children: string[] = [],
  variable_schema: Array<{ key: string; type: "string" | "number" }> = [],
) => ({
  entry_node_key: "start",
  variable_schema,
  nodes: [
    { node_key: "start", node_type: "start", config: { next_node_key: "end" } },
    ...children.map((flow_id, index) => ({
      node_key: `child_${index}`,
      node_type: "sub_flow",
      config: { flow_id, next_node_key: "end" },
    })),
    { node_key: "end", node_type: "end", config: {} },
  ],
});

describe("sub-flow publication pins", () => {
  it("embeds the current published child version and entry key", () => {
    const nodes = pinSubFlowNodesFromCatalog(
      "parent",
      [
        {
          node_key: "call",
          node_type: "sub_flow",
          config: { flow_id: "child", next_node_key: "end" },
        },
      ],
      new Map([
        [
          "child",
          {
            versionId: "11111111-1111-4111-8111-111111111111",
            graph: graph(),
          },
        ],
      ]),
    );
    expect(nodes[0].config).toMatchObject({
      flow_id: "child",
      flow_version_id: "11111111-1111-4111-8111-111111111111",
      child_entry_node_key: "start",
    });
  });

  it("rejects unpublished, self and transitive recursive calls", () => {
    expect(() =>
      pinSubFlowNodesFromCatalog(
        "parent",
        [
          {
            node_key: "call",
            node_type: "sub_flow",
            config: { flow_id: "missing", next_node_key: "end" },
          },
        ],
        new Map(),
      ),
    ).toThrow(/published/i);
    expect(() =>
      pinSubFlowNodesFromCatalog(
        "parent",
        [
          {
            node_key: "call",
            node_type: "sub_flow",
            config: { flow_id: "parent", next_node_key: "end" },
          },
        ],
        new Map(),
      ),
    ).toThrow(/itself/i);
    expect(() =>
      pinSubFlowNodesFromCatalog(
        "parent",
        [
          {
            node_key: "call",
            node_type: "sub_flow",
            config: { flow_id: "child", next_node_key: "end" },
          },
        ],
        new Map([
          [
            "child",
            {
              versionId: "11111111-1111-4111-8111-111111111111",
              graph: graph(["parent"]),
            },
          ],
        ]),
      ),
    ).toThrow(/cycle/i);
  });

  it("rejects a transitive dependency that is not published in the catalog", () => {
    expect(() =>
      pinSubFlowNodesFromCatalog(
        "parent",
        [
          {
            node_key: "call",
            node_type: "sub_flow",
            config: { flow_id: "child", next_node_key: "end" },
          },
        ],
        new Map([
          [
            "child",
            {
              versionId: "11111111-1111-4111-8111-111111111111",
              graph: graph(["missing-grandchild"]),
            },
          ],
        ]),
      ),
    ).toThrow(/missing-grandchild.*published/i);
  });

  it("requires mapped parent and child variables to exist with matching types", () => {
    const child = {
      versionId: "11111111-1111-4111-8111-111111111111",
      graph: graph([], [{ key: "child_name", type: "string" }]),
    };
    expect(() =>
      pinSubFlowNodesFromCatalog(
        "parent",
        [
          {
            node_key: "call",
            node_type: "sub_flow",
            config: {
              flow_id: "child",
              input_mapping: [
                { parent_key: "customer_age", child_key: "child_name" },
              ],
              output_mapping: [],
              next_node_key: "end",
            },
          },
        ],
        new Map([["child", child]]),
        [{ key: "customer_age", type: "number" }],
      ),
    ).toThrow(/customer_age.*child_name.*type/i);

    expect(() =>
      pinSubFlowNodesFromCatalog(
        "parent",
        [
          {
            node_key: "call",
            node_type: "sub_flow",
            config: {
              flow_id: "child",
              input_mapping: [
                { parent_key: "missing", child_key: "child_name" },
              ],
              output_mapping: [],
              next_node_key: "end",
            },
          },
        ],
        new Map([["child", child]]),
        [{ key: "customer_name", type: "string" }],
      ),
    ).toThrow(/parent variable.*missing/i);
  });
});
