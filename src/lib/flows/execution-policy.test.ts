import { describe, expect, it, vi } from "vitest";

import {
  CommittedSideEffectError,
  DEFAULT_NODE_EXECUTION_POLICY,
  NonRetryableExecutionError,
  NodeExecutionTimeoutError,
  executeWithNodePolicy,
  resolveExhaustedNodePolicy,
  resolveNodeExecutionPolicy,
  sanitizeExecutionError,
} from "./execution-policy";

describe("resolveNodeExecutionPolicy", () => {
  it("keeps legacy snapshots on one fail-run attempt with a bounded timeout", () => {
    expect(resolveNodeExecutionPolicy(undefined, {})).toEqual(
      DEFAULT_NODE_EXECUTION_POLICY,
    );
  });

  it("merges global defaults and node overrides", () => {
    expect(
      resolveNodeExecutionPolicy(
        {
          retry: { max_attempts: 2, interval_ms: 200, backoff: "fixed" },
          on_error: "fail_branch",
          error_next_node_key: "global_error",
          timeout_ms: 4_000,
        },
        {
          retry: { max_attempts: 3, interval_ms: 50, backoff: "exponential" },
          on_error: "default_value",
          default_value: {
            key: "send_result",
            type: "string",
            value: "skipped",
          },
        },
      ),
    ).toEqual({
      retry: { max_attempts: 3, interval_ms: 50, backoff: "exponential" },
      on_error: "default_value",
      default_value: { key: "send_result", type: "string", value: "skipped" },
      timeout_ms: 4_000,
    });
  });
});

describe("executeWithNodePolicy", () => {
  it("returns on the first successful attempt", async () => {
    const operation = vi.fn(async () => "ok");

    await expect(
      executeWithNodePolicy(operation, DEFAULT_NODE_EXECUTION_POLICY),
    ).resolves.toMatchObject({ value: "ok", attempts: 1 });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("retries until an attempt succeeds", async () => {
    let count = 0;
    const sleeps: number[] = [];
    const result = await executeWithNodePolicy(
      async () => {
        count += 1;
        if (count < 3) throw new Error("temporary");
        return "sent";
      },
      {
        retry: { max_attempts: 3, interval_ms: 10, backoff: "fixed" },
        on_error: "fail_run",
        timeout_ms: 1_000,
      },
      { sleep: async (ms) => void sleeps.push(ms) },
    );

    expect(result).toMatchObject({ value: "sent", attempts: 3 });
    expect(sleeps).toEqual([10, 10]);
  });

  it("uses bounded exponential backoff and reports exhaustion", async () => {
    const sleeps: number[] = [];
    const error = await executeWithNodePolicy(
      async () => {
        throw new Error("still down");
      },
      {
        retry: { max_attempts: 3, interval_ms: 100, backoff: "exponential" },
        on_error: "fail_run",
        timeout_ms: 1_000,
      },
      { sleep: async (ms) => void sleeps.push(ms) },
    ).catch((caught) => caught);

    expect(error).toMatchObject({ attempts: 3 });
    expect(error.cause).toMatchObject({ message: "still down" });
    expect(sleeps).toEqual([100, 200]);
  });

  it("times out an attempt and aborts the provided signal", async () => {
    let aborted = false;
    const error = await executeWithNodePolicy(
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(signal.reason);
          });
        }),
      {
        retry: { max_attempts: 1, interval_ms: 0, backoff: "fixed" },
        on_error: "fail_run",
        timeout_ms: 25,
      },
    ).catch((caught) => caught);

    expect(error.cause).toBeInstanceOf(NodeExecutionTimeoutError);
    expect(aborted).toBe(true);
  });

  it("does not retry errors marked non-retryable", async () => {
    const operation = vi.fn(async () => {
      throw new NonRetryableExecutionError("invalid node program");
    });

    const error = await executeWithNodePolicy(operation, {
      retry: { max_attempts: 3, interval_ms: 0, backoff: "fixed" },
      on_error: "fail_run",
      timeout_ms: 1_000,
    }).catch((caught) => caught);

    expect(error).toMatchObject({ attempts: 1 });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("does not retry a committed external side effect and preserves support metadata", async () => {
    const operation = vi.fn(async () => {
      throw new CommittedSideEffectError(
        "message sent but local persistence failed",
        {
          externalReference: "wamid-committed",
          persistenceStage: "message_insert",
          cause: new Error("database unavailable"),
        },
      );
    });

    const error = await executeWithNodePolicy(operation, {
      retry: { max_attempts: 3, interval_ms: 0, backoff: "fixed" },
      on_error: "fail_branch",
      error_next_node_key: "recover",
      timeout_ms: 1_000,
    }).catch((caught) => caught);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(sanitizeExecutionError(error.cause)).toMatchObject({
      name: "CommittedSideEffectError",
      retryable: false,
      side_effect_committed: true,
      external_reference: "wamid-committed",
      persistence_stage: "message_insert",
    });
  });

  it("keeps observability hook failures from changing business execution", async () => {
    const operation = vi.fn(async () => "once");

    await expect(
      executeWithNodePolicy(operation, DEFAULT_NODE_EXECUTION_POLICY, {
        onAttemptStart: async () => {
          throw new Error("logging unavailable");
        },
        onAttemptSuccess: async () => {
          throw new Error("logging unavailable");
        },
      }),
    ).resolves.toMatchObject({ value: "once", attempts: 1 });
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe("resolveExhaustedNodePolicy", () => {
  it("keeps fail_run as the backward-compatible default", () => {
    expect(
      resolveExhaustedNodePolicy(DEFAULT_NODE_EXECUTION_POLICY, {}, "next"),
    ).toEqual({ action: "fail_run" });
  });

  it("advances through the configured error branch", () => {
    expect(
      resolveExhaustedNodePolicy(
        {
          ...DEFAULT_NODE_EXECUTION_POLICY,
          on_error: "fail_branch",
          error_next_node_key: "recover",
        },
        {},
        "success",
      ),
    ).toEqual({ action: "advance", nextNodeKey: "recover", vars: {} });
  });

  it("persists a typed default and follows the success edge", () => {
    expect(
      resolveExhaustedNodePolicy(
        {
          ...DEFAULT_NODE_EXECUTION_POLICY,
          on_error: "default_value",
          default_value: { key: "delivery", type: "string", value: "skipped" },
        },
        { existing: 1 },
        "success",
      ),
    ).toEqual({
      action: "advance",
      nextNodeKey: "success",
      vars: { existing: 1, delivery: "skipped" },
    });
  });
});
