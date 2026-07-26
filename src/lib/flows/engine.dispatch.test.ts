import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  adminClient: vi.fn(),
  sendText: vi.fn(),
}));

vi.mock("./admin-client", () => ({
  supabaseAdmin: h.adminClient,
}));

vi.mock("./zapi-send", () => ({
  engineSendText: h.sendText,
  engineSendMedia: vi.fn(),
  engineSendInteractiveButtons: vi.fn(),
  engineSendInteractiveList: vi.fn(),
  persistCommittedOutbound: vi.fn(async () => undefined),
}));

vi.mock("@/lib/contacts/tag-events", () => ({
  addContactTagAndDispatch: vi.fn(),
}));

vi.mock("@/lib/contacts/tag-write", () => ({
  removeContactTag: vi.fn(),
}));

import { dispatchInboundToFlows } from "./engine";
import type { FlowRunRow } from "./types";
import type { FlowVersionGraph } from "./versions";

type Row = Record<string, unknown>;

interface ReceiptRow extends Row {
  id: string;
  account_id: string;
  contact_id: string;
  flow_run_id: string | null;
  flow_version_id: string;
  meta_message_id: string;
  from_node_key: string;
  from_visit_id: string;
  next_node_key: string;
  next_visit_id: string;
  transition_kind: string;
  recovery_state: "pending" | "completed";
  vars_after: Record<string, unknown>;
}

interface EffectRow extends Row {
  id: string;
  operation_id: string;
  status: "reserved" | "remote_committed" | "completed" | "ambiguous";
  result: Row | null;
  external_reference: string | null;
  invocation_token: string;
}

class Query {
  private operation: "select" | "insert" | "update" = "select";
  private value: Row | Row[] | null = null;
  private filters: Array<
    | { kind: "eq"; column: string; value: unknown }
    | { kind: "in"; column: string; value: unknown[] }
  > = [];
  private countExact = false;
  private head = false;
  private maxRows: number | null = null;

  constructor(
    private readonly state: DispatchState,
    private readonly table: string,
  ) {}

  select(
    columns = "*",
    options?: { count?: "exact"; head?: boolean },
  ) {
    void columns;
    this.countExact = options?.count === "exact";
    this.head = options?.head === true;
    return this;
  }

  insert(value: Row | Row[]) {
    this.operation = "insert";
    this.value = value;
    return this;
  }

  update(value: Row) {
    this.operation = "update";
    this.value = value;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ kind: "in", column, value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    void column;
    void options;
    return this;
  }

  limit(value: number) {
    this.maxRows = value;
    return this;
  }

  async maybeSingle() {
    const result = await this.execute();
    const rows = Array.isArray(result.data) ? result.data : [];
    return { data: rows[0] ?? null, error: result.error };
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?:
      | ((value: Awaited<ReturnType<Query["execute"]>>) => TResult1)
      | null,
    onrejected?: ((reason: unknown) => TResult2) | null,
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }

  private matches(row: Row) {
    return this.filters.every((filter) =>
      filter.kind === "eq"
        ? row[filter.column] === filter.value
        : filter.value.includes(row[filter.column]),
    );
  }

  private async execute(): Promise<{
    data: Row[] | null;
    error: { message: string } | null;
    count?: number;
  }> {
    if (this.operation === "insert") {
      const values = Array.isArray(this.value) ? this.value : [this.value!];
      const inserted = values.map((value) =>
        this.state.insert(this.table, value),
      );
      return { data: inserted, error: null };
    }
    if (this.operation === "update") {
      const updated = this.state
        .rows(this.table)
        .filter((row) => this.matches(row))
        .map((row) => {
          Object.assign(row, this.value);
          this.state.writes.push({
            table: this.table,
            kind: "update",
            value: this.value as Row,
          });
          return row;
        });
      return { data: updated, error: null };
    }
    let rows = this.state.rows(this.table).filter((row) => this.matches(row));
    if (this.maxRows !== null) rows = rows.slice(0, this.maxRows);
    if (this.countExact) {
      return {
        data: this.head ? null : rows,
        error: null,
        count: rows.length,
      };
    }
    return { data: rows, error: null };
  }
}

