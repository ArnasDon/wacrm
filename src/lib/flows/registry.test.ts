import { describe, expect, it } from "vitest";

import type {
  AutomationStepType,
  AutomationTriggerType,
} from "@/types";
import { NODE_META } from "@/components/flows/shared";
import { getRuntimeDescriptor } from "./engine";
import {
  FLOW_NODE_DESCRIPTORS,
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
      expect(descriptor.configSchema).toBeDefined();
      expect(typeof descriptor.validate).toBe("function");
      expect(descriptor.runtimeHook).not.toBe("");
      expect(descriptor.form).toBeDefined();
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
});
