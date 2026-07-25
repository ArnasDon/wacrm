import { describe, expect, it } from "vitest";

import { automationToFlowGraph } from "./to-flow-graph";
import { getNodeDescriptor } from "@/lib/flows/registry";
import { reachableFromEntry } from "@/lib/flows/validate";

describe("automationToFlowGraph", () => {
  it("preserves every legacy step config under a registered canonical identity", () => {
    const steps = [
      { step_type: "send_message", step_config: { text: "Hello" } },
      {
        step_type: "send_buttons",
        step_config: {
          kind: "buttons",
          body: "Choose",
          buttons: [{ id: "yes", title: "Yes" }],
        },
      },
      {
        step_type: "send_list",
        step_config: {
          kind: "list",
          body: "Choose",
          button_label: "Options",
          sections: [{ rows: [{ id: "one", title: "One" }] }],
        },
      },
      {
        step_type: "send_template",
        step_config: { template_name: "welcome", language: "en_US" },
      },
      { step_type: "add_tag", step_config: { tag_id: "tag-a" } },
      { step_type: "remove_tag", step_config: { tag_id: "tag-b" } },
      {
        step_type: "assign_conversation",
        step_config: { mode: "round_robin" },
      },
      {
        step_type: "update_contact_field",
        step_config: { field: "company", value: "Acme" },
      },
      {
        step_type: "create_deal",
        step_config: {
          pipeline_id: "pipeline",
          stage_id: "stage",
          title: "Opportunity",
        },
      },
      {
        step_type: "move_deal_stage",
        step_config: { pipeline_id: "pipeline", stage_id: "won" },
      },
      { step_type: "wait", step_config: { amount: 1, unit: "hours" } },
      {
        step_type: "condition",
        step_config: { subject: "contact_field", operand: "company" },
      },
      {
        step_type: "send_webhook",
        step_config: { url: "https://example.com/hook" },
      },
      { step_type: "close_conversation", step_config: {} },
    ] as const;

    const graph = automationToFlowGraph({
      trigger_type: "new_message_received",
      trigger_config: {},
      steps: steps.map((step) => ({
        ...step,
        parent_index: null,
        branch: null,
      })),
    });

    const knownNodeKeys = new Set(graph.nodes.map(({ node_key }) => node_key));
    graph.nodes.forEach((node) => {
      const descriptor = getNodeDescriptor(node.node_type);
      expect(
        descriptor?.configSchema.safeParse(node.config).success,
      ).toBe(true);
      expect(descriptor?.validate(node, { knownNodeKeys })).toEqual([]);
    });
    steps.forEach((step, index) => {
      expect(graph.nodes[index + 1]).toEqual(
        expect.objectContaining({
          node_type: step.step_type,
          config: expect.objectContaining(step.step_config),
        }),
      );
    });
  });

  it("deterministically chains a linear automation behind a trigger node", () => {
    const input = {
      trigger_type: "keyword_match" as const,
      trigger_config: {
        keywords: ["hello"],
        match_type: "exact" as const,
      },
      steps: [
        {
          step_type: "send_message" as const,
          step_config: { text: "Welcome" },
          parent_index: null,
          branch: null,
        },
        {
          step_type: "add_tag" as const,
          step_config: { tag_id: "tag-1" },
          parent_index: null,
          branch: null,
        },
      ],
    };

    const first = automationToFlowGraph(input);
    const second = automationToFlowGraph(input);

    expect(first).toEqual(second);
    expect(first.entry_node_key).toBe("trigger_keyword_match");
    expect(first.nodes).toEqual([
      expect.objectContaining({
        node_key: "trigger_keyword_match",
        node_type: "trigger_keyword_match",
        config: expect.objectContaining({
          keywords: ["hello"],
          next_node_key: "step_0_send_message",
        }),
      }),
      expect.objectContaining({
        node_key: "step_0_send_message",
        node_type: "send_message",
        config: {
          text: "Welcome",
          next_node_key: "step_1_add_tag",
        },
      }),
      expect.objectContaining({
        node_key: "step_1_add_tag",
        node_type: "add_tag",
        config: {
          tag_id: "tag-1",
          next_node_key: "end",
        },
      }),
      expect.objectContaining({
        node_key: "end",
        node_type: "end",
        config: {},
      }),
    ]);
  });

  it("converts condition children into true/false graph branches that rejoin", () => {
    const graph = automationToFlowGraph({
      trigger_type: "new_message_received",
      trigger_config: {},
      steps: [
        {
          step_type: "condition",
          step_config: {
            subject: "message_content",
            value: "pricing",
          },
          parent_index: null,
          branch: null,
        },
        {
          step_type: "send_message",
          step_config: { text: "Pricing details" },
          parent_index: 0,
          branch: "yes",
        },
        {
          step_type: "send_webhook",
          step_config: { url: "https://example.com/not-pricing" },
          parent_index: 0,
          branch: "no",
        },
        {
          step_type: "close_conversation",
          step_config: {},
          parent_index: null,
          branch: null,
        },
      ],
    });

    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node_key: "step_0_condition",
          node_type: "condition",
          config: expect.objectContaining({
            subject: "message_content",
            value: "pricing",
            true_next: "step_1_send_message",
            false_next: "step_2_send_webhook",
          }),
        }),
        expect.objectContaining({
          node_key: "step_1_send_message",
          config: expect.objectContaining({
            next_node_key: "step_3_close_conversation",
          }),
        }),
        expect.objectContaining({
          node_key: "step_2_send_webhook",
          config: expect.objectContaining({
            next_node_key: "step_3_close_conversation",
          }),
        }),
        expect.objectContaining({
          node_key: "step_3_close_conversation",
          node_type: "close_conversation",
          config: { next_node_key: "end" },
        }),
      ]),
    );

    for (const node of graph.nodes) {
      expect(
        getNodeDescriptor(node.node_type)?.configSchema.safeParse(node.config)
          .success,
      ).toBe(true);
    }
    expect(
      reachableFromEntry(graph.entry_node_key, graph.nodes),
    ).toEqual(new Set(graph.nodes.map(({ node_key }) => node_key)));
  });
});
