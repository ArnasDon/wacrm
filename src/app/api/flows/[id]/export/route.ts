import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  canonicalFlowCodeText,
  digestFlowCode,
  exportFlowCode,
  FlowCodeError,
} from "@/lib/flows/flow-code";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { loadFlowCodeCatalog } from "@/lib/flows/flow-code-server";

function safeFilename(name: string) {
  const stem =
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "flow";
  return `${stem}.wacrm-flow.json`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  let account;
  try {
    account = await requireRole("viewer");
  } catch (error) {
    return toErrorResponse(error);
  }
  const admin = supabaseAdmin();
  const [{ data: flow, error: flowError }, { data: nodes, error: nodeError }] =
    await Promise.all([
      admin
        .from("flows")
        .select("*")
        .eq("id", id)
        .eq("account_id", account.accountId)
        .maybeSingle(),
      admin
        .from("flow_nodes")
        .select("*")
        .eq("flow_id", id)
        .order("created_at", { ascending: true }),
    ]);
  if (flowError || nodeError) {
    return NextResponse.json({ code: "EXPORT_FAILED" }, { status: 500 });
  }
  if (!flow) {
    return NextResponse.json({ code: "FLOW_NOT_FOUND" }, { status: 404 });
  }
  try {
    const catalog = await loadFlowCodeCatalog(admin, account.accountId);
    const exported = exportFlowCode({
      flow,
      nodes: nodes ?? [],
      resourceCatalog: catalog,
    });
    const text = canonicalFlowCodeText(exported.document);
    const etag = `"${digestFlowCode(text)}"`;
    const headers = {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${safeFilename(flow.name)}"`,
      "Content-Type": "application/json; charset=utf-8",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    };
    if (request.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers });
    }
    return new NextResponse(text, { status: 200, headers });
  } catch (error) {
    if (error instanceof FlowCodeError) {
      return NextResponse.json({ code: error.code }, { status: 422 });
    }
    return NextResponse.json({ code: "EXPORT_FAILED" }, { status: 500 });
  }
}
