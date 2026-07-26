import { describe, expect, it } from "vitest";

import type { AutomationStepType, AutomationTriggerType } from "@/types";
import { NODE_META } from "@/components/flows/shared";
import { getRuntimeDescriptor } from "./engine";
import {
  FLOW_NODE_DESCRIPTORS,
  getDeterministicSuccessEdgeTarget,
  getNodeDescriptor,
  listBuilderNodeDescriptors,
} from "./registry";

const AUTOMATION_STEP_TYPES = [
  "send_message",
  "send_buttons",
  "send_list",
  "send_template",
  "add_tag",
  "remove_tag",
  "assign_conversation",
  "update_contact_field",
  "create_deal",
  "move_deal_stage",
  "wait",
  "condition",
  "send_webhook",
  "close_conversation",
] as const satisfies readonly AutomationStepType[];

const AUTOMATION_TRIGGER_TYPES = [
  "new_message_received",
  "first_inbound_message",
  "keyword_match",
  "new_contact_created",
  "conversation_assigned",
  "tag_added",
  "time_based",
  "interactive_reply",
  "deal_stage_changed",
] as const satisfies readonly AutomationTriggerType[];

describe("canonical flow node registry", () => {
  it("has unique ids and a complete descriptor contract", () => {
    const ids = FLOW_NODE_DESCRIPTORS.map((descriptor) => descriptor.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const descriptor of FLOW_NODE_DESCRIPTORS) {
      expect(descriptor.label).not.toBe("");
      expect(descriptor.category).not.toBe("");
      expect(descriptor.icon).not.toBe("");
      expect(Array.isArray(descriptor.inputs)).toBe(true);
      expect(Array.isArray(descriptor.outputs)).toBe(true);
      for (const port of [...descriptor.inputs, ...descriptor.outputs]) {
        expect([
          "control",
          "string",
          "number",
          "boolean",
          "json",
          "contact",
          "message",
          "any",
        ]).toContain(port.type);
        expect(["one", "many"]).toContain(port.cardinality);
        expect(
          port.required === undefined || typeof port.required === "boolean",
        ).toBe(true);
      }
      expect(descriptor.configSchema).toBeDefined();
      expect(descriptor.flowConfigSchema).toBeDefined();
      expect(typeof descriptor.supportsFlowRuntime).toBe("boolean");
      expect(typeof descriptor.supportsDefaultValue).toBe("boolean");
      expect(typeof descriptor.validate).toBe("function");
      expect(descriptor.runtimeHook).not.toBe("");
      expect(descriptor.form).toBeDefined();
      expect(typeof descriptor.outgoingEdgeTargets).toBe("function");
    }
  });

  it("represents every legacy automation action and trigger losslessly", () => {
    for (const stepType of AUTOMATION_STEP_TYPES) {
      expect(getNodeDescriptor(stepType)).toBeDefined();
    }
    for (const triggerType of AUTOMATION_TRIGGER_TYPES) {
      expect(getNodeDescriptor(`trigger_${triggerType}`)).toBeDefined();
    }
  });

  it("validates config through the descriptor schema", () => {
    const sendMessage = getNodeDescriptor("send_message");
    expect(sendMessage).toBeDefined();
    expect(
      sendMessage!.configSchema.safeParse({
        text: "Hello",
        next_node_key: "end",
      }).success,
    ).toBe(true);
    expect(
      sendMessage!.configSchema.safeParse({
        text: "",
        next_node_key: "end",
      }).success,
    ).toBe(false);
  });

  it("requires numeric loop comparison values for numeric operators", () => {
    const loop = getNodeDescriptor("loop")!;
    const base = {
      subject: "var",
      subject_key: "count",
      operator: "greater_than",
      max_iterations: 10,
      body_next: "body",
      done_next: "done",
    };
    expect(loop.configSchema.safeParse({ ...base, value: 5 }).success).toBe(
      true,
    );
    expect(loop.configSchema.safeParse({ ...base, value: "5" }).success).toBe(
      false,
    );
  });

  it("keeps HTTP authoring validation client-safe and rejects local targets", () => {
    const http = getNodeDescriptor("http_request")!;
    const config = {
      method: "GET",
      headers: {},
      response_var: "response",
      next_node_key: "done",
    };
    expect(
      http.configSchema.safeParse({
        ...config,
        url: "https://api.example.com/v1",
      }).success,
    ).toBe(true);
    for (const url of [
      "http://localhost/admin",
      "http://127.0.0.1/admin",
      "http://[::1]/admin",
    ]) {
      expect(http.configSchema.safeParse({ ...config, url }).success).toBe(
        false,
      );
    }
  });

  it("drives engine lookup and UI metadata from the same descriptor", () => {
    const descriptor = getRuntimeDescriptor("send_message");
    expect(descriptor?.runtimeHook).toBe("send_message");
    expect(NODE_META.send_message.label).toBe(descriptor?.label);
    expect(NODE_META.send_message.iconId).toBe(descriptor?.icon);

    const visibleIds = listBuilderNodeDescriptors().map(({ id }) => id);
    expect(visibleIds).toContain("send_message");
    expect(visibleIds).not.toContain("send_webhook");
    expect(visibleIds).not.toContain("trigger_keyword_match");
  });

  it("marks only executable flow descriptors as flow-runtime capable", () => {
    expect(getNodeDescriptor("send_message")?.supportsFlowRuntime).toBe(true);
    expect(getNodeDescriptor("wait")?.supportsFlowRuntime).toBe(true);
    expect(getNodeDescriptor("send_webhook")?.supportsFlowRuntime).toBe(false);
    expect(
      getNodeDescriptor("trigger_keyword_match")?.supportsFlowRuntime,
    ).toBe(false);
    for (const type of ["each", "loop", "sub_flow", "ai_reply"]) {
      expect(getNodeDescriptor(type)?.supportsFlowRuntime).toBe(true);
      expect(listBuilderNodeDescriptors().map(({ id }) => id)).toContain(type);
    }
  });

  it("declares structured composite control ports", () => {
    expect(getNodeDescriptor("each")?.outputs.map(({ id }) => id)).toEqual([
      "body",
      "done",
    ]);
    expect(getNodeDescriptor("loop")?.inputs.map(({ id }) => id)).toEqual([
      "in",
      "continue",
    ]);
    expect(getNodeDescriptor("loop")?.outputs.map(({ id }) => id)).toEqual([
      "body",
      "done",
    ]);
    expect(getNodeDescriptor("sub_flow")?.outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "next", type: "control" }),
        expect.objectContaining({ id: "outputs", type: "json" }),
      ]),
    );
    expect(getNodeDescriptor("ai_reply")?.outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "reply", type: "string" }),
      ]),
    );
  });

  it("offers a default value only for a concrete config with one success edge", () => {
    expect(
      getDeterministicSuccessEdgeTarget("send_message", {
        text: "Hello",
        next_node_key: "end",
      }),
    ).toBe("end");
    expect(
      getDeterministicSuccessEdgeTarget("condition", {
        true_next: "yes",
        false_next: "no",
      }),
    ).toBeUndefined();
    expect(
      getDeterministicSuccessEdgeTarget("send_buttons", {
        buttons: [{ next_node_key: "yes" }, { next_node_key: "no" }],
      }),
    ).toBeUndefined();
    expect(
      getDeterministicSuccessEdgeTarget("send_list", {
        sections: [
          {
            rows: [{ next_node_key: "one" }, { next_node_key: "two" }],
          },
        ],
      }),
    ).toBeUndefined();
    expect(getDeterministicSuccessEdgeTarget("handoff", {})).toBeUndefined();
  });
});
