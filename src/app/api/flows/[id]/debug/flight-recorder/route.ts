import { z } from "zod";

import { supabaseAdmin } from "@/lib/flows/admin-client";
import {
  debugJson,
  debugRpcError,
  requireFlowDebugOwner,
} from "@/lib/flows/debug-api";
import { sanitizeDebugValue } from "@/lib/flows/debug-runtime";

const flowIdSchema = z.string().uuid();

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  if (!flowIdSchema.safeParse(params.id).success) {
    return debugJson({ error: "Not found" }, { status: 404 });
  }
  const owner = await requireFlowDebugOwner(params.id);
  if (!owner.ok) return owner.response;

  const url = new URL(request.url);
  const requestedRun = url.searchParams.get("run_id");
  if (requestedRun && !z.string().uuid().safeParse(requestedRun).success) {
    return debugJson({ error: "Invalid run id" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  let runsQuery = admin
    .from("flow_runs")
    .select(
      "id, flow_id, flow_version_id, status, current_node_key, vars, started_at, last_advanced_at, ended_at, end_reason",
    )
    .eq("flow_id", params.id);
  if (requestedRun) {
    runsQuery = runsQuery.eq("id", requestedRun);
  }
  const { data: runs, error: runsError } = await runsQuery
    .order("started_at", { ascending: false })
    .limit(requestedRun ? 1 : 20);
  if (runsError) return debugRpcError(runsError);

  const runIds = (runs ?? []).map((run) => run.id as string);
  if (requestedRun && runIds.length === 0) {
    return debugJson({ error: "Not found" }, { status: 404 });
  }
  let executions: Record<string, unknown>[] = [];
  if (runIds.length > 0) {
    const { data, error } = await admin
      .from("flow_node_executions")
      .select(
        "id, flow_run_id, flow_version_id, node_key, node_type, status, inputs, outputs, duration_ms, attempt, error, started_at, completed_at",
      )
      .in("flow_run_id", runIds)
      .order("started_at", { ascending: false })
      .limit(500);
    if (error) {
      return debugRpcError(error, {
        operation: "read_flight_executions",
        flowId: params.id,
      });
    }
    executions = (data ?? []) as Record<string, unknown>[];
  }

  const latestByRun: Record<
    string,
    Record<string, Record<string, unknown>>
  > = {};
  for (const execution of executions) {
    const runId =
      typeof execution.flow_run_id === "string" ? execution.flow_run_id : "";
    const key =
      typeof execution.node_key === "string" ? execution.node_key : "";
    if (runId && key) {
      latestByRun[runId] ??= {};
      if (!Object.hasOwn(latestByRun[runId], key)) {
        latestByRun[runId][key] = execution;
      }
    }
  }
  return debugJson(
    sanitizeDebugValue({
      runs: runs ?? [],
      executions,
      latest_by_run: latestByRun,
    }),
  );
}
