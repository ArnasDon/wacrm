import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  start: vi.fn(),
}));

vi.mock("./engine", async (importOriginal) => {
  const original = await importOriginal<typeof import("./engine")>();
  return {
    ...original,
    startFlowRunFromTrigger: h.start,
  };
});

import { drainPendingFlowTriggerInvocations } from "./trigger-invocation-worker";

const graph = {
  schema_version: 2,
  entry_node_key: "trigger",
  fallback_policy: {
    on_unknown_reply: "ignore",
    max_reprompts: 0,
    on_timeout_hours: 24,
    on_exhaust: "end",
  },
  variable_schema: [],
  nodes: [
    {
      node_key: "trigger",
      node_type: "trigger_webhook",
      config: { next_node_key: "end", response_mode: "async" },
      position_x: -100,
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

describe("flow trigger invocation worker", () => {
  it("claims pending invocations, starts pinned runs, and completes them", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "claim_flow_trigger_invocations") {
        return {
          data: [
            {
              id: "invocation-1",
              account_id: "account-1",
              flow_id: "flow-1",
              flow_version_id: "version-1",
              trigger_node_key: "trigger",
              source: "webhook",
              variables: {},
              payload: { contact_id: "contact-1", conversation_id: "conversation-1" },
              claim_token: "claim-1",
            },
          ],
          error: null,
        };
      }
      if (name === "complete_flow_trigger_invocation") {
        return { data: true, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    });
    const db = {
      rpc,
      from: (table: string) => {
        if (table === "flows") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: "flow-1",
                      account_id: "account-1",
                      user_id: "user-1",
                      status: "active",
                      published_version_id: "version-1",
                      trigger_type: "webhook",
                      trigger_config: {},
                      fallback_policy: graph.fallback_policy,
                      draft_revision: 1,
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "flow_versions") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: "version-1",
                      flow_id: "flow-1",
                      account_id: "account-1",
                      graph,
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
    h.start.mockResolvedValue({
      consumed: true,
      flow_run_id: "run-1",
      outcome: "started",
    });

    const stats = await drainPendingFlowTriggerInvocations(db as never);

    expect(stats).toEqual({ claimed: 1, started: 1, failed: 0 });
    expect(h.start).toHaveBeenCalledWith(
      expect.objectContaining({
        versionId: "version-1",
        triggerInvocationId: "invocation-1",
        contactId: "contact-1",
        conversationId: "conversation-1",
      }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "complete_flow_trigger_invocation",
      expect.objectContaining({
        p_invocation_id: "invocation-1",
        p_claim_token: "claim-1",
        p_status: "completed",
        p_flow_run_id: "run-1",
      }),
    );
  });
});
