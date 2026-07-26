import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { parseFlowVersionGraph } from "@/lib/flows/versions";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; versionId: string }> },
) {
  const { id, versionId } = await context.params;
  try {
    await requireRole("agent");
  } catch (error) {
    return toErrorResponse(error);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: flow } = await supabase
    .from("flows")
    .select("id, user_id")
    .eq("id", id)
    .maybeSingle();
  if (!flow) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (flow.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as
    | {
        expected_draft_revision?: unknown;
        expected_published_version_id?: unknown;
      }
    | null;
  if (
    !body ||
    !Number.isSafeInteger(body.expected_draft_revision) ||
    (body.expected_draft_revision as number) < 0 ||
    !Object.hasOwn(body, "expected_published_version_id") ||
    (body.expected_published_version_id !== null &&
      typeof body.expected_published_version_id !== "string")
  ) {
    return NextResponse.json(
      {
        error:
          "expected_draft_revision and expected_published_version_id are required",
      },
      { status: 400 },
    );
  }
  const { data: version, error: versionError } = await supabase
    .from("flow_versions")
    .select("id, flow_id, graph")
    .eq("id", versionId)
    .eq("flow_id", id)
    .maybeSingle();
  if (versionError) {
    return NextResponse.json({ error: versionError.message }, { status: 500 });
  }
  if (!version) {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }

  let graph;
  try {
    graph = parseFlowVersionGraph(version.graph);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Stored flow version is invalid",
      },
      { status: 409 },
    );
  }

  const { data, error } = await supabaseAdmin().rpc("restore_flow_version", {
    p_flow_id: id,
    p_flow_version_id: versionId,
    p_expected_draft_revision: body.expected_draft_revision as number,
    p_expected_published_version_id:
      body.expected_published_version_id as string | null,
  });
  if (error) {
    if (
      error.message.includes("draft_revision_conflict") ||
      error.message.includes("published_version_conflict")
    ) {
      return NextResponse.json(
        {
          error:
            "The draft or live version changed before restore. Refresh and retry.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    flow: Array.isArray(data) ? data[0] : data,
    nodes: graph.nodes,
    graph,
    restored_version_id: versionId,
  });
}
