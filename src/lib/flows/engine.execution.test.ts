import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sendText: vi.fn(),
}));

vi.mock("./zapi-send", () => ({
  engineSendText: h.sendText,
  engineSendMedia: vi.fn(),
  engineSendInteractiveButtons: vi.fn(),
  engineSendInteractiveList: vi.fn(),
}));

import { advanceFromNodeKey } from "./engine";
import type { FlowNodeRow, FlowRunRow } from "./types";

interface CapturedWrite {
  table: string;
  kind: "insert" | "update";
  value: Record<string, unknown>;
}

function fakeDb(options: { failExecutionLogging?: boolean } = {}) {
  const writes: CapturedWrite[] = [];
  let executionSequence = 0;

  const db = {
    from(table: string) {
      return {
        insert(value: Record<string, unknown>) {
          writes.push({ table, kind: "insert", value });
          if (table === "flow_node_executions") {
            if (options.failExecutionLogging) {
              throw new Error("observability unavailable");
            }
            const id = `execution-${++executionSequence}`;
            return {
              select: () => ({
                maybeSingle: async () => ({ data: { id }, error: null }),
              }),
            };
          }
          return Promise.resolve({ error: null });
        },
        update(value: Record<string, unknown>) {
          writes.push({ table, kind: "update", value });
          return {
            eq: async () => ({ data: [{ id: "ok" }], error: null }),
          };
        },
      };
    },
  };
  return { db, writes };
}

function run(overrides: Partial<FlowRunRow> = {}): FlowRunRow {
  return {
    id: "run-1",
    flow_id: "flow-1",
    flow_version_id: "version-7",
    account_id: "account-1",
    user_id: "user-1",
    contact_id: "contact-1",
    conversation_id: "conversation-1",
    status: "active",
    current_node_key: "start",
    last_prompt_message_id: null,
    vars: {},
    reprompt_count: 0,
    started_at: "2026-01-01T00:00:00.000Z",
    last_advanced_at: "2026-01-01T00:00:00.000Z",
    ended_at: null,
    end_reason: null,
    ...overrides,
  };
}

function node(
  node_key: string,
  node_type: FlowNodeRow["node_type"],
  config: Record<string, unknown>,
): FlowNodeRow {
  return {
    id: `flow-1:${node_key}`,
    flow_id: "flow-1",
    node_key,
    node_type,
    config,
    position_x: 0,
    position_y: 0,
    created_at: "",
  };
}

function graph(messageConfig: Record<string, unknown>) {
  const nodes = [
    node("start", "start", { next_node_key: "send" }),
    node("send", "send_message", {
      text: "hello",
      next_node_key: "success",
      ...messageConfig,
    }),
    node("success", "end", {}),
    node("recover", "end", {}),
  ];
  return new Map(nodes.map((entry) => [entry.node_key, entry]));
}

beforeEach(() => {
  h.sendText.mockReset();
});

describe("node execution policy in the flow engine", () => {
  it("takes an error branch after a simulated Z-API failure without failing the run", async () => {
    h.sendText.mockRejectedValue(new Error("Z-API unavailable"));
    const { db, writes } = fakeDb();

    const result = await advanceFromNodeKey(
      db as never,
      run(),
      "start",
      graph({ on_error: "fail_branch", error_next_node_key: "recover" }),
    );

    expect(result).toEqual({ outcome: "completed" });
    expect(h.sendText).toHaveBeenCalledTimes(1);
    expect(
      writes.some(
        (write) =>
          write.table === "flow_runs" &&
          write.kind === "update" &&
          write.value.status === "failed",
      ),
    ).toBe(false);
    expect(
      writes.some(
        (write) =>
          write.table === "flow_run_events" &&
          write.kind === "insert" &&
          write.value.event_type === "error" &&
          (write.value.payload as { attempt?: number }).attempt === 1,
      ),
    ).toBe(true);
  });

  it("persists a typed default and follows the normal success edge", async () => {
    h.sendText.mockRejectedValue(new Error("Z-API unavailable"));
    const activeRun = run({ vars: { existing: true } });
    const { db, writes } = fakeDb();

    await advanceFromNodeKey(
      db as never,
      activeRun,
      "start",
      graph({
        on_error: "default_value",
        default_value: { key: "delivery", type: "string", value: "skipped" },
      }),
    );

    expect(activeRun.vars).toEqual({ existing: true, delivery: "skipped" });
    expect(
      writes.some(
        (write) =>
          write.table === "flow_runs" &&
          write.kind === "update" &&
          JSON.stringify(write.value.vars) ===
            JSON.stringify({ existing: true, delivery: "skipped" }),
      ),
    ).toBe(true);
  });

  it("keeps fail_run as the default", async () => {
    h.sendText.mockRejectedValue(new Error("Z-API unavailable"));
    const { db, writes } = fakeDb();

    await advanceFromNodeKey(db as never, run(), "start", graph({}));

    expect(
      writes.some(
        (write) =>
          write.table === "flow_runs" &&
          write.kind === "update" &&
          write.value.status === "failed",
      ),
    ).toBe(true);
  });

  it("records each attempt with version, status, output/error, and duration", async () => {
    h.sendText
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({ whatsapp_message_id: "wamid-1" });
    const { db, writes } = fakeDb();

    await advanceFromNodeKey(
      db as never,
      run(),
      "start",
      graph({
        retry: { max_attempts: 2, interval_ms: 0, backoff: "fixed" },
      }),
    );

    const sendInserts = writes.filter(
      (write) =>
        write.table === "flow_node_executions" &&
        write.kind === "insert" &&
        write.value.node_key === "send",
    );
    expect(sendInserts).toHaveLength(2);
    expect(h.sendText).toHaveBeenLastCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(sendInserts.map((write) => write.value.attempt)).toEqual([1, 2]);
    expect(sendInserts[0].value).toMatchObject({
      flow_run_id: "run-1",
      flow_version_id: "version-7",
      node_type: "send_message",
      status: "executing",
    });
    const finalUpdates = writes.filter(
      (write) =>
        write.table === "flow_node_executions" && write.kind === "update",
    );
    expect(finalUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: expect.objectContaining({
            status: "error",
            duration_ms: expect.any(Number),
            error: expect.objectContaining({ message: "temporary" }),
          }),
        }),
        expect.objectContaining({
          value: expect.objectContaining({
            status: "completed",
            duration_ms: expect.any(Number),
            outputs: { whatsapp_message_id: "wamid-1" },
          }),
        }),
      ]),
    );
  });

  it("does not repeat or fail business execution when execution logging fails", async () => {
    h.sendText.mockResolvedValue({ whatsapp_message_id: "wamid-1" });
    const { db, writes } = fakeDb({ failExecutionLogging: true });

    const result = await advanceFromNodeKey(
      db as never,
      run(),
      "start",
      graph({}),
    );

    expect(result).toEqual({ outcome: "completed" });
    expect(h.sendText).toHaveBeenCalledTimes(1);
    expect(
      writes.some(
        (write) =>
          write.table === "flow_runs" &&
          write.kind === "update" &&
          write.value.status === "failed",
      ),
    ).toBe(false);
  });
});
