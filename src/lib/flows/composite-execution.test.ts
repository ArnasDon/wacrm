import { describe, expect, it, vi } from "vitest";

import {
  enterSubFlow,
  executeEachIteration,
  executeLoopIteration,
  returnFromSubFlow,
} from "./composite-execution";

function dbWithRows(rows: Record<string, unknown>) {
  return {
    rpc: vi.fn(async (name: string) => ({
      data: rows[name] ?? null,
      error: null,
    })),
  };
}

const run = {
  id: "run-1",
  flow_id: "parent",
  flow_version_id: "root-version",
  active_flow_id: "parent",
  active_flow_version_id: "parent-version",
  current_node_key: "composite",
  current_visit_id: "visit-2",
  vars: { items: ["a", "b"], existing: true },
};

describe("composite execution RPC boundary", () => {
  it("replays the exact CAS arguments after a lost database response", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "network" } })
      .mockResolvedValueOnce({
        data: [
          {
            id: "state-1",
            items: [],
            next_iteration: 0,
            max_iterations: 10,
            state_version: 0,
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: { message: "network" } })
      .mockResolvedValueOnce({
        data: [{ ...run, current_node_key: "done" }],
        error: null,
      });
    await executeEachIteration(
      { rpc },
      run,
      {
        array_variable: "items",
        item_variable: "item",
        max_iterations: 10,
        body_next: "body",
        done_next: "done",
      },
    );
    expect(rpc).toHaveBeenCalledTimes(4);
    expect(rpc.mock.calls[2]).toEqual(rpc.mock.calls[3]);
  });

  it("advances each state and cursor/variables in one RPC", async () => {
    const db = dbWithRows({
      begin_flow_loop_iteration: [
        {
          id: "state-1",
          items: ["a", "b"],
          next_iteration: 0,
          max_iterations: 10,
          state_version: 3,
        },
      ],
      advance_flow_loop_iteration: [
        {
          ...run,
          current_node_key: "body",
          vars: { ...run.vars, item: "a", index: 0 },
        },
      ],
    });
    const result = await executeEachIteration(db, run, {
      array_variable: "items",
      item_variable: "item",
      index_variable: "index",
      max_iterations: 10,
      body_next: "body",
      done_next: "done",
    });
    expect(result).toMatchObject({ nextNodeKey: "body", branch: "body" });
    expect(db.rpc).toHaveBeenLastCalledWith(
      "advance_flow_loop_iteration",
      expect.objectContaining({
        p_state_id: "state-1",
        p_expected_visit_id: "visit-2",
        p_next_iteration: 1,
        p_completed: false,
        p_next_vars: expect.objectContaining({ item: "a", index: 0 }),
      }),
    );
  });

  it("takes loop done atomically when the predicate matches", async () => {
    const db = dbWithRows({
      begin_flow_loop_iteration: [
        {
          id: "state-loop",
          items: null,
          next_iteration: 2,
          max_iterations: 5,
          state_version: 2,
        },
      ],
      advance_flow_loop_iteration: [
        { ...run, current_node_key: "done" },
      ],
    });
    const result = await executeLoopIteration(
      db,
      run,
      {
        max_iterations: 5,
        body_next: "body",
        done_next: "done",
      },
      true,
    );
    expect(result).toMatchObject({ branch: "done", nextNodeKey: "done" });
    expect(db.rpc).toHaveBeenLastCalledWith(
      "advance_flow_loop_iteration",
      expect.objectContaining({ p_completed: true, p_next_iteration: 2 }),
    );
  });

  it("pins a child frame and maps return variables once", async () => {
    const db = dbWithRows({
      push_flow_call_frame: [
        {
          ...run,
          active_flow_id: "child",
          active_flow_version_id: "child-version",
          current_node_key: "child-start",
        },
      ],
      pop_flow_call_frame: [
        {
          ...run,
          current_node_key: "after",
          vars: { ...run.vars, result: "ok" },
        },
      ],
    });
    await enterSubFlow(db, run, {
      childFlowId: "child",
      childVersionId: "child-version",
      childEntryNodeKey: "child-start",
      returnNodeKey: "after",
      inputMapping: [{ parent_key: "existing", child_key: "enabled" }],
      outputMapping: [{ child_key: "answer", parent_key: "result" }],
    });
    expect(db.rpc).toHaveBeenCalledWith(
      "push_flow_call_frame",
      expect.objectContaining({
        p_child_flow_version_id: "child-version",
        p_child_vars: { enabled: true },
      }),
    );
    await returnFromSubFlow(
      db,
      { ...run, active_flow_version_id: "child-version" },
      { answer: "ok" },
    );
    expect(db.rpc).toHaveBeenLastCalledWith(
      "pop_flow_call_frame",
      expect.objectContaining({
        p_child_vars: { answer: "ok" },
      }),
    );
  });
});
