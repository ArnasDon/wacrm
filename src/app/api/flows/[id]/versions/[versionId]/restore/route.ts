import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { parseFlowVersionGraph } from "@/lib/flows/versions";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  _request: Request,
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
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    flow: Array.isArray(data) ? data[0] : data,
    nodes: graph.nodes,
    graph,
    restored_version_id: versionId,
  });
}
