import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sendText: vi.fn(),
  sendButtons: vi.fn(),
  sendList: vi.fn(),
  httpRequest: vi.fn(),
}));

vi.mock("./zapi-send", () => ({
  engineSendText: h.sendText,
  engineSendMedia: vi.fn(),
  engineSendInteractiveButtons: h.sendButtons,
  engineSendInteractiveList: h.sendList,
}));

vi.mock("./http-request", async (importOriginal) => {
  const original = await importOriginal<typeof import("./http-request")>();
  return { ...original, executeHttpRequest: h.httpRequest };
});

import { advanceFromNodeKey, handleReplyForActiveRun } from "./engine";
import { CommittedSideEffectError } from "./execution-policy";
import type { FlowNodeRow, FlowRunRow } from "./types";

interface CapturedWrite {
  table: string;
  kind: "insert" | "update";
  value: Record<string, unknown>;
}

function fakeDb(
  options: {
    failExecutionLogging?: boolean;
    failPromptPersistence?: boolean;
    failFlowVarsPersistence?: boolean;
    failFlowVarsPersistenceOnce?: boolean;
    flowVarsPersistence?: Promise<{ data: unknown; error: unknown }>;
    initialHttpEffect?: {
      status: "reserved" | "remote_committed" | "completed";
      response: Record<string, unknown> | null;
    };
  } = {},
) {
  const writes: CapturedWrite[] = [];
  let executionSequence = 0;
  let cursorSequence = 0;
  let failVarsOnce = options.failFlowVarsPersistenceOnce === true;
  const httpEffect = {
    id: "10000000-0000-4000-8000-000000000001",
    operation_id: "20000000-0000-4000-8000-000000000001",
    status: options.initialHttpEffect?.status ?? "reserved",
    response: options.initialHttpEffect?.response ?? null,
  };

  const db = {
    rpc(name: string, value: Record<string, unknown>) {
      writes.push({ table: `rpc:${name}`, kind: "insert", value });
      if (name === "reserve_flow_http_effect") {
        return Promise.resolve({ data: [{ ...httpEffect }], error: null });
      }
      if (name === "mark_flow_http_effect_committed") {
        httpEffect.status = "remote_committed";
        httpEffect.response = value.p_response as Record<string, unknown>;
        return Promise.resolve({ data: [{ ...httpEffect }], error: null });
      }
      if (name === "complete_flow_http_effect") {
        httpEffect.status = "completed";
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "advance_flow_run_cursor") {
        cursorSequence += 1;
        return Promise.resolve({
          data: [
            {
              current_node_key: value.p_next_node_key,
              current_visit_id: `30000000-0000-4000-8000-${String(
                cursorSequence,
              ).padStart(12, "0")}`,
              continuation_step: cursorSequence,
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: [{ id: "ok" }], error: null });
    },
    from(table: string) {
      return {
        select() {
          return {
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: "message-1" },
                error:
                  table === "messages" && options.failPromptPersistence
                    ? { message: "prompt lookup unavailable" }
                    : null,
              }),
            }),
          };
        },
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
            eq: async () => {
              if (
                table === "flow_runs" &&
                "vars" in value &&
                options.flowVarsPersistence
              ) {
                return options.flowVarsPersistence;
              }
              const shouldFailVars =
                table === "flow_runs" &&
                "vars" in value &&
                (options.failFlowVarsPersistence === true || failVarsOnce);
              if (shouldFailVars && failVarsOnce) failVarsOnce = false;
              return {
                data: [{ id: "ok" }],
                error: shouldFailVars
                  ? { message: "vars persistence unavailable" }
                  : null,
              };
            },
          };
        },
      };
    },
  };
  return { db, writes, httpEffect };
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
    current_visit_id: "00000000-0000-4000-8000-000000000001",
    continuation_id: null,
    continuation_phase: "idle",
    continuation_step: 0,
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
  h.sendButtons.mockReset();
  h.sendList.mockReset();
  h.httpRequest.mockReset();
});