class DispatchState {
  runs: FlowRunRow[] = [];
  receipts: ReceiptRow[] = [];
  effects = new Map<string, EffectRow>();
  versions: Row[] = [];
  flows: Row[] = [];
  conversations: Row[] = [
    { id: "conversation-1", status: "open" },
  ];
  messages: Row[] = [{ id: "message-1", message_id: "wamid-public" }];
  events: Row[] = [];
  executions: Row[] = [];
  writes: Array<{ table: string; kind: string; value: Row }> = [];
  rpcCalls: Array<{ name: string; value: Row }> = [];
  failCursorOnce = false;
  terminalizeOnCursorFailure = false;
  loseCursorResponseOnce = false;
  loseEffectCommitResponseOnce = false;
  loseReplyCommitResponseOnce = false;
  failRepromptFinalizeOnce = false;
  loseRepromptFinalizeResponseOnce = false;
  fallbackFailure: "none" | "before_commit_once" | "after_commit_once" =
    "none";
  private sequence = 10;

  from = (table: string) => new Query(this, table);

  rows(table: string): Row[] {
    if (table === "flow_runs") return this.runs as unknown as Row[];
    if (table === "flow_reply_transitions") return this.receipts;
    if (table === "flow_node_effects") {
      return [...this.effects.values()];
    }
    if (table === "flow_versions") return this.versions;
    if (table === "flows") return this.flows;
    if (table === "conversations") return this.conversations;
    if (table === "messages") return this.messages;
    if (table === "flow_run_events") return this.events;
    if (table === "flow_node_executions") return this.executions;
    return [];
  }

  insert(table: string, value: Row): Row {
    const row = { ...value };
    if (table === "flow_run_events") {
      row.id = `event-${this.events.length + 1}`;
      this.events.push(row);
    } else if (table === "flow_node_executions") {
      row.id = `execution-${this.executions.length + 1}`;
      this.executions.push(row);
    } else if (table === "flow_runs") {
      row.id = `new-run-${this.runs.length + 1}`;
      this.runs.push(row as unknown as FlowRunRow);
    }
    this.writes.push({ table, kind: "insert", value: row });
    return row;
  }

  private nextUuid(prefix: string) {
    this.sequence += 1;
    return `${prefix}-0000-4000-8000-${String(this.sequence).padStart(
      12,
      "0",
    )}`;
  }

  private runById(id: unknown) {
    return this.runs.find((run) => run.id === id);
  }

  private effectById(id: unknown) {
    return [...this.effects.values()].find((effect) => effect.id === id);
  }

