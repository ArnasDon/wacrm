import { requireApiKey } from "@/lib/auth/api-context";
import { fail, ok, toApiErrorResponse } from "@/lib/api/v1/respond";
import {
  startFlowRunFromTrigger,
  type StartFlowRunFromTriggerInput,
} from "@/lib/flows/engine";
import type { FlowRow, FlowVersionRow } from "@/lib/flows/types";
import {
  getFlowEntryTrigger,
  parseFlowVersionGraph,
  versionGraphNodes,
} from "@/lib/flows/versions";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const ctx = await requireApiKey(request, "flows:execute");
    const { id: flowId } = await context.params;
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey) {
      return fail("bad_request", "Idempotency-Key header is required", 400);
    }
    if (idempotencyKey.length > 240) {
      return fail("bad_request", "Idempotency-Key is too long", 400);
    }

    const body = asRecord(await request.json().catch(() => ({})));
    if (!body) {
      return fail("bad_request", "Request body must be a JSON object", 400);
    }
    const variables = asRecord(body.variables ?? {}) ?? null;
    if (!variables) {
      return fail("bad_request", "'variables' must be an object", 400);
    }
    const contactId =
      typeof body.contact_id === "string" && body.contact_id.trim()
        ? body.contact_id.trim()
        : null;
    const conversationId =
      typeof body.conversation_id === "string" && body.conversation_id.trim()
        ? body.conversation_id.trim()
        : null;

    const { data: flow, error: flowError } = await ctx.supabase
      .from("flows")
      .select("*")
      .eq("id", flowId)
      .eq("account_id", ctx.accountId)
      .eq("status", "active")
      .maybeSingle();
    if (flowError) throw flowError;
    const typedFlow = flow as FlowRow | null;
    if (!typedFlow?.published_version_id) {
      return fail("not_found", "Flow not found", 404);
    }

    const { data: version, error: versionError } = await ctx.supabase
      .from("flow_versions")
      .select("id, flow_id, account_id, graph")
      .eq("id", typedFlow.published_version_id)
      .eq("flow_id", typedFlow.id)
      .maybeSingle();
    if (versionError) throw versionError;
    const typedVersion = version as Pick<
      FlowVersionRow,
      "id" | "flow_id" | "account_id" | "graph"
    > | null;
    if (!typedVersion || typedVersion.account_id !== ctx.accountId) {
      return fail("not_found", "Flow not found", 404);
    }

    const graph = parseFlowVersionGraph(typedVersion.graph);
    const trigger = getFlowEntryTrigger(graph);
    if (trigger.type !== "manual") {
      return fail("bad_request", "Flow is not manually executable", 400);
    }

    const { data: accepted, error: acceptError } = await ctx.supabase.rpc(
      "accept_flow_trigger_invocation",
      {
        p_account_id: ctx.accountId,
        p_flow_id: typedFlow.id,
        p_trigger_node_key: trigger.node_key,
        p_source: "manual",
        p_idempotency_key: idempotencyKey,
        p_body_hash: null,
        p_payload: { contact_id: contactId, conversation_id: conversationId },
        p_variables: variables,
        p_webhook_endpoint_id: null,
        p_response_mode: "async",
      },
    );
    if (acceptError) {
      return fail("bad_request", "Flow run idempotency conflict", 409);
    }
    const invocation = Array.isArray(accepted) ? accepted[0] : accepted;
    if (!invocation?.id) {
      throw new Error("flow trigger invocation was not accepted");
    }
    if (invocation.status === "completed" && invocation.flow_run_id) {
      return ok(
        { run_id: invocation.flow_run_id, status: "completed" },
        200,
      );
    }

    const nodes = new Map(
      versionGraphNodes(graph, typedFlow.id).map((node) => [
        node.node_key,
        node,
      ]),
    );
    const started = await startFlowRunFromTrigger({
      db: ctx.supabase as StartFlowRunFromTriggerInput["db"],
      flow: typedFlow,
      versionId: typedVersion.id,
      graph,
      nodes,
      contactId,
      conversationId,
      variables,
      triggerInvocationId: invocation.id,
      triggerPayload: {
        source: "manual",
        api_key_id: ctx.keyId,
      },
    });

    if (invocation.claim_token) {
      await ctx.supabase.rpc("complete_flow_trigger_invocation", {
        p_invocation_id: invocation.id,
        p_claim_token: invocation.claim_token,
        p_status: started.flow_run_id ? "completed" : "failed",
        p_flow_run_id: started.flow_run_id ?? null,
        p_response_status: 202,
        p_response_body: { outcome: started.outcome },
        p_error_code: started.flow_run_id ? null : started.outcome,
      });
    }

    return ok(
      {
        run_id: started.flow_run_id ?? null,
        status: started.outcome,
      },
      202,
    );
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
