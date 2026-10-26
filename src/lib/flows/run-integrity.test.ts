import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeTables } from "./fake-db.test-helper";

const h = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  sendText: vi.fn(async () => ({ whatsapp_message_id: "wamid.text" })),
  sendButtons: vi.fn(async () => ({ whatsapp_message_id: "wamid.buttons" })),
}));

vi.mock("./admin-client", async () => {
  const { createFakeDb } = await import("./fake-db.test-helper");
  return { supabaseAdmin: () => createFakeDb(h.tables as FakeTables) };
});

vi.mock("./meta-send", () => ({
  engineSendText: h.sendText,
  engineSendMedia: vi.fn(async () => ({ whatsapp_message_id: "wamid.media" })),
  engineSendInteractiveButtons: h.sendButtons,
  engineSendInteractiveList: vi.fn(async () => ({ whatsapp_message_id: "wamid.list" })),
}));

import { closureForActiveRun, dispatchInboundToFlows } from "./engine";
import type { ParsedInbound } from "./types";

const HOUR = 60 * 60 * 1000;

function menuFlow(status: string, onTimeoutHours = 24) {
  return {
    id: "flow-menu",
    account_id: "acct-1",
    user_id: "u-1",
    status,
    trigger_type: "manual",
    trigger_config: {},
    entry_node_id: "menu",
    fallback_policy: { on_timeout_hours: onTimeoutHours },
    created_at: "2026-01-01T00:00:00Z",
  };
}

const GREETING_FLOW = {
  id: "flow-greet",
  account_id: "acct-1",
  user_id: "u-1",
  status: "active",
  trigger_type: "keyword",
  trigger_config: { keywords: ["hi"] },
  entry_node_id: "greet",
  fallback_policy: {},
  created_at: "2026-01-02T00:00:00Z",
};

const NODES = [
  {
    flow_id: "flow-menu",
    node_key: "menu",
    node_type: "send_buttons",
    config: {
      text: "Pick one",
      buttons: [{ reply_id: "a", title: "A", next_node_key: "thanks" }],
    },
  },
  {
    flow_id: "flow-menu",
    node_key: "thanks",
    node_type: "send_message",
    config: { text: "Thanks", next_node_key: "done" },
  },
  { flow_id: "flow-menu", node_key: "done", node_type: "end", config: {} },
  {
    flow_id: "flow-greet",
    node_key: "greet",
    node_type: "send_message",
    config: { text: "Hello", next_node_key: "bye" },
  },
  { flow_id: "flow-greet", node_key: "bye", node_type: "end", config: {} },
];

function activeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    flow_id: "flow-menu",
    account_id: "acct-1",
    user_id: "u-1",
    contact_id: "ct-1",
    conversation_id: "cv-1",
    status: "active",
    current_node_key: "menu",
    transition_seq: 0,
    vars: {},
    reprompt_count: 0,
    started_at: new Date().toISOString(),
    last_advanced_at: new Date().toISOString(),
    ...overrides,
  };
}

function dispatch(message: ParsedInbound) {
  return dispatchInboundToFlows({
    accountId: "acct-1",
    userId: "u-1",
    contactId: "ct-1",
    conversationId: "cv-1",
    message,
    isFirstInboundMessage: false,
  });
}

const tap = (id: string): ParsedInbound => ({
  kind: "interactive_reply",
  reply_id: "a",
  reply_title: "A",
  meta_message_id: id,
});

const hi: ParsedInbound = { kind: "text", text: "hi", meta_message_id: "m-hi" };

function run(id: string) {
  return h.tables.flow_runs.find((r) => r.id === id)!;
}

function setup(flowStatus: string, runOverrides: Record<string, unknown> = {}, onTimeoutHours = 24) {
  h.tables = {
    flows: [menuFlow(flowStatus, onTimeoutHours), GREETING_FLOW],
    flow_nodes: structuredClone(NODES),
    flow_runs: [activeRun(runOverrides)],
    flow_run_events: [],
    messages: [],
  };
}

