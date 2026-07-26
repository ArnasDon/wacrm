import { createHash } from "node:crypto";
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
  sanitizeDebugSession,
  sanitizeDebugValue,
} from "@/lib/flows/debug-runtime";
import type {
  FlowNodeExecutionRow,
  FlowNodeRow,
  FlowRow,
  FlowRunRow,
} from "@/lib/flows/types";
import {
  buildFlowVersionGraph,
  parseFlowVersionGraph,
  type FlowVersionGraph,
} from "@/lib/flows/versions";
import { initializeFlowVariables } from "@/lib/flows/runtime-primitives";

const bodySchema = z
  .object({
    source_run_id: z.string().uuid().optional(),
    flow_version_id: z.string().uuid().optional(),
  })
  .strict();
const flowIdSchema = z.string().uuid();
const MAX_CLONED_OUTPUT_BYTES = 256 * 1024;
const MAX_SOURCE_EXECUTION_ROWS = 32;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!flowIdSchema.safeParse(id).success) {
    return debugJson({ error: "Not found" }, { status: 404 });
  }
  const owner = await requireFlowDebugOwner(id);
  if (!owner.ok) return owner.response;
  const { data, error } = await supabaseAdmin()
    .from("flow_debug_sessions")
    .select(
      "id, flow_id, flow_version_id, draft_revision, source_run_id, status, revision, expires_at, created_at, updated_at",
    )
    .eq("flow_id", id)
    .eq("created_by", owner.user.id)
    .order("updated_at", { ascending: false })
    .limit(20);
  if (error) return debugRpcError(error);
  return debugJson({ sessions: sanitizeDebugValue(data ?? []) });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!flowIdSchema.safeParse(id).success) {
    return debugJson({ error: "Not found" }, { status: 404 });
  }
  const owner = await requireFlowDebugOwner(id);
  if (!owner.ok) return owner.response;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await readDebugJson(request));
  } catch (error) {
    return debugJson(
      {
        error:
          error instanceof Error && error.message === "debug_request_too_large"
            ? "Request too large"
            : "Invalid debug session request",
      },
      {
        status:
          error instanceof Error && error.message === "debug_request_too_large"
            ? 413
            : 400,
      },
    );
  }

  const admin = supabaseAdmin();
  let graph: FlowVersionGraph;
  let draftRevision: number | null = null;
  let flowVersionId: string | null = body.flow_version_id ?? null;
  let variables: Record<string, unknown>;
  const clonedOutputs: Record<string, Record<string, unknown>> = {};

  if (body.source_run_id) {
    const { data: sourceRun, error: sourceRunError } = await admin
      .from("flow_runs")
      .select("id, flow_id, account_id, flow_version_id")
      .eq("id", body.source_run_id)
      .eq("flow_id", id)
      .maybeSingle();
    if (sourceRunError) {
      return debugRpcError(sourceRunError, {
        operation: "read_source_run",
        flowId: id,
      });
    }
    const run = sourceRun as Pick<
      FlowRunRow,
      "id" | "flow_id" | "account_id" | "flow_version_id"
    > | null;
    if (!run || run.account_id !== owner.accountId) {
      return debugJson({ error: "Not found" }, { status: 404 });
    }
    if (!run.flow_version_id) {
      return debugJson(
        {
          error: "Source run has no immutable flow version",
          code: "DEBUG_SOURCE_RUN_UNVERSIONED",
        },
        { status: 422 },
      );
    }
    if (flowVersionId && flowVersionId !== run.flow_version_id) {
      return debugJson(
        {
          error: "Source run version conflict",
          code: "DEBUG_SOURCE_VERSION_CONFLICT",
        },
        { status: 409 },
      );
    }
    flowVersionId = run.flow_version_id;
    const { data: version, error: versionError } = await admin
      .from("flow_versions")
      .select("id, flow_id, graph")
      .eq("id", flowVersionId)
      .eq("flow_id", id)
      .maybeSingle();
    if (versionError) {
      return debugRpcError(versionError, {
        operation: "read_source_version",
        flowId: id,
      });
    }
    if (!version) return debugJson({ error: "Not found" }, { status: 404 });
    try {
      graph = parseFlowVersionGraph(version.graph);
    } catch {
      return debugJson({ error: "Invalid flow snapshot" }, { status: 422 });
    }
    const { data: sourceVariables, error: sourceVariablesError } =
      await admin.rpc("read_flow_debug_source_variables", {
        p_flow_id: id,
        p_run_id: run.id,
        p_max_bytes: 65_536,
      });
    if (sourceVariablesError) {
      return debugRpcError(sourceVariablesError, {
        operation: "read_source_variables",
        flowId: id,
      });
    }
    const sourceVariablesRow = Array.isArray(sourceVariables)
      ? sourceVariables[0]
      : sourceVariables;
    if (!sourceVariablesRow || sourceVariablesRow.truncated === true) {
      return debugJson(
        {
          error: "Source variables exceed the debug size limit",
          code: "DEBUG_VARIABLES_TOO_LARGE",
        },
        { status: 413 },
      );
    }
    variables = sourceVariablesRow.result_json as Record<string, unknown>;
    try {
      assertDebugVariablesBounded(variables);
    } catch {
      return debugJson(
        {
          error: "Source variables exceed the debug size limit",
          code: "DEBUG_VARIABLES_TOO_LARGE",
        },
        { status: 413 },
      );
    }
    variables = sanitizeDebugValue(variables) as Record<string, unknown>;
    const { data: executionRows, error: executionsError } = await admin
      .from("flow_node_executions")
      .select("node_key, outputs, started_at")
      .eq("flow_run_id", run.id)
      .order("started_at", { ascending: false })
      .limit(MAX_SOURCE_EXECUTION_ROWS);
    if (executionsError) {
      return debugRpcError(executionsError, {
        operation: "read_source_executions",
        flowId: id,
      });
    }
    for (const execution of (executionRows ?? []) as Pick<
      FlowNodeExecutionRow,
      "node_key" | "outputs"
    >[]) {
      if (!Object.hasOwn(clonedOutputs, execution.node_key)) {
        const sanitizedOutput = sanitizeDebugValue(execution.outputs) as Record<
          string,
          unknown
        >;
        const candidate = {
          ...clonedOutputs,
          [execution.node_key]: sanitizedOutput,
        };
        if (
          new TextEncoder().encode(JSON.stringify(candidate)).byteLength >
          MAX_CLONED_OUTPUT_BYTES
        ) {
          clonedOutputs[execution.node_key] = {
            truncated: true,
            reason: "source_clone_budget_exceeded",
          };
          continue;
        }
        clonedOutputs[execution.node_key] = sanitizedOutput;
      }
    }
  } else if (flowVersionId) {
    const { data: version } = await admin
      .from("flow_versions")
      .select("id, flow_id, graph")
      .eq("id", flowVersionId)
      .eq("flow_id", id)
      .maybeSingle();
    if (!version) return debugJson({ error: "Not found" }, { status: 404 });
    try {
      graph = parseFlowVersionGraph(version.graph);
    } catch {
      return debugJson({ error: "Invalid flow snapshot" }, { status: 422 });
    }
    variables = initializeFlowVariables(graph.variable_schema);
  } else {
    const { data, error } = await admin.rpc("read_flow_draft_for_publish", {
      p_flow_id: id,
    });
    if (error) return debugRpcError(error);
    const draftRead = Array.isArray(data) ? data[0] : data;
    if (!draftRead?.flow) {
      return debugJson({ error: "Not found" }, { status: 404 });
    }
    try {
      const flow = draftRead.flow as FlowRow;
      graph = buildFlowVersionGraph(
        flow,
        (draftRead.nodes ?? []) as FlowNodeRow[],
      );
      draftRevision = flow.draft_revision;
    } catch (error) {
      return debugJson(
        {
          error: error instanceof Error ? error.message : "Invalid flow draft",
        },
        { status: 422 },
      );
    }
    variables = initializeFlowVariables(graph.variable_schema);
  }

  try {
    assertDebugVariablesBounded(variables);
  } catch {
    return debugJson(
      {
        error: "Debug variables exceed the size limit",
        code: "DEBUG_VARIABLES_TOO_LARGE",
      },
      { status: 413 },
    );
  }
  const graphJson = JSON.stringify(graph);
  const snapshotHash = createHash("sha256").update(graphJson).digest("hex");
  const { data: created, error: createError } = await admin.rpc(
    "create_flow_debug_session",
    {
      p_flow_id: id,
      p_created_by: owner.user.id,
      p_graph_snapshot: graph,
      p_snapshot_hash: snapshotHash,
      p_flow_version_id: flowVersionId,
      p_draft_revision: draftRevision,
      p_source_run_id: body.source_run_id ?? null,
      p_variables: variables,
      p_node_outputs: {},
      p_source_node_outputs: clonedOutputs,
    },
  );
  if (createError) return debugRpcError(createError);
  const session = Array.isArray(created) ? created[0] : created;
  try {
    return debugJson(
      { session: sanitizeDebugSession(session as Record<string, unknown>) },
      { status: 201 },
    );
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
