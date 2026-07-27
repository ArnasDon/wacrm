import { requireApiKey } from "@/lib/auth/api-context";
import { fail, ok, toApiErrorResponse } from "@/lib/api/v1/respond";

interface RouteContext {
  params: Promise<{ id: string; runId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const ctx = await requireApiKey(request, "flows:execute");
    const { id: flowId, runId } = await context.params;
    const { data, error } = await ctx.supabase
      .from("flow_runs")
      .select(
        "id, flow_id, flow_version_id, status, current_node_key, started_at, ended_at, end_reason",
      )
      .eq("id", runId)
      .eq("flow_id", flowId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return fail("not_found", "Flow run not found", 404);

    return ok({
      id: data.id,
      flow_id: data.flow_id,
      flow_version_id: data.flow_version_id,
      status: data.status,
      current_node_key: data.current_node_key,
      started_at: data.started_at,
      ended_at: data.ended_at,
      end_reason: data.end_reason,
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
