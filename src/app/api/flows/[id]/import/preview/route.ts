import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { FlowCodeError } from "@/lib/flows/flow-code";
import {
  loadFlowCodeCatalog,
  previewFlowCode,
} from "@/lib/flows/flow-code-server";
import { readFlowCodeRequest } from "../../../import/request";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  let account;
  try {
    account = await requireRole("agent");
  } catch (error) {
    return toErrorResponse(error);
  }

  const admin = supabaseAdmin();
  const { data: flow, error: flowError } = await admin
    .from("flows")
    .select("id")
    .eq("id", id)
    .eq("account_id", account.accountId)
    .maybeSingle();
  if (flowError) {
    return NextResponse.json(
      { code: "IMPORT_PREVIEW_FAILED" },
      { status: 500 },
    );
  }
  if (!flow) {
    return NextResponse.json({ code: "FLOW_NOT_FOUND" }, { status: 404 });
  }

  const body = await readFlowCodeRequest(request, "preview");
  if (!body.ok) {
    return NextResponse.json({ code: body.code }, { status: body.status });
  }
  try {
    const catalog = await loadFlowCodeCatalog(admin, account.accountId);
    const { preview, graph } = previewFlowCode(
      body.document,
      catalog,
      id,
      body.resourceBindings,
    );
    return NextResponse.json(
      { ...preview, draft: graph },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof FlowCodeError) {
      return NextResponse.json({ code: error.code }, { status: 400 });
    }
    return NextResponse.json(
      { code: "IMPORT_PREVIEW_FAILED" },
      { status: 500 },
    );
  }
}
