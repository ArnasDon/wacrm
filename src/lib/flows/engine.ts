/**
 * Flow runner.
 *
 * The single entry point `dispatchInboundToFlows` is called by the
 * WhatsApp webhook on every inbound message *for an account that has
 * opted into the Flows beta*. It decides whether the message belongs
 * to an active conversation flow (advance it) or matches the entry
 * trigger of an active flow (start a new run) — and reports back to
 * the webhook so the webhook knows whether to also fire automations.
 *
 * Architecture in a sentence: the runner walks the customer through
 * a DB-stored node graph, suspending only at nodes that need
 * customer input. Each tap or text reply wakes it back up.
 *
 * What lives here vs elsewhere:
 *   - Pure decision logic (which button matched, where to advance to,
 *     when to fallback) — here.
 *   - DB shape (table reads/writes) — here.
 *   - Z-API send calls — `zapi-send.ts` (engineSendInteractive*).
 *   - Policy resolution (reprompt vs handoff vs end) — `fallback.ts`.
 *   - Type definitions — `types.ts`.
 *
 * Concurrency model:
 *   - Idempotency on `meta_message_id`: the runner refuses to advance
 *     an active run twice for the same Meta message — protects against
 *     Meta's retries.
 *   - Optimistic UPDATE with `current_node_key` precondition: two
 *     simultaneous taps for the same run collide at the DB layer; the
 *     second is a no-op.
 *   - Partial unique index `idx_one_active_run_per_contact`: two
 *     simultaneous starts for the same contact collide; the second
 *     INSERT raises 23505 and the runner catches & exits.
 */

import { supabaseAdmin } from "./admin-client";
import {
  engineSendInteractiveButtons,
  engineSendInteractiveList,
  engineSendMedia,
  engineSendText,
  persistCommittedOutbound,
} from "./zapi-send";
import { decideFallback } from "./fallback";
import { addContactTagAndDispatch } from "@/lib/contacts/tag-events";
import { removeContactTag } from "@/lib/contacts/tag-write";
import {
  type CollectInputNodeConfig,
  type ConditionNodeConfig,
  type DispatchInboundInput,
  type DispatchInboundResult,
  type FlowNodeRow,
  type FlowNodeEffectRow,
  type FlowRow,
  type FlowRunRow,
  type FlowFallbackPolicy,
  type FlowVersionRow,
  type ParsedInbound,
  type SendButtonsNodeConfig,
  type SendListNodeConfig,
  type SendMediaNodeConfig,
  type SendMessageNodeConfig,
  type SetTagNodeConfig,
  type StartNodeConfig,
  type KeywordTriggerConfig,
} from "./types";
import {
  getDeterministicSuccessEdgeTarget,
  getNodeDescriptor,
  resolveNodeOutput,
  type NodeDescriptor,
} from "./registry";
import type { PartialNodeExecutionPolicy } from "./registry";
import {
  CommittedSideEffectError,
  executeWithNodePolicy,
  isCommittedSideEffectError,
  resolveExhaustedNodePolicy,
  resolveNodeExecutionPolicy,
  sanitizeExecutionData,
  sanitizeExecutionError,
} from "./execution-policy";
import {
  matchesFlowVersionTrigger,
  parseFlowVersionGraph,
  versionGraphNodes,
  type FlowVersionGraph,
} from "./versions";
import {
  executeHttpRequest,
  type HttpRequestConfig,
  type HttpRequestOutput,
} from "./http-request";
import {
  coerceDeclaredValue,
  evaluateSwitch,
  initializeFlowVariables,
  validateCollectedInput,
  type FlowVariableType,
  type SwitchCase,
} from "./runtime-primitives";

// ============================================================
// Pure helpers — extracted so engine.test.ts can exercise them
// without a Supabase / Meta mock.
// ============================================================

/**
 * Given a node + the customer's reply_id, return the next_node_key
 * to advance to, or `null` if no option matches.
 */
export function matchReplyId(
  node: { node_type: string; config: Record<string, unknown> },
  reply_id: string,
): string | null {
  if (node.node_type === "send_buttons") {
    const cfg = node.config as unknown as SendButtonsNodeConfig;
    const hit = cfg.buttons?.find((b) => b.reply_id === reply_id);
    return hit?.next_node_key ?? null;
  }
  if (node.node_type === "send_list") {
    const cfg = node.config as unknown as SendListNodeConfig;
    for (const section of cfg.sections ?? []) {
      const hit = section.rows?.find((r) => r.reply_id === reply_id);
      if (hit) return hit.next_node_key;
    }
    return null;
  }
  return null;
}

function parsePositiveIntegerReply(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function matchTextOptionIndex(
  node: { node_type: string; config: Record<string, unknown> },
  text: string,
): string | null {
  const oneBased = parsePositiveIntegerReply(text);
  if (!oneBased) return null;
  const index = oneBased - 1;

  if (node.node_type === "send_buttons") {
    const cfg = node.config as unknown as SendButtonsNodeConfig;
    return cfg.buttons?.[index]?.next_node_key ?? null;
  }

  if (node.node_type === "send_list") {
    const cfg = node.config as unknown as SendListNodeConfig;
    let cursor = 0;
    for (const section of cfg.sections ?? []) {
      for (const row of section.rows ?? []) {
        if (cursor === index) return row.next_node_key;
        cursor++;
      }
    }
  }

  return null;
}

/**
 * Case-insensitive contains/exact match against a list of keywords.
 * Used by the trigger evaluator. Stable enough that the v3 builder
 * UI can preview matches by passing canned strings.
 */
export function matchesKeywordTrigger(
  text: string,
  cfg: KeywordTriggerConfig,
): boolean {
  if (!text || !cfg.keywords?.length) return false;
  const matchType = cfg.match_type ?? "contains";
  const haystack = cfg.case_sensitive ? text : text.toLowerCase();
  for (const raw of cfg.keywords) {
    if (!raw) continue;
    const needle = cfg.case_sensitive ? raw : raw.toLowerCase();
    if (
      matchType === "exact" ? haystack === needle : haystack.includes(needle)
    ) {
      return true;
    }
  }
  return false;
}

/** Nodes that advance to a next_node_key without waiting for input. */
export function isAutoAdvancing(node_type: string): boolean {
  return getRuntimeDescriptor(node_type)?.runtimeKind === "auto";
}

/** Nodes that send a prompt and suspend awaiting a customer reply. */
export function isSuspending(node_type: string): boolean {
  return getRuntimeDescriptor(node_type)?.runtimeKind === "suspend";
}

/** Nodes that end the run. */
export function isTerminal(node_type: string): boolean {
  return getRuntimeDescriptor(node_type)?.runtimeKind === "terminal";
}

/** Registry-backed runtime recognition and dispatch metadata lookup. */
export function getRuntimeDescriptor(
  nodeType: string,
): NodeDescriptor | undefined {
  return getNodeDescriptor(nodeType);
}

/**
 * Evaluate a `condition` node's predicate against the current run
 * state. Exported pure for unit testing — the engine wraps it with a
 * DB lookup for `tag` / `contact_field` subjects.
 */
export function evaluateConditionPredicate(args: {
  operator: ConditionNodeConfig["operator"];
  /**
   * Resolved value of the subject. `undefined` means the subject is
   * absent (no var with that key / no such tag / contact field is
   * null). Pure function: caller does the DB lookup.
   */
  subjectValue: string | undefined;
  /** The configured comparison value, when applicable. */
  configValue: string | undefined;
}): boolean {
  switch (args.operator) {
    case "present":
      return args.subjectValue !== undefined && args.subjectValue !== "";
    case "absent":
      return args.subjectValue === undefined || args.subjectValue === "";
    case "equals":
      if (args.subjectValue === undefined) return false;
      return args.subjectValue === (args.configValue ?? "");
    case "contains":
      if (args.subjectValue === undefined) return false;
      return args.subjectValue.includes(args.configValue ?? "");
  }
}

// ============================================================
// DB I/O — wrapped in tiny helpers so the dispatch flow stays
// readable. Errors surface as thrown — the entry point catches.
// ============================================================

type AdminClient = ReturnType<typeof supabaseAdmin>;

async function loadActiveRunForContact(
  db: AdminClient,
  accountId: string,
  contactId: string,
): Promise<FlowRunRow | null> {
  // The partial unique index `idx_one_active_run_per_contact` was
  // rebuilt in migration 017 over `(account_id, contact_id)` — so
  // "two active runs for one contact in one account" is impossible
  // by design. But a future migration glitch or manual SQL could
  // create one, and .maybeSingle() throws on >1 row — which would
  // kill dispatch for that contact's webhook entirely. .limit(1) is
  // forgiving: pick the newest, let the cron sweep clean up the
  // stale one.
  const { data, error } = await db
    .from("flow_runs")
    .select("*")
    .eq("account_id", accountId)
    .eq("contact_id", contactId)
    .in("status", ["active", "resuming", "needs_recovery"])
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) {
    console.error("[flows] loadActiveRunForContact error:", error.message);
    return null;
  }
  const rows = (data as FlowRunRow[] | null) ?? [];
  return rows[0] ?? null;
}

