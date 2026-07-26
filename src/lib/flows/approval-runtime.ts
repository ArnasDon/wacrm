import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveNodeExecutionPolicy } from "./execution-policy";
import type { PartialNodeExecutionPolicy } from "./registry";
import type { FlowNodeRow, FlowRunRow } from "./types";
import {
  parseFlowVersionGraph,
  versionGraphNodes,
  type FlowVersionGraph,
} from "./versions";

export interface ApprovalNodeRuntimeConfig
  extends Record<string, unknown> {
  title: string;
  message: string;
  assignee_user_id: string;
  timeout_hours: number;
  approved_next: string;
  rejected_next: string;
}

export type ApprovalTimeoutResolution =
  | { action: "fail" }
  | { action: "branch" | "default"; nextNodeKey: string };

export function resolveApprovalTimeout(
  globalPolicy: PartialNodeExecutionPolicy | undefined,
  config: Pick<
    ApprovalNodeRuntimeConfig,
    "approved_next" | "rejected_next"
  > &
    PartialNodeExecutionPolicy,
): ApprovalTimeoutResolution {
  const policy = resolveNodeExecutionPolicy(
    globalPolicy,
    config as unknown as Record<string, unknown>,
  );
  if (policy.on_error === "fail_branch" && policy.error_next_node_key) {
    return { action: "branch", nextNodeKey: policy.error_next_node_key };
  }
  if (policy.on_error === "default_value") {
    // Human approval must never be synthesized as approved. The deterministic
    // safe default is the explicit rejected branch.
    return { action: "default", nextNodeKey: config.rejected_next };
  }
  return { action: "fail" };
}

