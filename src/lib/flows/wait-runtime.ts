import type { SupabaseClient } from "@supabase/supabase-js";

import { advanceFromNodeKey } from "./engine";
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
      (node) =>
        node.node_key === claim.node_key &&
        node.node_type === "wait",
    );
    const pinnedNext =
      waitNode &&
      typeof waitNode.config.next_node_key === "string"
        ? waitNode.config.next_node_key
        : null;
    if (!pinned || pinnedNext !== claim.next_node_key) {
      stats.failed += 1;
      continue;
    }

    const { data: resumedRows, error: resumeError } = await db.rpc(
      "resume_flow_wait",
      {
        p_wait_id: claim.id,
        p_claim_token: claim.claim_token,
        p_flow_version_id: claim.flow_version_id,
        p_next_node_key: pinnedNext,
      },
    );
    const run = Array.isArray(resumedRows)
      ? (resumedRows[0] as FlowRunRow | undefined)
      : undefined;
    if (resumeError || !run) {
      stats.failed += 1;
      continue;
    }
    stats.resumed += 1;
    const nodes = new Map(
      versionGraphNodes(pinned.graph, pinned.flowId).map((node) => [
        node.node_key,
        node,
      ]),
    );
    await advance(
      db as ReturnType<typeof import("./admin-client").supabaseAdmin>,
      run,
      pinnedNext,
      nodes,
      pinned.graph.fallback_policy.execution,
    );
  }
  return stats;
}
