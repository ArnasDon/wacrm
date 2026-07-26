import type { SupabaseClient } from "@supabase/supabase-js";

import {
  advanceFromNodeKey,
  recoverFailedSubFlowRun,
} from "./engine";
import type { FlowRunRow } from "./types";
import {
  parseFlowVersionGraph,
  versionGraphNodes,
  type FlowVersionGraph,
} from "./versions";

interface ClaimedFlowWait {
  id: string;
  flow_run_id: string;
  flow_version_id: string;
  node_key: string;
  next_node_key: string;
  claim_token: string;
  resume_id: string;
}

interface ResumeStats {
  claimed: number;
  resumed: number;
  failed: number;
}

type Advance = typeof advanceFromNodeKey;

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

/**
 * Claims due waits with SKIP LOCKED through the database RPC and advances
 * only after the stored edge is verified against the immutable version.
 * The resume RPC consumes a claim token atomically, making concurrent cron
 * invocations harmless.
 */
export async function resumeDueFlowWaits(
  db: SupabaseClient,
  now = new Date(),
  dependencies: { advance?: Advance } = {},
): Promise<ResumeStats> {
  const { data, error } = await db.rpc("claim_due_flow_waits", {
    p_now: now.toISOString(),
    p_limit: 100,
  });
  if (error) throw error;
  const claims = (data ?? []) as ClaimedFlowWait[];
  const stats: ResumeStats = {
    claimed: claims.length,
    resumed: 0,
    failed: 0,
  };
  const advance = dependencies.advance ?? advanceFromNodeKey;

  for (const claim of claims) {
    const pinned = await loadPinnedGraph(db, claim.flow_version_id);
    const waitNode = pinned?.graph.nodes.find(
      (node) => node.node_key === claim.node_key && node.node_type === "wait",
    );
    const pinnedNext =
      waitNode && typeof waitNode.config.next_node_key === "string"
        ? waitNode.config.next_node_key
        : null;
    if (!pinned || pinnedNext !== claim.next_node_key) {
      stats.failed += 1;
      continue;
    }

    const prepareArgs = {
      p_wait_id: claim.id,
      p_claim_token: claim.claim_token,
      p_flow_version_id: claim.flow_version_id,
    };
    let { data: preparedRows, error: prepareError } = await db.rpc(
      "prepare_flow_wait_resume",
      prepareArgs,
    );
    if (prepareError || !Array.isArray(preparedRows) || !preparedRows[0]) {
      // The first call may have committed and only lost its response.
      ({ data: preparedRows, error: prepareError } = await db.rpc(
        "prepare_flow_wait_resume",
        prepareArgs,
      ));
    }
    const run = Array.isArray(preparedRows)
      ? (preparedRows[0] as FlowRunRow | undefined)
      : undefined;
    if (prepareError || !run) {
      stats.failed += 1;
      continue;
    }
    const needsAdvance =
      run.continuation_id === claim.resume_id &&
      run.continuation_phase === "running" &&
      typeof run.current_node_key === "string";
    try {
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
          run.current_node_key!,
          nodes,
          pinned.graph.fallback_policy.execution,
        );
        if (!dependencies.advance) {
          await recoverFailedSubFlowRun(
            db as ReturnType<typeof import("./admin-client").supabaseAdmin>,
            run,
          );
        }
      }
      const ackArgs = {
        p_wait_id: claim.id,
        p_claim_token: claim.claim_token,
        p_flow_version_id: claim.flow_version_id,
        p_node_key: claim.node_key,
      };
      // A wait -> wait edge atomically replaces this claim in schedule_flow_wait.
      // The replacement is a durable acknowledgement even though the old
      // continuation can no longer be marked completed.
      let { data: superseded, error: supersedeError } = await db.rpc(
        "ack_flow_wait_resume",
        ackArgs,
      );
      if (supersedeError) {
        ({ data: superseded, error: supersedeError } = await db.rpc(
          "ack_flow_wait_resume",
          ackArgs,
        ));
      }
      if (!supersedeError && superseded === true) {
        stats.resumed += 1;
        continue;
      }
      const completeArgs = {
        p_wait_id: claim.id,
        p_claim_token: claim.claim_token,
        p_flow_version_id: claim.flow_version_id,
      };
      let { data: completed, error: completeError } = await db.rpc(
        "complete_flow_wait_continuation",
        completeArgs,
      );
      if (completeError || completed !== true) {
        ({ data: completed, error: completeError } = await db.rpc(
          "complete_flow_wait_continuation",
          completeArgs,
        ));
      }
      if (completeError || completed !== true) {
        throw completeError ?? new Error("wait continuation was not completed");
      }
      let { data: acknowledged, error: ackError } = await db.rpc(
        "ack_flow_wait_resume",
        ackArgs,
      );
      if (ackError || acknowledged !== true) {
        ({ data: acknowledged, error: ackError } = await db.rpc(
          "ack_flow_wait_resume",
          ackArgs,
        ));
      }
      if (ackError || acknowledged !== true) {
        stats.failed += 1;
        continue;
      }
      stats.resumed += 1;
    } catch {
      // The claim remains durable and will be reclaimed after its lease.
      stats.failed += 1;
    }
  }
  return stats;
}
