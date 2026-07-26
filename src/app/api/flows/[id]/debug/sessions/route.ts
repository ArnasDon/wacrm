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
} from "@/lib/flows/versions";
import { initializeFlowVariables } from "@/lib/flows/runtime-primitives";

const bodySchema = z
  .object({
    source_run_id: z.string().uuid().optional(),
    flow_version_id: z.string().uuid().optional(),
  })
  .strict();
const flowIdSchema = z.string().uuid();

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
      "id, flow_id, flow_version_id, draft_revision, source_run_id, variables, status, revision, expires_at, created_at, updated_at",
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
          error instanceof Error &&
          error.message === "debug_request_too_large"
            ? "Request too large"
            : "Invalid debug session request",
      },
      { status: error instanceof Error && error.message === "debug_request_too_large" ? 413 : 400 },
    );
  }

  const admin = supabaseAdmin();
  let graph;
  let draftRevision: number | null = null;
  const flowVersionId: string | null = body.flow_version_id ?? null;

  if (flowVersionId) {
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
          error:
            error instanceof Error ? error.message : "Invalid flow draft",
        },
        { status: 422 },
      );
    }
  }

  let variables = initializeFlowVariables(graph.variable_schema);
  const clonedOutputs: Record<string, Record<string, unknown>> = {};
  if (body.source_run_id) {
    const { data: sourceRun } = await admin
      .from("flow_runs")
      .select("id, flow_id, account_id, vars")
      .eq("id", body.source_run_id)
      .eq("flow_id", id)
      .maybeSingle();
    const run = sourceRun as Pick<
      FlowRunRow,
      "id" | "flow_id" | "account_id" | "vars"
    > | null;
    if (!run || run.account_id !== owner.accountId) {
      return debugJson({ error: "Not found" }, { status: 404 });
    }
    variables = sanitizeDebugValue(run.vars) as Record<string, unknown>;
    const { data: executionRows } = await admin
      .from("flow_node_executions")
      .select("node_key, outputs, started_at")
      .eq("flow_run_id", run.id)
      .order("started_at", { ascending: false });
    for (const execution of (executionRows ?? []) as Pick<
      FlowNodeExecutionRow,
      "node_key" | "outputs"
    >[]) {
      if (!Object.hasOwn(clonedOutputs, execution.node_key)) {
        clonedOutputs[execution.node_key] = sanitizeDebugValue(
          execution.outputs,
        ) as Record<string, unknown>;
      }
    }
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
  return debugJson(
    { session: sanitizeDebugSession(session as Record<string, unknown>) },
    { status: 201 },
  );
}
