import { z } from "zod";

import { supabaseAdmin } from "@/lib/flows/admin-client";
import {
  debugJson,
  debugRpcError,
  requireFlowDebugOwner,
} from "@/lib/flows/debug-api";
import { sanitizeDebugExecutionDetail } from "@/lib/flows/debug-execution";
import { MAX_DEBUG_EXECUTION_FIELD_BYTES } from "@/lib/flows/execution-payload";

const paramsSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  executionId: z.string().uuid(),
});

export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      id: string;
      sessionId: string;
      executionId: string;
    }>;
  },
) {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return debugJson({ error: "Not found" }, { status: 404 });
  }
  const owner = await requireFlowDebugOwner(parsed.data.id);
  if (!owner.ok) return owner.response;

  const { data, error } = await supabaseAdmin().rpc(
    "read_flow_debug_execution_detail",
    {
      p_flow_id: parsed.data.id,
      p_session_id: parsed.data.sessionId,
      p_execution_id: parsed.data.executionId,
      p_created_by: owner.user.id,
      p_max_field_bytes: MAX_DEBUG_EXECUTION_FIELD_BYTES,
    },
  );
  if (error) {
    return debugRpcError(error, {
      operation: "read_debug_execution_detail",
      flowId: parsed.data.id,
    });
  }
  const row = Array.isArray(data) ? data[0] : data;
  const execution = row?.execution_json;
  if (!execution || typeof execution !== "object" || Array.isArray(execution)) {
    return debugJson({ error: "Not found" }, { status: 404 });
  }
  try {
    return debugJson({
      execution: sanitizeDebugExecutionDetail(
        execution as Record<string, unknown>,
      ),
    });
  } catch {
    return debugJson(
      { error: "Invalid debug execution response" },
      { status: 502 },
    );
  }
}
