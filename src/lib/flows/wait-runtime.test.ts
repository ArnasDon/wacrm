import { describe, expect, it, vi } from "vitest";

import { resumeDueFlowWaits } from "./wait-runtime";

function graph() {
  return {
    schema_version: 1,
    trigger: { type: "manual", config: {} },
    entry_node_key: "wait",
    fallback_policy: {
      on_unknown_reply: "reprompt",
      max_reprompts: 2,
      on_timeout_hours: 24,
      on_exhaust: "handoff",
    },
    nodes: [
      {
        node_key: "wait",
        node_type: "wait",
        config: { amount: 1, unit: "minutes", next_node_key: "end" },
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
}

describe("durable flow wait resume", () => {
  it("claims due waits and resumes using the immutable pinned version", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            id: "wait-1",
            flow_run_id: "run-1",
            flow_version_id: "version-7",
            node_key: "wait",
            next_node_key: "end",
            claim_token: "token-1",
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "run-1",
            flow_id: "flow-1",
            flow_version_id: "version-7",
            account_id: "account-1",
            user_id: "user-1",
            contact_id: "contact-1",
            conversation_id: "conversation-1",
            status: "active",
            current_node_key: "end",
            vars: {},
            reprompt_count: 0,
            started_at: "",
            last_advanced_at: "",
          },
        ],
        error: null,
      });
    const versionQuery = {
      select: vi.fn(() => versionQuery),
      eq: vi.fn(() => versionQuery),
      maybeSingle: vi.fn(async () => ({
        data: { id: "version-7", flow_id: "flow-1", graph: graph() },
        error: null,
      })),
    };
    const insert = vi.fn(async () => ({ error: null }));
    const updateQuery = {
      eq: vi.fn(async () => ({ error: null, data: [{ id: "ok" }] })),
    };
    const db = {
      rpc,
      from: vi.fn((table: string) => {
        if (table === "flow_versions") return versionQuery;
        return {
          insert,
          update: vi.fn(() => updateQuery),
        };
      }),
    };
    const advance = vi.fn(async () => ({ outcome: "completed" as const }));

    const result = await resumeDueFlowWaits(
      db as never,
      new Date("2026-07-26T00:00:00.000Z"),
      { advance },
    );

    expect(result).toEqual({ claimed: 1, resumed: 1, failed: 0 });
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "resume_flow_wait",
      expect.objectContaining({
        p_wait_id: "wait-1",
        p_claim_token: "token-1",
        p_flow_version_id: "version-7",
        p_next_node_key: "end",
      }),
    );
    expect(advance).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ flow_version_id: "version-7" }),
      "end",
      expect.any(Map),
      undefined,
    );
  });

  it("does not resume when the claimed edge differs from the pinned snapshot", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({
      data: [
        {
          id: "wait-1",
          flow_run_id: "run-1",
          flow_version_id: "version-7",
          node_key: "wait",
          next_node_key: "attacker-node",
          claim_token: "token-1",
        },
      ],
      error: null,
    });
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({
        data: { id: "version-7", flow_id: "flow-1", graph: graph() },
        error: null,
      })),
    };
    const db = {
      rpc,
      from: vi.fn(() => query),
    };

    const result = await resumeDueFlowWaits(db as never, new Date());

    expect(result).toEqual({ claimed: 1, resumed: 0, failed: 1 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