  rpc = async (name: string, value: Row) => {
    this.rpcCalls.push({ name, value });
    if (name === "commit_flow_reply_transition") {
      const existing = this.receipts.find(
        (receipt) =>
          receipt.account_id === this.runById(value.p_run_id)?.account_id &&
          receipt.contact_id === this.runById(value.p_run_id)?.contact_id &&
          receipt.meta_message_id === value.p_meta_message_id,
      );
      if (existing) {
        const run = this.runById(existing.flow_run_id);
        return {
          data: run
            ? [
                {
                  ...run,
                  next_node_key: existing.next_node_key,
                  run_vars: run.vars,
                  duplicate: true,
                },
              ]
            : [],
          error: null,
        };
      }
      const run = this.runById(value.p_run_id)!;
      const nextVisit = this.nextUuid("reply");
      const receipt: ReceiptRow = {
        id: `receipt-${this.receipts.length + 1}`,
        account_id: run.account_id,
        contact_id: run.contact_id!,
        flow_run_id: run.id,
        flow_version_id: run.flow_version_id,
        meta_message_id: value.p_meta_message_id as string,
        from_node_key: value.p_expected_node_key as string,
        from_visit_id: value.p_expected_visit_id as string,
        next_node_key: value.p_next_node_key as string,
        next_visit_id: nextVisit,
        transition_kind: "reply_branch",
        recovery_state: "pending",
        vars_after: (value.p_vars as Row | null) ?? run.vars,
      };
      this.receipts.push(receipt);
      run.vars = receipt.vars_after;
      run.reprompt_count = 0;
      run.current_node_key = receipt.next_node_key;
      run.current_visit_id = receipt.next_visit_id;
      run.continuation_step = (run.continuation_step ?? 0) + 1;
      if (this.loseReplyCommitResponseOnce) {
        this.loseReplyCommitResponseOnce = false;
        return {
          data: null,
          error: { message: "reply commit response lost" },
        };
      }
      return {
        data: [
          {
            ...run,
            next_node_key: receipt.next_node_key,
            run_vars: run.vars,
            duplicate: false,
          },
        ],
        error: null,
      };
    }
    if (name === "reserve_flow_node_effect") {
      const key = [
        value.p_visit_id,
        value.p_node_key,
        value.p_effect_kind,
      ].join(":");
      let effect = this.effects.get(key);
      if (!effect) {
        effect = {
          id: this.nextUuid("effect"),
          operation_id: this.nextUuid("operation"),
          status: "reserved",
          result: null,
          external_reference: null,
          invocation_token: value.p_invocation_token as string,
        };
        this.effects.set(key, effect);
      }
      return {
        data: [
          {
            ...effect,
            is_owner:
              effect.invocation_token === value.p_invocation_token,
          },
        ],
        error: null,
      };
    }
    if (name === "mark_flow_node_effect_committed") {
      const effect = this.effectById(value.p_effect_id)!;
      effect.status = "remote_committed";
      effect.result = value.p_result as Row;
      effect.external_reference =
        (value.p_external_reference as string | null) ?? null;
      if (this.loseEffectCommitResponseOnce) {
        this.loseEffectCommitResponseOnce = false;
        return {
          data: null,
          error: { message: "effect commit response lost" },
        };
      }
      return { data: [{ ...effect }], error: null };
    }
    if (name === "complete_flow_node_effect") {
      const effect = this.effectById(value.p_effect_id)!;
      effect.status = "completed";
      return { data: true, error: null };
    }
    if (name === "mark_flow_node_effect_ambiguous") {
      const effect = this.effectById(value.p_effect_id)!;
      effect.status = "ambiguous";
      return { data: true, error: null };
    }
    if (name === "reconcile_flow_node_effect_recovery") {
      const run = this.runById(value.p_run_id)!;
      const effect = this.effectById(value.p_effect_id)!;
      if (effect.status === "completed") {
        return {
          data: [{ outcome: "completed", run_row: { ...run } }],
          error: null,
        };
      }
      if (
        effect.status === "remote_committed" &&
        run.current_node_key === value.p_expected_node_key &&
        run.current_visit_id === value.p_expected_visit_id &&
        (run.continuation_id ?? null) ===
          (value.p_expected_continuation_id ?? null) &&
        ["active", "resuming", "needs_recovery"].includes(run.status)
      ) {
        run.status = "needs_recovery";
        run.end_reason =
          "side_effect_committed_local_persistence_failed";
        return {
          data: [
            { outcome: "recovery_required", run_row: { ...run } },
          ],
          error: null,
        };
      }
      return {
        data: [{ outcome: "stale", run_row: { ...run } }],
        error: null,
      };
    }
    if (name === "mark_flow_run_cursor_recovery") {
      const run = this.runById(value.p_run_id)!;
      if (
        run.current_node_key === value.p_expected_node_key &&
        run.current_visit_id === value.p_expected_visit_id &&
        (run.continuation_id ?? null) ===
          (value.p_expected_continuation_id ?? null) &&
        ["active", "resuming", "needs_recovery"].includes(run.status)
      ) {
        run.status = "needs_recovery";
        run.end_reason = value.p_reason as string;
        return { data: [{ ...run }], error: null };
      }
      return { data: [], error: null };
    }
    if (name === "advance_flow_run_cursor") {
      if (this.failCursorOnce) {
        this.failCursorOnce = false;
        if (this.terminalizeOnCursorFailure) {
          this.runById(value.p_run_id)!.status = "completed";
        }
        return { data: null, error: { message: "cursor unavailable" } };
      }
      const run = this.runById(value.p_run_id)!;
      if (
        run.current_node_key !== value.p_expected_node_key ||
        run.current_visit_id !== value.p_expected_visit_id
      ) {
        return { data: [], error: null };
      }
      run.current_node_key = value.p_next_node_key as string;
      run.current_visit_id = this.nextUuid("cursor");
      run.continuation_step = (run.continuation_step ?? 0) + 1;
      if (run.status === "needs_recovery") run.status = "active";
      if (this.loseCursorResponseOnce) {
        this.loseCursorResponseOnce = false;
        return {
          data: null,
          error: { message: "cursor response lost" },
        };
      }
      return { data: [{ ...run }], error: null };
    }
    if (name === "finalize_flow_reprompt_effect") {
      if (this.failRepromptFinalizeOnce) {
        this.failRepromptFinalizeOnce = false;
        return {
          data: null,
          error: { message: "reprompt finalize unavailable" },
        };
      }
      const run = this.runById(value.p_run_id)!;
      const effect = this.effectById(value.p_effect_id)!;
      const nextVisit = this.nextUuid("reprompt");
      this.receipts.push({
        id: `receipt-${this.receipts.length + 1}`,
        account_id: run.account_id,
        contact_id: run.contact_id!,
        flow_run_id: run.id,
        flow_version_id: run.flow_version_id,
        meta_message_id: value.p_meta_message_id as string,
        from_node_key: value.p_expected_node_key as string,
        from_visit_id: value.p_expected_visit_id as string,
        next_node_key: value.p_expected_node_key as string,
        next_visit_id: nextVisit,
        transition_kind: "reprompt",
        recovery_state: "completed",
        vars_after: run.vars,
      });
      run.reprompt_count = value.p_reprompt_count as number;
      run.current_visit_id = nextVisit;
      run.status = "active";
      effect.status = "completed";
      if (this.loseRepromptFinalizeResponseOnce) {
        this.loseRepromptFinalizeResponseOnce = false;
        return {
          data: null,
          error: { message: "reprompt finalize response lost" },
        };
      }
      return { data: [{ ...run }], error: null };
    }
    if (name === "finalize_flow_fallback_decision") {
      if (this.fallbackFailure === "before_commit_once") {
        this.fallbackFailure = "none";
        return {
          data: null,
          error: { message: "fallback finalize unavailable" },
        };
      }
      const run = this.runById(value.p_run_id)!;
      const decision = value.p_decision as "ignore" | "handoff" | "end";
      this.receipts.push({
        id: `receipt-${this.receipts.length + 1}`,
        account_id: run.account_id,
        contact_id: run.contact_id!,
        flow_run_id: run.id,
        flow_version_id: run.flow_version_id,
        meta_message_id: value.p_meta_message_id as string,
        from_node_key: value.p_expected_node_key as string,
        from_visit_id: value.p_expected_visit_id as string,
        next_node_key: value.p_expected_node_key as string,
        next_visit_id: value.p_expected_visit_id as string,
        transition_kind: `fallback_${decision}`,
        recovery_state: "completed",
        vars_after: run.vars,
      });
      run.reprompt_count = value.p_reprompt_count as number;
      if (decision === "handoff") {
        run.status = "handed_off";
        this.conversations[0].status = "pending";
      } else if (decision === "end") {
        run.status = "completed";
      } else {
        run.status = "active";
      }
      const response = { data: [{ ...run }], error: null };
      if (this.fallbackFailure === "after_commit_once") {
        this.fallbackFailure = "none";
        return {
          data: null,
          error: { message: "fallback response lost" },
        };
      }
      return response;
    }
    return { data: [{ id: "ok" }], error: null };
  };
}

