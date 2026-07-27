import type { SupabaseClient } from "@supabase/supabase-js";

import { startFlowRunFromTrigger } from "./engine";
import type { FlowRow, FlowVersionRow } from "./types";
import {
  getFlowEntryTrigger,
  parseFlowVersionGraph,
  versionGraphNodes,
} from "./versions";

interface ClaimedTriggerInvocation {
  id: string;
  account_id: string;
  flow_id: string;
  flow_version_id: string;
  trigger_node_key: string;
  source: string;
  idempotency_key?: string | null;
  variables: unknown;
  payload: unknown;
  claim_token: string;
}

export interface TriggerInvocationWorkerStats {
  claimed: number;
  started: number;
  failed: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function completeInvocation(
  db: SupabaseClient,
  claim: ClaimedTriggerInvocation,
  status: "completed" | "failed",
  flowRunId: string | null,
  responseBody: Record<string, unknown>,
  errorCode: string | null = null,
): Promise<boolean> {
  const { data, error } = await db.rpc("complete_flow_trigger_invocation", {
    p_invocation_id: claim.id,
    p_claim_token: claim.claim_token,
    p_status: status,
    p_flow_run_id: flowRunId,
    p_response_status: status === "completed" ? 202 : 500,
    p_response_body: responseBody,
    p_error_code: errorCode,
  });
  if (error) throw error;
  return data === true;
}

export async function drainPendingFlowTriggerInvocations(
  db: SupabaseClient,
  now = new Date(),
): Promise<TriggerInvocationWorkerStats> {
  const { data, error } = await db.rpc("claim_flow_trigger_invocations", {
    p_now: now.toISOString(),
    p_limit: 100,
  });
  if (error) throw error;

  const claims = (data ?? []) as ClaimedTriggerInvocation[];
  const stats: TriggerInvocationWorkerStats = {
    claimed: claims.length,
    started: 0,
    failed: 0,
  };

  for (const claim of claims) {
    try {
      const { data: flowRow, error: flowError } = await db
        .from("flows")
        .select("*")
        .eq("id", claim.flow_id)
        .eq("account_id", claim.account_id)
        .maybeSingle();
      if (flowError) throw flowError;
      const flow = flowRow as FlowRow | null;
      if (
        !flow ||
        flow.status !== "active" ||
        flow.published_version_id !== claim.flow_version_id
      ) {
        await completeInvocation(
          db,
          claim,
          "failed",
          null,
          { reason: "active_flow_unavailable" },
          "active_flow_unavailable",
        );
        stats.failed += 1;
        continue;
      }

      const { data: versionRow, error: versionError } = await db
        .from("flow_versions")
        .select("*")
        .eq("id", claim.flow_version_id)
        .eq("flow_id", claim.flow_id)
        .maybeSingle();
      if (versionError) throw versionError;
      const version = versionRow as FlowVersionRow | null;
      if (!version) {
        await completeInvocation(
          db,
          claim,
          "failed",
          null,
          { reason: "flow_version_unavailable" },
          "flow_version_unavailable",
        );
        stats.failed += 1;
        continue;
      }

      const graph = parseFlowVersionGraph(version.graph);
      const trigger = getFlowEntryTrigger(graph);
      if (trigger.node_key !== claim.trigger_node_key) {
        await completeInvocation(
          db,
          claim,
          "failed",
          null,
          { reason: "trigger_node_mismatch" },
          "trigger_node_mismatch",
        );
        stats.failed += 1;
        continue;
      }

      const payload = asRecord(claim.payload);
      const nodes = new Map(
        versionGraphNodes(graph, flow.id).map((node) => [node.node_key, node]),
      );
      const result = await startFlowRunFromTrigger({
        db: db as never,
        flow,
        versionId: version.id,
        graph,
        nodes,
        contactId: optionalString(payload.contact_id),
        conversationId: optionalString(payload.conversation_id),
        variables: asRecord(claim.variables),
        triggerInvocationId: claim.id,
        triggerPayload: {
          source: claim.source,
          idempotency_key: claim.idempotency_key ?? null,
        },
      });

      const flowRunId = result.flow_run_id ?? null;
      const completed = result.consumed && flowRunId;
      await completeInvocation(
        db,
        claim,
        completed ? "completed" : "failed",
        flowRunId,
        { outcome: result.outcome },
        completed ? null : "flow_run_not_started",
      );
      if (completed) {
        stats.started += 1;
      } else {
        stats.failed += 1;
      }
    } catch (claimError) {
      console.error(
        "[flows] trigger invocation worker failed:",
        claimError instanceof Error ? claimError.message : claimError,
      );
      try {
        await completeInvocation(
          db,
          claim,
          "failed",
          null,
          { reason: "worker_error" },
          "worker_error",
        );
      } catch (completionError) {
        console.error(
          "[flows] trigger invocation completion failed:",
          completionError instanceof Error
            ? completionError.message
            : completionError,
        );
      }
      stats.failed += 1;
    }
  }

  return stats;
}
