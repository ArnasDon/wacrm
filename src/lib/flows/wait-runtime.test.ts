import { describe, expect, it, vi } from "vitest";

import { resumeDueFlowWaits } from "./wait-runtime";

function graph(next: "end" | "switch" | "wait2" = "end") {
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
        config: { amount: 1, unit: "minutes", next_node_key: next },
        position_x: 0,
        position_y: 0,
      },
      ...(next === "switch"
        ? [
            {
              node_key: "switch",
              node_type: "switch",
              config: {
                subject: "var",
                subject_key: "kind",
                cases: [
                  {
                    id: "known",
                    label: "Known",
                    operator: "equals",
                    value: "x",
                    next: "end",
                  },
                ],
                default_next: "end",
              },
              position_x: 0,
              position_y: 0,
            },
          ]
        : next === "wait2"
          ? [
              {
                node_key: "wait2",
                node_type: "wait",
                config: {
                  amount: 1,
                  unit: "minutes",
                  next_node_key: "end",
                },
                position_x: 0,
                position_y: 0,
              },
            ]
          : []),
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

function durableHarness(
  next: "end" | "switch" | "wait2" = "end",
  options: { failCompleteOnce?: boolean; claimedNextOverride?: string } = {},
) {
  const resumeId = "10000000-0000-4000-8000-000000000001";
  const run = {
    id: "run-1",
    flow_id: "flow-1",
    flow_version_id: "version-7",
    account_id: "account-1",
    user_id: "user-1",
    contact_id: "contact-1",
    conversation_id: "conversation-1",
    status: "waiting",
    current_node_key: "wait",
    current_visit_id: "00000000-0000-4000-8000-000000000001",
    continuation_id: null as string | null,
    continuation_phase: "idle",
    continuation_step: 0,
    last_prompt_message_id: null,
    vars: { kind: "x" },
    reprompt_count: 0,
    started_at: "",
    last_advanced_at: "",
    ended_at: null,
    end_reason: null,
  };
  let waitStatus = "pending";
  let claimToken = "";
  let claimSequence = 0;
  let failComplete = options.failCompleteOnce === true;

  const rpc = vi.fn(async (name: string, value?: Record<string, unknown>) => {
    if (name === "claim_due_flow_waits") {
      if (waitStatus === "resumed") return { data: [], error: null };
      claimToken = `token-${++claimSequence}`;
      waitStatus = "claimed";
      return {
        data: [
          {
            id: "wait-1",
            flow_run_id: "run-1",
            flow_version_id: "version-7",
            node_key: "wait",
            next_node_key: options.claimedNextOverride ?? next,
            claim_token: claimToken,
            resume_id: resumeId,
          },
        ],
        error: null,
      };
    }
    if (name === "prepare_flow_wait_resume") {
      if (run.continuation_id === null) {
        run.status = "resuming";
        run.current_node_key = next;
        run.current_visit_id = resumeId;
        run.continuation_id = resumeId;
        run.continuation_phase = "running";
      }
      return { data: [{ ...run }], error: null };
    }
    if (name === "complete_flow_wait_continuation") {
      if (failComplete) {
        failComplete = false;
        run.continuation_phase = "completed";
        return { data: false, error: { message: "worker lost DB" } };
      }
      run.continuation_phase = "completed";
      return { data: true, error: null };
    }
    if (name === "ack_flow_wait_resume") {
      if (
        value?.p_claim_token !== claimToken &&
        run.current_node_key === "wait2"
      ) {
        return { data: true, error: null };
      }
      if (run.continuation_phase !== "completed") {
        return { data: false, error: null };
      }
      waitStatus = "resumed";
      if (
        run.status === "resuming" ||
        run.status === "needs_recovery"
      ) {
        run.status = "active";
      }
      run.continuation_id = null;
      run.continuation_phase = "idle";
      run.continuation_step = 0;
      return { data: true, error: null };
    }
    throw new Error(`unexpected RPC ${name}`);
  });
  const versionQuery = {
    select: vi.fn(() => versionQuery),
    eq: vi.fn(() => versionQuery),
    maybeSingle: vi.fn(async () => ({
      data: { id: "version-7", flow_id: "flow-1", graph: graph(next) },
      error: null,
    })),
  };
  return {
    run,
    rpc,
    db: {
      rpc,
      from: vi.fn(() => versionQuery),
    },
    get waitStatus() {
      return waitStatus;
    },
    supersedeWait() {
      waitStatus = "pending";
      claimToken = "replacement-token";
      run.status = "waiting";
      run.current_node_key = "wait2";
      run.continuation_id = null;
      run.continuation_phase = "idle";
    },
  };
}