/** Load and schema-validate the immutable snapshot pinned to a run. */
async function loadFlowVersion(
  db: AdminClient,
  versionId: string,
  expectedFlowId: string,
): Promise<{ id: string; graph: FlowVersionGraph } | null> {
  const { data, error } = await db
    .from("flow_versions")
    .select("id, flow_id, graph")
    .eq("id", versionId)
    .maybeSingle();
  if (error) {
    console.error("[flows] loadFlowVersion error:", error.message);
    return null;
  }
  const row = data as Pick<FlowVersionRow, "id" | "flow_id" | "graph"> | null;
  if (!row || row.flow_id !== expectedFlowId) return null;
  try {
    return { id: row.id, graph: parseFlowVersionGraph(row.graph) };
  } catch (error) {
    console.error(
      "[flows] corrupt flow version:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

function snapshotNodes(
  flowId: string,
  graph: FlowVersionGraph,
): Map<string, FlowNodeRow> {
  return new Map(
    versionGraphNodes(graph, flowId).map((node) => [node.node_key, node]),
  );
}

async function logEvent(
  db: AdminClient,
  flowRunId: string,
  event_type:
    | "started"
    | "node_entered"
    | "message_sent"
    | "reply_received"
    | "fallback_fired"
    | "handoff"
    | "timeout"
    | "error"
    | "completed",
  node_key: string | null,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await db.from("flow_run_events").insert({
    flow_run_id: flowRunId,
    event_type,
    node_key,
    payload,
  });
  if (error) {
    // Logging failure is non-fatal — surface but don't throw.
    console.error("[flows] logEvent error:", error.message);
  }
}

/**
 * An inbound is duplicate only after its runtime transition is committed.
 * Audit events are excluded because a process can crash after logging the
 * inbound but before finalizing a remote-committed reprompt.
 */
interface FlowInboundReceipt {
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
  transition_kind:
    | "reply_branch"
    | "reprompt"
    | "fallback_ignore"
    | "fallback_handoff"
    | "fallback_end";
  recovery_state: "pending" | "completed";
}

async function loadInboundReceipt(
  db: AdminClient,
  accountId: string,
  contactId: string,
  metaMessageId: string,
): Promise<FlowInboundReceipt | null> {
  // The account/contact/message key survives run deletion, so a received
  // inbound can never become eligible to start a fresh run later.
  const { data, error } = await db
    .from("flow_reply_transitions")
    .select(
      "id, account_id, contact_id, flow_run_id, flow_version_id, meta_message_id, from_node_key, from_visit_id, next_node_key, next_visit_id, transition_kind, recovery_state",
    )
    .eq("account_id", accountId)
    .eq("contact_id", contactId)
    .eq("meta_message_id", metaMessageId)
    .maybeSingle();
  if (error) throw error;
  return data as FlowInboundReceipt | null;
}

async function loadRunById(
  db: AdminClient,
  runId: string,
): Promise<FlowRunRow | null> {
  const { data, error } = await db
    .from("flow_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw error;
  return data as FlowRunRow | null;
}

async function findEntryFlow(
  db: AdminClient,
  accountId: string,
  message: ParsedInbound,
  isFirstInbound: boolean,
): Promise<{
  flow: FlowRow;
  versionId: string;
  graph: FlowVersionGraph;
} | null> {
  // Only text messages can match an entry trigger. Interactive replies
  // are responses to existing prompts; they never start a new flow.
  if (message.kind !== "text") return null;

  // Pull all active flows for this account. Active set is bounded
  // (the builder discourages double-trigger overlap; partial index
  // makes the lookup index-supported).
  const { data: flows, error } = await db
    .from("flows")
    .select("*")
    .eq("account_id", accountId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error || !flows) return null;

  const typed = flows as FlowRow[];
  for (const flow of typed) {
    if (!flow.published_version_id) continue;
    const version = await loadFlowVersion(
      db,
      flow.published_version_id,
      flow.id,
    );
    if (
      version &&
      matchesFlowVersionTrigger(version.graph, message, isFirstInbound)
    ) {
      return { flow, versionId: version.id, graph: version.graph };
    }
  }
  return null;
}

async function startNodeExecutionRecord(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
  attempt: number,
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from("flow_node_executions")
      .insert({
        flow_run_id: run.id,
        flow_version_id: run.flow_version_id,
        node_key: node.node_key,
        node_type: node.node_type,
        status: "executing",
        inputs: sanitizeExecutionData(node.config),
        attempt,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[flows] execution record insert failed:", error.message);
      return null;
    }
    return (data as { id?: string } | null)?.id ?? null;
  } catch (error) {
    console.error(
      "[flows] execution record insert failed:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

async function finishNodeExecutionRecord(
  db: AdminClient,
  executionId: string | null,
  update: {
    status: "completed" | "error";
    duration_ms: number;
    outputs?: unknown;
    error?: Record<string, unknown>;
  },
): Promise<void> {
  if (!executionId) return;
  try {
    const { error } = await db
      .from("flow_node_executions")
      .update({
        ...update,
        outputs:
          update.outputs === undefined
            ? null
            : sanitizeExecutionData(update.outputs),
        error: update.error ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", executionId);
    if (error) {
      console.error("[flows] execution record update failed:", error.message);
    }
  } catch (error) {
    console.error(
      "[flows] execution record update failed:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

type PolicyNodeResult<T> =
  { ok: true; value: T } | { ok: false; nextNodeKey?: string };

function committedSideEffectCause(
  error: unknown,
): CommittedSideEffectError | null {
  if (error instanceof CommittedSideEffectError) return error;
  if (error instanceof Error && "cause" in error && error.cause !== undefined) {
    return committedSideEffectCause(error.cause);
  }
  return null;
}

async function executePolicyNode<T>(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
  globalPolicy: PartialNodeExecutionPolicy | undefined,
  operation: (signal: AbortSignal, operationId: string) => Promise<T>,
  options: {
    operationId?: string;
    forceSingleAttempt?: boolean;
    persistErrorTransition?: boolean;
    suppressErrorPolicy?: boolean;
  } = {},
): Promise<PolicyNodeResult<T>> {
  // Z-API executors consume this signal all the way through fetch. Supabase
  // query builders and tag helpers do not currently expose AbortSignal; a
  // timeout is therefore non-retryable so unabortable late completion is
  // never followed by an automatic duplicate attempt.
  const resolvedPolicy = resolveNodeExecutionPolicy(globalPolicy, node.config);
  const policy = options.forceSingleAttempt
    ? {
        ...resolvedPolicy,
        retry: { ...resolvedPolicy.retry, max_attempts: 1 },
      }
    : resolvedPolicy;
  const operationId = options.operationId ?? crypto.randomUUID();
  const executionIds = new Map<number, string | null>();
  try {
    const result = await executeWithNodePolicy(
      (signal) => operation(signal, operationId),
      policy,
      {
        onAttemptStart: async (attempt) => {
          executionIds.set(
            attempt,
            await startNodeExecutionRecord(db, run, node, attempt),
          );
        },
        onAttemptSuccess: async (attempt, value, durationMs) => {
          await finishNodeExecutionRecord(
            db,
            executionIds.get(attempt) ?? null,
            {
              status: "completed",
              duration_ms: Math.max(0, Math.round(durationMs)),
              outputs: value,
            },
          );
        },
        onAttemptError: async (attempt, error, durationMs) => {
          const sanitized = sanitizeExecutionError(error);
          await finishNodeExecutionRecord(
            db,
            executionIds.get(attempt) ?? null,
            {
              status: "error",
              duration_ms: Math.max(0, Math.round(durationMs)),
              error: sanitized,
            },
          );
          await logEvent(db, run.id, "error", node.node_key, {
            reason: "node_attempt_failed",
            attempt,
            node_type: node.node_type,
            error: sanitized,
          });
        },
      },
    );
    return { ok: true, value: result.value };
  } catch (error) {
    if (isCommittedSideEffectError(error)) {
      // Only the durable-effect executor has the operation id, source visit,
      // expected continuation and ledger row needed to reconcile this safely.
      throw committedSideEffectCause(error) ?? error;
    }
    if (options.suppressErrorPolicy) {
      return { ok: false };
    }
    const normalSuccessNextNodeKey = getDeterministicSuccessEdgeTarget(
      node.node_type,
      node.config,
    );
    const resolution = resolveExhaustedNodePolicy(
      policy,
      run.vars,
      normalSuccessNextNodeKey,
    );
    if (resolution.action === "fail_run") {
      await endRun(db, run.id, "failed", "node_execution_failed");
      return { ok: false };
    }
    await logEvent(db, run.id, "node_entered", node.node_key, {
      error_action: policy.on_error,
      advancing_to: resolution.nextNodeKey,
    });
    if (options.persistErrorTransition !== false) {
      try {
        if (policy.on_error === "default_value") {
          await persistDurableVariableTransition(
            db,
            run,
            resolution.nextNodeKey,
            resolution.vars,
          );
        } else {
          await persistDurableCursor(db, run, resolution.nextNodeKey);
        }
      } catch (cursorError) {
        if (isCommittedSideEffectError(cursorError)) {
          throw committedSideEffectCause(cursorError) ?? cursorError;
        }
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "error_transition_cursor_persist_failed",
          error: sanitizeExecutionError(cursorError),
        });
        await endRun(
          db,
          run.id,
          "failed",
          "error_transition_cursor_persist_failed",
        );
        return { ok: false };
      }
    }
    return { ok: false, nextNodeKey: resolution.nextNodeKey };
  }
}

type DurableNodeEffect = Pick<
  FlowNodeEffectRow,
  "id" | "operation_id" | "status" | "result" | "external_reference"
> & { is_owner: boolean };

async function readNodeEffect(
  db: AdminClient,
  effectId: string,
  operationId: string,
): Promise<DurableNodeEffect | null> {
  const { data, error } = await db
    .from("flow_node_effects")
    .select("id, operation_id, status, result, external_reference")
    .eq("id", effectId)
    .eq("operation_id", operationId)
    .maybeSingle();
  if (error) throw error;
  return data
    ? { ...(data as Omit<DurableNodeEffect, "is_owner">), is_owner: false }
    : null;
}

function syncRun(target: FlowRunRow, source: FlowRunRow): void {
  Object.assign(target, source);
}

function isAmbiguousLocalTransitionReason(reason: string | null): boolean {
  return (
    reason === "flow_cursor_advance_ambiguous" ||
    reason === "flow_variable_transition_ambiguous"
  );
}

function sanitizeExternalReference(value: string | undefined): string | null {
  if (!value) return null;
  return value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 500);
}

async function reserveNodeEffect(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
  effectKind: string,
): Promise<DurableNodeEffect> {
  if (!run.current_visit_id) {
    throw new Error("flow run is missing a durable visit identity");
  }
  const invocationToken = crypto.randomUUID();
  const reserve = () => db.rpc("reserve_flow_node_effect", {
    p_run_id: run.id,
    p_flow_version_id: run.flow_version_id,
    p_node_key: node.node_key,
    p_visit_id: run.current_visit_id,
    p_effect_kind: effectKind,
    p_invocation_token: invocationToken,
  });
  let { data, error } = await reserve();
  const effect = Array.isArray(data)
    ? (data[0] as DurableNodeEffect | undefined)
    : undefined;
  if (!error && effect) return effect;

  // The reservation may have committed while its response was lost. Retrying
  // with the same invocation token preserves ownership.
  ({ data, error } = await reserve());
  const retried = Array.isArray(data)
    ? (data[0] as DurableNodeEffect | undefined)
    : undefined;
  if (error || !retried) {
    throw error ?? new Error("node effect reservation was not returned");
  }
  return retried;
}

async function markNodeEffectCommitted<T>(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
  effect: DurableNodeEffect,
  effectKind: string,
  result: T,
  externalReference?: string,
): Promise<DurableNodeEffect> {
  const commit = () =>
    db.rpc("mark_flow_node_effect_committed", {
      p_effect_id: effect.id,
      p_operation_id: effect.operation_id,
      p_result: result,
      p_external_reference: sanitizeExternalReference(externalReference),
    });
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await commit();
    const committed = Array.isArray(data)
      ? (data[0] as DurableNodeEffect | undefined)
      : undefined;
    if (!error && committed) {
      return { ...committed, is_owner: effect.is_owner };
    }
    lastError = error;
    let readBack: DurableNodeEffect | null = null;
    try {
      readBack = await readNodeEffect(
        db,
        effect.id,
        effect.operation_id,
      );
    } catch (readError) {
      lastError = new AggregateError(
        [error, readError].filter(Boolean),
        "ledger commit and read-back both failed",
      );
    }
    if (
      readBack?.status === "remote_committed" ||
      readBack?.status === "completed"
    ) {
      return { ...readBack, is_owner: effect.is_owner };
    }
  }
  throw new CommittedSideEffectError(
    "External effect completed but its durable ledger could not be committed",
    {
      externalReference: externalReference ?? effect.operation_id,
      persistenceStage: "node_effect_ledger_commit",
      cause: lastError,
      effectId: effect.id,
      operationId: effect.operation_id,
      effectKind,
      remoteResult: sanitizeExecutionData(result),
      expectedNodeKey: node.node_key,
      expectedVisitId: run.current_visit_id ?? undefined,
      expectedContinuationId: run.continuation_id ?? null,
    },
  );
}

async function completeNodeEffect(
  db: AdminClient,
  effect: DurableNodeEffect,
): Promise<void> {
  const completeArgs = {
    p_effect_id: effect.id,
    p_operation_id: effect.operation_id,
  };
  let lastError: unknown = null;
  let readError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await db.rpc(
      "complete_flow_node_effect",
      completeArgs,
    );
    if (!error && data === true) {
      effect.status = "completed";
      return;
    }
    lastError = error ?? new Error("effect ledger was not completed");
    try {
      const readBack = await readNodeEffect(
        db,
        effect.id,
        effect.operation_id,
      );
      if (readBack?.status === "completed") {
        effect.status = "completed";
        effect.result = readBack.result;
        effect.external_reference = readBack.external_reference;
        return;
      }
    } catch (caught) {
      readError = caught;
    }
  }
  throw new CommittedSideEffectError(
    "External effect completed remotely but its ledger was not finalized",
    {
      externalReference: effect.external_reference ?? effect.operation_id,
      persistenceStage: "node_effect_ledger_complete",
      cause:
        readError && lastError
          ? new AggregateError(
              [lastError, readError],
              "ledger completion and read-back both failed",
            )
          : readError ?? lastError,
      effectId: effect.id,
      operationId: effect.operation_id,
      remoteResult: sanitizeExecutionData(effect.result),
    },
  );
}

async function failAmbiguousNodeEffect(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
  effect: DurableNodeEffect,
): Promise<DurableNodeEffect | null> {
  let readBack: DurableNodeEffect | null = null;
  let ledgerError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await db.rpc(
      "mark_flow_node_effect_ambiguous",
      {
        p_effect_id: effect.id,
        p_operation_id: effect.operation_id,
      },
    );
    ledgerError = error;
    try {
      readBack = await readNodeEffect(
        db,
        effect.id,
        effect.operation_id,
      );
    } catch (readError) {
      ledgerError = new AggregateError(
        [error, readError].filter(Boolean),
        "ambiguous ledger update and read-back failed",
      );
    }
    if (
      readBack?.status === "remote_committed" ||
      readBack?.status === "completed"
    ) {
      return readBack;
    }
    if ((!error && data === true) || readBack?.status === "ambiguous") {
      break;
    }
  }
  if (run.current_node_key && run.current_visit_id) {
    const recoveryArgs = {
      p_run_id: run.id,
      p_flow_version_id: run.flow_version_id,
      p_expected_node_key: run.current_node_key,
      p_expected_visit_id: run.current_visit_id,
      p_expected_continuation_id: run.continuation_id ?? null,
      p_reason: "external_effect_needs_reconciliation",
      p_intended_next_node_key: null,
      p_intended_next_visit_id: null,
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { data, error } = await db.rpc(
        "mark_flow_run_cursor_recovery",
        recoveryArgs,
      );
      const recovered = Array.isArray(data)
        ? (data[0] as FlowRunRow | undefined)
        : undefined;
      if (!error && recovered) {
        syncRun(run, recovered);
        break;
      }
    }
  }
  await logEvent(db, run.id, "error", node.node_key, {
    reason: "external_effect_needs_reconciliation",
    operation_id: effect.operation_id,
    ledger_update_failed: ledgerError
      ? sanitizeExecutionError(ledgerError)
      : undefined,
  });
  return null;
}

type DurableEffectResult<T> =
  { ok: true; value: T; effect: DurableNodeEffect } | { ok: false };

async function executeDurableNodeEffect<T>(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
  globalPolicy: PartialNodeExecutionPolicy | undefined,
  effectKind: string,
  operation: (
    signal: AbortSignal,
    operationId: string,
    remoteCommitted: (result: T, externalReference?: string) => Promise<void>,
  ) => Promise<T>,
): Promise<DurableEffectResult<T>> {
  let effect: DurableNodeEffect;
  try {
    effect = await reserveNodeEffect(db, run, node, effectKind);
  } catch (error) {
    await logEvent(db, run.id, "error", node.node_key, {
      reason: "node_effect_reservation_failed",
      error: sanitizeExecutionError(error),
    });
    await endRun(db, run.id, "failed", "node_effect_reservation_failed");
    return { ok: false };
  }

  if (effect.status === "ambiguous") {
    const resolved = await failAmbiguousNodeEffect(
      db,
      run,
      node,
      effect,
    );
    if (
      resolved &&
      (resolved.status === "remote_committed" ||
        resolved.status === "completed") &&
      resolved.result !== null
    ) {
      return { ok: true, value: resolved.result as T, effect: resolved };
    }
    return { ok: false };
  }
  if (effect.status === "remote_committed" || effect.status === "completed") {
    return {
      ok: true,
      value: effect.result as T,
      effect,
    };
  }
  if (!effect.is_owner) {
    const resolved = await failAmbiguousNodeEffect(
      db,
      run,
      node,
      effect,
    );
    if (
      resolved &&
      (resolved.status === "remote_committed" ||
        resolved.status === "completed") &&
      resolved.result !== null
    ) {
      return { ok: true, value: resolved.result as T, effect: resolved };
    }
    return { ok: false };
  }

  let committedEffect: DurableNodeEffect | null = null;
  let remoteResult: T | undefined;
  let executed: PolicyNodeResult<T>;
  try {
    executed = await executePolicyNode<T>(
      db,
      run,
      node,
      globalPolicy,
      (signal, operationId) =>
        operation(signal, operationId, async (result, reference) => {
          remoteResult = result;
          committedEffect = await markNodeEffectCommitted(
            db,
            run,
            node,
            effect,
            effectKind,
            result,
            reference,
          );
        }),
      {
        operationId: effect.operation_id,
        forceSingleAttempt: true,
        persistErrorTransition: false,
        suppressErrorPolicy: true,
      },
    );
  } catch (error) {
    let committedError = committedSideEffectCause(error);
    if (!committedError) throw error;
    let readBack: DurableNodeEffect | null =
      committedEffect as DurableNodeEffect | null;
    if (!readBack) {
      try {
        readBack = await readNodeEffect(
          db,
          effect.id,
          effect.operation_id,
        );
      } catch (readError) {
        committedError = new CommittedSideEffectError(
          committedError.message,
          {
            ...committedError.metadata,
            cause: new AggregateError(
              [committedError, readError],
              "committed effect read-back failed",
            ),
            effectId: effect.id,
            operationId: effect.operation_id,
            effectKind,
            remoteResult: sanitizeExecutionData(
              remoteResult ?? committedError.metadata.remoteResult,
            ),
            expectedNodeKey: node.node_key,
            expectedVisitId: run.current_visit_id ?? undefined,
            expectedContinuationId: run.continuation_id ?? null,
          },
        );
      }
    }
    const recoverableResult =
      remoteResult ?? (committedError.metadata.remoteResult as T | undefined);
    if (
      readBack?.status === "reserved" &&
      recoverableResult !== undefined
    ) {
      try {
        readBack = await markNodeEffectCommitted(
          db,
          run,
          node,
          effect,
          effectKind,
          recoverableResult,
          committedError.externalReference,
        );
      } catch (markError) {
        committedError =
          committedSideEffectCause(markError) ?? committedError;
      }
    } else if (
      readBack?.status === "reserved" &&
      (effectKind === "outbound" || effectKind.startsWith("prompt:"))
    ) {
      const recoveredResult = {
        whatsapp_message_id: committedError.externalReference,
      } as T;
      remoteResult = recoveredResult;
      try {
        readBack = await markNodeEffectCommitted(
          db,
          run,
          node,
          effect,
          effectKind,
          recoveredResult,
          committedError.externalReference,
        );
      } catch (markError) {
        committedError =
          committedSideEffectCause(markError) ?? committedError;
      }
    }
    if (
      readBack &&
      (readBack.status === "remote_committed" ||
        readBack.status === "completed") &&
      (remoteResult !== undefined || readBack.result !== null)
    ) {
      return {
        ok: true,
        value: (remoteResult ?? readBack.result) as T,
        effect: { ...readBack, is_owner: effect.is_owner },
      };
    }
    const phaseCompleted =
      run.current_visit_id &&
      (await stopAfterCommittedEffectPersistenceFailure(
        db,
        run,
        effect,
        node.node_key,
        run.current_visit_id,
        run.continuation_id ?? null,
        committedError,
      ));
    if (phaseCompleted && recoverableResult !== undefined) {
      return {
        ok: true,
        value: recoverableResult,
        effect: { ...effect, status: "completed" },
      };
    }
    throw committedError;
  }
  if (!executed.ok) {
    if (!committedEffect) {
      const resolved = await failAmbiguousNodeEffect(
        db,
        run,
        node,
        effect,
      );
      if (
        resolved &&
        (resolved.status === "remote_committed" ||
          resolved.status === "completed") &&
        resolved.result !== null
      ) {
        return { ok: true, value: resolved.result as T, effect: resolved };
      }
    }
    return { ok: false };
  }
  if (!committedEffect) {
    committedEffect = await markNodeEffectCommitted(
      db,
      run,
      node,
      effect,
      effectKind,
      executed.value,
    );
  }
  return { ok: true, value: executed.value, effect: committedEffect };
}

interface DurableCursorTransition {
  expectedNodeKey: string;
  expectedVisitId: string;
  expectedContinuationId: string | null;
  intendedNextNodeKey: string;
  intendedNextVisitId: string;
}

async function persistDurableCursor(
  db: AdminClient,
  run: FlowRunRow,
  nextNodeKey: string,
): Promise<DurableCursorTransition | null> {
  if (
    !run.current_node_key ||
    !run.current_visit_id ||
    !["active", "resuming", "needs_recovery"].includes(run.status)
  ) {
    return null;
  }
  const expectedNodeKey = run.current_node_key;
  const expectedVisitId = run.current_visit_id;
  const expectedContinuationId = run.continuation_id ?? null;
  const intendedNextVisitId = crypto.randomUUID();
  const advanceArgs = {
    p_run_id: run.id,
    p_flow_version_id: run.flow_version_id,
    p_expected_node_key: expectedNodeKey,
    p_expected_visit_id: expectedVisitId,
    p_next_node_key: nextNodeKey,
    p_next_visit_id: intendedNextVisitId,
  };
  let advanced: FlowRunRow | undefined;
  let lastError: unknown = null;
  let readError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await db.rpc(
      "advance_flow_run_cursor",
      advanceArgs,
    );
    const candidate = Array.isArray(data)
      ? (data[0] as FlowRunRow | undefined)
      : undefined;
    if (
      !error &&
      candidate?.current_node_key === nextNodeKey &&
      candidate.current_visit_id === intendedNextVisitId
    ) {
      advanced = candidate;
      break;
    }
    lastError =
      error ?? new Error("durable flow cursor was not advanced");
    let readBack: FlowRunRow | null = null;
    try {
      readBack = await loadRunById(db, run.id);
    } catch (caught) {
      readError = caught;
    }
    if (
      readBack?.flow_version_id === run.flow_version_id &&
      readBack.current_node_key === nextNodeKey &&
      readBack.current_visit_id === intendedNextVisitId
    ) {
      advanced = readBack;
      break;
    }
  }
  if (!advanced) {
    const recoveryArgs = {
      p_run_id: run.id,
      p_flow_version_id: run.flow_version_id,
      p_expected_node_key: expectedNodeKey,
      p_expected_visit_id: expectedVisitId,
      p_expected_continuation_id: expectedContinuationId,
      p_reason: "flow_cursor_advance_ambiguous",
      p_intended_next_node_key: nextNodeKey,
      p_intended_next_visit_id: intendedNextVisitId,
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { data, error } = await db.rpc(
        "mark_flow_run_cursor_recovery",
        recoveryArgs,
      );
      const recovered = Array.isArray(data)
        ? (data[0] as FlowRunRow | undefined)
        : undefined;
      if (!error && recovered) {
        syncRun(run, recovered);
        break;
      }
    }
    throw new CommittedSideEffectError(
      "Flow cursor advancement remains ambiguous after bounded recovery",
      {
        externalReference: "flow_cursor",
        persistenceStage: "flow_cursor_advance",
        cause:
          readError && lastError
            ? new AggregateError(
                [lastError, readError],
                "cursor advance and read-back both failed",
              )
            : readError ?? lastError,
        expectedNodeKey,
        expectedVisitId,
        expectedContinuationId,
        intendedNextNodeKey: nextNodeKey,
        intendedNextVisitId,
      },
    );
  }
  if (
    advanced.current_node_key !== nextNodeKey ||
    advanced.current_visit_id !== intendedNextVisitId
  ) {
    throw new Error("durable flow cursor lost an advancement race");
  }
  run.current_node_key = advanced.current_node_key;
  run.current_visit_id = advanced.current_visit_id;
  run.continuation_step = advanced.continuation_step;
  if (advanced.status) run.status = advanced.status;
  return {
    expectedNodeKey,
    expectedVisitId,
    expectedContinuationId,
    intendedNextNodeKey: nextNodeKey,
    intendedNextVisitId,
  };
}

async function persistDurableVariableTransition(
  db: AdminClient,
  run: FlowRunRow,
  nextNodeKey: string,
  nextVars: Record<string, unknown>,
): Promise<DurableCursorTransition | null> {
  if (
    !run.current_node_key ||
    !run.current_visit_id ||
    !["active", "resuming", "needs_recovery"].includes(run.status)
  ) {
    return null;
  }
  const expectedNodeKey = run.current_node_key;
  const expectedVisitId = run.current_visit_id;
  const expectedContinuationId = run.continuation_id ?? null;
  const intendedNextVisitId = crypto.randomUUID();
  const commitArgs = {
    p_run_id: run.id,
    p_flow_version_id: run.flow_version_id,
    p_expected_node_key: expectedNodeKey,
    p_expected_visit_id: expectedVisitId,
    p_expected_continuation_id: expectedContinuationId,
    p_next_node_key: nextNodeKey,
    p_next_visit_id: intendedNextVisitId,
    p_next_vars: nextVars,
  };
  let committed: FlowRunRow | undefined;
  let lastError: unknown = null;
  let readError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await db.rpc(
      "commit_flow_variable_transition",
      commitArgs,
    );
    const candidate = Array.isArray(data)
      ? (data[0] as FlowRunRow | undefined)
      : undefined;
    if (
      !error &&
      candidate?.current_node_key === nextNodeKey &&
      candidate.current_visit_id === intendedNextVisitId
    ) {
      committed = candidate;
      break;
    }
    lastError =
      error ?? new Error("durable variable transition was not committed");
    try {
      const readBack = await loadRunById(db, run.id);
      if (
        readBack?.flow_version_id === run.flow_version_id &&
        readBack.current_node_key === nextNodeKey &&
        readBack.current_visit_id === intendedNextVisitId
      ) {
        committed = readBack;
        break;
      }
    } catch (caught) {
      readError = caught;
    }
  }
  if (!committed) {
    const recoveryArgs = {
      p_run_id: run.id,
      p_flow_version_id: run.flow_version_id,
      p_expected_node_key: expectedNodeKey,
      p_expected_visit_id: expectedVisitId,
      p_expected_continuation_id: expectedContinuationId,
      p_reason: "flow_variable_transition_ambiguous",
      p_intended_next_node_key: nextNodeKey,
      p_intended_next_visit_id: intendedNextVisitId,
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { data, error } = await db.rpc(
        "mark_flow_run_cursor_recovery",
        recoveryArgs,
      );
      const recovered = Array.isArray(data)
        ? (data[0] as FlowRunRow | undefined)
        : undefined;
      if (!error && recovered) {
        syncRun(run, recovered);
        break;
      }
    }
    throw new CommittedSideEffectError(
      "Flow variable transition remains ambiguous after bounded recovery",
      {
        externalReference: "flow_variable_transition",
        persistenceStage: "flow_variable_transition",
        cause:
          readError && lastError
            ? new AggregateError(
                [lastError, readError],
                "variable transition and read-back both failed",
              )
            : readError ?? lastError,
        expectedNodeKey,
        expectedVisitId,
        expectedContinuationId,
        intendedNextNodeKey: nextNodeKey,
        intendedNextVisitId,
      },
    );
  }
  syncRun(run, committed);
  return {
    expectedNodeKey,
    expectedVisitId,
    expectedContinuationId,
    intendedNextNodeKey: nextNodeKey,
    intendedNextVisitId,
  };
}

async function persistTransition(
  db: AdminClient,
  run: FlowRunRow,
  nextNodeKey: string,
): Promise<string> {
  await persistDurableCursor(db, run, nextNodeKey);
  return nextNodeKey;
}

interface CommittedReplyTransition {
  current_node_key: string;
  current_visit_id: string;
  next_node_key: string;
  run_vars: Record<string, unknown>;
  reprompt_count: number;
  continuation_step: number;
  duplicate: boolean;
}

async function findCommittedReplyTransition(
  db: AdminClient,
  runId: string,
  metaMessageId: string,
): Promise<{
  from_node_key: string;
  from_visit_id: string;
  next_node_key: string;
  next_visit_id: string;
  transition_kind: FlowInboundReceipt["transition_kind"];
  recovery_state: FlowInboundReceipt["recovery_state"];
} | null> {
  const { data, error } = await db
    .from("flow_reply_transitions")
    .select(
      "from_node_key, from_visit_id, next_node_key, next_visit_id, transition_kind, recovery_state",
    )
    .eq("flow_run_id", runId)
    .eq("meta_message_id", metaMessageId)
    .maybeSingle();
  if (error) throw error;
  return data as {
    from_node_key: string;
    from_visit_id: string;
    next_node_key: string;
    next_visit_id: string;
    transition_kind: FlowInboundReceipt["transition_kind"];
    recovery_state: FlowInboundReceipt["recovery_state"];
  } | null;
}

async function commitReplyTransition(
  db: AdminClient,
  run: FlowRunRow,
  nextNodeKey: string,
  metaMessageId: string,
  vars: Record<string, unknown> | null,
): Promise<CommittedReplyTransition> {
  if (!run.current_node_key || !run.current_visit_id) {
    throw new Error("flow reply is missing its durable source visit");
  }
  const expectedNodeKey = run.current_node_key;
  const expectedVisitId = run.current_visit_id;
  const { data, error } = await db.rpc("commit_flow_reply_transition", {
    p_run_id: run.id,
    p_flow_version_id: run.flow_version_id,
    p_expected_node_key: expectedNodeKey,
    p_expected_visit_id: expectedVisitId,
    p_next_node_key: nextNodeKey,
    p_meta_message_id: metaMessageId,
    p_vars: vars,
  });
  const committed = Array.isArray(data)
    ? (data[0] as CommittedReplyTransition | undefined)
    : undefined;
  if (!error && committed) return committed;

  const receipt = await findCommittedReplyTransition(
    db,
    run.id,
    metaMessageId,
  );
  const readBack = await loadRunById(db, run.id);
  if (
    receipt?.transition_kind === "reply_branch" &&
    receipt.from_node_key === expectedNodeKey &&
    receipt.from_visit_id === expectedVisitId &&
    receipt.next_node_key === nextNodeKey &&
    readBack?.current_node_key === receipt.next_node_key &&
    readBack.current_visit_id === receipt.next_visit_id
  ) {
    syncRun(run, readBack);
    return {
      current_node_key: readBack.current_node_key!,
      current_visit_id: readBack.current_visit_id!,
      next_node_key: receipt.next_node_key,
      run_vars: readBack.vars,
      reprompt_count: readBack.reprompt_count,
      continuation_step: readBack.continuation_step ?? 0,
      duplicate: false,
    };
  }
  throw error ?? new Error("flow reply transition was not committed");
}

async function stopAfterCommittedEffectPersistenceFailure(
  db: AdminClient,
  run: FlowRunRow,
  effect: DurableNodeEffect,
  expectedNodeKey: string,
  expectedVisitId: string,
  expectedContinuationId: string | null,
  error: unknown,
): Promise<boolean> {
  const committedError =
    committedSideEffectCause(error) ??
    new CommittedSideEffectError(
      "External effect completed but local state is ambiguous",
      {
        externalReference: effect.external_reference ?? effect.operation_id,
        persistenceStage: "node_effect_reconciliation",
        cause: error,
        effectId: effect.id,
        operationId: effect.operation_id,
        remoteResult: sanitizeExecutionData(effect.result),
        expectedNodeKey,
        expectedVisitId,
        expectedContinuationId,
      },
    );
  const reconcileArgs = {
    p_run_id: run.id,
    p_flow_version_id: run.flow_version_id,
    p_effect_id: effect.id,
    p_operation_id: effect.operation_id,
    p_expected_node_key: expectedNodeKey,
    p_expected_visit_id: expectedVisitId,
    p_expected_continuation_id: expectedContinuationId,
    p_intended_next_node_key:
      committedError.metadata.intendedNextNodeKey ?? null,
    p_intended_next_visit_id:
      committedError.metadata.intendedNextVisitId ?? null,
    p_remote_result:
      committedError.metadata.remoteResult ?? effect.result ?? null,
    p_external_reference:
      committedError.externalReference ?? effect.external_reference,
  };
  let reconcileError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error: rpcError } = await db.rpc(
      "reconcile_flow_node_effect_recovery",
      reconcileArgs,
    );
    const resolution = Array.isArray(data)
      ? (data[0] as
          | {
              outcome:
                | "completed"
                | "already_committed"
                | "recovery_required"
                | "stale";
              run_row: FlowRunRow;
            }
          | undefined)
      : undefined;
    if (!rpcError && resolution) {
      syncRun(run, resolution.run_row);
      if (
        resolution.outcome === "completed" ||
        resolution.outcome === "already_committed"
      ) {
        return true;
      }
      throw committedError;
    }
    reconcileError = rpcError;
  }

  // The reconciliation CAS itself may have committed without returning.
  let runReadBack: FlowRunRow | null = null;
  let effectReadBack: DurableNodeEffect | null = null;
  try {
    [runReadBack, effectReadBack] = await Promise.all([
      loadRunById(db, run.id),
      readNodeEffect(db, effect.id, effect.operation_id),
    ]);
  } catch (readError) {
    throw new CommittedSideEffectError(committedError.message, {
      ...committedError.metadata,
      cause: new AggregateError(
        [reconcileError, readError].filter(Boolean),
        "effect reconciliation and read-back both failed",
      ),
    });
  }
  if (runReadBack) syncRun(run, runReadBack);
  if (effectReadBack?.status === "completed") return true;
  if (
    runReadBack?.status === "needs_recovery" &&
    runReadBack.current_node_key === expectedNodeKey &&
    runReadBack.current_visit_id === expectedVisitId &&
    runReadBack.continuation_id === expectedContinuationId
  ) {
    throw committedError;
  }
  throw committedError;
}

async function finalizeDurableNodeEffect(
  db: AdminClient,
  run: FlowRunRow,
  effect: DurableNodeEffect,
  localPersistence: () => Promise<void | DurableCursorTransition | null>,
  nextNodeKey?: string,
): Promise<boolean> {
  if (!run.current_node_key || !run.current_visit_id) return false;
  const expectedNodeKey = run.current_node_key;
  const expectedVisitId = run.current_visit_id;
  const expectedContinuationId = run.continuation_id ?? null;
  let committedCursor: DurableCursorTransition | null = null;
  try {
    committedCursor = (await localPersistence()) ?? null;
    if (nextNodeKey) {
      committedCursor = await persistDurableCursor(db, run, nextNodeKey);
    }
    await completeNodeEffect(db, effect);
    return true;
  } catch (error) {
    const committedError = committedSideEffectCause(error);
    const enrichedError =
      committedCursor && committedError
        ? new CommittedSideEffectError(committedError.message, {
            ...committedError.metadata,
            expectedNodeKey: committedCursor.expectedNodeKey,
            expectedVisitId: committedCursor.expectedVisitId,
            expectedContinuationId:
              committedCursor.expectedContinuationId,
            intendedNextNodeKey: committedCursor.intendedNextNodeKey,
            intendedNextVisitId: committedCursor.intendedNextVisitId,
          })
        : error;
    return stopAfterCommittedEffectPersistenceFailure(
      db,
      run,
      effect,
      expectedNodeKey,
      expectedVisitId,
      expectedContinuationId,
      enrichedError,
    );
  }
}

async function finalizeRepromptEffect(
  db: AdminClient,
  run: FlowRunRow,
  effect: DurableNodeEffect,
  repromptCount: number,
  metaMessageId: string,
  localPersistence: () => Promise<void>,
): Promise<boolean> {
  if (!run.current_node_key || !run.current_visit_id) {
    throw new Error("reprompt is missing its durable source visit");
  }
  const expectedNodeKey = run.current_node_key;
  const expectedVisitId = run.current_visit_id;
  const expectedContinuationId = run.continuation_id ?? null;
  try {
    await localPersistence();
    const { data, error } = await db.rpc("finalize_flow_reprompt_effect", {
      p_run_id: run.id,
      p_flow_version_id: run.flow_version_id,
      p_effect_id: effect.id,
      p_operation_id: effect.operation_id,
      p_expected_node_key: expectedNodeKey,
      p_expected_visit_id: expectedVisitId,
      p_reprompt_count: repromptCount,
      p_meta_message_id: metaMessageId,
    });
    const finalized = Array.isArray(data)
      ? (data[0] as FlowRunRow | undefined)
      : undefined;
    if (error || !finalized) {
      const receipt = await findCommittedReplyTransition(
        db,
        run.id,
        metaMessageId,
      );
      const [readBack, effectReadBack] = await Promise.all([
        loadRunById(db, run.id),
        readNodeEffect(db, effect.id, effect.operation_id),
      ]);
      if (
        receipt?.transition_kind === "reprompt" &&
        receipt.recovery_state === "completed" &&
        receipt.from_node_key === expectedNodeKey &&
        receipt.from_visit_id === expectedVisitId &&
        readBack?.current_node_key === receipt.next_node_key &&
        readBack.current_visit_id === receipt.next_visit_id &&
        readBack.reprompt_count >= repromptCount &&
        effectReadBack?.status === "completed"
      ) {
        syncRun(run, readBack);
        return true;
      }
      throw new CommittedSideEffectError(
        "Reprompt was sent but its durable state was not finalized",
        {
          externalReference:
            effect.external_reference ?? effect.operation_id,
          persistenceStage: "reprompt_state_finalize",
          cause: error,
        },
      );
    }
    run.current_node_key = finalized.current_node_key;
    run.current_visit_id = finalized.current_visit_id;
    run.continuation_step = finalized.continuation_step;
    run.reprompt_count = finalized.reprompt_count;
    run.status = finalized.status;
    return true;
  } catch (error) {
    return stopAfterCommittedEffectPersistenceFailure(
      db,
      run,
      effect,
      expectedNodeKey,
      expectedVisitId,
      expectedContinuationId,
      error,
    );
  }
}

async function finalizeFallbackDecision(
  db: AdminClient,
  run: FlowRunRow,
  metaMessageId: string,
  repromptCount: number,
  decision: "ignore" | "handoff" | "end",
): Promise<boolean> {
  if (!run.current_node_key || !run.current_visit_id) {
    throw new Error("fallback decision is missing its durable source visit");
  }
  const expectedNodeKey = run.current_node_key;
  const expectedVisitId = run.current_visit_id;
  const { data, error } = await db.rpc(
    "finalize_flow_fallback_decision",
    {
      p_run_id: run.id,
      p_flow_version_id: run.flow_version_id,
      p_expected_node_key: expectedNodeKey,
      p_expected_visit_id: expectedVisitId,
      p_meta_message_id: metaMessageId,
      p_reprompt_count: repromptCount,
      p_decision: decision,
    },
  );
  const finalized = Array.isArray(data)
    ? (data[0] as FlowRunRow | undefined)
    : undefined;
  if (!error && finalized) {
    run.status = finalized.status;
    run.reprompt_count = finalized.reprompt_count;
    run.ended_at = finalized.ended_at;
    run.end_reason = finalized.end_reason;
    return true;
  }

  // The transaction may have committed while its response was lost.
  const receipt = await findCommittedReplyTransition(
    db,
    run.id,
    metaMessageId,
  );
  if (
    receipt?.recovery_state === "completed" &&
    receipt.transition_kind === `fallback_${decision}`
  ) {
    const readBack = await loadRunById(db, run.id);
    if (readBack) syncRun(run, readBack);
    return true;
  }

  const { data: recoveryRows, error: recoveryError } = await db.rpc(
    "mark_flow_run_cursor_recovery",
    {
      p_run_id: run.id,
      p_flow_version_id: run.flow_version_id,
      p_expected_node_key: expectedNodeKey,
      p_expected_visit_id: expectedVisitId,
      p_expected_continuation_id: run.continuation_id ?? null,
      p_reason: "fallback_decision_persistence_failed",
      p_intended_next_node_key: null,
      p_intended_next_visit_id: null,
    },
  );
  const recoveryRun = Array.isArray(recoveryRows)
    ? (recoveryRows[0] as FlowRunRow | undefined)
    : undefined;
  if (!recoveryError && recoveryRun) {
    syncRun(run, recoveryRun);
  } else {
    const readBack = await loadRunById(db, run.id);
    if (readBack) syncRun(run, readBack);
  }
  const continuationMustRetry = run.continuation_id !== null;
  if (continuationMustRetry) {
    throw error ?? new Error("fallback decision was not committed");
  }
  return false;
}

// ============================================================
// Node executors — each handles ONE node type. send_buttons and
// send_list also persist `last_prompt_message_id` so the inbox
// thread can quote the prompt the customer is replying to.
// ============================================================

async function persistPromptAfterCommittedSend(
  db: AdminClient,
  run: FlowRunRow,
  whatsappMessageId: string,
): Promise<void> {
  let persistenceStage = "prompt_message_lookup";
  try {
    const { data: message, error: messageError } = await db
      .from("messages")
      .select("id")
      .eq("message_id", whatsappMessageId)
      .maybeSingle();
    if (messageError) throw messageError;
    const messageId = (message as { id: string } | null)?.id;
    if (!messageId) throw new Error("Persisted prompt message was not found");

    persistenceStage = "flow_run_prompt_update";
    const { error: runError } = await db
      .from("flow_runs")
      .update({ last_prompt_message_id: messageId })
      .eq("id", run.id);
    if (runError) throw runError;
  } catch (error) {
    throw new CommittedSideEffectError(
      `WhatsApp prompt was sent but local ${persistenceStage} failed`,
      {
        externalReference: whatsappMessageId,
        persistenceStage,
        cause: error,
      },
    );
  }
}

async function persistOutboundForNode(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
  whatsappMessageId: string,
): Promise<void> {
  if (node.node_type === "send_media") {
    const cfg = node.config as unknown as SendMediaNodeConfig;
    const caption = cfg.caption
      ? interpolateVars(cfg.caption, run.vars)
      : undefined;
    await persistCommittedOutbound(db, {
      conversationId: run.conversation_id!,
      messageId: whatsappMessageId,
      contentType: cfg.media_type,
      contentText: caption ?? null,
      conversationPreview: caption?.trim() || `[${cfg.media_type}]`,
    });
    return;
  }
  const interactive =
    node.node_type === "send_buttons" || node.node_type === "send_list";
  const text =
    node.node_type === "send_message"
      ? interpolateVars(
          (node.config as unknown as SendMessageNodeConfig).text,
          run.vars,
        )
      : node.node_type === "collect_input"
        ? interpolateVars(
            (node.config as unknown as CollectInputNodeConfig).prompt_text,
            run.vars,
          )
        : String(node.config.text ?? "");
  await persistCommittedOutbound(db, {
    conversationId: run.conversation_id!,
    messageId: whatsappMessageId,
    contentType: interactive ? "interactive" : "text",
    contentText: text,
    conversationPreview: text,
  });
}

async function sendButtonsAndSuspend(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
  remoteCommitted?: (
    result: {
      outcome: "advanced";
      node_key: string;
      whatsapp_message_id: string;
    },
    externalReference?: string,
  ) => Promise<void>,
  signal?: AbortSignal,
): Promise<{
  outcome: "advanced";
  node_key: string;
  whatsapp_message_id: string;
}> {
  const cfg = node.config as unknown as SendButtonsNodeConfig;
  const { whatsapp_message_id } = await engineSendInteractiveButtons({
    accountId: run.account_id,
    userId: run.user_id,
    conversationId: run.conversation_id!,
    contactId: run.contact_id!,
    bodyText: cfg.text,
    headerText: cfg.header_text,
    footerText: cfg.footer_text,
    buttons: cfg.buttons.map((b) => ({ id: b.reply_id, title: b.title })),
    signal,
    onRemoteCommitted: remoteCommitted
      ? (result) =>
          remoteCommitted(
            {
              outcome: "advanced",
              node_key: node.node_key,
              whatsapp_message_id: result.whatsapp_message_id,
            },
            result.whatsapp_message_id,
          )
      : undefined,
  });
  return {
    outcome: "advanced",
    node_key: node.node_key,
    whatsapp_message_id,
  };
}

async function sendListAndSuspend(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
  remoteCommitted?: (
    result: {
      outcome: "advanced";
      node_key: string;
      whatsapp_message_id: string;
    },
    externalReference?: string,
  ) => Promise<void>,
  signal?: AbortSignal,
): Promise<{
  outcome: "advanced";
  node_key: string;
  whatsapp_message_id: string;
}> {
  const cfg = node.config as unknown as SendListNodeConfig;
  const { whatsapp_message_id } = await engineSendInteractiveList({
    accountId: run.account_id,
    userId: run.user_id,
    conversationId: run.conversation_id!,
    contactId: run.contact_id!,
    bodyText: cfg.text,
    buttonLabel: cfg.button_label,
    headerText: cfg.header_text,
    footerText: cfg.footer_text,
    sections: cfg.sections.map((s) => ({
      title: s.title,
      rows: s.rows.map((r) => ({
        id: r.reply_id,
        title: r.title,
        description: r.description,
      })),
    })),
    signal,
    onRemoteCommitted: remoteCommitted
      ? (result) =>
          remoteCommitted(
            {
              outcome: "advanced",
              node_key: node.node_key,
              whatsapp_message_id: result.whatsapp_message_id,
            },
            result.whatsapp_message_id,
          )
      : undefined,
  });
  return {
    outcome: "advanced",
    node_key: node.node_key,
    whatsapp_message_id,
  };
}

async function executeHandoff(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
): Promise<void> {
  const cfg = node.config as { assign_to?: string; note?: string };
  const convUpdate: Record<string, unknown> = {
    status: "pending",
    updated_at: new Date().toISOString(),
  };
  if (cfg.assign_to) convUpdate.assigned_agent_id = cfg.assign_to;
  if (run.conversation_id) {
    await db
      .from("conversations")
      .update(convUpdate)
      .eq("id", run.conversation_id);
  }
  await logEvent(db, run.id, "handoff", node.node_key, {
    note: cfg.note ?? null,
    assigned_to: cfg.assign_to ?? null,
  });
  await endRun(db, run.id, "handed_off", "handoff_node");
}

/**
 * Resolve a condition node's subject value from DB / run state, then
 * call the pure `evaluateConditionPredicate`. Splits out so the
 * predicate itself stays unit-testable without a Supabase mock.
 *
 * Subject sources:
 *   - `var` → `flow_runs.vars[subject_key]` (captured by collect_input
 *     or http_fetch in v2).
 *   - `tag` → present iff `contact_tags(contact_id, tag_id)` exists.
 *     `subject_key` IS the tag UUID; the SELECT returns 1 row or 0.
 *   - `contact_field` → one of name/email/phone/company on `contacts`.
 */
async function evaluateConditionNode(
  db: AdminClient,
  run: FlowRunRow,
  cfg: ConditionNodeConfig,
): Promise<boolean> {
  let subjectValue: string | undefined;
  if (cfg.subject === "var") {
    const v = run.vars[cfg.subject_key];
    subjectValue =
      typeof v === "string" ? v : v === undefined ? undefined : String(v);
  } else if (cfg.subject === "tag") {
    const { count } = await db
      .from("contact_tags")
      .select("contact_id", { count: "exact", head: true })
      .eq("contact_id", run.contact_id!)
      .eq("tag_id", cfg.subject_key);
    // For tags, "present" really is the only meaningful test — the
    // `present`/`absent` operators are the natural fit. equals/contains
    // against a tag UUID would still work mechanically (compare its
    // existence to the value).
    subjectValue = (count ?? 0) > 0 ? cfg.subject_key : undefined;
  } else {
    const ALLOWED = ["name", "email", "phone", "company"] as const;
    type AllowedField = (typeof ALLOWED)[number];
    if (!ALLOWED.includes(cfg.subject_key as AllowedField)) {
      throw new Error(`unsupported contact_field: ${cfg.subject_key}`);
    }
    const { data } = await db
      .from("contacts")
      .select(cfg.subject_key)
      .eq("id", run.contact_id!)
      .maybeSingle();
    const raw = (data as Record<string, unknown> | null)?.[cfg.subject_key];
    subjectValue = typeof raw === "string" && raw.length > 0 ? raw : undefined;
  }
  return evaluateConditionPredicate({
    operator: cfg.operator,
    subjectValue,
    configValue: cfg.value,
  });
}

async function resolveSwitchSubject(
  db: AdminClient,
  run: FlowRunRow,
  config: { subject: "var" | "contact_field"; subject_key: string },
): Promise<unknown> {
  if (config.subject === "var") return run.vars[config.subject_key];
  const allowed = ["name", "email", "phone", "company"] as const;
  if (!allowed.includes(config.subject_key as (typeof allowed)[number])) {
    throw new Error(`unsupported contact_field: ${config.subject_key}`);
  }
  const { data, error } = await db
    .from("contacts")
    .select(config.subject_key)
    .eq("id", run.contact_id!)
    .maybeSingle();
  if (error) throw error;
  return (data as Record<string, unknown> | null)?.[config.subject_key];
}

/**
 * Tiny `{{vars.foo}}` interpolation. Used by send_message + collect_input
 * prompt text so a captured `name` can show up in the next prompt
 * ("Thanks {{vars.name}}, what's your email?"). Missing vars render as
 * empty string — the same behavior as the automations engine.
 */
function interpolateVars(
  template: string,
  vars: Record<string, unknown>,
): string {
  if (!template) return "";
  return template.replace(/\{\{vars\.([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

function resolveBoundDataInput(
  node: FlowNodeRow,
  handle: string,
  nodes: Map<string, FlowNodeRow>,
  vars: Record<string, unknown>,
): unknown {
  const bindings =
    node.config._data_inputs &&
    typeof node.config._data_inputs === "object" &&
    !Array.isArray(node.config._data_inputs)
      ? (node.config._data_inputs as Record<string, Record<string, unknown>>)
      : {};
  const binding = bindings[handle];
  const sourceKey =
    typeof binding?.source_node_key === "string"
      ? binding.source_node_key
      : null;
  const sourceHandle =
    typeof binding?.source_handle === "string" ? binding.source_handle : null;
  const source = sourceKey ? nodes.get(sourceKey) : undefined;
  if (!source || !sourceHandle) return undefined;
  return resolveNodeOutput(source.node_type, source.config, sourceHandle, vars);
}

async function endRun(
  db: AdminClient,
  runId: string,
  status: "completed" | "handed_off" | "timed_out" | "failed",
  reason: string,
): Promise<void> {
  await db
    .from("flow_runs")
    .update({
      status,
      ended_at: new Date().toISOString(),
      end_reason: reason,
    })
    .eq("id", runId);
}

// ============================================================
// The synchronous advance loop. Walks through auto-advance nodes
// until it hits one that suspends (send_buttons/send_list) or
// terminates (handoff/end). Each suspending node persists the
// new current_node_key before returning.
// ============================================================

export async function advanceFromNodeKey(
  db: AdminClient,
  run: FlowRunRow,
  startNodeKey: string,
  nodes: Map<string, FlowNodeRow>,
  globalExecutionPolicy?: PartialNodeExecutionPolicy,
): Promise<{ outcome: "advanced" | "completed" | "handed_off" }> {
  let currentKey: string | null = startNodeKey;
  // Defensive cap — if a flow has a cycle (which the validator
  // SHOULD catch but doesn't yet in v1), we bail rather than loop.
  for (let safety = 0; safety < 64; safety += 1) {
    if (!currentKey) {
      await logEvent(db, run.id, "error", null, {
        reason: "next_node_key was null mid-advance",
      });
      await endRun(db, run.id, "failed", "missing_next_node");
      return { outcome: "completed" };
    }
    const node: FlowNodeRow | null = nodes.get(currentKey) ?? null;
    if (!node) {
      await logEvent(db, run.id, "error", currentKey, {
        reason: "node_not_found",
      });
      await endRun(db, run.id, "failed", "node_not_found");
      return { outcome: "completed" };
    }
    await logEvent(db, run.id, "node_entered", node.node_key, {
      node_type: node.node_type,
    });
    const runtimeDescriptor = getRuntimeDescriptor(node.node_type);
    if (!runtimeDescriptor) {
      await logEvent(db, run.id, "error", node.node_key, {
        reason: `unknown_node_type:${node.node_type}`,
      });
      await endRun(db, run.id, "failed", "unknown_node_type");
      return { outcome: "completed" };
    }
    const runtimeHook = runtimeDescriptor.runtimeHook;

    if (runtimeHook === "start") {
      const cfg = node.config as unknown as StartNodeConfig;
      const executed: PolicyNodeResult<{ next_node_key: string }> =
        await executePolicyNode<{ next_node_key: string }>(
          db,
          run,
          node,
          globalExecutionPolicy,
          async () => ({ next_node_key: cfg.next_node_key }),
        );
      if (!executed.ok) {
        if (executed.nextNodeKey) {
          currentKey = executed.nextNodeKey;
          continue;
        }
        return { outcome: "completed" };
      }
      currentKey = await persistTransition(db, run, cfg.next_node_key);
      continue;
    }
    if (runtimeHook === "send_message") {
      const cfg = node.config as unknown as SendMessageNodeConfig;
      const executed = await executeDurableNodeEffect<{
        whatsapp_message_id: string;
      }>(
        db,
        run,
        node,
        globalExecutionPolicy,
        "outbound",
        async (signal, _operationId, remoteCommitted) =>
          engineSendText({
            accountId: run.account_id,
            userId: run.user_id,
            conversationId: run.conversation_id!,
            contactId: run.contact_id!,
            text: interpolateVars(cfg.text, run.vars),
            signal,
            onRemoteCommitted: (result) =>
              remoteCommitted(result, result.whatsapp_message_id),
          }),
      );
      if (!executed.ok) {
        return { outcome: "completed" };
      }
      if (
        !(await finalizeDurableNodeEffect(
          db,
          run,
          executed.effect,
          async () => {
            await persistOutboundForNode(
              db,
              run,
              node,
              executed.value.whatsapp_message_id,
            );
            await logEvent(db, run.id, "message_sent", node.node_key, {
              node_type: "send_message",
              whatsapp_message_id: executed.value.whatsapp_message_id,
            });
          },
          cfg.next_node_key,
        ))
      ) {
        return { outcome: "completed" };
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (runtimeHook === "send_media") {
      const cfg = node.config as unknown as SendMediaNodeConfig;
      const executed = await executeDurableNodeEffect<{
        whatsapp_message_id: string;
      }>(
        db,
        run,
        node,
        globalExecutionPolicy,
        "outbound",
        async (signal, _operationId, remoteCommitted) =>
          engineSendMedia({
            accountId: run.account_id,
            userId: run.user_id,
            conversationId: run.conversation_id!,
            contactId: run.contact_id!,
            kind: cfg.media_type,
            link: cfg.media_url,
            caption: cfg.caption
              ? interpolateVars(cfg.caption, run.vars)
              : undefined,
            filename: cfg.filename,
            signal,
            onRemoteCommitted: (result) =>
              remoteCommitted(result, result.whatsapp_message_id),
          }),
      );
      if (!executed.ok) {
        return { outcome: "completed" };
      }
      if (
        !(await finalizeDurableNodeEffect(
          db,
          run,
          executed.effect,
          async () => {
            await persistOutboundForNode(
              db,
              run,
              node,
              executed.value.whatsapp_message_id,
            );
            await logEvent(db, run.id, "message_sent", node.node_key, {
              node_type: "send_media",
              media_type: cfg.media_type,
              whatsapp_message_id: executed.value.whatsapp_message_id,
            });
          },
          cfg.next_node_key,
        ))
      ) {
        return { outcome: "completed" };
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (runtimeHook === "collect_input") {
      // Send the prompt and suspend. Customer's next TEXT reply will
      // wake us up via handleReplyForActiveRun's collect_input branch.
      const cfg = node.config as unknown as CollectInputNodeConfig;
      const executed = await executeDurableNodeEffect<{
        whatsapp_message_id: string;
      }>(
        db,
        run,
        node,
        globalExecutionPolicy,
        "prompt:initial",
        async (signal, _operationId, remoteCommitted) =>
          engineSendText({
            accountId: run.account_id,
            userId: run.user_id,
            conversationId: run.conversation_id!,
            contactId: run.contact_id!,
            text: interpolateVars(cfg.prompt_text, run.vars),
            signal,
            onRemoteCommitted: (result) =>
              remoteCommitted(result, result.whatsapp_message_id),
          }),
      );
      if (!executed.ok) {
        return { outcome: "completed" };
      }
      const { whatsapp_message_id } = executed.value;
      if (
        !(await finalizeDurableNodeEffect(
          db,
          run,
          executed.effect,
          async () => {
            await persistOutboundForNode(db, run, node, whatsapp_message_id);
            await persistPromptAfterCommittedSend(db, run, whatsapp_message_id);
            await logEvent(db, run.id, "message_sent", node.node_key, {
              node_type: "collect_input",
              whatsapp_message_id,
            });
          },
          node.node_key,
        ))
      ) {
        return { outcome: "completed" };
      }
      return { outcome: "advanced" };
    }
    if (runtimeHook === "condition") {
      const cfg = node.config as unknown as ConditionNodeConfig;
      const executed: PolicyNodeResult<"true" | "false"> =
        await executePolicyNode<"true" | "false">(
          db,
          run,
          node,
          globalExecutionPolicy,
          async () =>
            (await evaluateConditionNode(db, run, cfg)) ? "true" : "false",
        );
      if (!executed.ok) {
        if (executed.nextNodeKey) {
          currentKey = executed.nextNodeKey;
          continue;
        }
        return { outcome: "completed" };
      }
      const branch: "true" | "false" = executed.value;
      const nextNodeKey = branch === "true" ? cfg.true_next : cfg.false_next;
      await logEvent(db, run.id, "node_entered", node.node_key, {
        condition_result: branch,
        advancing_to: nextNodeKey,
      });
      currentKey = await persistTransition(db, run, nextNodeKey);
      continue;
    }
    if (runtimeHook === "switch") {
      const cfg = node.config as {
        subject: "var" | "contact_field";
        subject_key: string;
        cases: SwitchCase[];
        default_next: string;
      };
      const executed: PolicyNodeResult<string> =
        await executePolicyNode<string>(
          db,
          run,
          node,
          globalExecutionPolicy,
          async () => {
            const boundSubject = resolveBoundDataInput(
              node,
              "subject",
              nodes,
              run.vars,
            );
            const subject =
              boundSubject === undefined
                ? await resolveSwitchSubject(db, run, cfg)
                : boundSubject;
            return evaluateSwitch(subject, cfg.cases) ?? cfg.default_next;
          },
        );
      if (!executed.ok) {
        if (executed.nextNodeKey) {
          currentKey = executed.nextNodeKey;
          continue;
        }
        return { outcome: "completed" };
      }
      await logEvent(db, run.id, "node_entered", node.node_key, {
        switch_case_next: executed.value,
      });
      currentKey = await persistTransition(db, run, executed.value);
      continue;
    }
    if (runtimeHook === "variable_set") {
      const cfg = node.config as {
        assignments: Array<{
          key: string;
          type: FlowVariableType;
          value: unknown;
        }>;
        next_node_key: string;
      };
      const executed: PolicyNodeResult<Record<string, unknown>> =
        await executePolicyNode<Record<string, unknown>>(
          db,
          run,
          node,
          globalExecutionPolicy,
          async () => {
            const nextVars = { ...run.vars };
            const boundValue = resolveBoundDataInput(
              node,
              "value",
              nodes,
              run.vars,
            );
            for (const [index, assignment] of cfg.assignments.entries()) {
              const raw =
                index === 0 && boundValue !== undefined
                  ? boundValue
                  : typeof assignment.value === "string"
                    ? interpolateVars(assignment.value, run.vars)
                    : assignment.value;
              const coerced = coerceDeclaredValue(assignment.type, raw);
              if (!coerced.ok) {
                throw new Error(
                  `variable "${assignment.key}" ${coerced.reason}`,
                );
              }
              nextVars[assignment.key] = coerced.value;
            }
            return nextVars;
          },
        );
      if (!executed.ok) {
        if (executed.nextNodeKey) {
          currentKey = executed.nextNodeKey;
          continue;
        }
        return { outcome: "completed" };
      }
      await persistDurableVariableTransition(
        db,
        run,
        cfg.next_node_key,
        executed.value,
      );
      currentKey = cfg.next_node_key;
      continue;
    }
    if (runtimeHook === "http_request") {
      const cfg = node.config as unknown as HttpRequestConfig & {
        next_node_key: string;
      };
      const executed = await executeDurableNodeEffect<HttpRequestOutput>(
        db,
        run,
        node,
        globalExecutionPolicy,
        "http",
        async (signal, idempotencyKey, remoteCommitted) => {
          const renderedHeaders = Object.fromEntries(
            Object.entries(cfg.headers ?? {}).map(([key, value]) => [
              key,
              interpolateVars(value, run.vars),
            ]),
          );
          if (
            !["GET", "DELETE"].includes(cfg.method) &&
            !Object.keys(renderedHeaders).some(
              (key) => key.toLowerCase() === "idempotency-key",
            )
          ) {
            renderedHeaders["Idempotency-Key"] = idempotencyKey;
          }
          const output = await executeHttpRequest(
            {
              method: cfg.method,
              url: interpolateVars(cfg.url, run.vars),
              headers: renderedHeaders,
              body: (() => {
                const boundRequest = resolveBoundDataInput(
                  node,
                  "request",
                  nodes,
                  run.vars,
                );
                if (boundRequest !== undefined) {
                  return JSON.stringify(boundRequest);
                }
                return cfg.body
                  ? interpolateVars(cfg.body, run.vars)
                  : undefined;
              })(),
              response_var: cfg.response_var,
            },
            { signal },
          );
          await remoteCommitted(output, `http:${output.status}`);
          return output;
        },
      );
      if (!executed.ok) {
        return { outcome: "completed" };
      }
      const output = executed.value;
      if (!output) {
        await endRun(db, run.id, "failed", "http_effect_response_missing");
        return { outcome: "completed" };
      }
      const nextVars = { ...run.vars, [cfg.response_var]: output };
      if (
        !(await finalizeDurableNodeEffect(
          db,
          run,
          executed.effect,
          async () => {
            return await persistDurableVariableTransition(
              db,
              run,
              cfg.next_node_key,
              nextVars,
            );
          },
        ))
      ) {
        return { outcome: "completed" };
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (runtimeHook === "wait") {
      const cfg = node.config as {
        amount: number;
        unit: "minutes" | "hours" | "days";
        next_node_key: string;
      };
      const executed: PolicyNodeResult<{
        wake_at: string;
        next_node_key: string;
      }> = await executePolicyNode<{
        wake_at: string;
        next_node_key: string;
      }>(db, run, node, globalExecutionPolicy, async () => {
        const multiplier =
          cfg.unit === "minutes"
            ? 60_000
            : cfg.unit === "hours"
              ? 3_600_000
              : 86_400_000;
        const wakeAt = new Date(
          Date.now() + cfg.amount * multiplier,
        ).toISOString();
        const scheduleArgs = {
          p_run_id: run.id,
          p_flow_version_id: run.flow_version_id,
          p_node_key: node.node_key,
          p_next_node_key: cfg.next_node_key,
          p_wake_at: wakeAt,
        };
        let { error } = await db.rpc("schedule_flow_wait", scheduleArgs);
        if (error) {
          // The RPC returns the existing wait for the same run, so retrying
          // these exact arguments is a read-after-ambiguous operation.
          ({ error } = await db.rpc("schedule_flow_wait", scheduleArgs));
        }
        if (error) throw error;
        return { wake_at: wakeAt, next_node_key: cfg.next_node_key };
      });
      if (!executed.ok) {
        if (executed.nextNodeKey) {
          currentKey = executed.nextNodeKey;
          continue;
        }
        return { outcome: "completed" };
      }
      return { outcome: "advanced" };
    }
    if (runtimeHook === "set_tag") {
      const cfg = node.config as unknown as SetTagNodeConfig;
      const executed = await executeDurableNodeEffect<{
        mode: "add" | "remove";
        tag_id: string;
      }>(
        db,
        run,
        node,
        globalExecutionPolicy,
        `tag:${cfg.mode}:${cfg.tag_id}`,
        async (_signal, _operationId, remoteCommitted) => {
          if (cfg.mode === "add") {
            await addContactTagAndDispatch({
              db,
              accountId: run.account_id,
              contactId: run.contact_id!,
              tagId: cfg.tag_id,
              context: {
                conversation_id: run.conversation_id ?? undefined,
                vars: run.vars,
              },
            });
          } else {
            await removeContactTag(db, {
              accountId: run.account_id,
              contactId: run.contact_id!,
              tagId: cfg.tag_id,
            });
          }
          const result = { mode: cfg.mode, tag_id: cfg.tag_id };
          await remoteCommitted(result, `tag:${cfg.tag_id}`);
          return result;
        },
      );
      if (!executed.ok) {
        return { outcome: "completed" };
      }
      if (
        !(await finalizeDurableNodeEffect(
          db,
          run,
          executed.effect,
          async () => undefined,
          cfg.next_node_key,
        ))
      ) {
        return { outcome: "completed" };
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (runtimeHook === "send_buttons") {
      const executed = await executeDurableNodeEffect<{
        outcome: "advanced";
        node_key: string;
        whatsapp_message_id: string;
      }>(
        db,
        run,
        node,
        globalExecutionPolicy,
        "prompt:initial",
        async (signal, _operationId, remoteCommitted) =>
          sendButtonsAndSuspend(db, run, node, remoteCommitted, signal),
      );
      if (!executed.ok) {
        return { outcome: "completed" };
      }
      if (
        !(await finalizeDurableNodeEffect(
          db,
          run,
          executed.effect,
          async () => {
            await persistOutboundForNode(
              db,
              run,
              node,
              executed.value.whatsapp_message_id,
            );
            await persistPromptAfterCommittedSend(
              db,
              run,
              executed.value.whatsapp_message_id,
            );
            await logEvent(db, run.id, "message_sent", node.node_key, {
              node_type: "send_buttons",
              whatsapp_message_id: executed.value.whatsapp_message_id,
            });
          },
          node.node_key,
        ))
      ) {
        return { outcome: "completed" };
      }
      return { outcome: "advanced" };
    }
    if (runtimeHook === "send_list") {
      const executed = await executeDurableNodeEffect<{
        outcome: "advanced";
        node_key: string;
        whatsapp_message_id: string;
      }>(
        db,
        run,
        node,
        globalExecutionPolicy,
        "prompt:initial",
        async (signal, _operationId, remoteCommitted) =>
          sendListAndSuspend(db, run, node, remoteCommitted, signal),
      );
      if (!executed.ok) {
        return { outcome: "completed" };
      }
      if (
        !(await finalizeDurableNodeEffect(
          db,
          run,
          executed.effect,
          async () => {
            await persistOutboundForNode(
              db,
              run,
              node,
              executed.value.whatsapp_message_id,
            );
            await persistPromptAfterCommittedSend(
              db,
              run,
              executed.value.whatsapp_message_id,
            );
            await logEvent(db, run.id, "message_sent", node.node_key, {
              node_type: "send_list",
              whatsapp_message_id: executed.value.whatsapp_message_id,
            });
          },
          node.node_key,
        ))
      ) {
        return { outcome: "completed" };
      }
      return { outcome: "advanced" };
    }
    if (runtimeHook === "handoff") {
      const executed: PolicyNodeResult<void> = await executePolicyNode<void>(
        db,
        run,
        node,
        globalExecutionPolicy,
        async () => executeHandoff(db, run, node),
      );
      if (!executed.ok) {
        if (executed.nextNodeKey) {
          currentKey = executed.nextNodeKey;
          continue;
        }
        return { outcome: "completed" };
      }
      return { outcome: "handed_off" };
    }
    if (runtimeHook === "end") {
      const executed: PolicyNodeResult<{ status: "completed" }> =
        await executePolicyNode<{ status: "completed" }>(
          db,
          run,
          node,
          globalExecutionPolicy,
          async () => {
            await logEvent(db, run.id, "completed", node.node_key);
            await endRun(db, run.id, "completed", "end_node");
            return { status: "completed" };
          },
        );
      if (!executed.ok && executed.nextNodeKey) {
        currentKey = executed.nextNodeKey;
        continue;
      }
      return { outcome: "completed" };
    }
    // Unknown node type — shouldn't happen given the CHECK constraint.
    await logEvent(db, run.id, "error", node.node_key, {
      reason: `unsupported_runtime_hook:${runtimeHook}`,
    });
    await endRun(db, run.id, "failed", "unsupported_runtime_hook");
    return { outcome: "completed" };
  }
  // Safety break — log + fail.
  await logEvent(db, run.id, "error", currentKey, {
    reason: "advance_loop_safety_break",
  });
  await endRun(db, run.id, "failed", "advance_loop_overflow");
  return { outcome: "completed" };
}

// ============================================================
// Public entry point — the webhook calls this on every inbound.
// ============================================================

export async function dispatchInboundToFlows(
  input: DispatchInboundInput & { isFirstInboundMessage: boolean },
): Promise<DispatchInboundResult> {
  const db = supabaseAdmin();
  try {
    // Receipts are checked before active-run lookup and before flow starts.
    const receipt = await loadInboundReceipt(
      db,
      input.accountId,
      input.contactId,
      input.message.meta_message_id,
    );
    if (receipt) {
      const receiptRun = receipt.flow_run_id
        ? await loadRunById(db, receipt.flow_run_id)
        : null;
      const recoverable =
        receiptRun &&
        receiptRun.account_id === input.accountId &&
        receiptRun.contact_id === input.contactId &&
        receipt.recovery_state === "pending" &&
        ["active", "resuming", "needs_recovery"].includes(
          receiptRun.status,
        ) &&
        receiptRun.current_node_key === receipt.next_node_key &&
        receiptRun.current_visit_id === receipt.next_visit_id;
      if (recoverable) {
        const version = await loadFlowVersion(
          db,
          receiptRun.flow_version_id,
          receiptRun.flow_id,
        );
        if (version) {
          const recovered = await advanceFromNodeKey(
            db,
            receiptRun,
            receipt.next_node_key,
            snapshotNodes(receiptRun.flow_id, version.graph),
            version.graph.fallback_policy.execution,
          );
          return {
            consumed: true,
            flow_run_id: receiptRun.id,
            outcome: recovered.outcome,
          };
        }
      }
      if (
        receiptRun?.account_id === input.accountId &&
        receiptRun.contact_id === input.contactId &&
        receiptRun.status === "needs_recovery" &&
        isAmbiguousLocalTransitionReason(receiptRun.end_reason) &&
        receiptRun.current_node_key &&
        receiptRun.current_visit_id
      ) {
        const version = await loadFlowVersion(
          db,
          receiptRun.flow_version_id,
          receiptRun.flow_id,
        );
        if (version) {
          const recovered = await advanceFromNodeKey(
            db,
            receiptRun,
            receiptRun.current_node_key,
            snapshotNodes(receiptRun.flow_id, version.graph),
            version.graph.fallback_policy.execution,
          );
          return {
            consumed: true,
            flow_run_id: receiptRun.id,
            outcome: recovered.outcome,
          };
        }
      }
      return {
        consumed: true,
        ...(receipt.flow_run_id
          ? { flow_run_id: receipt.flow_run_id }
          : {}),
        outcome: "duplicate_inbound_ignored",
      };
    }

    const activeRun = await loadActiveRunForContact(
      db,
      input.accountId,
      input.contactId,
    );

    // A run may already be active even when this inbound has no receipt.
    // In that case, only its pinned graph is allowed to consume the message.
    if (activeRun) {
      // Never consult the mutable draft: the pinned version owns nodes,
      // trigger semantics, and fallback behavior for the run's lifetime.
      const version = activeRun.flow_version_id
        ? await loadFlowVersion(
            db,
            activeRun.flow_version_id,
            activeRun.flow_id,
          )
        : null;
      if (!version) {
        await logEvent(db, activeRun.id, "error", activeRun.current_node_key, {
          reason: "published_snapshot_unavailable",
          flow_version_id: activeRun.flow_version_id ?? null,
        });
        await endRun(
          db,
          activeRun.id,
          "failed",
          "published_snapshot_unavailable",
        );
        return {
          consumed: true,
          flow_run_id: activeRun.id,
          outcome: "no_match",
        };
      }
      if (
        activeRun.status === "needs_recovery" &&
        isAmbiguousLocalTransitionReason(activeRun.end_reason) &&
        activeRun.current_node_key &&
        activeRun.current_visit_id
      ) {
        const recovered = await advanceFromNodeKey(
          db,
          activeRun,
          activeRun.current_node_key,
          snapshotNodes(activeRun.flow_id, version.graph),
          version.graph.fallback_policy.execution,
        );
        return {
          consumed: true,
          flow_run_id: activeRun.id,
          outcome: recovered.outcome,
        };
      }
      return await handleReplyForActiveRun(
        db,
        activeRun,
        input.message,
        snapshotNodes(activeRun.flow_id, version.graph),
        version.graph.fallback_policy,
      );
    }

    // No active run → look for a flow whose entry trigger matches.
    const flow = await findEntryFlow(
      db,
      input.accountId,
      input.message,
      input.isFirstInboundMessage,
    );
    if (!flow) {
      return { consumed: false, outcome: "no_match" };
    }
    return await startNewRun(
      db,
      flow.flow,
      flow.versionId,
      flow.graph,
      input,
      snapshotNodes(flow.flow.id, flow.graph),
    );
  } catch (err) {
    console.error(
      "[flows] dispatchInboundToFlows threw:",
      err instanceof Error ? err.message : err,
    );
    return {
      consumed: isCommittedSideEffectError(err),
      outcome: "no_match",
    };
  }
}

export async function handleReplyForActiveRun(
  db: AdminClient,
  run: FlowRunRow,
  message: ParsedInbound,
  nodes: Map<string, FlowNodeRow>,
  fallbackPolicy: FlowFallbackPolicy,
): Promise<DispatchInboundResult> {
  const priorTransition = await findCommittedReplyTransition(
    db,
    run.id,
    message.meta_message_id,
  );
  if (priorTransition) {
    if (
      run.current_node_key &&
      run.current_visit_id &&
      priorTransition.recovery_state === "pending" &&
      run.current_node_key === priorTransition.next_node_key &&
      run.current_visit_id === priorTransition.next_visit_id &&
      ["active", "resuming", "needs_recovery"].includes(run.status)
    ) {
      const recovered = await advanceFromNodeKey(
        db,
        run,
        run.current_node_key,
        nodes,
        fallbackPolicy.execution,
      );
      return {
        consumed: true,
        flow_run_id: run.id,
        outcome: recovered.outcome,
      };
    }
    return {
      consumed: true,
      flow_run_id: run.id,
      outcome: "duplicate_inbound_ignored",
    };
  }

  // Note: we intentionally do NOT persist the raw customer text. A
  // `collect_input` prompt that asks "what's your card number?" would
  // otherwise leave the PAN sitting in flow_run_events.payload forever,
  // visible to anyone with access to the runs viewer or the events
  // table. Length is enough for "did they actually reply?" debugging;
  // for the captured value itself, the `node_entered` event already
  // records `captured_key` + `captured_length` after the var is stored.
  const replyEventPayload = {
    meta_message_id: message.meta_message_id,
    reply_kind: message.kind,
    reply_id: message.kind === "interactive_reply" ? message.reply_id : null,
    text_length: message.kind === "text" ? message.text.length : null,
  };

  if (!run.current_node_key) {
    // Defensive — a run with status='active' but no current node is
    // malformed. Fail the run rather than spin.
    await endRun(db, run.id, "failed", "active_run_missing_current_node");
    return {
      consumed: true,
      flow_run_id: run.id,
      outcome: "no_match",
    };
  }

  const currentNode = nodes.get(run.current_node_key) ?? null;
  if (!currentNode) {
    await endRun(db, run.id, "failed", "current_node_not_found");
    return { consumed: true, flow_run_id: run.id, outcome: "no_match" };
  }

  // Two ways a reply can advance:
  //   1. Interactive button/list tap on a send_buttons/send_list node.
  //   2. Text reply on a collect_input node — capture into vars.
  //
  // Everything else falls through to the fallback policy below.
  let matched: string | null = null;
  let capturedVars: Record<string, unknown> | null = null;
  let capturedKey: string | null = null;
  let capturedLength = 0;
  if (
    message.kind === "interactive_reply" &&
    (currentNode.node_type === "send_buttons" ||
      currentNode.node_type === "send_list")
  ) {
    matched = matchReplyId(currentNode, message.reply_id);
  } else if (
    message.kind === "text" &&
    (currentNode.node_type === "send_buttons" ||
      currentNode.node_type === "send_list")
  ) {
    matched = matchTextOptionIndex(currentNode, message.text);
  } else if (
    message.kind === "text" &&
    currentNode.node_type === "collect_input"
  ) {
    const cfg = currentNode.config as unknown as CollectInputNodeConfig;
    const captured = message.text.trim();
    if (
      captured.length > 0 &&
      cfg.var_key &&
      validateCollectedInput(captured, cfg.validation ?? "any", cfg.regex)
    ) {
      // Persist captured value + reset reprompt count atomically.
      capturedVars = { ...run.vars, [cfg.var_key]: captured };
      capturedKey = cfg.var_key;
      capturedLength = captured.length;
      matched = cfg.next_node_key;
    }
  }

  if (matched) {
    const committed = await commitReplyTransition(
      db,
      run,
      matched,
      message.meta_message_id,
      capturedVars,
    );
    if (committed.duplicate) {
      return {
        consumed: true,
        flow_run_id: run.id,
        outcome: "duplicate_inbound_ignored",
      };
    }
    run.current_node_key = committed.current_node_key;
    run.current_visit_id = committed.current_visit_id;
    run.continuation_step = committed.continuation_step;
    run.vars = committed.run_vars;
    run.reprompt_count = committed.reprompt_count;
    await logEvent(
      db,
      run.id,
      "reply_received",
      currentNode.node_key,
      replyEventPayload,
    );
    if (capturedKey) {
      await logEvent(db, run.id, "node_entered", currentNode.node_key, {
        captured_key: capturedKey,
        captured_length: capturedLength,
      });
    }
    const outcome = await advanceFromNodeKey(
      db,
      run,
      matched,
      nodes,
      fallbackPolicy.execution,
    );
    return {
      consumed: true,
      flow_run_id: run.id,
      outcome: outcome.outcome,
    };
  }

  // No match → fallback. Apply the policy.
  await logEvent(
    db,
    run.id,
    "reply_received",
    currentNode.node_key,
    replyEventPayload,
  );
  const policy = fallbackPolicy;
  const newReprompts = run.reprompt_count + 1;

  const action = decideFallback({ policy, reprompt_count: newReprompts });
  await logEvent(db, run.id, "fallback_fired", run.current_node_key, {
    action: action.type,
    reprompt_count: newReprompts,
  });
  if (action.type === "reprompt") {
    // A reprompt is another execution attempt for the current node. Keep the
    // stored counter unchanged unless the prompt was actually sent; exhausted
    // fail_branch/default_value policies advance instead of falsely suspending.
    let executed: DurableEffectResult<{
      whatsapp_message_id: string;
    }> | null = null;
    if (currentNode.node_type === "send_buttons") {
      executed = await executeDurableNodeEffect(
        db,
        run,
        currentNode,
        fallbackPolicy.execution,
        `prompt:reprompt:${newReprompts}`,
        async (signal, _operationId, remoteCommitted) =>
          sendButtonsAndSuspend(db, run, currentNode, remoteCommitted, signal),
      );
    } else if (currentNode.node_type === "send_list") {
      executed = await executeDurableNodeEffect(
        db,
        run,
        currentNode,
        fallbackPolicy.execution,
        `prompt:reprompt:${newReprompts}`,
        async (signal, _operationId, remoteCommitted) =>
          sendListAndSuspend(db, run, currentNode, remoteCommitted, signal),
      );
    } else if (currentNode.node_type === "collect_input") {
      // Customer typed something we couldn't accept (empty after trim,
      // or var_key missing — rare). Re-send the prompt so they try again.
      const cfg = currentNode.config as unknown as CollectInputNodeConfig;
      executed = await executeDurableNodeEffect(
        db,
        run,
        currentNode,
        fallbackPolicy.execution,
        `prompt:reprompt:${newReprompts}`,
        async (signal, _operationId, remoteCommitted) =>
          engineSendText({
            accountId: run.account_id,
            userId: run.user_id,
            conversationId: run.conversation_id!,
            contactId: run.contact_id!,
            text: interpolateVars(cfg.prompt_text, run.vars),
            signal,
            onRemoteCommitted: (result) =>
              remoteCommitted(result, result.whatsapp_message_id),
          }),
      );
    }
    if (executed && !executed.ok) {
      return { consumed: true, flow_run_id: run.id, outcome: "completed" };
    }
    if (
      executed?.ok &&
      !(await finalizeRepromptEffect(
        db,
        run,
        executed.effect,
        newReprompts,
        message.meta_message_id,
        async () => {
          await persistOutboundForNode(
            db,
            run,
            currentNode,
            executed.value.whatsapp_message_id,
          );
          await persistPromptAfterCommittedSend(
            db,
            run,
            executed.value.whatsapp_message_id,
          );
        },
      ))
    ) {
      return { consumed: true, flow_run_id: run.id, outcome: "completed" };
    }
    return { consumed: true, flow_run_id: run.id, outcome: "fallback_fired" };
  }

  if (
    !(await finalizeFallbackDecision(
      db,
      run,
      message.meta_message_id,
      newReprompts,
      action.type,
    ))
  ) {
    return { consumed: true, flow_run_id: run.id, outcome: "completed" };
  }
  if (action.type === "ignore") {
    // Don't consume — let automations have a shot at it.
    return { consumed: false, flow_run_id: run.id, outcome: "no_match" };
  }
  if (action.type === "handoff") {
    await logEvent(db, run.id, "handoff", run.current_node_key, {
      reason: "fallback_exhausted",
    });
    return { consumed: true, flow_run_id: run.id, outcome: "handed_off" };
  }
  return { consumed: true, flow_run_id: run.id, outcome: "completed" };
}

async function startNewRun(
  db: AdminClient,
  flow: FlowRow,
  versionId: string,
  graph: FlowVersionGraph,
  input: DispatchInboundInput,
  nodes: Map<string, FlowNodeRow>,
): Promise<DispatchInboundResult> {
  let initialVars: Record<string, unknown>;
  try {
    initialVars = initializeFlowVariables(graph.variable_schema);
  } catch (error) {
    console.error(
      "[flows] required variable initialization failed:",
      error instanceof Error ? error.message : String(error),
    );
    return { consumed: false, outcome: "no_match" };
  }
  // INSERT — partial unique index `idx_one_active_run_per_contact`
  // catches concurrent inserts with 23505. We catch and return as
  // consumed:true (the parallel webhook handles it).
  const { data: inserted, error: insErr } = await db
    .from("flow_runs")
    .insert({
      flow_id: flow.id,
      flow_version_id: versionId,
      // Tenancy: NOT NULL post-017. The partial unique index
      // `idx_one_active_run_per_contact` is over (account_id,
      // contact_id) WHERE status='active', so two accounts sharing
      // a contact phone number each run their own flows independently.
      account_id: flow.account_id,
      // Audit: preserves the flow's author on the run row for log
      // attribution.
      user_id: flow.user_id,
      contact_id: input.contactId,
      conversation_id: input.conversationId,
      status: "active",
      current_node_key: graph.entry_node_key,
      vars: initialVars,
    })
    .select("*")
    .maybeSingle();
  if (insErr) {
    // 23505 = unique_violation → another webhook is starting the run.
    const msg = insErr.message ?? "";
    if (msg.includes("23505") || msg.includes("duplicate key")) {
      return { consumed: true, outcome: "duplicate_inbound_ignored" };
    }
    console.error("[flows] startNewRun insert error:", insErr.message);
    return { consumed: false, outcome: "no_match" };
  }
  const run = inserted as FlowRunRow;
  await logEvent(db, run.id, "started", graph.entry_node_key, {
    flow_id: flow.id,
    flow_version_id: versionId,
    trigger_type: graph.trigger.type,
    meta_message_id: input.message.meta_message_id,
  });
  // Bump the flow's execution counter — used by the builder UI to
  // surface "X runs since activation" on the flow card.
  //
  // Atomic RPC (migration 012) rather than read-modify-write: two
  // concurrent webhooks starting runs for different contacts on the
  // same flow would otherwise both read N and both write N+1, losing
  // a count. Mirrors the automations engine's use of
  // `increment_automation_execution_count` (migration 007).
  const { error: incErr } = await db.rpc("increment_flow_execution_count", {
    p_flow_id: flow.id,
  });
  if (incErr) {
    // Non-fatal — the run itself succeeded; only the counter is off.
    console.error("[flows] execution_count rpc error:", incErr.message);
  }

  // Run the advance loop starting from the entry node.
  const outcome = await advanceFromNodeKey(
    db,
    run,
    graph.entry_node_key,
    nodes,
    graph.fallback_policy.execution,
  );
  return {
    consumed: true,
    flow_run_id: run.id,
    outcome: outcome.outcome === "advanced" ? "started" : outcome.outcome,
  };
}