function interpolateApprovalCopy(
  value: string,
  vars: Readonly<Record<string, unknown>>,
): string {
  return value.replace(/\{\{\s*vars\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (
    _match,
    key: string,
  ) => {
    const resolved = vars[key];
    return resolved === null || resolved === undefined
      ? ""
      : typeof resolved === "object"
        ? JSON.stringify(resolved)
        : String(resolved);
  });
}

export async function scheduleFlowApproval(
  db: SupabaseClient,
  run: FlowRunRow,
  node: FlowNodeRow,
  globalPolicy?: PartialNodeExecutionPolicy,
): Promise<void> {
  if (!run.current_visit_id) throw new Error("approval_visit_missing");
  const config = node.config as ApprovalNodeRuntimeConfig;
  const timeout = resolveApprovalTimeout(globalPolicy, config);
  const args = {
    p_run_id: run.id,
    p_flow_id: run.active_flow_id ?? run.flow_id,
    p_flow_version_id:
      run.active_flow_version_id ?? run.flow_version_id,
    p_node_key: node.node_key,
    p_visit_id: run.current_visit_id,
    p_attempt: 1,
    p_assignee_user_id: config.assignee_user_id,
    p_title: interpolateApprovalCopy(config.title, run.vars).slice(0, 120),
    p_message: interpolateApprovalCopy(config.message, run.vars).slice(
      0,
      2_000,
    ),
    p_expires_at: new Date(
      Date.now() + config.timeout_hours * 60 * 60 * 1_000,
    ).toISOString(),
    p_approved_next: config.approved_next,
    p_rejected_next: config.rejected_next,
    p_timeout_action: timeout.action,
    p_timeout_next: "nextNodeKey" in timeout ? timeout.nextNodeKey : null,
  };
  let { data, error } = await db.rpc("schedule_flow_approval", args);
  if (error || !Array.isArray(data) || !data[0]) {
    // Same immutable arguments are idempotent; retry covers a committed RPC
    // whose response was lost without creating a second request/notification.
    ({ data, error } = await db.rpc("schedule_flow_approval", args));
  }
  if (error || !Array.isArray(data) || !data[0]) {
    throw error ?? new Error("approval_schedule_failed");
  }
  run.status = "paused_by_agent";
}

interface ClaimedApproval {
  id: string;
  flow_run_id: string;
  flow_version_id: string;
  node_key: string;
  decision: "approved" | "rejected" | "timed_out";
  resolution_token: string;
  resume_id: string;
  run_row?: unknown;
}

interface ApprovalResumeStats {
  claimed: number;
  resumed: number;
  failed: number;
}

type Advance = (
  db: ReturnType<typeof import("./admin-client").supabaseAdmin>,
  run: FlowRunRow,
  startNodeKey: string,
  nodes: Map<string, FlowNodeRow>,
  globalPolicy?: PartialNodeExecutionPolicy,
) => Promise<{ outcome: "advanced" | "completed" | "handed_off" }>;

async function loadPinnedGraph(
  db: SupabaseClient,
  flowVersionId: string,
): Promise<{ flowId: string; graph: FlowVersionGraph } | null> {
  const { data, error } = await db
    .from("flow_versions")
    .select("id, flow_id, graph")
    .eq("id", flowVersionId)
    .maybeSingle();
  if (error || !data) return null;
  try {
    return {
      flowId: data.flow_id as string,
      graph: parseFlowVersionGraph(data.graph),
    };
  } catch {
    return null;
  }
}

function claimRun(
  claim: ClaimedApproval,
  flowId: string,
  nextNodeKey: string,
): FlowRunRow {
  if (
    claim.run_row &&
    typeof claim.run_row === "object" &&
    !Array.isArray(claim.run_row)
  ) {
    return claim.run_row as FlowRunRow;
  }
  return {
    id: claim.flow_run_id,
    flow_id: flowId,
    flow_version_id: claim.flow_version_id,
    active_flow_id: flowId,
    active_flow_version_id: claim.flow_version_id,
    account_id: "",
    user_id: "",
    contact_id: null,
    conversation_id: null,
    status: "resuming",
    current_node_key: nextNodeKey,
    current_visit_id: claim.resume_id,
    continuation_id: claim.resume_id,
    continuation_phase: "running",
    continuation_step: 0,
    last_prompt_message_id: null,
    vars: {},
    reprompt_count: 0,
    started_at: "",
    last_advanced_at: "",
    ended_at: null,
    end_reason: null,
  };
}

/**
 * Claims resolved approvals in bounded batches. The database prepares the
 * immutable-version cursor atomically; this worker only verifies that pinned
 * edge, advances it, and acknowledges the claim token.
 */
export async function resumeFlowApprovalResolutions(
  db: SupabaseClient,
  options: {
    requestId?: string;
    limit?: number;
    advance?: Advance;
  } = {},
): Promise<ApprovalResumeStats> {
  const { data, error } = await db.rpc(
    "claim_flow_approval_resolutions",
    {
      p_request_id: options.requestId ?? null,
      p_limit: options.limit ?? 100,
    },
  );
  if (error) throw error;
  const claims = (data ?? []) as ClaimedApproval[];
  const stats = { claimed: claims.length, resumed: 0, failed: 0 };
  const engine = options.advance ? null : await import("./engine");
  const advance = options.advance ?? engine!.advanceFromNodeKey;

  for (const claim of claims) {
    try {
      const pinned = await loadPinnedGraph(db, claim.flow_version_id);
      const approvalNode = pinned?.graph.nodes.find(
        (node) =>
          node.node_key === claim.node_key && node.node_type === "approval",
      );
      if (!pinned || !approvalNode) {
        stats.failed += 1;
        continue;
      }
      const config = approvalNode.config as ApprovalNodeRuntimeConfig;
      const timeout = resolveApprovalTimeout(
        pinned.graph.fallback_policy.execution,
        config,
      );
      const expectedNext =
        claim.decision === "approved"
          ? config.approved_next
          : claim.decision === "rejected"
            ? config.rejected_next
            : "nextNodeKey" in timeout
              ? timeout.nextNodeKey
              : null;
      if (!expectedNext) {
        // fail_run timeouts are completed entirely inside the claim RPC.
        stats.failed += 1;
        continue;
      }
      const run = claimRun(claim, pinned.flowId, expectedNext);
      if (
        run.flow_version_id !== claim.flow_version_id &&
        run.active_flow_version_id !== claim.flow_version_id
      ) {
        stats.failed += 1;
        continue;
      }
      const needsAdvance =
        run.continuation_id === claim.resume_id &&
        run.current_node_key === expectedNext &&
        run.status === "resuming";
      const alreadyAdvanced =
        run.current_node_key !== claim.node_key &&
        run.current_node_key !== expectedNext &&
        run.status !== "paused_by_agent";
      if (!needsAdvance && !alreadyAdvanced) {
        stats.failed += 1;
        continue;
      }
      if (needsAdvance) {
        const nodes = new Map(
          versionGraphNodes(pinned.graph, pinned.flowId).map((node) => [
            node.node_key,
            node,
          ]),
        );
        await advance(
          db as ReturnType<typeof import("./admin-client").supabaseAdmin>,
          run,
          expectedNext,
          nodes,
          pinned.graph.fallback_policy.execution,
        );
        if (engine) {
          await engine.recoverFailedSubFlowRun(
            db as ReturnType<typeof import("./admin-client").supabaseAdmin>,
            run,
          );
        }
      }
      const ackArgs = {
        p_request_id: claim.id,
        p_resolution_token: claim.resolution_token,
        p_flow_version_id: claim.flow_version_id,
      };
      let { data: completed, error: ackError } = await db.rpc(
        "complete_flow_approval_resolution",
        ackArgs,
      );
      if (ackError || completed !== true) {
        ({ data: completed, error: ackError } = await db.rpc(
          "complete_flow_approval_resolution",
          ackArgs,
        ));
      }
      if (ackError || completed !== true) {
        stats.failed += 1;
        continue;
      }
      stats.resumed += 1;
    } catch {
      stats.failed += 1;
    }
  }
  return stats;
}