describe("durable flow wait resume", () => {
  it.each(["end", "switch"] as const)(
    "persists the continuation before advancing wait → %s and acknowledges it",
    async (next) => {
      const harness = durableHarness(next);
      const advance = vi.fn(async (_db, resumedRun, startNodeKey) => {
        expect(resumedRun.current_node_key).toBe(next);
        expect(resumedRun.current_visit_id).toBe(
          "10000000-0000-4000-8000-000000000001",
        );
        expect(startNodeKey).toBe(next);
        harness.run.status = "completed";
        return { outcome: "completed" as const };
      });

      const result = await resumeDueFlowWaits(
        harness.db as never,
        new Date("2026-07-26T00:00:00.000Z"),
        { advance },
      );

      expect(result).toEqual({ claimed: 1, resumed: 1, failed: 0 });
      expect(harness.waitStatus).toBe("resumed");
      expect(harness.run.continuation_phase).toBe("idle");
      expect(harness.run.continuation_id).toBeNull();
      expect(harness.rpc.mock.calls.map(([name]) => name)).toEqual([
        "claim_due_flow_waits",
        "prepare_flow_wait_resume",
        "ack_flow_wait_resume",
        "complete_flow_wait_continuation",
        "ack_flow_wait_resume",
      ]);
    },
  );

  it("treats wait to wait replacement as a successful supersession", async () => {
    const harness = durableHarness("wait2");
    const advance = vi.fn(async () => {
      harness.supersedeWait();
      return { outcome: "advanced" as const };
    });

    const result = await resumeDueFlowWaits(
      harness.db as never,
      new Date(),
      { advance },
    );

    expect(result).toEqual({ claimed: 1, resumed: 1, failed: 0 });
    expect(harness.waitStatus).toBe("pending");
    expect(harness.run.current_node_key).toBe("wait2");
    expect(
      harness.rpc.mock.calls.filter(
        ([name]) => name === "complete_flow_wait_continuation",
      ),
    ).toHaveLength(0);
  });

  it("reclaims a crash before auto-node completion from the persisted cursor", async () => {
    const harness = durableHarness("switch");
    const advance = vi
      .fn()
      .mockRejectedValueOnce(new Error("worker crashed"))
      .mockImplementationOnce(async (_db, resumedRun, startNodeKey) => {
        expect(resumedRun.current_node_key).toBe("switch");
        expect(startNodeKey).toBe("switch");
        harness.run.status = "completed";
        return { outcome: "completed" as const };
      });

    expect(
      await resumeDueFlowWaits(harness.db as never, new Date(), { advance }),
    ).toEqual({ claimed: 1, resumed: 0, failed: 1 });
    expect(harness.run.current_node_key).toBe("switch");
    expect(harness.run.continuation_phase).toBe("running");

    expect(
      await resumeDueFlowWaits(harness.db as never, new Date(), { advance }),
    ).toEqual({ claimed: 1, resumed: 1, failed: 0 });
    expect(advance).toHaveBeenCalledTimes(2);
  });

  it("reclaims a needs-recovery effect continuation without repeating the remote effect", async () => {
    const harness = durableHarness("switch");
    let remoteCommitted = false;
    let remoteCalls = 0;
    const advance = vi.fn(async () => {
      if (!remoteCommitted) {
        remoteCalls += 1;
        remoteCommitted = true;
        harness.run.status = "needs_recovery";
        throw new Error("effect cursor response lost");
      }
      expect(harness.run.status).toBe("needs_recovery");
      expect(harness.run.continuation_id).toBe(
        "10000000-0000-4000-8000-000000000001",
      );
      harness.run.status = "completed";
      return { outcome: "completed" as const };
    });

    expect(
      await resumeDueFlowWaits(harness.db as never, new Date(), { advance }),
    ).toEqual({ claimed: 1, resumed: 0, failed: 1 });
    expect(
      await resumeDueFlowWaits(harness.db as never, new Date(), { advance }),
    ).toEqual({ claimed: 1, resumed: 1, failed: 0 });
    expect(remoteCalls).toBe(1);
    expect(advance).toHaveBeenCalledTimes(2);
    expect(harness.run.status).toBe("completed");
    expect(harness.run.continuation_id).toBeNull();
    expect(harness.run.continuation_phase).toBe("idle");
  });

  it("reclaims a crash after terminal advancement without replaying it", async () => {
    const harness = durableHarness("end", { failCompleteOnce: true });
    const advance = vi.fn(async () => {
      harness.run.status = "completed";
      return { outcome: "completed" as const };
    });

    expect(
      await resumeDueFlowWaits(harness.db as never, new Date(), { advance }),
    ).toEqual({ claimed: 1, resumed: 1, failed: 0 });
    expect(advance).toHaveBeenCalledTimes(1);
    expect(harness.run.status).toBe("completed");
    expect(harness.run.continuation_id).toBeNull();
    expect(harness.run.continuation_phase).toBe("idle");
  });

  it("rejects an edge that differs from the immutable version", async () => {
    const harness = durableHarness("end", {
      claimedNextOverride: "attacker-node",
    });

    const result = await resumeDueFlowWaits(harness.db as never, new Date());

    expect(result).toEqual({ claimed: 1, resumed: 0, failed: 1 });
    expect(harness.rpc).toHaveBeenCalledTimes(1);
  });
});
