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
    .eq("status", "active")
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
 * Idempotency check — has a `reply_received` event with this Meta
 * message_id already been recorded for any of the contact's flow
 * runs? If yes, the inbound is a duplicate (Meta retry) and we
 * exit without re-advancing.
 *
 * Implementation note: scoped to runs belonging to this user/contact
 * so the lookup is cheap (the index on flow_run_events(flow_run_id,
 * event_type) plus the small set of runs per contact).
 */
async function isDuplicateInbound(
  db: AdminClient,
  accountId: string,
  contactId: string,
  metaMessageId: string,
): Promise<boolean> {
  // Fetch ALL run ids for this contact in this account (active +
  // historical). Bounded by how many flows the customer has been
  // through — small.
  const { data: runs } = await db
    .from("flow_runs")
    .select("id")
    .eq("account_id", accountId)
    .eq("contact_id", contactId);
  if (!runs?.length) return false;
  const runIds = runs.map((r) => (r as { id: string }).id);

  const { count } = await db
    .from("flow_run_events")
    .select("id", { count: "exact", head: true })
    .in("flow_run_id", runIds)
    .eq("event_type", "reply_received")
    .filter("payload->>meta_message_id", "eq", metaMessageId);
  return (count ?? 0) > 0;
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

async function executePolicyNode<T>(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
  globalPolicy: PartialNodeExecutionPolicy | undefined,
  operation: (signal: AbortSignal, operationId: string) => Promise<T>,
): Promise<PolicyNodeResult<T>> {
  // Z-API executors consume this signal all the way through fetch. Supabase
  // query builders and tag helpers do not currently expose AbortSignal; a
  // timeout is therefore non-retryable so unabortable late completion is
  // never followed by an automatic duplicate attempt.
  const policy = resolveNodeExecutionPolicy(globalPolicy, node.config);
  const operationId = crypto.randomUUID();
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
        await finishNodeExecutionRecord(db, executionIds.get(attempt) ?? null, {
          status: "completed",
          duration_ms: Math.max(0, Math.round(durationMs)),
          outputs: value,
        });
      },
      onAttemptError: async (attempt, error, durationMs) => {
        const sanitized = sanitizeExecutionError(error);
        await finishNodeExecutionRecord(db, executionIds.get(attempt) ?? null, {
          status: "error",
          duration_ms: Math.max(0, Math.round(durationMs)),
          error: sanitized,
        });
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
      await endRun(
        db,
        run.id,
        "failed",
        "side_effect_committed_local_persistence_failed",
      );
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
    if (policy.on_error === "default_value") {
      const { error: varsError } = await db
        .from("flow_runs")
        .update({ vars: resolution.vars })
        .eq("id", run.id);
      if (varsError) {
        await logEvent(db, run.id, "error", node.node_key, {
          reason: "default_value_persist_failed",
          error: sanitizeExecutionError(varsError),
        });
        await endRun(db, run.id, "failed", "default_value_persist_failed");
        return { ok: false };
      }
      run.vars = resolution.vars;
    }
    await logEvent(db, run.id, "node_entered", node.node_key, {
      error_action: policy.on_error,
      advancing_to: resolution.nextNodeKey,
    });
    return { ok: false, nextNodeKey: resolution.nextNodeKey };
  }
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

async function advanceAfterCommittedSend(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
  whatsappMessageId: string,
): Promise<void> {
  try {
    const advanced = await advanceCurrentNodeKey(
      db,
      run.id,
      run.current_node_key,
      node.node_key,
    );
    if (!advanced) {
      await logEvent(db, run.id, "error", node.node_key, {
        reason: "lost_race_during_advance",
      });
    }
  } catch (error) {
    throw new CommittedSideEffectError(
      "WhatsApp message was sent but the flow run pointer could not advance",
      {
        externalReference: whatsappMessageId,
        persistenceStage: "flow_run_node_advance",
        cause: error,
      },
    );
  }
}

async function sendButtonsAndSuspend(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow,
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
  });
  await logEvent(db, run.id, "message_sent", node.node_key, {
    node_type: "send_buttons",
    whatsapp_message_id,
  });
  await persistPromptAfterCommittedSend(db, run, whatsapp_message_id);
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
  });
  await logEvent(db, run.id, "message_sent", node.node_key, {
    node_type: "send_list",
    whatsapp_message_id,
  });
  await persistPromptAfterCommittedSend(db, run, whatsapp_message_id);
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
  if (source.node_type === "collect_input" && sourceHandle === "value") {
    const key = source.config.var_key;
    return typeof key === "string" ? vars[key] : undefined;
  }
  if (
    (source.node_type as string) === "http_request" &&
    sourceHandle === "response"
  ) {
    const key = source.config.response_var;
    return typeof key === "string" ? vars[key] : undefined;
  }
  if (source.node_type === "variable_set" && sourceHandle === "variables") {
    return vars;
  }
  return undefined;
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
      currentKey = cfg.next_node_key;
      continue;
    }
    if (runtimeHook === "send_message") {
      const cfg = node.config as unknown as SendMessageNodeConfig;
      const executed: PolicyNodeResult<{ whatsapp_message_id: string }> =
        await executePolicyNode<{ whatsapp_message_id: string }>(
          db,
          run,
          node,
          globalExecutionPolicy,
          async (signal) =>
            engineSendText({
              accountId: run.account_id,
              userId: run.user_id,
              conversationId: run.conversation_id!,
              contactId: run.contact_id!,
              text: interpolateVars(cfg.text, run.vars),
              signal,
            }),
        );
      if (!executed.ok) {
        if (executed.nextNodeKey) {
          currentKey = executed.nextNodeKey;
          continue;
        }
        return { outcome: "completed" };
      }
      await logEvent(db, run.id, "message_sent", node.node_key, {
        node_type: "send_message",
        whatsapp_message_id: executed.value.whatsapp_message_id,
      });
      currentKey = cfg.next_node_key;
      continue;
    }
    if (runtimeHook === "send_media") {
      const cfg = node.config as unknown as SendMediaNodeConfig;
      const executed: PolicyNodeResult<{ whatsapp_message_id: string }> =
        await executePolicyNode<{ whatsapp_message_id: string }>(
          db,
          run,
          node,
          globalExecutionPolicy,
          async (signal) =>
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
            }),
        );
      if (!executed.ok) {
        if (executed.nextNodeKey) {
          currentKey = executed.nextNodeKey;
          continue;
        }
        return { outcome: "completed" };
      }
      await logEvent(db, run.id, "message_sent", node.node_key, {
        node_type: "send_media",
        media_type: cfg.media_type,
        whatsapp_message_id: executed.value.whatsapp_message_id,
      });
      currentKey = cfg.next_node_key;
      continue;
    }
    if (runtimeHook === "collect_input") {
      // Send the prompt and suspend. Customer's next TEXT reply will
      // wake us up via handleReplyForActiveRun's collect_input branch.
      const cfg = node.config as unknown as CollectInputNodeConfig;
      const executed: PolicyNodeResult<{ whatsapp_message_id: string }> =
        await executePolicyNode<{ whatsapp_message_id: string }>(
          db,
          run,
          node,
          globalExecutionPolicy,
          async (signal) => {
            const sent = await engineSendText({
              accountId: run.account_id,
              userId: run.user_id,
              conversationId: run.conversation_id!,
              contactId: run.contact_id!,
              text: interpolateVars(cfg.prompt_text, run.vars),
              signal,
            });
            await persistPromptAfterCommittedSend(
              db,
              run,
              sent.whatsapp_message_id,
            );
            await advanceAfterCommittedSend(
              db,
              run,
              node,
              sent.whatsapp_message_id,
            );
            return sent;
          },
        );
      if (!executed.ok) {
        if (executed.nextNodeKey) {
          currentKey = executed.nextNodeKey;
          continue;
        }
        return { outcome: "completed" };
      }
      const { whatsapp_message_id } = executed.value;
      await logEvent(db, run.id, "message_sent", node.node_key, {
        node_type: "collect_input",
        whatsapp_message_id,
      });
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
      currentKey = branch === "true" ? cfg.true_next : cfg.false_next;
      await logEvent(db, run.id, "node_entered", node.node_key, {
        condition_result: branch,
        advancing_to: currentKey,
      });
      continue;
    }
    if (runtimeHook === "switch") {
      const cfg = node.config as {
        subject: "var" | "contact_field";
        subject_key: string;
        cases: SwitchCase[];
        default_next: string;
      };
      const executed: PolicyNodeResult<string> = await executePolicyNode<string>(
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
      currentKey = executed.value;
      await logEvent(db, run.id, "node_entered", node.node_key, {
        switch_case_next: currentKey,
      });
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
          const { error } = await db
            .from("flow_runs")
            .update({ vars: nextVars })
            .eq("id", run.id);
          if (error) throw error;
          run.vars = nextVars;
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
      currentKey = cfg.next_node_key;
      continue;
    }
    if (runtimeHook === "http_request") {
      const cfg = node.config as unknown as HttpRequestConfig & {
        next_node_key: string;
      };
      const executed: PolicyNodeResult<HttpRequestOutput> =
        await executePolicyNode<HttpRequestOutput>(
        db,
        run,
        node,
        globalExecutionPolicy,
        async (signal, idempotencyKey) => {
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
          const nextVars = { ...run.vars, [cfg.response_var]: output };
          const { error } = await db
            .from("flow_runs")
            .update({ vars: nextVars })
            .eq("id", run.id);
          if (error) {
            throw new CommittedSideEffectError(
              "HTTP response was received but flow variables could not be persisted",
              {
                externalReference: `http:${output.status}`,
                persistenceStage: "flow_run_vars_update",
                cause: error,
              },
            );
          }
          run.vars = nextVars;
          return output;
        },
      );
      if (!executed.ok) {
        if (executed.nextNodeKey) {
          currentKey = executed.nextNodeKey;
          continue;
        }
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
      }>(
        db,
        run,
        node,
        globalExecutionPolicy,
        async () => {
          const multiplier =
            cfg.unit === "minutes"
              ? 60_000
              : cfg.unit === "hours"
                ? 3_600_000
                : 86_400_000;
          const wakeAt = new Date(
            Date.now() + cfg.amount * multiplier,
          ).toISOString();
          const { error } = await db.rpc("schedule_flow_wait", {
            p_run_id: run.id,
            p_flow_version_id: run.flow_version_id,
            p_node_key: node.node_key,
            p_next_node_key: cfg.next_node_key,
            p_wake_at: wakeAt,
          });
          if (error) throw error;
          return { wake_at: wakeAt, next_node_key: cfg.next_node_key };
        },
      );
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
      const executed: PolicyNodeResult<{
        mode: "add" | "remove";
        tag_id: string;
      }> = await executePolicyNode<{
        mode: "add" | "remove";
        tag_id: string;
      }>(db, run, node, globalExecutionPolicy, async () => {
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
        return { mode: cfg.mode, tag_id: cfg.tag_id };
      });
      if (!executed.ok) {
        if (executed.nextNodeKey) {
          currentKey = executed.nextNodeKey;
          continue;
        }
        return { outcome: "completed" };
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (runtimeHook === "send_buttons") {
      const executed: PolicyNodeResult<{
        outcome: "advanced";
        node_key: string;
        whatsapp_message_id: string;
      }> = await executePolicyNode<{
        outcome: "advanced";
        node_key: string;
        whatsapp_message_id: string;
      }>(db, run, node, globalExecutionPolicy, async (signal) => {
        const sent = await sendButtonsAndSuspend(db, run, node, signal);
        await advanceAfterCommittedSend(
          db,
          run,
          node,
          sent.whatsapp_message_id,
        );
        return sent;
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
    if (runtimeHook === "send_list") {
      const executed: PolicyNodeResult<{
        outcome: "advanced";
        node_key: string;
        whatsapp_message_id: string;
      }> = await executePolicyNode<{
        outcome: "advanced";
        node_key: string;
        whatsapp_message_id: string;
      }>(db, run, node, globalExecutionPolicy, async (signal) => {
        const sent = await sendListAndSuspend(db, run, node, signal);
        await advanceAfterCommittedSend(
          db,
          run,
          node,
          sent.whatsapp_message_id,
        );
        return sent;
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

/**
 * Optimistic UPDATE — only advance current_node_key when it matches
 * the value we read at the top of dispatch. If another webhook beat
 * us, the row's pointer has already moved and our UPDATE returns
 * zero rows; we treat that as a no-op and let the other run continue.
 */
async function advanceCurrentNodeKey(
  db: AdminClient,
  runId: string,
  expectedOldKey: string | null,
  newKey: string,
): Promise<boolean> {
  // PostgREST: when expectedOldKey is null we can't `.eq` (would match
  // any row); use `.is('current_node_key', null)` instead.
  let q = db
    .from("flow_runs")
    .update({
      current_node_key: newKey,
      last_advanced_at: new Date().toISOString(),
    })
    .eq("id", runId)
    .eq("status", "active");
  if (expectedOldKey === null) {
    q = q.is("current_node_key", null);
  } else {
    q = q.eq("current_node_key", expectedOldKey);
  }
  const { data, error } = await q.select("id");
  if (error) {
    console.error("[flows] advanceCurrentNodeKey error:", error.message);
    throw error;
  }
  return Array.isArray(data) && data.length > 0;
}

// ============================================================
// Public entry point — the webhook calls this on every inbound.
// ============================================================

export async function dispatchInboundToFlows(
  input: DispatchInboundInput & { isFirstInboundMessage: boolean },
): Promise<DispatchInboundResult> {
  const db = supabaseAdmin();
  try {
    const activeRun = await loadActiveRunForContact(
      db,
      input.accountId,
      input.contactId,
    );

    // Idempotency — only matters if there's already a run for this
    // contact. For new runs, the partial unique index catches duplicate
    // starts at INSERT time.
    if (activeRun) {
      const dupe = await isDuplicateInbound(
        db,
        input.accountId,
        input.contactId,
        input.message.meta_message_id,
      );
      if (dupe) {
        return {
          consumed: true,
          flow_run_id: activeRun.id,
          outcome: "duplicate_inbound_ignored",
        };
      }
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
      return handleReplyForActiveRun(
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
    return startNewRun(
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
    return { consumed: false, outcome: "no_match" };
  }
}

export async function handleReplyForActiveRun(
  db: AdminClient,
  run: FlowRunRow,
  message: ParsedInbound,
  nodes: Map<string, FlowNodeRow>,
  fallbackPolicy: FlowFallbackPolicy,
): Promise<DispatchInboundResult> {
  // Note: we intentionally do NOT persist the raw customer text. A
  // `collect_input` prompt that asks "what's your card number?" would
  // otherwise leave the PAN sitting in flow_run_events.payload forever,
  // visible to anyone with access to the runs viewer or the events
  // table. Length is enough for "did they actually reply?" debugging;
  // for the captured value itself, the `node_entered` event already
  // records `captured_key` + `captured_length` after the var is stored.
  await logEvent(db, run.id, "reply_received", run.current_node_key, {
    meta_message_id: message.meta_message_id,
    reply_kind: message.kind,
    reply_id: message.kind === "interactive_reply" ? message.reply_id : null,
    text_length: message.kind === "text" ? message.text.length : null,
  });

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
      validateCollectedInput(
        captured,
        cfg.validation ?? "any",
        cfg.regex,
      )
    ) {
      // Persist captured value + reset reprompt count atomically.
      const newVars = { ...run.vars, [cfg.var_key]: captured };
      const { error: capErr } = await db
        .from("flow_runs")
        .update({
          vars: newVars,
          reprompt_count: 0,
        })
        .eq("id", run.id);
      if (!capErr) {
        // Mirror the UPDATE in-memory so downstream interpolation in
        // the advance loop sees the captured var without us having to
        // re-SELECT the whole row.
        run.vars = newVars;
        run.reprompt_count = 0;
        await logEvent(db, run.id, "node_entered", currentNode.node_key, {
          captured_key: cfg.var_key,
          captured_length: captured.length,
        });
        matched = cfg.next_node_key;
      }
    }
  }

  if (matched) {
    // Reset reprompt count on a successful match. Skip the write when
    // already 0 — the collect_input capture branch above already
    // zeroed it, and interactive-reply matches against a fresh run
    // (post-prior-reset) are also already 0. The previous re-read of
    // the whole row was needed only because we weren't mirroring the
    // capture UPDATE into the in-memory `run`; now that we do, the
    // local copy is the source of truth.
    if (run.reprompt_count !== 0) {
      const { error } = await db
        .from("flow_runs")
        .update({ reprompt_count: 0 })
        .eq("id", run.id);
      if (!error) run.reprompt_count = 0;
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
    let executed: PolicyNodeResult<unknown> | null = null;
    if (currentNode.node_type === "send_buttons") {
      executed = await executePolicyNode(
        db,
        run,
        currentNode,
        fallbackPolicy.execution,
        async (signal) => sendButtonsAndSuspend(db, run, currentNode, signal),
      );
    } else if (currentNode.node_type === "send_list") {
      executed = await executePolicyNode(
        db,
        run,
        currentNode,
        fallbackPolicy.execution,
        async (signal) => sendListAndSuspend(db, run, currentNode, signal),
      );
    } else if (currentNode.node_type === "collect_input") {
      // Customer typed something we couldn't accept (empty after trim,
      // or var_key missing — rare). Re-send the prompt so they try again.
      const cfg = currentNode.config as unknown as CollectInputNodeConfig;
      executed = await executePolicyNode(
        db,
        run,
        currentNode,
        fallbackPolicy.execution,
        async (signal) =>
          engineSendText({
            accountId: run.account_id,
            userId: run.user_id,
            conversationId: run.conversation_id!,
            contactId: run.contact_id!,
            text: interpolateVars(cfg.prompt_text, run.vars),
            signal,
          }),
      );
    }
    if (executed && !executed.ok) {
      if (executed.nextNodeKey) {
        const outcome = await advanceFromNodeKey(
          db,
          run,
          executed.nextNodeKey,
          nodes,
          fallbackPolicy.execution,
        );
        return {
          consumed: true,
          flow_run_id: run.id,
          outcome: outcome.outcome,
        };
      }
      return { consumed: true, flow_run_id: run.id, outcome: "completed" };
    }
    const { error } = await db
      .from("flow_runs")
      .update({ reprompt_count: newReprompts })
      .eq("id", run.id);
    if (!error) run.reprompt_count = newReprompts;
    return { consumed: true, flow_run_id: run.id, outcome: "fallback_fired" };
  }

  // Non-reprompt fallback actions count the rejected reply immediately. A
  // reprompt defers this write until its send succeeds above.
  await db
    .from("flow_runs")
    .update({ reprompt_count: newReprompts })
    .eq("id", run.id);
  if (action.type === "ignore") {
    // Don't consume — let automations have a shot at it.
    return { consumed: false, flow_run_id: run.id, outcome: "no_match" };
  }
  if (action.type === "handoff") {
    if (run.conversation_id) {
      await db
        .from("conversations")
        .update({ status: "pending", updated_at: new Date().toISOString() })
        .eq("id", run.conversation_id);
    }
    await logEvent(db, run.id, "handoff", run.current_node_key, {
      reason: "fallback_exhausted",
    });
    await endRun(db, run.id, "handed_off", "fallback_exhausted");
    return { consumed: true, flow_run_id: run.id, outcome: "handed_off" };
  }
  // action.type === 'end'
  await endRun(db, run.id, "completed", "fallback_exhausted_end");
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
