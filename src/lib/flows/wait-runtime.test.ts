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
            status: "resuming",
            current_node_key: "wait",
            vars: {},
            reprompt_count: 0,
            started_at: "",
            last_advanced_at: "",
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: true,
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
      "prepare_flow_wait_resume",
      expect.objectContaining({
        p_wait_id: "wait-1",
        p_claim_token: "token-1",
        p_flow_version_id: "version-7",
      }),
    );
    expect(advance).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ flow_version_id: "version-7" }),
      "end",
      expect.any(Map),
      undefined,
    );
    expect(rpc).toHaveBeenNthCalledWith(
      3,
      "ack_flow_wait_resume",
      expect.objectContaining({
        p_wait_id: "wait-1",
        p_claim_token: "token-1",
        p_flow_version_id: "version-7",
        p_node_key: "wait",
      }),
    );
  });

  it("leaves the claimed continuation reclaimable when advance crashes", async () => {
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
            status: "resuming",
            current_node_key: "wait",
            vars: {},
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
    const db = { rpc, from: vi.fn(() => versionQuery) };
    const advance = vi.fn(async () => {
      throw new Error("worker crashed");
    });

    const result = await resumeDueFlowWaits(db as never, new Date(), {
      advance,
    });

    expect(result).toEqual({ claimed: 1, resumed: 0, failed: 1 });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(
      rpc.mock.calls.some(([name]) => name === "ack_flow_wait_resume"),
    ).toBe(false);
  });

  it("acks without replaying when a prior worker advanced before crashing", async () => {
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
            claim_token: "token-2",
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
            status: "completed",
            current_node_key: "end",
            vars: {},
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: true, error: null });
    const versionQuery = {
      select: vi.fn(() => versionQuery),
      eq: vi.fn(() => versionQuery),
      maybeSingle: vi.fn(async () => ({
        data: { id: "version-7", flow_id: "flow-1", graph: graph() },
        error: null,
      })),
    };
    const db = { rpc, from: vi.fn(() => versionQuery) };
    const advance = vi.fn();

    const result = await resumeDueFlowWaits(db as never, new Date(), {
      advance,
    });

    expect(result).toEqual({ claimed: 1, resumed: 1, failed: 0 });
    expect(advance).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenNthCalledWith(
      3,
      "ack_flow_wait_resume",
      expect.any(Object),
    );
  });

  it("does not ack a claim when the run remains in a mismatched state", async () => {
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
      .mockResolvedValueOnce({ data: [], error: null });
    const versionQuery = {
      select: vi.fn(() => versionQuery),
      eq: vi.fn(() => versionQuery),
      maybeSingle: vi.fn(async () => ({
        data: { id: "version-7", flow_id: "flow-1", graph: graph() },
        error: null,
      })),
    };
    const db = { rpc, from: vi.fn(() => versionQuery) };
    const advance = vi.fn();

    const result = await resumeDueFlowWaits(db as never, new Date(), {
      advance,
    });

    expect(result).toEqual({ claimed: 1, resumed: 0, failed: 1 });
    expect(advance).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(2);
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
