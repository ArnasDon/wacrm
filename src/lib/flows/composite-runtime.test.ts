import { describe, expect, it } from "vitest";

import {
  MAX_COMPOSITE_ITERATIONS,
  MAX_SUB_FLOW_DEPTH,
  advanceEachState,
  advanceLoopState,
  createEachState,
  createLoopState,
  mapSubFlowInputs,
  mapSubFlowOutputs,
  validateSubFlowCallGraph,
} from "./composite-runtime";

describe("durable composite runtime decisions", () => {
  it("iterates each values in order and takes done for an empty array", () => {
    const empty = createEachState([], 10);
    expect(advanceEachState(empty)).toEqual({
      branch: "done",
      state: empty,
    });

    const initial = createEachState(["a", "b"], 10);
    const first = advanceEachState(initial);
    expect(first).toMatchObject({
      branch: "body",
      item: "a",
      index: 0,
      state: { nextIndex: 1 },
    });
    const second = advanceEachState(first.state);
    expect(second).toMatchObject({
      branch: "body",
      item: "b",
      index: 1,
      state: { nextIndex: 2 },
    });
    expect(advanceEachState(second.state).branch).toBe("done");
  });

  it("caps each and loop iteration counts", () => {
    expect(() =>
      createEachState(
        Array.from({ length: MAX_COMPOSITE_ITERATIONS + 1 }),
        MAX_COMPOSITE_ITERATIONS + 1,
      ),
    ).toThrow(/cap/i);
    expect(() =>
      createLoopState(MAX_COMPOSITE_ITERATIONS + 1),
    ).toThrow(/cap/i);
  });

  it("stops a loop when its exit predicate matches or the max is exhausted", () => {
    const initial = createLoopState(2);
    const first = advanceLoopState(initial, false);
    expect(first).toMatchObject({
      branch: "body",
      iteration: 0,
      state: { nextIteration: 1 },
    });
    expect(advanceLoopState(first.state, true).branch).toBe("done");

    const second = advanceLoopState(first.state, false);
    expect(second.branch).toBe("body");
    expect(advanceLoopState(second.state, false)).toMatchObject({
      branch: "done",
      exhausted: true,
    });
  });

  it("maps only declared sub-flow inputs and outputs", () => {
    expect(
      mapSubFlowInputs(
        { customer: "Ada", ignored: "secret" },
        [{ parent_key: "customer", child_key: "name" }],
      ),
    ).toEqual({ name: "Ada" });
    expect(
      mapSubFlowOutputs(
        { answer: "42", internal: true },
        { existing: 1 },
        [{ child_key: "answer", parent_key: "result" }],
      ),
    ).toEqual({ existing: 1, result: "42" });
  });

  it("rejects recursive sub-flow calls and excessive depth", () => {
    expect(
      validateSubFlowCallGraph(
        new Map([
          ["a", ["b"]],
          ["b", ["a"]],
        ]),
        "a",
      ),
    ).toEqual({ ok: false, reason: "cycle" });
    expect(
      validateSubFlowCallGraph(
        new Map(
          Array.from({ length: MAX_SUB_FLOW_DEPTH + 1 }, (_, index) => [
            `f${index}`,
            index === MAX_SUB_FLOW_DEPTH ? [] : [`f${index + 1}`],
          ]),
        ),
        "f0",
      ),
    ).toEqual({ ok: false, reason: "depth" });
  });
});
