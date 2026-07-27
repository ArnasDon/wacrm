import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  adminClient: vi.fn(),
  sendText: vi.fn(),
  httpRequest: vi.fn(),
  addTag: vi.fn(),
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
  addContactTagAndDispatch: h.addTag,
}));

vi.mock("@/lib/contacts/tag-write", () => ({
  removeContactTag: vi.fn(),
}));

vi.mock("./http-request", async (importOriginal) => {
  const original = await importOriginal<typeof import("./http-request")>();
  return { ...original, executeHttpRequest: h.httpRequest };
});

import { dispatchInboundToFlows } from "./engine";
import { resumeDueFlowWaits } from "./wait-runtime";
import type { FlowRunRow } from "./types";
import {
  parseFlowVersionGraph,
  type FlowVersionGraph,
} from "./versions";

type Row = Record<string, unknown>;

function legacyGraph(value: unknown): FlowVersionGraph {
  return parseFlowVersionGraph(value);
}

function setEntryTriggerNext(
  flowGraph: FlowVersionGraph,
  nextNodeKey: string,
): void {
  const trigger = flowGraph.nodes.find(
    (node) => node.node_key === flowGraph.entry_node_key,
  );
  if (!trigger) throw new Error("test graph missing entry trigger");
  trigger.config = { ...trigger.config, next_node_key: nextNodeKey };
}

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

