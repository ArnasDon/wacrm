import { z } from "zod";

import { supabaseAdmin } from "@/lib/flows/admin-client";
import {
  debugJson,
  debugRpcError,
  requireFlowDebugOwner,
} from "@/lib/flows/debug-api";
import {
  MAX_DEBUG_EXECUTION_RESPONSE_BYTES,
  MAX_FLOW_EXECUTION_FIELD_BYTES,
} from "@/lib/flows/execution-payload";
import { sanitizeDebugValue } from "@/lib/flows/debug-runtime";

const paramsSchema = z.object({
  id: z.string().uuid(),
  executionId: z.string().uuid(),
});
const RESPONSE_RESERVE_BYTES = 4 * 1024;
const executionDetailSchema = z
  .object({
    id: z.string().uuid(),
    flow_run_id: z.string().uuid(),
    flow_version_id: z.string().uuid().nullable().optional(),
    node_key: z.string().min(1),
    node_type: z.string().min(1),
    status: z.string().min(1),
    duration_ms: z.number().int().nonnegative().nullable().optional(),
    attempt: z.number().int().positive(),
    started_at: z.string().nullable().optional(),
    completed_at: z.string().nullable().optional(),
    inputs: z.unknown().optional(),
    outputs: z.unknown().optional(),
    error: z.unknown().optional(),
    metadata: z.unknown().optional(),
  })
  .passthrough();
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

  const { data, error } = await supabaseAdmin().rpc(
    "read_flow_production_execution_detail",
    {
      p_flow_id: parsed.data.id,
      p_execution_id: parsed.data.executionId,
      p_created_by: owner.user.id,
      p_max_field_bytes: MAX_FLOW_EXECUTION_FIELD_BYTES,
    },
  );
  if (error) {
    return debugRpcError(error, {
      operation: "read_flight_execution_detail",
      flowId: parsed.data.id,
    });
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return debugJson({ error: "Not found" }, { status: 404 });
  }
  const parsedExecution = executionDetailSchema.safeParse(row.execution_json);
  if (!parsedExecution.success) {
    return debugJson(
      {
        error: "Invalid bounded production execution",
        code: "DEBUG_EXECUTION_DETAIL_INVALID",
      },
      { status: 502 },
    );
  }
  return debugJson({
    execution: sanitizeExecutionDetail(parsedExecution.data),
    budget_bytes: MAX_DEBUG_EXECUTION_RESPONSE_BYTES,
  });
}