beforeEach(() => {
  h.sendText.mockClear();
  h.sendButtons.mockClear();
});

describe("closureForActiveRun", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  const fresh = { current_node_key: "menu", last_advanced_at: "2026-10-16T11:00:00Z" };
  const keys = new Set(["menu"]);
  const flow = { status: "active" as const, fallback_policy: menuFlow("active").fallback_policy as never };

  it("keeps a healthy run going", () => {
    expect(closureForActiveRun({ run: fresh, flow, nodeKeys: keys, now })).toBeNull();
  });

  it("cancels runs of a flow that is no longer active", () => {
    for (const status of ["draft", "archived"] as const) {
      expect(
        closureForActiveRun({ run: fresh, flow: { ...flow, status }, nodeKeys: keys, now }),
      ).toEqual({ kind: "cancel", reason: "flow_not_active" });
    }
    expect(closureForActiveRun({ run: fresh, flow: null, nodeKeys: keys, now })).toMatchObject({
      kind: "cancel",
    });
  });

  it("times out a run idle past the flow's cutoff", () => {
    const stale = { ...fresh, last_advanced_at: "2026-10-15T11:00:00Z" };
    expect(closureForActiveRun({ run: stale, flow, nodeKeys: keys, now })).toMatchObject({
      kind: "timeout",
    });
  });

  it("cancels a run whose current node was removed by an edit", () => {
    expect(
      closureForActiveRun({ run: fresh, flow, nodeKeys: new Set(["other"]), now }),
    ).toEqual({ kind: "cancel", reason: "current_node_removed" });
  });
});

describe("dispatchInboundToFlows run integrity", () => {
  it("ends a run of an archived flow and lets the inbound start a matching flow", async () => {
    setup("archived");
    const result = await dispatch(hi);
    expect(run("run-1")).toMatchObject({ status: "cancelled", end_reason: "flow_not_active" });
    expect(result).toMatchObject({ consumed: true, outcome: "completed" });
    expect(h.tables.flow_runs.find((r) => r.flow_id === "flow-greet")).toMatchObject({ status: "completed" });
    expect(h.sendText).toHaveBeenCalledTimes(1);
  });

  it("does not advance a paused flow's run on a tap", async () => {
    setup("draft");
    const result = await dispatch(tap("m-1"));
    expect(run("run-1").status).toBe("cancelled");
    expect(result).toEqual({ consumed: false, outcome: "no_match" });
    expect(h.sendText).not.toHaveBeenCalled();
  });

  it("times out a stale run inline and falls through to entry triggers", async () => {
    setup("active", { last_advanced_at: new Date(Date.now() - 2 * HOUR).toISOString() }, 1);
    const result = await dispatch(hi);
    expect(run("run-1")).toMatchObject({ status: "timed_out", end_reason: "timed_out_on_reply" });
    expect(
      h.tables.flow_run_events.filter((e) => e.event_type === "timeout" && e.flow_run_id === "run-1"),
    ).toHaveLength(1);
    expect(result).toMatchObject({ consumed: true, outcome: "completed" });
  });

  it("cancels a run whose current node no longer exists", async () => {
    setup("active", { current_node_key: "deleted_node" });
    const result = await dispatch(tap("m-1"));
    expect(run("run-1")).toMatchObject({ status: "cancelled", end_reason: "current_node_removed" });
    expect(result).toEqual({ consumed: false, outcome: "no_match" });
  });

  it("advances only once when two taps on the same menu arrive together", async () => {
    setup("active");
    const results = await Promise.all([dispatch(tap("m-1")), dispatch(tap("m-2"))]);
    expect(h.sendText).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.outcome).sort()).toEqual(["completed", "duplicate_inbound_ignored"]);
    expect(run("run-1")).toMatchObject({ status: "completed", transition_seq: 1 });
  });

  it("still advances a single tap normally", async () => {
    setup("active");
    const result = await dispatch(tap("m-1"));
    expect(result).toMatchObject({ consumed: true, outcome: "completed" });
    expect(h.sendText).toHaveBeenCalledTimes(1);
  });
});
