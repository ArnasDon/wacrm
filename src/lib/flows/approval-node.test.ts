import { describe, expect, it } from "vitest";

import { getNodeDescriptor } from "./registry";
import { approvalConfigSchema } from "./registry/schemas";
import { runIsolatedDebugNode } from "./debug-runtime";

const validConfig = {
  title: "Review refund",
  message: "Confirm the refund before the flow continues.",
  assignee_user_id: "00000000-0000-4000-8000-000000000001",
  timeout_hours: 24,
  approved_next: "refund",
  rejected_next: "handoff",
};

describe("approval node contract", () => {
  it("registers an authorable suspending node with explicit decision handles", () => {
    const descriptor = getNodeDescriptor("approval");

    expect(descriptor).toMatchObject({
      id: "approval",
      runtimeKind: "suspend",
      runtimeHook: "approval",
      supportsFlowRuntime: true,
      builder: { visible: true },
    });
    expect(descriptor?.outputs.map(({ id }) => id)).toEqual([
      "approved",
      "rejected",
    ]);
    expect(descriptor?.outgoingEdges(validConfig)).toEqual([
      "refund",
      "handoff",
    ]);
  });

  it("strictly validates bounded copy, member id, timeout, and branches", () => {
    expect(approvalConfigSchema.safeParse(validConfig).success).toBe(true);
    expect(
      approvalConfigSchema.safeParse({
        ...validConfig,
        assignee_user_id: "not-a-user",
      }).success,
    ).toBe(false);
    expect(
      approvalConfigSchema.safeParse({
        ...validConfig,
        timeout_hours: 0,
      }).success,
    ).toBe(false);
    expect(
      approvalConfigSchema.safeParse({
        ...validConfig,
        message: "x".repeat(2_001),
      }).success,
    ).toBe(false);
    expect(
      approvalConfigSchema.safeParse({
        ...validConfig,
        secret: "must-not-be-accepted",
      }).success,
    ).toBe(false);
  });

  it("simulates both decision paths without requests or notifications", async () => {
    const result = await runIsolatedDebugNode({
      graph: {
        schema_version: 1,
        trigger: { type: "manual", config: {} },
        entry_node_key: "approval",
        fallback_policy: {
          on_unknown_reply: "ignore",
          max_reprompts: 0,
          on_timeout_hours: 24,
          on_exhaust: "end",
          execution: {},
        },
        variable_schema: [],
        nodes: [
          {
            node_key: "approval",
            node_type: "approval",
            config: validConfig,
            position_x: 0,
            position_y: 0,
          },
        ],
      },
      nodeKey: "approval",
      variables: {},
      savedOutputs: {},
      clonedOutputs: {},
      overrides: {},
    });

    expect(result.simulatedEffects).toEqual([]);
    expect(result.outputs).toMatchObject({
      preview: true,
      planned_transition: {
        kind: "approval",
        approved_next: "refund",
        rejected_next: "handoff",
        schedules_production: false,
      },
    });
  });
});