describe("node execution policy in the flow engine", () => {
  it("persists a typed HTTP response and continues through the success edge", async () => {
    h.httpRequest.mockResolvedValue({
      status: 200,
      body: { answer: 42 },
      content_type: "application/json",
    });
    const activeRun = run();
    const { db, writes } = fakeDb();
    const nodes = new Map(
      [
        node("http", "http_request", {
          method: "GET",
          url: "https://api.example.com/data",
          headers: {},
          response_var: "response",
          next_node_key: "end",
        }),
        node("end", "end", {}),
      ].map((entry) => [entry.node_key, entry]),
    );

    await advanceFromNodeKey(db as never, activeRun, "http", nodes);

    expect(h.httpRequest).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://api.example.com/data" }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(activeRun.vars).toEqual({
      response: {
        status: 200,
        body: { answer: 42 },
        content_type: "application/json",
      },
    });
    expect(
      writes.some(
        (write) =>
          write.table === "flow_runs" &&
          write.kind === "update" &&
          "vars" in write.value,
      ),
    ).toBe(true);
  });

  it("never repeats an HTTP effect after the remote response is confirmed", async () => {
    h.httpRequest.mockResolvedValue({
      status: 200,
      body: { created: true },
      content_type: "application/json",
    });
    const activeRun = run({ current_node_key: "http" });
    const { db, writes } = fakeDb({ failFlowVarsPersistence: true });
    const nodes = new Map(
      [
        node("http", "http_request", {
          method: "POST",
          url: "https://api.example.com/create",
          headers: {},
          body: "{}",
          response_var: "response",
          next_node_key: "end",
          retry: {
            max_attempts: 3,
            interval_ms: 0,
            backoff: "fixed",
          },
          on_error: "fail_branch",
          error_next_node_key: "recover",
        }),
        node("end", "end", {}),
        node("recover", "end", {}),
      ].map((entry) => [entry.node_key, entry]),
    );

    await advanceFromNodeKey(db as never, activeRun, "http", nodes);

    expect(h.httpRequest).toHaveBeenCalledTimes(1);
    expect(h.httpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key": expect.any(String),
        }),
      }),
      expect.any(Object),
    );
    expect(
      writes.some(
        (write) =>
          write.table === "flow_runs" &&
          write.kind === "update" &&
          write.value.status === "failed" &&
          write.value.end_reason ===
            "side_effect_committed_local_persistence_failed",
      ),
    ).toBe(true);
  });

  it("reuses a remote-committed HTTP visit without invoking the remote server", async () => {
    const committed = {
      status: 201,
      body: { created: true },
      content_type: "application/json",
    };
    const activeRun = run({ current_node_key: "http" });
    const { db } = fakeDb({
      initialHttpEffect: {
        status: "remote_committed",
        response: committed,
      },
    });
    const nodes = new Map(
      [
        node("http", "http_request", {
          method: "POST",
          url: "https://api.example.com/create",
          headers: {},
          body: "{}",
          response_var: "response",
          next_node_key: "end",
        }),
        node("end", "end", {}),
      ].map((entry) => [entry.node_key, entry]),
    );

    await advanceFromNodeKey(db as never, activeRun, "http", nodes);

    expect(h.httpRequest).not.toHaveBeenCalled();
    expect(activeRun.vars.response).toEqual(committed);
  });

  it("keeps one stable operation id when a reserved HTTP visit is retried", async () => {
    h.httpRequest
      .mockRejectedValueOnce(new Error("connection reset during request"))
      .mockResolvedValueOnce({
        status: 200,
        body: { ok: true },
        content_type: "application/json",
      });
    const activeRun = run({ current_node_key: "http" });
    const { db, httpEffect } = fakeDb();
    const nodes = new Map(
      [
        node("http", "http_request", {
          method: "POST",
          url: "https://api.example.com/create",
          headers: {},
          body: "{}",
          response_var: "response",
          next_node_key: "end",
          retry: {
            max_attempts: 2,
            interval_ms: 0,
            backoff: "fixed",
          },
        }),
        node("end", "end", {}),
      ].map((entry) => [entry.node_key, entry]),
    );

    await advanceFromNodeKey(db as never, activeRun, "http", nodes);

    expect(h.httpRequest).toHaveBeenCalledTimes(2);
    expect(
      h.httpRequest.mock.calls.map(
        ([request]) => request.headers["Idempotency-Key"],
      ),
    ).toEqual([httpEffect.operation_id, httpEffect.operation_id]);
  });

  it("reclaims committed HTTP persistence failure with the same operation id", async () => {
    h.httpRequest.mockResolvedValue({
      status: 200,
      body: { created: true },
      content_type: "application/json",
    });
    const resumedRun = run({
      status: "resuming",
      current_node_key: "http",
      continuation_id: "40000000-0000-4000-8000-000000000001",
      continuation_phase: "running",
    });
    const { db, httpEffect } = fakeDb({
      failFlowVarsPersistenceOnce: true,
    });
    const nodes = new Map(
      [
        node("http", "http_request", {
          method: "POST",
          url: "https://api.example.com/create",
          headers: {},
          body: "{}",
          response_var: "response",
          next_node_key: "end",
        }),
        node("end", "end", {}),
      ].map((entry) => [entry.node_key, entry]),
    );

    await expect(
      advanceFromNodeKey(db as never, resumedRun, "http", nodes),
    ).rejects.toBeInstanceOf(CommittedSideEffectError);
    expect(httpEffect.status).toBe("remote_committed");

    await advanceFromNodeKey(db as never, resumedRun, "http", nodes);

    expect(h.httpRequest).toHaveBeenCalledTimes(1);
    expect(h.httpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key": httpEffect.operation_id,
        }),
      }),
      expect.any(Object),
    );
    expect(httpEffect.status).toBe("completed");
  });

  it("does not let slow local persistence turn a confirmed HTTP response into a timeout", async () => {
    vi.useFakeTimers();
    let resolvePersistence!: (value: { data: unknown; error: unknown }) => void;
    const persistence = new Promise<{ data: unknown; error: unknown }>(
      (resolve) => {
        resolvePersistence = resolve;
      },
    );
    try {
      h.httpRequest.mockResolvedValue({
        status: 200,
        body: { ok: true },
        content_type: "application/json",
      });
      const activeRun = run({ current_node_key: "http" });
      const { db } = fakeDb({ flowVarsPersistence: persistence });
      const nodes = new Map(
        [
          node("http", "http_request", {
            method: "POST",
            url: "https://api.example.com/slow-local-write",
            headers: {},
            body: "{}",
            response_var: "response",
            next_node_key: "end",
            timeout_ms: 10,
            retry: {
              max_attempts: 3,
              interval_ms: 0,
              backoff: "fixed",
            },
            on_error: "fail_branch",
            error_next_node_key: "recover",
          }),
          node("end", "end", {}),
          node("recover", "end", {}),
        ].map((entry) => [entry.node_key, entry]),
      );
      let settled = false;
      const advancing = advanceFromNodeKey(
        db as never,
        activeRun,
        "http",
        nodes,
      ).finally(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(100);
      expect(h.httpRequest).toHaveBeenCalledTimes(1);
      expect(settled).toBe(false);

      resolvePersistence({ data: [{ id: "run-1" }], error: null });
      await advancing;
      expect(h.httpRequest).toHaveBeenCalledTimes(1);
      expect(activeRun.vars.response).toMatchObject({ status: 200 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("feeds persisted typed output ports into connected runtime inputs", async () => {
    h.httpRequest.mockResolvedValue({
      status: 200,
      body: { answer: 42 },
      content_type: "application/json",
    });
    const activeRun = run({ current_node_key: "http" });
    const { db } = fakeDb();
    const nodes = new Map(
      [
        node("http", "http_request", {
          method: "GET",
          url: "https://api.example.com/data",
          headers: {},
          response_var: "response",
          next_node_key: "set",
        }),
        node("set", "variable_set", {
          assignments: [{ key: "copied", type: "json", value: "wrong" }],
          next_node_key: "end",
          _data_inputs: {
            value: {
              source_node_key: "http",
              source_handle: "response",
            },
          },
        }),
        node("end", "end", {}),
      ].map((entry) => [entry.node_key, entry]),
    );

    await advanceFromNodeKey(db as never, activeRun, "http", nodes);

    expect(activeRun.vars.copied).toEqual({
      status: 200,
      body: { answer: 42 },
      content_type: "application/json",
    });
  });

  it("schedules a durable wait through an atomic RPC without sleeping", async () => {
    const activeRun = run({ current_node_key: "wait" });
    const { db, writes } = fakeDb();
    const nodes = new Map(
      [
        node("wait", "wait", {
          amount: 5,
          unit: "minutes",
          next_node_key: "end",
        }),
        node("end", "end", {}),
      ].map((entry) => [entry.node_key, entry]),
    );

    const result = await advanceFromNodeKey(
      db as never,
      activeRun,
      "wait",
      nodes,
    );

    expect(result).toEqual({ outcome: "advanced" });
    expect(
      writes.find((write) => write.table === "rpc:schedule_flow_wait")?.value,
    ).toMatchObject({
      p_run_id: "run-1",
      p_flow_version_id: "version-7",
      p_node_key: "wait",
      p_next_node_key: "end",
    });
  });

  it("routes switch cases first-match and persists conservative variable assignments", async () => {
    const activeRun = run({ vars: { tier: "gold-customer" } });
    const { db, writes } = fakeDb();
    const nodes = new Map(
      [
        node("set", "variable_set", {
          assignments: [{ key: "count", type: "number", value: "42" }],
          next_node_key: "switch",
        }),
        node("switch", "switch", {
          subject: "var",
          subject_key: "tier",
          cases: [
            {
              id: "contains",
              label: "Gold-ish",
              operator: "contains",
              value: "gold",
              next: "first",
            },
            {
              id: "equals",
              label: "Exact",
              operator: "equals",
              value: "gold-customer",
              next: "second",
            },
          ],
          default_next: "fallback",
        }),
        node("first", "end", {}),
        node("second", "end", {}),
        node("fallback", "end", {}),
      ].map((entry) => [entry.node_key, entry]),
    );

    await advanceFromNodeKey(db as never, activeRun, "set", nodes);

    expect(activeRun.vars).toEqual({ tier: "gold-customer", count: 42 });
    expect(
      writes
        .filter((write) => write.table === "rpc:advance_flow_run_cursor")
        .map((write) => write.value.p_next_node_key),
    ).toEqual(["switch", "first"]);
  });
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

  it.each([
    {
      label: "fail_branch",
      config: {
        retry: { max_attempts: 3, interval_ms: 0, backoff: "fixed" as const },
        on_error: "fail_branch" as const,
        error_next_node_key: "recover",
      },
    },
    {
      label: "default_value",
      config: {
        retry: { max_attempts: 3, interval_ms: 0, backoff: "fixed" as const },
        on_error: "default_value" as const,
        default_value: {
          key: "delivery",
          type: "string" as const,
          value: "skipped",
        },
      },
    },
  ])(
    "forces fail_run after a committed send despite $label handling",
    async ({ config }) => {
      h.sendText.mockRejectedValue(
        new CommittedSideEffectError(
          "message sent but local persistence failed",
          {
            externalReference: "wamid-committed",
            persistenceStage: "message_insert",
          },
        ),
      );
      const activeRun = run({ vars: { existing: true } });
      const { db, writes } = fakeDb();

      const result = await advanceFromNodeKey(
        db as never,
        activeRun,
        "start",
        graph(config),
      );

      expect(result).toEqual({ outcome: "completed" });
      expect(h.sendText).toHaveBeenCalledTimes(1);
      expect(activeRun.vars).toEqual({ existing: true });
      expect(
        writes.filter(
          (write) =>
            write.table === "flow_runs" &&
            write.kind === "update" &&
            write.value.status === "failed" &&
            write.value.end_reason ===
              "side_effect_committed_local_persistence_failed",
        ),
      ).toHaveLength(1);
      expect(
        writes.some(
          (write) =>
            write.table === "flow_node_executions" &&
            write.kind === "update" &&
            write.value.status === "error" &&
            (write.value.error as { side_effect_committed?: boolean })
              .side_effect_committed === true,
        ),
      ).toBe(true);
      expect(
        writes.some(
          (write) =>
            write.table === "flow_run_events" &&
            write.kind === "insert" &&
            write.value.event_type === "error" &&
            (
              (write.value.payload as { error?: Record<string, unknown> })
                .error ?? {}
            ).side_effect_committed === true,
        ),
      ).toBe(true);
      expect(
        writes.some(
          (write) =>
            write.table === "flow_runs" &&
            write.kind === "update" &&
            write.value.status === "completed",
        ),
      ).toBe(false);
    },
  );

  it.each([
    {
      label: "send_buttons",
      nodeType: "send_buttons" as const,
      config: {
        text: "Choose",
        buttons: [{ reply_id: "yes", title: "Yes", next_node_key: "done" }],
      },
      prepare: () =>
        h.sendButtons.mockResolvedValue({
          whatsapp_message_id: "wamid-buttons",
        }),
      sendMock: h.sendButtons,
    },
    {
      label: "send_list",
      nodeType: "send_list" as const,
      config: {
        text: "Choose",
        button_label: "Options",
        sections: [
          {
            title: "Choices",
            rows: [{ reply_id: "one", title: "One", next_node_key: "done" }],
          },
        ],
      },
      prepare: () =>
        h.sendList.mockResolvedValue({
          whatsapp_message_id: "wamid-list",
        }),
      sendMock: h.sendList,
    },
    {
      label: "collect_input",
      nodeType: "collect_input" as const,
      config: {
        prompt_text: "Your name?",
        var_key: "name",
        next_node_key: "done",
      },
      prepare: () =>
        h.sendText.mockResolvedValue({
          whatsapp_message_id: "wamid-collect",
        }),
      sendMock: h.sendText,
    },
  ])(
    "fails $label safely when prompt bookkeeping fails after send",
    async ({ nodeType, config, prepare, sendMock }) => {
      prepare();
      const { db, writes } = fakeDb({ failPromptPersistence: true });
      const nodes = new Map(
        [
          node("prompt", nodeType, {
            ...config,
            retry: {
              max_attempts: 3,
              interval_ms: 0,
              backoff: "fixed",
            },
            on_error: "fail_branch",
            error_next_node_key: "recover",
          }),
          node("done", "end", {}),
          node("recover", "end", {}),
        ].map((entry) => [entry.node_key, entry]),
      );

      const result = await advanceFromNodeKey(
        db as never,
        run({ current_node_key: "prompt" }),
        "prompt",
        nodes,
      );

      expect(result).toEqual({ outcome: "completed" });
      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(
        writes.some(
          (write) =>
            write.table === "flow_runs" &&
            write.kind === "update" &&
            write.value.status === "failed" &&
            write.value.end_reason ===
              "side_effect_committed_local_persistence_failed",
        ),
      ).toBe(true);
      expect(
        writes.some(
          (write) =>
            write.table === "flow_runs" &&
            write.kind === "update" &&
            write.value.status === "completed",
        ),
      ).toBe(false);
    },
  );
});

describe("reprompt execution policy", () => {
  const fallbackPolicy = {
    on_unknown_reply: "reprompt" as const,
    max_reprompts: 2,
    on_timeout_hours: 24,
    on_exhaust: "handoff" as const,
  };

  function repromptGraph(messageConfig: Record<string, unknown>) {
    const entries = [
      node("menu", "send_buttons", {
        text: "Choose",
        buttons: [{ reply_id: "yes", title: "Yes", next_node_key: "success" }],
        ...messageConfig,
      }),
      node("success", "end", {}),
      node("recover", "end", {}),
    ];
    return new Map(entries.map((entry) => [entry.node_key, entry]));
  }

  it("does not persist an invalid collect_input value and reprompts the same node", async () => {
    h.sendText.mockResolvedValue({ whatsapp_message_id: "wamid-reprompt" });
    const { db, writes } = fakeDb();
    const nodes = new Map(
      [
        node("input", "collect_input", {
          prompt_text: "Email?",
          var_key: "email",
          validation: "email",
          next_node_key: "success",
        }),
        node("success", "end", {}),
      ].map((entry) => [entry.node_key, entry]),
    );

    const result = await handleReplyForActiveRun(
      db as never,
      run({ current_node_key: "input" }),
      { kind: "text", text: "not-an-email", meta_message_id: "invalid-1" },
      nodes,
      fallbackPolicy,
    );

    expect(result.outcome).toBe("fallback_fired");
    expect(h.sendText).toHaveBeenCalledTimes(1);
    expect(
      writes.some(
        (write) =>
          write.table === "flow_runs" &&
          write.kind === "update" &&
          "vars" in write.value,
      ),
    ).toBe(false);
  });

  it("persists a valid regex collect_input and advances", async () => {
    const activeRun = run({ current_node_key: "input" });
    const { db } = fakeDb();
    const nodes = new Map(
      [
        node("input", "collect_input", {
          prompt_text: "Code?",
          var_key: "code",
          validation: "regex",
          regex: "^[A-Z][A-Z][A-Z]-\\d\\d$",
          next_node_key: "success",
        }),
        node("success", "end", {}),
      ].map((entry) => [entry.node_key, entry]),
    );

    const result = await handleReplyForActiveRun(
      db as never,
      activeRun,
      { kind: "text", text: "ABC-12", meta_message_id: "valid-1" },
      nodes,
      fallbackPolicy,
    );

    expect(result.outcome).toBe("completed");
    expect(activeRun.vars).toEqual({ code: "ABC-12" });
  });

  it("retries a failed reprompt and increments reprompt_count once after success", async () => {
    h.sendButtons
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({ whatsapp_message_id: "wamid-reprompt" });
    const { db, writes } = fakeDb();

    const result = await handleReplyForActiveRun(
      db as never,
      run({ current_node_key: "menu" }),
      { kind: "text", text: "unknown", meta_message_id: "inbound-1" },
      repromptGraph({
        retry: { max_attempts: 2, interval_ms: 0, backoff: "fixed" },
      }),
      fallbackPolicy,
    );

    expect(result.outcome).toBe("fallback_fired");
    expect(h.sendButtons).toHaveBeenCalledTimes(2);
    expect(
      writes.filter(
        (write) =>
          write.table === "flow_runs" &&
          write.kind === "update" &&
          write.value.reprompt_count === 1,
      ),
    ).toHaveLength(1);
  });

  it("takes an exhausted reprompt error branch without failing or incrementing the reprompt count", async () => {
    h.sendButtons.mockRejectedValue(new Error("Z-API unavailable"));
    const { db, writes } = fakeDb();

    const result = await handleReplyForActiveRun(
      db as never,
      run({ current_node_key: "menu" }),
      { kind: "text", text: "unknown", meta_message_id: "inbound-2" },
      repromptGraph({
        on_error: "fail_branch",
        error_next_node_key: "recover",
      }),
      fallbackPolicy,
    );

    expect(result.outcome).toBe("completed");
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
          write.table === "flow_runs" &&
          write.kind === "update" &&
          "reprompt_count" in write.value,
      ),
    ).toBe(false);
  });

  it("fails safely instead of choosing an arbitrary button edge for default_value", async () => {
    h.sendButtons.mockRejectedValue(new Error("Z-API unavailable"));
    const activeRun = run({
      current_node_key: "menu",
      vars: { existing: true },
    });
    const { db, writes } = fakeDb();

    const result = await handleReplyForActiveRun(
      db as never,
      activeRun,
      { kind: "text", text: "unknown", meta_message_id: "inbound-default" },
      repromptGraph({
        on_error: "default_value",
        default_value: {
          key: "delivery",
          type: "string",
          value: "skipped",
        },
      }),
      fallbackPolicy,
    );

    expect(result.outcome).toBe("completed");
    expect(activeRun.vars).toEqual({ existing: true });
    expect(
      writes.some(
        (write) =>
          write.table === "flow_runs" &&
          write.kind === "update" &&
          write.value.status === "failed",
      ),
    ).toBe(true);
    expect(
      writes.some(
        (write) =>
          write.table === "flow_runs" &&
          write.kind === "update" &&
          write.value.status === "completed",
      ),
    ).toBe(false);
  });

  it("aborts a timed-out reprompt and does not retry it", async () => {
    const signals: AbortSignal[] = [];
    h.sendButtons.mockImplementation(
      (args: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const signal = args.signal!;
          signals.push(signal);
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const { db } = fakeDb();

    const result = await handleReplyForActiveRun(
      db as never,
      run({ current_node_key: "menu" }),
      { kind: "text", text: "unknown", meta_message_id: "inbound-3" },
      repromptGraph({
        retry: { max_attempts: 3, interval_ms: 0, backoff: "fixed" },
        timeout_ms: 100,
        on_error: "fail_branch",
        error_next_node_key: "recover",
      }),
      fallbackPolicy,
    );

    expect(result.outcome).toBe("completed");
    expect(h.sendButtons).toHaveBeenCalledTimes(1);
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(true);
  });

  it("writes one reprompt execution record for each attempt", async () => {
    h.sendButtons
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({ whatsapp_message_id: "wamid-reprompt" });
    const { db, writes } = fakeDb();

    await handleReplyForActiveRun(
      db as never,
      run({ current_node_key: "menu" }),
      { kind: "text", text: "unknown", meta_message_id: "inbound-4" },
      repromptGraph({
        retry: { max_attempts: 2, interval_ms: 0, backoff: "fixed" },
      }),
      fallbackPolicy,
    );

    expect(
      writes
        .filter(
          (write) =>
            write.table === "flow_node_executions" &&
            write.kind === "insert" &&
            write.value.node_key === "menu",
        )
        .map((write) => write.value.attempt),
    ).toEqual([1, 2]);
  });
});
