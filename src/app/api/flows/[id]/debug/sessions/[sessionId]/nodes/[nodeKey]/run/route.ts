import { z } from "zod";

import { supabaseAdmin } from "@/lib/flows/admin-client";
import {
  debugJson,
  debugRpcError,
  readDebugJson,
  requireFlowDebugOwner,
} from "@/lib/flows/debug-api";
import {
  runIsolatedDebugNode,
  sanitizeDebugSession,
  sanitizeDebugValue,
  type DebugNodeOutputs,
} from "@/lib/flows/debug-runtime";
import { parseFlowVersionGraph } from "@/lib/flows/versions";

const paramsSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  nodeKey: z.string().min(1).max(120).regex(/^[a-zA-Z0-9_.:-]+$/),
});
const bodySchema = z
  .object({
    expected_revision: z.number().int().nonnegative(),
    overrides: z.record(z.string().max(120), z.unknown()).optional().default({}),
  })
  .strict();

const MAX_EXECUTIONS_PER_MINUTE = 30;

export async function POST(
  request: Request,
  context: {
    params: Promise<{ id: string; sessionId: string; nodeKey: string }>;
  },
) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return debugJson({ error: "Not found" }, { status: 404 });
  }
  const { id, sessionId, nodeKey } = parsedParams.data;
  const owner = await requireFlowDebugOwner(id);
  if (!owner.ok) return owner.response;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await readDebugJson(request));
  } catch (error) {
    const tooLarge =
      error instanceof Error && error.message === "debug_request_too_large";
    return debugJson(
      { error: tooLarge ? "Request too large" : "Invalid debug node request" },
      { status: tooLarge ? 413 : 400 },
    );
  }

  const admin = supabaseAdmin();
  const { data: session, error: sessionError } = await admin
    .from("flow_debug_sessions")
    .select(
      "id, flow_id, revision, status, expires_at, graph_snapshot, variables, node_outputs, source_node_outputs",
    )
    .eq("id", sessionId)
    .eq("flow_id", id)
    .eq("created_by", owner.user.id)
    .maybeSingle();
  if (
    sessionError ||
    !session ||
    session.status !== "active" ||
    new Date(session.expires_at).getTime() <= Date.now()
  ) {
    return debugJson({ error: "Not found" }, { status: 404 });
  }
  if (session.revision !== body.expected_revision) {
    return debugJson(
      {
        code: "DEBUG_REVISION_CONFLICT",
        error: "The debug session changed. Reload and retry.",
      },
      { status: 409 },
    );
  }

  const minuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { data: recent } = await admin
    .from("flow_debug_node_executions")
    .select("id")
    .eq("session_id", sessionId)
    .gte("created_at", minuteAgo)
    .limit(MAX_EXECUTIONS_PER_MINUTE);
  if ((recent?.length ?? 0) >= MAX_EXECUTIONS_PER_MINUTE) {
    return debugJson(
      { error: "Too many debug executions. Retry in a minute." },
      { status: 429 },
    );
  }

  let graph;
  try {
    graph = parseFlowVersionGraph(session.graph_snapshot);
  } catch {
    return debugJson({ error: "Invalid debug snapshot" }, { status: 422 });
  }
  const node = graph.nodes.find((candidate) => candidate.node_key === nodeKey);
  if (!node) return debugJson({ error: "Not found" }, { status: 404 });

  const started = performance.now();
  let result;
  try {
    result = await runIsolatedDebugNode({
      graph,
      nodeKey,
      variables: session.variables as Record<string, unknown>,
      savedOutputs: (session.node_outputs ?? {}) as DebugNodeOutputs,
      clonedOutputs: (session.source_node_outputs ?? {}) as DebugNodeOutputs,
      overrides: body.overrides,
    });
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
    throw error;
  }
  const durationMs = Math.min(
    60_000,
    Math.max(0, Math.round(performance.now() - started)),
  );
  const { data: committed, error: commitError } = await admin.rpc(
    "commit_flow_debug_node_execution",
    {
      p_session_id: sessionId,
      p_created_by: owner.user.id,
      p_expected_revision: body.expected_revision,
      p_node_key: nodeKey,
      p_node_type: node.node_type,
      p_status: result.status,
      p_inputs: result.inputs,
      p_outputs: result.outputs,
      p_variables: result.variables,
      p_simulated_effects: result.simulatedEffects,
      p_metadata: result.metadata,
      p_duration_ms: durationMs,
      p_error: result.error ?? null,
    },
  );
  if (commitError) {
    return debugRpcError(commitError, {
      operation: "commit_debug_execution",
      flowId: id,
    });
  }
  const row = (Array.isArray(committed) ? committed[0] : committed) as {
    session?: Record<string, unknown>;
    execution?: Record<string, unknown>;
  };
  return debugJson({
    session: row?.session ? sanitizeDebugSession(row.session) : null,
    execution: sanitizeDebugValue(row?.execution ?? null),
  });
}
