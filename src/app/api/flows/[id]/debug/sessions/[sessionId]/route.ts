import { z } from "zod";

import { supabaseAdmin } from "@/lib/flows/admin-client";
import {
  debugJson,
  debugRpcError,
  readDebugJson,
  requireFlowDebugOwner,
} from "@/lib/flows/debug-api";
import {
  assertDebugVariablesBounded,
  editDebugVariables,
  sanitizeDebugSession,
  sanitizeDebugValue,
} from "@/lib/flows/debug-runtime";
import { parseFlowVersionGraph } from "@/lib/flows/versions";

const paramsSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
});
const revisionSchema = z
  .object({ expected_revision: z.number().int().nonnegative() })
  .strict();
const patchSchema = z
  .object({
    expected_revision: z.number().int().nonnegative(),
    variables: z.record(z.string().max(120), z.unknown()),
  })
  .strict();

async function contextFor(
  context: { params: Promise<{ id: string; sessionId: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return null;
  const owner = await requireFlowDebugOwner(params.data.id);
  if (!owner.ok) return { response: owner.response } as const;
  const { data: session, error } = await supabaseAdmin()
    .from("flow_debug_sessions")
    .select("*")
    .eq("id", params.data.sessionId)
    .eq("flow_id", params.data.id)
    .eq("created_by", owner.user.id)
    .maybeSingle();
  if (error || !session) return null;
  return { params: params.data, owner, session } as const;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; sessionId: string }> },
) {
  const state = await contextFor(context);
  if (!state) return debugJson({ error: "Not found" }, { status: 404 });
  if ("response" in state) return state.response!;
  const { data: executions, error } = await supabaseAdmin()
    .from("flow_debug_node_executions")
    .select(
      "id, node_key, node_type, status, inputs, outputs, variables, simulated_effects, metadata, duration_ms, error, attempt, created_at",
    )
    .eq("session_id", state.params.sessionId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return debugRpcError(error);
  return debugJson(
    sanitizeDebugValue({
      session: sanitizeDebugSession(
        state.session as Record<string, unknown>,
      ),
      executions: executions ?? [],
    }),
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; sessionId: string }> },
) {
  const state = await contextFor(context);
  if (!state) return debugJson({ error: "Not found" }, { status: 404 });
  if ("response" in state) return state.response!;
  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await readDebugJson(request));
  } catch (error) {
    const tooLarge =
      error instanceof Error && error.message === "debug_request_too_large";
    return debugJson(
      { error: tooLarge ? "Request too large" : "Invalid variable edit" },
      { status: tooLarge ? 413 : 400 },
    );
  }
  if (state.session.revision !== body.expected_revision) {
    return debugJson(
      { code: "DEBUG_REVISION_CONFLICT", error: "Reload the debug session." },
      { status: 409 },
    );
  }
  let graph;
  let variables;
  try {
    graph = parseFlowVersionGraph(state.session.graph_snapshot);
    variables = editDebugVariables(
      graph.variable_schema,
      state.session.variables as Record<string, unknown>,
      body.variables,
    );
    assertDebugVariablesBounded(variables);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "debug_variables_too_large"
    ) {
      return debugJson(
        {
          error: "Debug variables exceed the size limit",
          code: "DEBUG_VARIABLES_TOO_LARGE",
        },
        { status: 413 },
      );
    }
    return debugJson(
      { error: error instanceof Error ? error.message : "Invalid variables" },
      { status: 422 },
    );
  }
  const { data, error } = await supabaseAdmin().rpc(
    "edit_flow_debug_session_variables",
    {
      p_session_id: state.params.sessionId,
      p_created_by: state.owner.user.id,
      p_expected_revision: body.expected_revision,
      p_variables: sanitizeDebugValue(variables),
    },
  );
  if (error) {
    return debugRpcError(error, {
      operation: "edit_debug_variables",
      flowId: state.params.id,
    });
  }
  return debugJson({
    session: sanitizeDebugSession(
      (Array.isArray(data) ? data[0] : data) as Record<string, unknown>,
    ),
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; sessionId: string }> },
) {
  const state = await contextFor(context);
  if (!state) return debugJson({ error: "Not found" }, { status: 404 });
  if ("response" in state) return state.response!;
  let body: z.infer<typeof revisionSchema>;
  try {
    body = revisionSchema.parse(await readDebugJson(request));
  } catch {
    return debugJson({ error: "Invalid close request" }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin().rpc(
    "close_flow_debug_session",
    {
      p_session_id: state.params.sessionId,
      p_created_by: state.owner.user.id,
      p_expected_revision: body.expected_revision,
    },
  );
  if (error) {
    return debugRpcError(error, {
      operation: "close_debug_session",
      flowId: state.params.id,
    });
  }
  return debugJson({
    session: sanitizeDebugSession(
      (Array.isArray(data) ? data[0] : data) as Record<string, unknown>,
    ),
  });
}
