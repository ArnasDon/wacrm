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
import {
  decodeDebugCursor,
  descendingCursorFilter,
  encodeDebugCursor,
} from "@/lib/flows/debug-pagination";
import { MAX_DEBUG_EXECUTION_RESPONSE_BYTES } from "@/lib/flows/execution-payload";

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
const getQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});
const RESPONSE_RESERVE_BYTES = 4 * 1024;

function responseBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function isUnavailableSession(session: Record<string, unknown>): boolean {
  if (session.status !== "active" || typeof session.expires_at !== "string") {
    return true;
  }
  const expiresAt = Date.parse(session.expires_at);
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
}

async function contextFor(context: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
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
  request: Request,
  context: { params: Promise<{ id: string; sessionId: string }> },
) {
  const state = await contextFor(context);
  if (!state) return debugJson({ error: "Not found" }, { status: 404 });
  if ("response" in state) return state.response!;
  if (isUnavailableSession(state.session as Record<string, unknown>)) {
    return debugJson(
      {
        code: "DEBUG_SESSION_UNAVAILABLE",
        error: "The debug session is closed or expired.",
      },
      { status: 410 },
    );
  }

  const url = new URL(request.url);
  const parsedQuery = getQuerySchema.safeParse({
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsedQuery.success) {
    return debugJson({ error: "Invalid debug session query" }, { status: 400 });
  }
  const decodedCursor = parsedQuery.data.cursor
    ? decodeDebugCursor(parsedQuery.data.cursor)
    : null;
  if (parsedQuery.data.cursor && !decodedCursor) {
    return debugJson(
      { error: "Invalid debug session cursor" },
      { status: 400 },
    );
  }

  let executionsQuery = supabaseAdmin()
    .from("flow_debug_node_executions")
    .select(
      "id, node_key, node_type, status, inputs, outputs, simulated_effects, metadata, duration_ms, error, attempt, created_at",
    )
    .eq("session_id", state.params.sessionId);
  if (decodedCursor) {
    executionsQuery = executionsQuery.or(
      descendingCursorFilter("created_at", decodedCursor),
    );
  }
  const { data: rawExecutions, error } = await executionsQuery
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(parsedQuery.data.limit + 1);
  if (error) return debugRpcError(error);
  try {
    const session = sanitizeDebugSession(
      state.session as Record<string, unknown>,
    );
    const executions: Record<string, unknown>[] = [];
    let truncationReason: "page" | "budget" | null =
      (rawExecutions ?? []).length > parsedQuery.data.limit ? "page" : null;
    for (const execution of (rawExecutions ?? []).slice(
      0,
      parsedQuery.data.limit,
    )) {
      const sanitized = Object.fromEntries(
        Object.entries(execution).map(([key, value]) => [
          key,
          sanitizeDebugValue(value),
        ]),
      );
      if (
        responseBytes({
          session,
          executions: [...executions, sanitized],
        }) >
        MAX_DEBUG_EXECUTION_RESPONSE_BYTES - RESPONSE_RESERVE_BYTES
      ) {
        truncationReason = "budget";
        break;
      }
      executions.push(sanitized);
    }
    const lastExecution = executions.at(-1);
    const nextCursor =
      truncationReason &&
      typeof lastExecution?.created_at === "string" &&
      typeof lastExecution.id === "string"
        ? encodeDebugCursor({
            timestamp: lastExecution.created_at,
            id: lastExecution.id,
          })
        : null;
    return debugJson({
      session,
      executions,
      page: {
        limit: parsedQuery.data.limit,
        returned: executions.length,
        truncated: truncationReason !== null,
        truncation_reason: truncationReason,
        next_cursor: nextCursor,
        budget_bytes: MAX_DEBUG_EXECUTION_RESPONSE_BYTES,
      },
    });
  } catch (sanitizationError) {
    if (
      sanitizationError instanceof Error &&
      sanitizationError.message === "debug_response_too_large"
    ) {
      return debugJson(
        {
          code: "DEBUG_RESPONSE_TOO_LARGE",
          error: "The debug session is too large to inspect.",
        },
        { status: 413 },
      );
    }
    throw sanitizationError;
  }
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
  try {
    return debugJson({
      session: sanitizeDebugSession(
        (Array.isArray(data) ? data[0] : data) as Record<string, unknown>,
      ),
    });
  } catch (sanitizationError) {
    if (
      sanitizationError instanceof Error &&
      sanitizationError.message === "debug_response_too_large"
    ) {
      return debugJson(
        {
          code: "DEBUG_RESPONSE_TOO_LARGE",
          error: "The debug session is too large to inspect.",
        },
        { status: 413 },
      );
    }
    throw sanitizationError;
  }
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
  try {
    return debugJson({
      session: sanitizeDebugSession(
        (Array.isArray(data) ? data[0] : data) as Record<string, unknown>,
      ),
    });
  } catch (sanitizationError) {
    if (
      sanitizationError instanceof Error &&
      sanitizationError.message === "debug_response_too_large"
    ) {
      return debugJson(
        {
          code: "DEBUG_RESPONSE_TOO_LARGE",
          error: "The debug session is too large to inspect.",
        },
        { status: 413 },
      );
    }
    throw sanitizationError;
  }
}