function graph(
  options: {
    nextNode?: "send" | "end";
    maxReprompts?: number;
    onExhaust?: "handoff" | "end";
  } = {},
): FlowVersionGraph {
  const nextNode = options.nextNode ?? "send";
  const nodes: FlowVersionGraph["nodes"] = [
    {
      node_key: "input",
      node_type: "collect_input",
      config: {
        prompt_text: "Code?",
        var_key: "code",
        next_node_key: nextNode,
      },
      position_x: 0,
      position_y: 0,
    },
    {
      node_key: "end",
      node_type: "end",
      config: {},
      position_x: 100,
      position_y: 0,
    },
  ];
  if (nextNode === "send") {
    nodes.splice(1, 0, {
      node_key: "send",
      node_type: "send_message",
      config: { text: "Captured {{vars.code}}", next_node_key: "end" },
      position_x: 50,
      position_y: 0,
    });
  }
  return {
    schema_version: 1,
    trigger: {
      type: "keyword",
      config: { keywords: ["go"], match_type: "exact" },
    },
    entry_node_key: "input",
    fallback_policy: {
      on_unknown_reply: "reprompt",
      max_reprompts: options.maxReprompts ?? 2,
      on_timeout_hours: 24,
      on_exhaust: options.onExhaust ?? "handoff",
    },
    variable_schema: [],
    nodes,
  };
}