interface FrameRow extends Row {
  id: string;
  depth: number;
  parent_flow_id: string;
  parent_flow_version_id: string;
  parent_node_key: string;
  return_node_key: string;
  parent_vars: Record<string, unknown>;
  child_flow_id: string;
  child_flow_version_id: string;
  error_policy: {
    on_error: "fail_run" | "fail_branch" | "default_value";
    error_next_node_key?: string;
    default_value?: { key: string; type: string; value: unknown };
  };
  state: "active" | "completed" | "failed";
  completed_child_visit_id?: string;
  failure_reason?: string;
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
    if (
      this.operation === "select" &&
      this.table === "flow_node_effects" &&
      this.state.effectReadFailures > 0
    ) {
      this.state.effectReadFailures -= 1;
      return {
        data: null,
        error: { message: "effect read unavailable" },
      };
    }
    if (
      this.operation === "select" &&
      this.table === "flow_runs" &&
      this.state.runReadFailures > 0
    ) {
      this.state.runReadFailures -= 1;
      return {
        data: null,
        error: { message: "run read unavailable" },
      };
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
  frames: FrameRow[] = [];
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
  cursorResponseFailures = 0;
  commitFirstPersistentCursorFailure = false;
  private persistentCursorCommitted = false;
  variableTransitionResponseFailures = 0;
  commitFirstVariableTransitionFailure = false;
  private variableTransitionCommitted = false;
  loseEffectCommitResponseOnce = false;
  effectCommitResponseFailures = 0;
  completeEffectResponseFailures = 0;
  commitFirstCompleteEffectFailure = false;
  private completeEffectCommitted = false;
  effectReadFailures = 0;
  effectReadFailuresAfterCommit = 0;
  runReadFailures = 0;
  runReadFailuresAfterCursorLoss = 0;
  loseReplyCommitResponseOnce = false;
  failRepromptFinalizeOnce = false;
  loseRepromptFinalizeResponseOnce = false;
  loseFailFrameResponseOnce = false;
  fallbackFailure: "none" | "before_commit_once" | "after_commit_once" =
    "none";
  private sequence = 10;
  waitEnabled = false;
  waitStatus: "pending" | "claimed" | "resumed" = "pending";
  waitNextNodeKey = "send";
  waitFlowVersionId = "version-1";
  waitNodeKey = "wait";
  readonly waitResumeId =
    "90000000-0000-4000-8000-000000000001";

  from = (table: string) => new Query(this, table);

  rows(table: string): Row[] {
    if (table === "flow_runs") return this.runs as unknown as Row[];
    if (table === "flow_reply_transitions") return this.receipts;
    if (table === "flow_node_effects") {
      return [...this.effects.values()];
    }
    if (table === "flow_call_frames") return this.frames;
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
      row.current_visit_id ??= this.nextUuid("visit");
      row.continuation_id ??= null;
      row.continuation_phase ??= "idle";
      row.continuation_step ??= 0;
      row.last_prompt_message_id ??= null;
      row.reprompt_count ??= 0;
      row.started_at ??= "2026-01-01T00:00:00.000Z";
      row.last_advanced_at ??= "2026-01-01T00:00:00.000Z";
      row.ended_at ??= null;
      row.end_reason ??= null;
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
    if (name === "end_flow_run_if_owned") {
      const run = this.runById(value.p_run_id);
      const activeVersionId =
        run?.active_flow_version_id ?? run?.flow_version_id;
      const matchesOwnedCursor =
        run !== undefined &&
        activeVersionId === value.p_active_flow_version_id &&
        run.status === value.p_expected_status &&
        (run.current_node_key ?? null) ===
          (value.p_expected_node_key ?? null) &&
        (run.current_visit_id ?? null) ===
          (value.p_expected_visit_id ?? null) &&
        (run.continuation_id ?? null) ===
          (value.p_expected_continuation_id ?? null);

      if (!run || !matchesOwnedCursor) {
        return { data: false, error: null };
      }

      run.status = value.p_target_status as FlowRunRow["status"];
      run.ended_at = "2026-01-01T00:00:00.000Z";
      run.end_reason = value.p_reason as string;
      return { data: true, error: null };
    }
    if (name === "claim_due_flow_waits") {
      if (!this.waitEnabled || this.waitStatus === "resumed") {
        return { data: [], error: null };
      }
      this.waitStatus = "claimed";
      return {
        data: [
          {
            id: "wait-1",
            flow_run_id: "run-1",
            flow_version_id: this.waitFlowVersionId,
            node_key: this.waitNodeKey,
            next_node_key: this.waitNextNodeKey,
            claim_token: "claim-1",
            resume_id: this.waitResumeId,
          },
        ],
        error: null,
      };
    }
    if (name === "prepare_flow_wait_resume") {
      const run = this.runById("run-1")!;
      if (run.continuation_id === null) {
        run.status = "resuming";
        run.current_node_key = this.waitNextNodeKey;
        run.current_visit_id = this.waitResumeId;
        run.continuation_id = this.waitResumeId;
        run.continuation_phase = "running";
      }
      return { data: [{ ...run }], error: null };
    }
    if (name === "fail_flow_call_frame") {
      const run = this.runById(value.p_run_id)!;
      const replay = this.frames.find(
        (frame) =>
          frame.child_flow_version_id ===
            value.p_child_flow_version_id &&
          frame.completed_child_visit_id ===
            value.p_expected_visit_id &&
          frame.state === "failed",
      );
      if (
        replay &&
        run.active_flow_version_id ===
          replay.parent_flow_version_id
      ) {
        return { data: [{ ...run }], error: null };
      }
      const frame = [...this.frames]
        .sort((left, right) => right.depth - left.depth)
        .find(
          (candidate) =>
            candidate.state === "active" &&
            candidate.child_flow_version_id ===
              value.p_child_flow_version_id,
        );
      if (
        !frame ||
        run.active_flow_version_id !==
          value.p_child_flow_version_id ||
        run.current_visit_id !== value.p_expected_visit_id
      ) {
        return { data: [], error: null };
      }
      frame.state = "failed";
      frame.completed_child_visit_id =
        value.p_expected_visit_id as string;
      frame.failure_reason = value.p_failure_reason as string;
      run.active_flow_id = frame.parent_flow_id;
      run.active_flow_version_id =
        frame.parent_flow_version_id;
      run.vars = { ...frame.parent_vars };
      run.current_visit_id = this.nextUuid("frame-failure");
      const policy = frame.error_policy;
      if (
        policy.on_error === "fail_branch" &&
        policy.error_next_node_key
      ) {
        run.status =
          run.continuation_id === null ? "active" : "resuming";
        run.current_node_key = policy.error_next_node_key;
        run.ended_at = null;
        run.end_reason = null;
      } else if (
        policy.on_error === "default_value" &&
        policy.default_value
      ) {
        run.status =
          run.continuation_id === null ? "active" : "resuming";
        run.current_node_key = frame.return_node_key;
        run.vars[policy.default_value.key] =
          policy.default_value.value;
        run.ended_at = null;
        run.end_reason = null;
      } else {
        run.status = "failed";
        run.current_node_key = frame.parent_node_key;
        run.end_reason = "sub_flow_child_failed";
      }
      run.continuation_step = (run.continuation_step ?? 0) + 1;
      if (this.loseFailFrameResponseOnce) {
        this.loseFailFrameResponseOnce = false;
        return {
          data: null,
          error: { message: "frame failure response lost" },
        };
      }
      return { data: [{ ...run }], error: null };
    }
    if (name === "complete_flow_wait_continuation") {
      const run = this.runById("run-1")!;
      if (run.continuation_id !== this.waitResumeId) {
        return { data: false, error: null };
      }
      run.continuation_phase = "completed";
      return { data: true, error: null };
    }
    if (name === "ack_flow_wait_resume") {
      const run = this.runById("run-1")!;
      if (
        run.continuation_id !== this.waitResumeId ||
        run.continuation_phase !== "completed"
      ) {
        return { data: false, error: null };
      }
      this.waitStatus = "resumed";
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
            in_progress:
              effect.status === "reserved" &&
              effect.invocation_token !== value.p_invocation_token,
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
      if (this.effectCommitResponseFailures > 0) {
        this.effectCommitResponseFailures -= 1;
        this.effectReadFailures += this.effectReadFailuresAfterCommit;
        this.effectReadFailuresAfterCommit = 0;
        return {
          data: null,
          error: { message: "effect commit unavailable" },
        };
      }
      return { data: [{ ...effect }], error: null };
    }
    if (name === "complete_flow_node_effect") {
      const effect = this.effectById(value.p_effect_id)!;
      if (this.completeEffectResponseFailures > 0) {
        if (
          this.commitFirstCompleteEffectFailure &&
          !this.completeEffectCommitted
        ) {
          effect.status = "completed";
          this.completeEffectCommitted = true;
        }
        this.completeEffectResponseFailures -= 1;
        this.effectReadFailures += 1;
        return {
          data: null,
          error: { message: "effect completion response unavailable" },
        };
      }
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
      if (
        effect.status === "reserved" &&
        value.p_remote_result !== null &&
        value.p_remote_result !== undefined
      ) {
        effect.status = "remote_committed";
        effect.result = value.p_remote_result as Row;
        effect.external_reference =
          (value.p_external_reference as string | null) ?? null;
      }
      if (effect.status === "completed") {
        return {
          data: [{ outcome: "completed", run_row: { ...run } }],
          error: null,
        };
      }
      if (
        effect.status === "remote_committed" &&
        run.current_node_key === value.p_intended_next_node_key &&
        run.current_visit_id === value.p_intended_next_visit_id &&
        (run.continuation_id ?? null) ===
          (value.p_expected_continuation_id ?? null)
      ) {
        effect.status = "completed";
        return {
          data: [
            { outcome: "already_committed", run_row: { ...run } },
          ],
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
      const atExpectedCursor =
        run.current_node_key === value.p_expected_node_key &&
        run.current_visit_id === value.p_expected_visit_id;
      const atIntendedCursor =
        typeof value.p_intended_next_node_key === "string" &&
        typeof value.p_intended_next_visit_id === "string" &&
        run.current_node_key === value.p_intended_next_node_key &&
        run.current_visit_id === value.p_intended_next_visit_id;
      if (
        (atExpectedCursor || atIntendedCursor) &&
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
    if (name === "commit_flow_variable_transition") {
      const run = this.runById(value.p_run_id)!;
      const applyTransition = () => {
        run.vars = value.p_next_vars as Record<string, unknown>;
        run.current_node_key = value.p_next_node_key as string;
        run.current_visit_id = value.p_next_visit_id as string;
        run.continuation_step = (run.continuation_step ?? 0) + 1;
        if (run.status === "needs_recovery") run.status = "active";
      };
      if (this.variableTransitionResponseFailures > 0) {
        if (
          this.commitFirstVariableTransitionFailure &&
          !this.variableTransitionCommitted
        ) {
          applyTransition();
          this.variableTransitionCommitted = true;
        }
        this.variableTransitionResponseFailures -= 1;
        this.runReadFailures += 1;
        return {
          data: null,
          error: { message: "variable transition unavailable" },
        };
      }
      if (
        run.current_node_key === value.p_next_node_key &&
        run.current_visit_id === value.p_next_visit_id &&
        (run.continuation_id ?? null) ===
          (value.p_expected_continuation_id ?? null)
      ) {
        return { data: [{ ...run }], error: null };
      }
      if (
        run.current_node_key !== value.p_expected_node_key ||
        run.current_visit_id !== value.p_expected_visit_id ||
        (run.continuation_id ?? null) !==
          (value.p_expected_continuation_id ?? null) ||
        !["active", "resuming", "needs_recovery"].includes(run.status)
      ) {
        return { data: [], error: null };
      }
      applyTransition();
      return { data: [{ ...run }], error: null };
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
      if (!["active", "resuming", "needs_recovery"].includes(run.status)) {
        return { data: [], error: null };
      }
      if (this.cursorResponseFailures > 0) {
        if (
          this.commitFirstPersistentCursorFailure &&
          !this.persistentCursorCommitted
        ) {
          run.current_node_key = value.p_next_node_key as string;
          run.current_visit_id = value.p_next_visit_id as string;
          run.continuation_step = (run.continuation_step ?? 0) + 1;
          this.persistentCursorCommitted = true;
        }
        this.cursorResponseFailures -= 1;
        this.runReadFailures += 1;
        return {
          data: null,
          error: { message: "cursor persistently unavailable" },
        };
      }
      if (
        run.current_node_key !== value.p_expected_node_key ||
        run.current_visit_id !== value.p_expected_visit_id
      ) {
        if (
          run.current_node_key === value.p_next_node_key &&
          run.current_visit_id === value.p_next_visit_id
        ) {
          return { data: [{ ...run }], error: null };
        }
        return { data: [], error: null };
      }
      run.current_node_key = value.p_next_node_key as string;
      run.current_visit_id = value.p_next_visit_id as string;
      run.continuation_step = (run.continuation_step ?? 0) + 1;
      if (run.status === "needs_recovery") run.status = "active";
      if (this.loseCursorResponseOnce) {
        this.loseCursorResponseOnce = false;
        this.runReadFailures += this.runReadFailuresAfterCursorLoss;
        this.runReadFailuresAfterCursorLoss = 0;
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
  return legacyGraph({
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
  });
}

function terminalGraph(entryNodeKey = "end"): FlowVersionGraph {
  return legacyGraph({
    schema_version: 1,
    trigger: { type: "manual", config: {} },
    entry_node_key: entryNodeKey,
    fallback_policy: {
      on_unknown_reply: "reprompt",
      max_reprompts: 2,
      on_timeout_hours: 24,
      on_exhaust: "handoff",
    },
    variable_schema: [],
    nodes: [
      {
        node_key: "end",
        node_type: "end",
        config: {},
        position_x: 0,
        position_y: 0,
      },
    ],
  });
}

function failingChildGraph(
  entry: "input" | "wait" = "input",
): FlowVersionGraph {
  return legacyGraph({
    schema_version: 1,
    trigger: { type: "manual", config: {} },
    entry_node_key: entry,
    fallback_policy: {
      on_unknown_reply: "reprompt",
      max_reprompts: 2,
      on_timeout_hours: 24,
      on_exhaust: "handoff",
    },
    variable_schema: [],
    nodes: [
      ...(entry === "input"
        ? [
            {
              node_key: "input",
              node_type: "collect_input",
              config: {
                prompt_text: "Child value?",
                var_key: "child_value",
                next_node_key: "broken",
              },
              position_x: 0,
              position_y: 0,
            },
          ]
        : [
            {
              node_key: "wait",
              node_type: "wait",
              config: {
                amount: 1,
                unit: "minutes",
                next_node_key: "broken",
              },
              position_x: 0,
              position_y: 0,
            },
          ]),
      {
        node_key: "broken",
        node_type: "variable_set",
        config: {
          assignments: [
            { key: "invalid", type: "number", value: "not-a-number" },
          ],
          next_node_key: "end",
        },
        position_x: 100,
        position_y: 0,
      },
      {
        node_key: "end",
        node_type: "end",
        config: {},
        position_x: 200,
        position_y: 0,
      },
    ],
  });
}

function frame(
  overrides: Partial<FrameRow> = {},
): FrameRow {
  return {
    id: `frame-${overrides.depth ?? 1}`,
    depth: 1,
    parent_flow_id: "flow-1",
    parent_flow_version_id: "version-1",
    parent_node_key: "call_child",
    return_node_key: "end",
    parent_vars: { parent: true },
    child_flow_id: "child-flow",
    child_flow_version_id: "child-version",
    error_policy: { on_error: "fail_run" },
    state: "active",
    ...overrides,
  };
}

function graphForEffect(
  kind: "zapi" | "http" | "tag",
): FlowVersionGraph {
  const flowGraph = graph();
  if (kind === "zapi") return flowGraph;
  const effectNode = flowGraph.nodes.find(
    (candidate) => candidate.node_key === "send",
  )!;
  if (kind === "http") {
    effectNode.node_type = "http_request";
    effectNode.config = {
      method: "POST",
      url: "https://example.test/hook",
      response_var: "http_result",
      next_node_key: "end",
    };
  } else {
    effectNode.node_type = "set_tag";
    effectNode.config = {
      mode: "add",
      tag_id: "tag-1",
      next_node_key: "end",
    };
  }
  return flowGraph;
}

function pureChainGraph(
  options: { entryAtStart?: boolean; withEffect?: boolean } = {},
): FlowVersionGraph {
  const withEffect = options.withEffect ?? true;
  return legacyGraph({
    schema_version: 1,
    trigger: {
      type: "keyword",
      config: { keywords: ["go"], match_type: "exact" },
    },
    entry_node_key: options.entryAtStart ? "pure_start" : "input",
    fallback_policy: {
      on_unknown_reply: "reprompt",
      max_reprompts: 2,
      on_timeout_hours: 24,
      on_exhaust: "handoff",
    },
    variable_schema: [],
    nodes: [
      {
        node_key: "input",
        node_type: "collect_input",
        config: {
          prompt_text: "Code?",
          var_key: "code",
          next_node_key: "pure_start",
        },
        position_x: 0,
        position_y: 0,
      },
      {
        node_key: "pure_start",
        node_type: "start",
        config: { next_node_key: "condition" },
        position_x: 50,
        position_y: 0,
      },
      {
        node_key: "condition",
        node_type: "condition",
        config: {
          subject: "var",
          subject_key: "code",
          operator: "present",
          true_next: "switch",
          false_next: "switch",
        },
        position_x: 100,
        position_y: 0,
      },
      {
        node_key: "switch",
        node_type: "switch",
        config: {
          subject: "var",
          subject_key: "code",
          cases: [
            {
              id: "stable",
              label: "Stable",
              operator: "equals",
              value: "stable",
              next: "set",
            },
          ],
          default_next: "set",
        },
        position_x: 150,
        position_y: 0,
      },
      {
        node_key: "set",
        node_type: "variable_set",
        config: {
          assignments: [{ key: "pure_chain", type: "boolean", value: "true" }],
          next_node_key: withEffect ? "send" : "end",
        },
        position_x: 200,
        position_y: 0,
      },
      ...(withEffect
        ? [
            {
              node_key: "send",
              node_type: "send_message",
              config: {
                text: "Pure chain complete",
                next_node_key: "end",
              },
              position_x: 250,
              position_y: 0,
            },
          ]
        : []),
      {
        node_key: "end",
        node_type: "end",
        config: {},
        position_x: 300,
        position_y: 0,
      },
    ],
  });
}

function appendVariableGraph(
  options: { entryAtSet?: boolean; entryAtWait?: boolean } = {},
): FlowVersionGraph {
  const entryNodeKey = options.entryAtWait
    ? "wait"
    : options.entryAtSet
      ? "set"
      : "input";
  return legacyGraph({
    schema_version: 1,
    trigger: {
      type: "keyword",
      config: { keywords: ["go"], match_type: "exact" },
    },
    entry_node_key: entryNodeKey,
    fallback_policy: {
      on_unknown_reply: "reprompt",
      max_reprompts: 2,
      on_timeout_hours: 24,
      on_exhaust: "handoff",
    },
    variable_schema: options.entryAtSet
      ? [{ key: "x", type: "string", required: false, default: "a" }]
      : [],
    nodes: [
      {
        node_key: "input",
        node_type: "collect_input",
        config: {
          prompt_text: "Value?",
          var_key: "x",
          next_node_key: "set",
        },
        position_x: 0,
        position_y: 0,
      },
      {
        node_key: "wait",
        node_type: "wait",
        config: {
          amount: 1,
          unit: "minutes",
          next_node_key: "set",
        },
        position_x: 0,
        position_y: 50,
      },
      {
        node_key: "set",
        node_type: "variable_set",
        config: {
          assignments: [
            { key: "x", type: "string", value: "{{vars.x}}b" },
          ],
          next_node_key: "end",
        },
        position_x: 100,
        position_y: 0,
      },
      {
        node_key: "end",
        node_type: "end",
        config: {},
        position_x: 200,
        position_y: 0,
      },
    ],
  });
}

function policyRecoveryGraph(
  policy: "fail_branch" | "default_value",
): FlowVersionGraph {
  return legacyGraph({
    schema_version: 1,
    trigger: {
      type: "keyword",
      config: { keywords: ["go"], match_type: "exact" },
    },
    entry_node_key: "input",
    fallback_policy: {
      on_unknown_reply: "reprompt",
      max_reprompts: 2,
      on_timeout_hours: 24,
      on_exhaust: "handoff",
    },
    variable_schema: [],
    nodes: [
      {
        node_key: "input",
        node_type: "collect_input",
        config: {
          prompt_text: "Value?",
          var_key: "x",
          next_node_key: "broken",
        },
        position_x: 0,
        position_y: 0,
      },
      {
        node_key: "broken",
        node_type: "variable_set",
        config: {
          assignments: [
            { key: "invalid", type: "number", value: "not-a-number" },
          ],
          next_node_key: "send",
          on_error: policy,
          ...(policy === "fail_branch"
            ? { error_next_node_key: "send" }
            : {
                default_value: {
                  key: "fallback",
                  type: "string",
                  value: "used",
                },
              }),
        },
        position_x: 100,
        position_y: 0,
      },
      {
        node_key: "send",
        node_type: "send_message",
        config: { text: "Recovered", next_node_key: "end" },
        position_x: 200,
        position_y: 0,
      },
      {
        node_key: "end",
        node_type: "end",
        config: {},
        position_x: 300,
        position_y: 0,
      },
    ],
  });
}

function effectCompletionGraph(
  effect: "http" | "zapi",
  options: { entryAtEffect?: boolean } = {},
): FlowVersionGraph {
  return legacyGraph({
    schema_version: 1,
    trigger: {
      type: "keyword",
      config: { keywords: ["go"], match_type: "exact" },
    },
    entry_node_key: options.entryAtEffect ? "effect" : "input",
    fallback_policy: {
      on_unknown_reply: "reprompt",
      max_reprompts: 2,
      on_timeout_hours: 24,
      on_exhaust: "handoff",
    },
    variable_schema: [],
    nodes: [
      {
        node_key: "input",
        node_type: "collect_input",
        config: {
          prompt_text: "Value?",
          var_key: "input",
          next_node_key: "effect",
        },
        position_x: 0,
        position_y: 0,
      },
      {
        node_key: "effect",
        node_type: effect === "http" ? "http_request" : "send_message",
        config:
          effect === "http"
            ? {
                method: "POST",
                url: "https://example.test/complete",
                response_var: "response",
                next_node_key: "successor",
              }
            : {
                text: "Effect",
                next_node_key: "successor",
              },
        position_x: 100,
        position_y: 0,
      },
      {
        node_key: "successor",
        node_type: "variable_set",
        config: {
          assignments: [
            { key: "successor", type: "string", value: "once" },
          ],
          next_node_key: "end",
        },
        position_x: 200,
        position_y: 0,
      },
      {
        node_key: "end",
        node_type: "end",
        config: {},
        position_x: 300,
        position_y: 0,
      },
    ],
  });
}

function waitEffectGraph(): FlowVersionGraph {
  const flowGraph = graph();
  setEntryTriggerNext(flowGraph, "wait");
  flowGraph.nodes.unshift({
    node_key: "wait",
    node_type: "wait",
    config: {
      amount: 1,
      unit: "minutes",
      next_node_key: "send",
    },
    position_x: -50,
    position_y: 0,
  });
  return flowGraph;
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
  h.httpRequest.mockReset();
  h.addTag.mockReset();
  h.httpRequest.mockResolvedValue({
    status: 200,
    body: { ok: true },
    headers: {},
  });
  h.addTag.mockResolvedValue(undefined);
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
  it("uses the active child snapshot when a reply arrives inside a sub-flow", async () => {
    const state = new DispatchState();
    prepare(
      state,
      run({
        active_flow_id: "child-flow",
        active_flow_version_id: "child-version",
        current_node_key: "child_input",
        current_visit_id: "visit-child-input",
      }),
    );
    const childGraph = graph({ nextNode: "end" });
    setEntryTriggerNext(childGraph, "child_input");
    const input = childGraph.nodes.find(
      (node) => node.node_key === "input",
    )!;
    input.node_key = "child_input";
    input.config = {
      prompt_text: "Child value?",
      var_key: "child_value",
      next_node_key: "child_wait",
    };
    childGraph.nodes.splice(1, 0, {
      node_key: "child_wait",
      node_type: "wait",
      config: {
        amount: 1,
        unit: "minutes",
        next_node_key: "end",
      },
      position_x: 50,
      position_y: 0,
    });
    state.versions.push({
      id: "child-version",
      flow_id: "child-flow",
      graph: childGraph,
    });

    const result = await dispatchInboundToFlows(
      inbound("child-reply", "from child"),
    );

    expect(result).toMatchObject({
      consumed: true,
      flow_run_id: "run-1",
      outcome: "advanced",
    });
    expect(state.runs[0].vars.child_value).toBe("from child");
    expect(state.rpcCalls).toContainEqual({
      name: "schedule_flow_wait",
      value: expect.objectContaining({
        p_flow_version_id: "child-version",
        p_node_key: "child_wait",
      }),
    });
  });

  it.each([
    {
      policy: {
        on_error: "fail_branch" as const,
        error_next_node_key: "end",
      },
      expectedStatus: "completed",
      expectedVars: { parent: true },
    },
    {
      policy: {
        on_error: "default_value" as const,
        default_value: {
          key: "fallback",
          type: "string",
          value: "used",
        },
      },
      expectedStatus: "completed",
      expectedVars: { parent: true, fallback: "used" },
    },
    {
      policy: { on_error: "fail_run" as const },
      expectedStatus: "failed",
      expectedVars: { parent: true },
    },
  ])(
    "unwinds a reply-suspended child exactly once with $policy.on_error",
    async ({ policy, expectedStatus, expectedVars }) => {
      const state = new DispatchState();
      prepare(
        state,
        run({
          active_flow_id: "child-flow",
          active_flow_version_id: "child-version",
          current_node_key: "input",
          current_visit_id: "child-reply-visit",
          vars: { child_only: true },
        }),
        terminalGraph(),
      );
      state.versions.push({
        id: "child-version",
        flow_id: "child-flow",
        graph: failingChildGraph(),
      });
      state.frames.push(frame({ error_policy: policy }));

      const result = await dispatchInboundToFlows(
        inbound(`child-${policy.on_error}`, "value"),
      );

      expect(result.consumed).toBe(true);
      expect(state.runs[0].status).toBe(expectedStatus);
      expect(state.runs[0].vars).toEqual(expectedVars);
      expect(state.frames).toEqual([
        expect.objectContaining({
          state: "failed",
          failure_reason: "node_execution_failed",
          completed_child_visit_id: expect.any(String),
        }),
      ]);
      expect(
        state.rpcCalls.filter(
          (call) => call.name === "fail_flow_call_frame",
        ),
      ).toHaveLength(1);
    },
  );

  it("propagates nested fail_run to the outer frame policy", async () => {
    const state = new DispatchState();
    prepare(
      state,
      run({
        active_flow_id: "grandchild-flow",
        active_flow_version_id: "grandchild-version",
        current_node_key: "input",
        current_visit_id: "grandchild-reply-visit",
      }),
      terminalGraph(),
    );
    state.versions.push(
      {
        id: "middle-version",
        flow_id: "middle-flow",
        graph: terminalGraph(),
      },
      {
        id: "grandchild-version",
        flow_id: "grandchild-flow",
        graph: failingChildGraph(),
      },
    );
    state.frames.push(
      frame({
        id: "outer-frame",
        depth: 1,
        child_flow_id: "middle-flow",
        child_flow_version_id: "middle-version",
        error_policy: {
          on_error: "fail_branch",
          error_next_node_key: "end",
        },
      }),
      frame({
        id: "inner-frame",
        depth: 2,
        parent_flow_id: "middle-flow",
        parent_flow_version_id: "middle-version",
        parent_node_key: "call_grandchild",
        child_flow_id: "grandchild-flow",
        child_flow_version_id: "grandchild-version",
        error_policy: { on_error: "fail_run" },
      }),
    );

    await dispatchInboundToFlows(inbound("nested-failure", "value"));

    expect(state.runs[0]).toMatchObject({
      active_flow_id: "flow-1",
      active_flow_version_id: "version-1",
      status: "completed",
    });
    expect(state.frames.map(({ state: status }) => status)).toEqual([
      "failed",
      "failed",
    ]);
    expect(
      state.rpcCalls.filter(
        (call) => call.name === "fail_flow_call_frame",
      ),
    ).toHaveLength(2);
  });

  it("replays a committed frame failure after losing the RPC response", async () => {
    const state = new DispatchState();
    state.loseFailFrameResponseOnce = true;
    prepare(
      state,
      run({
        active_flow_id: "child-flow",
        active_flow_version_id: "child-version",
        current_node_key: "input",
        current_visit_id: "lost-frame-response-visit",
      }),
      terminalGraph(),
    );
    state.versions.push({
      id: "child-version",
      flow_id: "child-flow",
      graph: failingChildGraph(),
    });
    state.frames.push(
      frame({
        error_policy: {
          on_error: "fail_branch",
          error_next_node_key: "end",
        },
      }),
    );

    await dispatchInboundToFlows(inbound("lost-frame-response", "value"));

    expect(state.frames).toHaveLength(1);
    expect(state.frames[0].state).toBe("failed");
    const calls = state.rpcCalls.filter(
      (call) => call.name === "fail_flow_call_frame",
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(state.runs[0].status).toBe("completed");
  });

  it("unwinds a child that fails after a durable wait resumes", async () => {
    const state = new DispatchState();
    state.waitEnabled = true;
    state.waitFlowVersionId = "child-version";
    state.waitNodeKey = "wait";
    state.waitNextNodeKey = "broken";
    prepare(
      state,
      run({
        active_flow_id: "child-flow",
        active_flow_version_id: "child-version",
        status: "waiting",
        current_node_key: "wait",
        current_visit_id: "child-wait-visit",
      }),
      terminalGraph(),
    );
    state.versions.push({
      id: "child-version",
      flow_id: "child-flow",
      graph: failingChildGraph("wait"),
    });
    state.frames.push(
      frame({
        error_policy: {
          on_error: "fail_branch",
          error_next_node_key: "end",
        },
      }),
    );

    const result = await resumeDueFlowWaits(
      state as never,
      new Date("2026-07-26T00:00:00.000Z"),
    );

    expect(result).toEqual({ claimed: 1, resumed: 1, failed: 0 });
    expect(state.frames[0]).toMatchObject({ state: "failed" });
    expect(state.runs[0]).toMatchObject({
      active_flow_version_id: "version-1",
      status: "completed",
    });
  });

  it("treats a concurrent reserved effect as in progress without poisoning the owner", async () => {
    const state = new DispatchState();
    prepare(state, run());
    let releaseProvider!: () => void;
    const barrier = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    h.sendText.mockImplementation(
      async (args: {
        onRemoteCommitted?: (
          result: { whatsapp_message_id: string },
        ) => Promise<void>;
      }) => {
        await barrier;
        const result = { whatsapp_message_id: "wamid-concurrent" };
        await args.onRemoteCommitted?.(result);
        return result;
      },
    );

    const first = dispatchInboundToFlows(
      inbound("concurrent-effect", "stable"),
    );
    await vi.waitFor(() =>
      expect(
        state.rpcCalls.filter(
          (call) => call.name === "reserve_flow_node_effect",
        ),
      ).toHaveLength(1),
    );
    const second = await dispatchInboundToFlows(
      inbound("concurrent-effect", "ignored"),
    );

    expect(second.consumed).toBe(true);
    expect(h.sendText).toHaveBeenCalledTimes(1);
    expect(state.effects.values().next().value?.status).toBe("reserved");
    expect(
      state.rpcCalls.some(
        (call) => call.name === "mark_flow_node_effect_ambiguous",
      ),
    ).toBe(false);

    releaseProvider();
    const completed = await first;
    expect(completed.outcome).toBe("completed");
    expect(state.effects.values().next().value?.status).toBe("completed");
    expect(h.sendText).toHaveBeenCalledTimes(1);
  });

  it.each(["zapi", "http", "tag"] as const)(
    "keeps %s recoverable when ledger RPC and read-back both fail",
    async (kind) => {
      const state = new DispatchState();
      state.effectCommitResponseFailures = 2;
      state.effectReadFailuresAfterCommit = 3;
      prepare(state, run(), graphForEffect(kind));

      const first = await dispatchInboundToFlows(
        inbound(`double-unavailable-${kind}`, "stable"),
      );

      expect(first.consumed).toBe(true);
      expect(state.runs[0].status).toBe("needs_recovery");
      expect(
        state.writes.some(
          (write) =>
            write.table === "flow_runs" &&
            write.value.status === "failed",
        ),
      ).toBe(false);

      const recovered = await dispatchInboundToFlows(
        inbound(`double-unavailable-${kind}`, "changed"),
      );
      expect(recovered.outcome).toBe("completed");
      expect(state.runs[0].status).toBe("completed");
      expect(state.effects.values().next().value?.status).toBe("completed");
      expect(state.runs[0].vars.code).toBe("stable");
      const providerCalls =
        kind === "zapi"
          ? h.sendText.mock.calls.length
          : kind === "http"
            ? h.httpRequest.mock.calls.length
            : h.addTag.mock.calls.length;
      expect(providerCalls).toBe(1);
    },
  );

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

  it("continues from the intended cursor when advance response and read-back both fail", async () => {
    const state = new DispatchState();
    state.loseCursorResponseOnce = true;
    state.runReadFailuresAfterCursorLoss = 1;
    prepare(state, run());

    const result = await dispatchInboundToFlows(
      inbound("lost-cursor-and-read", "stable"),
    );

    expect(result.outcome).toBe("completed");
    expect(state.runs[0].status).toBe("completed");
    expect(state.effects.values().next().value?.status).toBe("completed");
    expect(h.sendText).toHaveBeenCalledTimes(1);
    const advances = state.rpcCalls.filter(
      (call) => call.name === "advance_flow_run_cursor",
    );
    expect(advances).toHaveLength(2);
    expect(advances[0].value).toEqual(advances[1].value);
    expect(
      state.rpcCalls.some(
        (call) => call.name === "mark_flow_run_cursor_recovery",
      ),
    ).toBe(false);
  });

  it("retries the same pure cursor transition and executes downstream effects once", async () => {
    const state = new DispatchState();
    state.loseCursorResponseOnce = true;
    state.runReadFailuresAfterCursorLoss = 1;
    prepare(state, run(), pureChainGraph());

    const result = await dispatchInboundToFlows(
      inbound("pure-chain-lost-response", "stable"),
    );

    expect(result.outcome).toBe("completed");
    expect(state.runs[0].vars).toEqual({
      code: "stable",
      pure_chain: true,
    });
    expect(h.sendText).toHaveBeenCalledTimes(1);
    const advances = state.rpcCalls.filter(
      (call) => call.name === "advance_flow_run_cursor",
    );
    expect(advances.slice(0, 2).map((call) => call.value)).toEqual([
      advances[0].value,
      advances[0].value,
    ]);
    expect(
      advances.map((call) => call.value.p_expected_node_key),
    ).toEqual([
      "pure_start",
      "pure_start",
      "condition",
      "switch",
      "send",
    ]);
    expect(
      state.rpcCalls.filter(
        (call) => call.name === "commit_flow_variable_transition",
      ),
    ).toHaveLength(1);
  });

  it("retries a pure transition for a new flow without a reply receipt", async () => {
    const state = new DispatchState();
    state.loseCursorResponseOnce = true;
    state.runReadFailuresAfterCursorLoss = 1;
    prepare(state, null, pureChainGraph({ entryAtStart: true }));

    const result = await dispatchInboundToFlows(
      inbound("new-flow-pure-chain", "go"),
    );

    expect(result.outcome).toBe("completed");
    expect(state.receipts).toHaveLength(0);
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0].vars).toEqual({ pure_chain: true });
    expect(h.sendText).toHaveBeenCalledTimes(1);
    const advances = state.rpcCalls.filter(
      (call) => call.name === "advance_flow_run_cursor",
    );
    expect(advances[0].value).toEqual(advances[1].value);
  });

  it("marks a persistently unavailable pure transition recoverable and resumes it once", async () => {
    const state = new DispatchState();
    state.cursorResponseFailures = 2;
    state.commitFirstPersistentCursorFailure = true;
    prepare(state, run(), pureChainGraph());

    const first = await dispatchInboundToFlows(
      inbound("persistent-pure-chain", "stable"),
    );

    expect(first.consumed).toBe(true);
    expect(state.runs[0]).toMatchObject({
      status: "needs_recovery",
      current_node_key: "condition",
      end_reason: "flow_cursor_advance_ambiguous",
    });
    expect(h.sendText).not.toHaveBeenCalled();
    const attempted = state.rpcCalls.filter(
      (call) => call.name === "advance_flow_run_cursor",
    );
    expect(attempted).toHaveLength(2);
    expect(attempted[0].value).toEqual(attempted[1].value);

    const recovered = await dispatchInboundToFlows(
      inbound("persistent-pure-chain", "changed"),
    );

    expect(recovered.outcome).toBe("completed");
    expect(state.runs[0].status).toBe("completed");
    expect(state.runs[0].vars).toEqual({
      code: "stable",
      pure_chain: true,
    });
    expect(h.sendText).toHaveBeenCalledTimes(1);
  });

  it("replays an uncommitted variable transition from the source visit without applying its template twice", async () => {
    const state = new DispatchState();
    state.variableTransitionResponseFailures = 2;
    prepare(state, run(), appendVariableGraph());

    const first = await dispatchInboundToFlows(
      inbound("append-recovery", "a"),
    );

    expect(first.consumed).toBe(true);
    expect(state.runs[0]).toMatchObject({
      status: "needs_recovery",
      current_node_key: "set",
      vars: { x: "a" },
      end_reason: "flow_variable_transition_ambiguous",
    });
    expect(
      state.writes.some(
        (write) =>
          write.table === "flow_runs" &&
          write.value.status === "failed",
      ),
    ).toBe(false);

    const recovered = await dispatchInboundToFlows(
      inbound("append-recovery", "ignored"),
    );

    expect(recovered.outcome).toBe("completed");
    expect(state.runs[0].vars).toEqual({ x: "ab" });
    const commits = state.rpcCalls.filter(
      (call) => call.name === "commit_flow_variable_transition",
    );
    expect(commits.slice(0, 2).map((call) => call.value)).toEqual([
      commits[0].value,
      commits[0].value,
    ]);
    expect(commits.map((call) => call.value.p_next_vars)).toEqual([
      { x: "ab" },
      { x: "ab" },
      { x: "ab" },
    ]);
  });

  it("recognizes a committed variable transition after response loss without rendering vars again", async () => {
    const state = new DispatchState();
    state.variableTransitionResponseFailures = 1;
    state.commitFirstVariableTransitionFailure = true;
    prepare(state, run(), appendVariableGraph());

    const result = await dispatchInboundToFlows(
      inbound("append-committed-loss", "a"),
    );

    expect(result.outcome).toBe("completed");
    expect(state.runs[0].vars).toEqual({ x: "ab" });
    const commits = state.rpcCalls.filter(
      (call) => call.name === "commit_flow_variable_transition",
    );
    expect(commits).toHaveLength(2);
    expect(commits[0].value).toEqual(commits[1].value);
    expect(commits[0].value.p_next_vars).toEqual({ x: "ab" });
  });

  it("atomically commits an appended variable for a new flow without a receipt", async () => {
    const state = new DispatchState();
    state.variableTransitionResponseFailures = 1;
    state.commitFirstVariableTransitionFailure = true;
    prepare(state, null, appendVariableGraph({ entryAtSet: true }));

    const result = await dispatchInboundToFlows(
      inbound("append-new-flow", "go"),
    );

    expect(result.outcome).toBe("completed");
    expect(state.receipts).toHaveLength(0);
    expect(state.runs[0].vars).toEqual({ x: "ab" });
    const commits = state.rpcCalls.filter(
      (call) => call.name === "commit_flow_variable_transition",
    );
    expect(commits).toHaveLength(2);
    expect(commits[0].value).toEqual(commits[1].value);
  });

  it("preserves wait continuation identity while atomically appending vars", async () => {
    const state = new DispatchState();
    state.waitEnabled = true;
    state.waitNextNodeKey = "set";
    state.variableTransitionResponseFailures = 1;
    state.commitFirstVariableTransitionFailure = true;
    prepare(
      state,
      run({
        status: "waiting",
        current_node_key: "wait",
        current_visit_id: "visit-wait",
        vars: { x: "a" },
      }),
      appendVariableGraph({ entryAtWait: true }),
    );

    const result = await resumeDueFlowWaits(state as never);

    expect(result).toEqual({ claimed: 1, resumed: 1, failed: 0 });
    expect(state.runs[0].vars).toEqual({ x: "ab" });
    expect(state.runs[0].continuation_id).toBeNull();
    const commits = state.rpcCalls.filter(
      (call) => call.name === "commit_flow_variable_transition",
    );
    expect(commits).toHaveLength(2);
    expect(commits[0].value).toEqual(commits[1].value);
    expect(commits[0].value.p_expected_continuation_id).toBe(
      state.waitResumeId,
    );
  });

  it.each(["fail_branch", "default_value"] as const)(
    "keeps an ambiguous %s policy transition recoverable and resumes its branch once",
    async (policy) => {
      const state = new DispatchState();
      if (policy === "fail_branch") {
        state.cursorResponseFailures = 2;
        state.commitFirstPersistentCursorFailure = true;
      } else {
        state.variableTransitionResponseFailures = 2;
        state.commitFirstVariableTransitionFailure = true;
      }
      prepare(state, run(), policyRecoveryGraph(policy));

      const first = await dispatchInboundToFlows(
        inbound(`policy-${policy}`, "a"),
      );

      expect(first.consumed).toBe(true);
      expect(state.runs[0]).toMatchObject({
        status: "needs_recovery",
        current_node_key: "send",
      });
      expect(
        state.writes.some(
          (write) =>
            write.table === "flow_runs" &&
            write.value.status === "failed",
        ),
      ).toBe(false);
      expect(h.sendText).not.toHaveBeenCalled();

      const recovered = await dispatchInboundToFlows(
        inbound(`policy-${policy}`, "ignored"),
      );

      expect(recovered.outcome).toBe("completed");
      expect(h.sendText).toHaveBeenCalledTimes(1);
      expect(state.runs[0].vars).toEqual(
        policy === "default_value"
          ? { x: "a", fallback: "used" }
          : { x: "a" },
      );
    },
  );

  it("reconciles ledger completion before commit after HTTP vars and cursor advance atomically", async () => {
    const state = new DispatchState();
    state.completeEffectResponseFailures = 2;
    prepare(
      state,
      null,
      effectCompletionGraph("http", { entryAtEffect: true }),
    );

    const result = await dispatchInboundToFlows(
      inbound("http-complete-before-commit", "go"),
    );

    expect(result.outcome).toBe("completed");
    expect(state.receipts).toHaveLength(0);
    expect(h.httpRequest).toHaveBeenCalledTimes(1);
    expect(state.effects.values().next().value?.status).toBe("completed");
    expect(state.runs[0].vars).toMatchObject({
      response: { status: 200, body: { ok: true } },
      successor: "once",
    });
    expect(
      state.rpcCalls.filter(
        (call) => call.name === "complete_flow_node_effect",
      ),
    ).toHaveLength(2);
    expect(
      state.rpcCalls
        .filter(
          (call) => call.name === "commit_flow_variable_transition",
        )
        .map((call) => call.value.p_expected_node_key),
    ).toEqual(["effect", "successor"]);
    const httpCursor = state.rpcCalls.find(
      (call) =>
        call.name === "commit_flow_variable_transition" &&
        call.value.p_expected_node_key === "effect",
    )!;
    expect(
      state.rpcCalls.find(
        (call) => call.name === "reconcile_flow_node_effect_recovery",
      )?.value,
    ).toMatchObject({
      p_expected_node_key: "effect",
      p_intended_next_node_key: "successor",
      p_intended_next_visit_id: httpCursor.value.p_next_visit_id,
    });
  });

  it("recognizes committed ledger completion after response loss and continues a Z-API successor once", async () => {
    const state = new DispatchState();
    state.completeEffectResponseFailures = 2;
    state.commitFirstCompleteEffectFailure = true;
    prepare(state, run(), effectCompletionGraph("zapi"));

    const result = await dispatchInboundToFlows(
      inbound("zapi-complete-after-commit", "value"),
    );

    expect(result.outcome).toBe("completed");
    expect(h.sendText).toHaveBeenCalledTimes(1);
    expect(state.effects.values().next().value?.status).toBe("completed");
    expect(state.runs[0].vars).toEqual({
      input: "value",
      successor: "once",
    });
    const completes = state.rpcCalls.filter(
      (call) => call.name === "complete_flow_node_effect",
    );
    expect(completes).toHaveLength(2);
    expect(completes[0].value).toEqual(completes[1].value);
    expect(
      state.rpcCalls.filter(
        (call) =>
          call.name === "commit_flow_variable_transition" &&
          call.value.p_expected_node_key === "successor",
      ),
    ).toHaveLength(1);
    const zapiCursor = state.rpcCalls.find(
      (call) =>
        call.name === "advance_flow_run_cursor" &&
        call.value.p_expected_node_key === "effect",
    )!;
    expect(
      state.rpcCalls.find(
        (call) => call.name === "reconcile_flow_node_effect_recovery",
      )?.value,
    ).toMatchObject({
      p_expected_node_key: "effect",
      p_intended_next_node_key: "successor",
      p_intended_next_visit_id: zapiCursor.value.p_next_visit_id,
    });
  });

  it("acks a wait only after the intended cursor and downstream nodes continue", async () => {
    const state = new DispatchState();
    state.waitEnabled = true;
    state.loseCursorResponseOnce = true;
    state.runReadFailuresAfterCursorLoss = 1;
    prepare(
      state,
      run({
        status: "waiting",
        current_node_key: "wait",
        current_visit_id: "visit-wait",
      }),
      waitEffectGraph(),
    );

    const result = await resumeDueFlowWaits(state as never);

    expect(result).toEqual({ claimed: 1, resumed: 1, failed: 0 });
    expect(h.sendText).toHaveBeenCalledTimes(1);
    expect(state.effects.values().next().value?.status).toBe("completed");
    expect(state.runs[0].status).toBe("completed");
    expect(state.runs[0].continuation_id).toBeNull();
    expect(state.runs[0].continuation_phase).toBe("idle");
    expect(state.waitStatus).toBe("resumed");
    const calls = state.rpcCalls.map((call) => call.name);
    expect(calls.indexOf("advance_flow_run_cursor")).toBeLessThan(
      calls.indexOf("complete_flow_wait_continuation"),
    );
    expect(calls.indexOf("complete_flow_wait_continuation")).toBeLessThan(
      calls.lastIndexOf("ack_flow_wait_resume"),
    );
  });

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
    state.cursorResponseFailures = 2;
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

    expect(result.outcome).toBe("no_match");
    expect(result.consumed).toBe(true);
    expect(state.runs[0].status).toBe("completed");
    expect(
      state.rpcCalls.filter(
        (call) => call.name === "mark_flow_run_cursor_recovery",
      ),
    ).toHaveLength(2);
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
