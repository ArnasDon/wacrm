import { describe, expect, it, vi } from "vitest";

import {
  resolveApprovalTimeout,
  resumeFlowApprovalResolutions,
  scheduleFlowApproval,
} from "./approval-runtime";

describe("approval timeout policy", () => {
  it("maps fail branch, default value, and fail run deterministically", () => {
    const config = {
      approved_next: "approved",
      rejected_next: "rejected",
    };
    expect(
      resolveApprovalTimeout(
        { on_error: "fail_branch", error_next_node_key: "manual" },
        config,
      ),
    ).toEqual({ action: "branch", nextNodeKey: "manual" });
    expect(
      resolveApprovalTimeout({ on_error: "default_value" }, config),
    ).toEqual({ action: "default", nextNodeKey: "rejected" });
    expect(resolveApprovalTimeout({ on_error: "fail_run" }, config)).toEqual({
      action: "fail",
    });
  });
});

describe("approval resolution worker", () => {
  it("retries the same durable schedule arguments and pauses the run", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "lost" } })
      .mockResolvedValueOnce({ data: [{ id: "request-1" }], error: null });
    const run = {
      id: "run-1",
      flow_id: "flow-1",
      flow_version_id: "version-1",
      account_id: "account-1",
      user_id: "user-1",
      contact_id: null,
      conversation_id: null,
      status: "active" as const,
      current_node_key: "approval",
      current_visit_id: "visit-1",
      last_prompt_message_id: null,
      vars: { amount: 42 },
      reprompt_count: 0,
      started_at: "",
      last_advanced_at: "",
      ended_at: null,
      end_reason: null,
    };
    const node = {
      id: "node-1",
      flow_id: "flow-1",
      node_key: "approval",
      node_type: "approval" as const,
      config: {
        title: "Review {{vars.amount}}",
        message: "Confirm",
        assignee_user_id: "00000000-0000-4000-8000-000000000001",
        timeout_hours: 1,
        approved_next: "approved",
        rejected_next: "rejected",
      },
      position_x: 0,
      position_y: 0,
      created_at: "",
    };

    await scheduleFlowApproval({ rpc } as never, run, node);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_run_id: "run-1",
      p_visit_id: "visit-1",
      p_title: "Review 42",
      p_timeout_action: "fail",
    });
    expect(run.status).toBe("paused_by_agent");
  });

  it("loads the pinned graph, advances the prepared cursor once, then acknowledges", async () => {
    const calls: string[] = [];
    const graph = {
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
          position_x: 0,
          position_y: 0,
          config: {
            title: "Review",
            message: "Review",
            assignee_user_id: "00000000-0000-4000-8000-000000000001",
            timeout_hours: 1,
            approved_next: "end",
            rejected_next: "end",
          },
        },
        {
          node_key: "end",
          node_type: "end",
          config: {},
          position_x: 0,
          position_y: 100,
        },
      ],
    };
    const db = {
      rpc: vi.fn(async (name: string) => {
        calls.push(name);
        if (name === "claim_flow_approval_resolutions") {
          return {
            data: [
              {
                id: "approval-1",
                flow_run_id: "run-1",
                flow_version_id: "version-1",
                node_key: "approval",
                decision: "approved",
                resolution_token: "token-1",
                resume_id: "resume-1",
              },
            ],
            error: null,
          };
        }
        return { data: true, error: null };
      }),
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: "version-1", flow_id: "flow-1", graph },
              error: null,
            }),
          }),
        }),
      })),
    };
    const advance = vi.fn(async () => ({ outcome: "completed" as const }));

    const result = await resumeFlowApprovalResolutions(db as never, {
      advance,
    });

    expect(result).toEqual({ claimed: 1, resumed: 1, failed: 0 });
    expect(advance).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      "claim_flow_approval_resolutions",
      "complete_flow_approval_resolution",
    ]);
  });

  it("acknowledges an already-completed cursor without executing it twice", async () => {
    const graph = {
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
          config: {
            title: "Review",
            message: "Review",
            assignee_user_id: "00000000-0000-4000-8000-000000000001",
            timeout_hours: 1,
            approved_next: "end",
            rejected_next: "end",
          },
          position_x: 0,
          position_y: 0,
        },
        {
          node_key: "end",
          node_type: "end",
          config: {},
          position_x: 0,
          position_y: 100,
        },
      ],
    };
    const rpc = vi.fn(async (name: string) =>
      name === "claim_flow_approval_resolutions"
        ? {
            data: [
              {
                id: "approval-1",
                flow_run_id: "run-1",
                flow_version_id: "version-1",
                node_key: "approval",
                decision: "approved",
                resolution_token: "token-2",
                resume_id: "resume-1",
                run_row: {
                  id: "run-1",
                  flow_id: "flow-1",
                  flow_version_id: "version-1",
                  account_id: "account-1",
                  user_id: "user-1",
                  contact_id: null,
                  conversation_id: null,
                  status: "completed",
                  current_node_key: "end",
                  current_visit_id: "resume-1",
                  continuation_id: "resume-1",
                  continuation_phase: "running",
                  continuation_step: 1,
                  last_prompt_message_id: null,
                  vars: {},
                  reprompt_count: 0,
                  started_at: "",
                  last_advanced_at: "",
                  ended_at: "",
                  end_reason: "end_node",
                },
              },
            ],
            error: null,
          }
        : { data: true, error: null },
    );
    const db = {
      rpc,
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: "version-1", flow_id: "flow-1", graph },
              error: null,
            }),
          }),
        }),
      })),
    };
    const advance = vi.fn();

    const result = await resumeFlowApprovalResolutions(db as never, {
      advance,
    });

    expect(result).toEqual({ claimed: 1, resumed: 1, failed: 0 });
    expect(advance).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenLastCalledWith(
      "complete_flow_approval_resolution",
      expect.objectContaining({ p_resolution_token: "token-2" }),
    );
  });

  it("acknowledges a reclaimed approval when durable evidence shows the next approval already opened", async () => {
    const graph = {
      schema_version: 1,
      trigger: { type: "manual", config: {} },
      entry_node_key: "approval-one",
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
          node_key: "approval-one",
          node_type: "approval",
          config: {
            title: "First review",
            message: "First review",
            assignee_user_id: "00000000-0000-4000-8000-000000000001",
            timeout_hours: 1,
            approved_next: "approval-two",
            rejected_next: "end",
          },
          position_x: 0,
          position_y: 0,
        },
        {
          node_key: "approval-two",
          node_type: "approval",
          config: {
            title: "Second review",
            message: "Second review",
            assignee_user_id: "00000000-0000-4000-8000-000000000002",
            timeout_hours: 1,
            approved_next: "end",
            rejected_next: "end",
          },
          position_x: 0,
          position_y: 100,
        },
        {
          node_key: "end",
          node_type: "end",
          config: {},
          position_x: 0,
          position_y: 200,
        },
      ],
    };
    const rpc = vi.fn(async (name: string) =>
      name === "claim_flow_approval_resolutions"
        ? {
            data: [
              {
                id: "approval-1",
                flow_run_id: "run-1",
                flow_version_id: "version-1",
                node_key: "approval-one",
                decision: "approved",
                resolution_token: "token-3",
                resume_id: "resume-1",
                chained_approval_ready: true,
                run_row: {
                  id: "run-1",
                  flow_id: "flow-1",
                  flow_version_id: "version-1",
                  account_id: "account-1",
                  user_id: "user-1",
                  contact_id: null,
                  conversation_id: null,
                  status: "paused_by_agent",
                  current_node_key: "approval-two",
                  current_visit_id: "resume-1",
                  continuation_id: "resume-1",
                  continuation_phase: "running",
                  continuation_step: 1,
                  last_prompt_message_id: null,
                  vars: {},
                  reprompt_count: 0,
                  started_at: "",
                  last_advanced_at: "",
                  ended_at: null,
                  end_reason: null,
                },
              },
            ],
            error: null,
          }
        : { data: true, error: null },
    );
    const db = {
      rpc,
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: "version-1", flow_id: "flow-1", graph },
              error: null,
            }),
          }),
        }),
      })),
    };
    const advance = vi.fn();

    const result = await resumeFlowApprovalResolutions(db as never, {
      advance,
    });

    expect(result).toEqual({ claimed: 1, resumed: 1, failed: 0 });
    expect(advance).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenLastCalledWith(
      "complete_flow_approval_resolution",
      expect.objectContaining({ p_resolution_token: "token-3" }),
    );
  });
});