function run(
  overrides: Partial<FlowRunRow> = {},
): FlowRunRow {
  return {
    id: "run-1",
    flow_id: "flow-1",
    flow_version_id: "version-1",
    account_id: "account-1",
    user_id: "user-1",
    contact_id: "contact-1",
    conversation_id: "conversation-1",
    status: "active",
    current_node_key: "input",
    current_visit_id: "visit-input-1",
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

function prepare(
  state: DispatchState,
  activeRun: FlowRunRow | null,
  flowGraph = graph(),
) {
  if (activeRun) state.runs.push(activeRun);
  state.versions.push({
    id: "version-1",
    flow_id: "flow-1",
    graph: flowGraph,
  });
  state.flows.push({
    id: "flow-1",
    account_id: "account-1",
    user_id: "user-1",
    name: "Flow",
    status: "active",
    trigger_type: "keyword",
    trigger_config: { keywords: ["go"], match_type: "exact" },
    entry_node_id: "input",
    fallback_policy: flowGraph.fallback_policy,
    published_version_id: "version-1",
    draft_revision: 1,
    variable_schema: [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });
  h.adminClient.mockReturnValue(state);
}

function inbound(metaMessageId: string, text: string) {
  return {
    accountId: "account-1",
    userId: "user-1",
    contactId: "contact-1",
    conversationId: "conversation-1",
    message: {
      kind: "text" as const,
      text,
      meta_message_id: metaMessageId,
    },
    isFirstInboundMessage: false,
  };
}

beforeEach(() => {
  h.adminClient.mockReset();
  h.sendText.mockReset();
  h.sendText.mockImplementation(
    async (args: {
      onRemoteCommitted?: (
        result: { whatsapp_message_id: string },
      ) => Promise<void>;
    }) => {
      const result = { whatsapp_message_id: "wamid-public" };
      await args.onRemoteCommitted?.(result);
      return result;
    },
  );
});

describe("public flow dispatcher recovery protocol", () => {
  it.each([
    "effect_commit",
    "cursor_advance",
    "reply_commit",
  ] as const)(
    "continues after a committed %s response is lost",
    async (lostPhase) => {
      const state = new DispatchState();
      state.loseEffectCommitResponseOnce = lostPhase === "effect_commit";
      state.loseCursorResponseOnce = lostPhase === "cursor_advance";
      state.loseReplyCommitResponseOnce = lostPhase === "reply_commit";
      prepare(state, run());

      const result = await dispatchInboundToFlows(
        inbound(`lost-${lostPhase}`, "stable"),
      );

      expect(result.outcome).toBe("completed");
      expect(state.runs[0].status).toBe("completed");
      expect(state.runs[0].vars).toEqual({ code: "stable" });
      expect(h.sendText).toHaveBeenCalledTimes(1);
      expect(
        state.writes.some(
          (write) =>
            write.table === "flow_runs" &&
            write.value.status === "failed",
        ),
      ).toBe(false);
    },
  );

  it("continues after a committed reprompt finalize response is lost", async () => {
    const state = new DispatchState();
    state.loseRepromptFinalizeResponseOnce = true;
    prepare(state, run());

    const result = await dispatchInboundToFlows(
      inbound("lost-reprompt-finalize", ""),
    );

    expect(result.outcome).toBe("fallback_fired");
    expect(state.runs[0].status).toBe("active");
    expect(state.runs[0].reprompt_count).toBe(1);
    expect(state.effects.values().next().value?.status).toBe("completed");
    expect(h.sendText).toHaveBeenCalledTimes(1);

    const duplicate = await dispatchInboundToFlows(
      inbound("lost-reprompt-finalize", ""),
    );
    expect(duplicate.outcome).toBe("duplicate_inbound_ignored");
    expect(h.sendText).toHaveBeenCalledTimes(1);
  });

  it("recovers the first downstream effect from the receipt cursor", async () => {
    const state = new DispatchState();
    state.failCursorOnce = true;
    prepare(state, run());

    const first = await dispatchInboundToFlows(inbound("reply-1", "ABC"));
    expect(first.consumed).toBe(true);
    expect(state.runs[0].status).toBe("needs_recovery");
    expect(state.receipts[0]).toMatchObject({
      meta_message_id: "reply-1",
      transition_kind: "reply_branch",
      recovery_state: "pending",
    });

    const recovered = await dispatchInboundToFlows(
      inbound("reply-1", "different"),
    );
    expect(recovered.outcome).toBe("completed");
    expect(h.sendText).toHaveBeenCalledTimes(1);
    expect(state.runs[0].vars).toEqual({ code: "ABC" });
    expect(state.runs[0].status).toBe("completed");
  });

  it("does not overwrite terminal state while reconciling a stale effect phase", async () => {
    const state = new DispatchState();
    state.failCursorOnce = true;
    state.terminalizeOnCursorFailure = true;
    prepare(state, run());

    const result = await dispatchInboundToFlows(
      inbound("terminal-race", "stable"),
    );

    expect(result.outcome).toBe("completed");
    expect(state.runs[0].status).toBe("completed");
    expect(
      state.rpcCalls.filter(
        (call) => call.name === "reconcile_flow_node_effect_recovery",
      ),
    ).toHaveLength(1);
  });

  it("recovers a remote-committed reprompt on a reachable public status", async () => {
    const state = new DispatchState();
    state.failRepromptFinalizeOnce = true;
    prepare(state, run());

    const first = await dispatchInboundToFlows(inbound("invalid-1", ""));
    expect(first.consumed).toBe(true);
    expect(state.runs[0].status).toBe("needs_recovery");
    expect(state.runs[0].reprompt_count).toBe(0);

    const recovered = await dispatchInboundToFlows(
      inbound("invalid-1", ""),
    );
    expect(recovered.outcome).toBe("fallback_fired");
    expect(state.runs[0].status).toBe("active");
    expect(state.runs[0].reprompt_count).toBe(1);
    expect(h.sendText).toHaveBeenCalledTimes(1);

    const duplicate = await dispatchInboundToFlows(
      inbound("invalid-1", ""),
    );
    expect(duplicate.outcome).toBe("duplicate_inbound_ignored");
    expect(h.sendText).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: "late active cursor",
      status: "active" as const,
      currentKey: "input",
      currentVisit: "visit-later",
      hasRun: true,
    },
    {
      label: "failed run",
      status: "failed" as const,
      currentKey: "end",
      currentVisit: "receipt-next",
      hasRun: true,
    },
    {
      label: "completed run",
      status: "completed" as const,
      currentKey: "end",
      currentVisit: "receipt-next",
      hasRun: true,
    },
    {
      label: "deleted run",
      status: "completed" as const,
      currentKey: "end",
      currentVisit: "receipt-next",
      hasRun: false,
    },
  ])(
    "never starts a new flow for a received inbound with $label",
    async ({ status, currentKey, currentVisit, hasRun }) => {
      const state = new DispatchState();
      const existing = hasRun
        ? run({
            status,
            current_node_key: currentKey,
            current_visit_id: currentVisit,
          })
        : null;
      prepare(state, existing);
      state.receipts.push({
        id: "receipt-existing",
        account_id: "account-1",
        contact_id: "contact-1",
        flow_run_id: hasRun ? "run-1" : null,
        flow_version_id: "version-1",
        meta_message_id: "received-1",
        from_node_key: "input",
        from_visit_id: "visit-input-1",
        next_node_key: "end",
        next_visit_id: "receipt-next",
        transition_kind: "reply_branch",
        recovery_state: "pending",
        vars_after: { code: "original" },
      });

      const result = await dispatchInboundToFlows(
        inbound("received-1", "go"),
      );

      expect(result.outcome).toBe("duplicate_inbound_ignored");
      expect(
        state.writes.filter(
          (write) => write.table === "flow_runs" && write.kind === "insert",
        ),
      ).toHaveLength(0);
    },
  );

  it("recovers a resuming run only at the receipt's exact cursor", async () => {
    const state = new DispatchState();
    prepare(
      state,
      run({
        status: "resuming",
        current_node_key: "end",
        current_visit_id: "receipt-next",
        continuation_id: "continuation-1",
        continuation_phase: "running",
      }),
      graph({ nextNode: "end" }),
    );
    state.receipts.push({
      id: "receipt-resuming",
      account_id: "account-1",
      contact_id: "contact-1",
      flow_run_id: "run-1",
      flow_version_id: "version-1",
      meta_message_id: "resume-1",
      from_node_key: "input",
      from_visit_id: "visit-input-1",
      next_node_key: "end",
      next_visit_id: "receipt-next",
      transition_kind: "reply_branch",
      recovery_state: "pending",
      vars_after: { code: "stable" },
    });

    const result = await dispatchInboundToFlows(
      inbound("resume-1", "changed"),
    );
    expect(result.outcome).toBe("completed");
    expect(state.runs[0].status).toBe("completed");
  });

  it("retries an exhaustion decision that failed before the atomic commit", async () => {
    const state = new DispatchState();
    state.fallbackFailure = "before_commit_once";
    prepare(state, run({ reprompt_count: 2 }), graph({ maxReprompts: 2 }));

    const first = await dispatchInboundToFlows(inbound("exhaust-1", ""));
    expect(first.consumed).toBe(true);
    expect(state.runs[0].status).toBe("needs_recovery");

    const recovered = await dispatchInboundToFlows(
      inbound("exhaust-1", ""),
    );
    expect(recovered.outcome).toBe("handed_off");
    expect(state.runs[0].status).toBe("handed_off");
    expect(state.runs[0].reprompt_count).toBe(3);
    expect(state.conversations[0].status).toBe("pending");
    expect(
      state.rpcCalls.filter(
        (call) => call.name === "finalize_flow_fallback_decision",
      ),
    ).toHaveLength(2);
  });

  it("recognizes an exhaustion commit whose response was lost", async () => {
    const state = new DispatchState();
    state.fallbackFailure = "after_commit_once";
    prepare(
      state,
      run({ reprompt_count: 2 }),
      graph({ maxReprompts: 2, onExhaust: "end" }),
    );

    const first = await dispatchInboundToFlows(inbound("exhaust-2", ""));
    expect(first.outcome).toBe("completed");
    expect(state.runs[0].status).toBe("completed");

    const duplicate = await dispatchInboundToFlows(
      inbound("exhaust-2", "go"),
    );
    expect(duplicate.outcome).toBe("duplicate_inbound_ignored");
    expect(
      state.writes.filter(
        (write) => write.table === "flow_runs" && write.kind === "insert",
      ),
    ).toHaveLength(0);
    expect(
      state.rpcCalls.filter(
        (call) => call.name === "finalize_flow_fallback_decision",
      ),
    ).toHaveLength(1);
  });
});
