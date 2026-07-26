import { z } from "zod";

import { supabaseAdmin } from "@/lib/flows/admin-client";
import {
  debugJson,
  debugRpcError,
  requireFlowDebugOwner,
} from "@/lib/flows/debug-api";
import { MAX_DEBUG_EXECUTION_RESPONSE_BYTES } from "@/lib/flows/execution-payload";
import { sanitizeDebugValue } from "@/lib/flows/debug-runtime";

const paramsSchema = z.object({
  id: z.string().uuid(),
  executionId: z.string().uuid(),
});
const RESPONSE_RESERVE_BYTES = 4 * 1024;
const DETAIL_FIELDS = [
  "id",
  "flow_run_id",
  "flow_version_id",
  "node_key",
  "node_type",
  "status",
  "duration_ms",
  "attempt",
  "started_at",
  "completed_at",
  "inputs",
  "outputs",
  "error",
  "metadata",
] as const;

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function sanitizeExecutionDetail(
  execution: Record<string, unknown>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const field of DETAIL_FIELDS) {
    const sanitized = sanitizeDebugValue(execution[field]);
    if (
      bytes({ execution: { ...safe, [field]: sanitized } }) >
      MAX_DEBUG_EXECUTION_RESPONSE_BYTES - RESPONSE_RESERVE_BYTES
    ) {
      safe[field] = {
        truncated: true,
        reason: "response_budget_exceeded",
      };
    } else {
      safe[field] = sanitized;
    }
  }
  return safe;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; executionId: string }> },
) {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return debugJson({ error: "Not found" }, { status: 404 });
  }
  const owner = await requireFlowDebugOwner(parsed.data.id);
  if (!owner.ok) return owner.response;

  const admin = supabaseAdmin();
  const { data: executionRef, error: refError } = await admin
    .from("flow_node_executions")
    .select("id, flow_run_id")
    .eq("id", parsed.data.executionId)
    .maybeSingle();
  if (refError) return debugRpcError(refError);
  if (!executionRef || typeof executionRef.flow_run_id !== "string") {
    return debugJson({ error: "Not found" }, { status: 404 });
  }

  const { data: sourceRun, error: runError } = await admin
    .from("flow_runs")
    .select("id, flow_id")
    .eq("id", executionRef.flow_run_id)
    .eq("flow_id", parsed.data.id)
    .maybeSingle();
  if (runError) return debugRpcError(runError);
  if (!sourceRun) {
    return debugJson({ error: "Not found" }, { status: 404 });
  }

  const { data: execution, error } = await admin
    .from("flow_node_executions")
    .select(DETAIL_FIELDS.join(", "))
    .eq("id", parsed.data.executionId)
    .eq("flow_run_id", executionRef.flow_run_id)
    .maybeSingle();
  if (error) {
    return debugRpcError(error, {
      operation: "read_flight_execution_detail",
      flowId: parsed.data.id,
    });
  }
  if (!execution) {
    return debugJson({ error: "Not found" }, { status: 404 });
  }
  return debugJson({
    execution: sanitizeExecutionDetail(
      execution as unknown as Record<string, unknown>,
    ),
    budget_bytes: MAX_DEBUG_EXECUTION_RESPONSE_BYTES,
  });
}
