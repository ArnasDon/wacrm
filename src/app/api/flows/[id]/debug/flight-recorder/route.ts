import { z } from "zod";

import { supabaseAdmin } from "@/lib/flows/admin-client";
import {
  debugJson,
  debugRpcError,
  requireFlowDebugOwner,
} from "@/lib/flows/debug-api";
import { sanitizeDebugValue } from "@/lib/flows/debug-runtime";
import {
  decodeDebugCursor,
  descendingCursorFilter,
  encodeDebugCursor,
} from "@/lib/flows/debug-pagination";

const flowIdSchema = z.string().uuid();
const querySchema = z.object({
  run_id: z.string().uuid().optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const MAX_FLIGHT_RESPONSE_BYTES = 256 * 1024;
const FLIGHT_ENVELOPE_RESERVE_BYTES = 4 * 1024;

type FlightExecution = Record<string, unknown> & {
  flow_run_id?: unknown;
  node_key?: unknown;
  started_at?: unknown;
};

function latestByRun(executions: FlightExecution[]) {
  const latest: Record<string, Record<string, FlightExecution>> = {};
  for (const execution of executions) {
    const runId =
      typeof execution.flow_run_id === "string" ? execution.flow_run_id : "";
    const nodeKey =
      typeof execution.node_key === "string" ? execution.node_key : "";
    if (!runId || !nodeKey) continue;
    latest[runId] ??= {};
    if (!Object.hasOwn(latest[runId], nodeKey)) {
      latest[runId][nodeKey] = execution;
    }
  }
  return latest;
}

function responseBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

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
  const parsedQuery = querySchema.safeParse({
    run_id: url.searchParams.get("run_id") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsedQuery.success) {
    return debugJson(
      { error: "Invalid flight recorder query" },
      { status: 400 },
    );
  }
  const { run_id: requestedRun, cursor, limit } = parsedQuery.data;
  const decodedCursor = cursor ? decodeDebugCursor(cursor) : null;
  if (cursor && !decodedCursor) {
    return debugJson(
      { error: "Invalid flight recorder cursor" },
      { status: 400 },
    );
  }

  const admin = supabaseAdmin();
  let runsQuery = admin
    .from("flow_runs")
    .select(
      "id, flow_id, flow_version_id, status, current_node_key, started_at, last_advanced_at, ended_at, end_reason",
    )
    .eq("flow_id", params.id);
  if (requestedRun) {
    runsQuery = runsQuery.eq("id", requestedRun);
  }
  const { data: rawRuns, error: runsError } = await runsQuery
    .order("started_at", { ascending: false })
    .limit(requestedRun ? 1 : 20);
  if (runsError) return debugRpcError(runsError);

  const runs = (rawRuns ?? []).map((run) => sanitizeDebugValue(run)) as Record<
    string,
    unknown
  >[];
  const runIds = runs
    .map((run) => run.id)
    .filter((id): id is string => typeof id === "string");
  if (requestedRun && runIds.length === 0) {
    return debugJson({ error: "Not found" }, { status: 404 });
  }

  let rawExecutions: FlightExecution[] = [];
  if (runIds.length > 0) {
    let executionsQuery = admin
      .from("flow_node_executions")
      .select(
        "id, flow_run_id, flow_version_id, node_key, node_type, status, duration_ms, attempt, started_at, completed_at",
      )
      .in("flow_run_id", runIds);
    if (decodedCursor) {
      executionsQuery = executionsQuery.or(
        descendingCursorFilter("started_at", decodedCursor),
      );
    }
    const { data, error } = await executionsQuery
      .order("started_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);
    if (error) {
      return debugRpcError(error, {
        operation: "read_flight_executions",
        flowId: params.id,
      });
    }
    rawExecutions = (data ?? []) as FlightExecution[];
  }

  const executions: FlightExecution[] = [];
  let truncationReason: "page" | "budget" | null =
    rawExecutions.length > limit ? "page" : null;
  for (const row of rawExecutions.slice(0, limit)) {
    const sanitized = sanitizeDebugValue(row) as FlightExecution;
    const candidateExecutions = [...executions, sanitized];
    const candidateLatest = latestByRun(candidateExecutions);
    if (
      responseBytes({
        runs,
        executions: candidateExecutions,
        latest_by_run: candidateLatest,
      }) >
      MAX_FLIGHT_RESPONSE_BYTES - FLIGHT_ENVELOPE_RESERVE_BYTES
    ) {
      truncationReason = "budget";
      break;
    }
    executions.push(sanitized);
  }

  const lastExecution = executions.at(-1);
  const nextCursor =
    truncationReason &&
    typeof lastExecution?.started_at === "string" &&
    typeof lastExecution.id === "string"
      ? encodeDebugCursor({
          timestamp: lastExecution.started_at,
          id: lastExecution.id,
        })
      : null;
  return debugJson({
    runs,
    executions,
    latest_by_run: latestByRun(executions),
    page: {
      limit,
      returned: executions.length,
      truncated: truncationReason !== null,
      truncation_reason: truncationReason,
      next_cursor: nextCursor,
      budget_bytes: MAX_FLIGHT_RESPONSE_BYTES,
    },
  });
}
