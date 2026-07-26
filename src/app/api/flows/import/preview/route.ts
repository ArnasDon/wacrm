import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { FlowCodeError } from "@/lib/flows/flow-code";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import {
  loadFlowCodeCatalog,
  previewFlowCode,
} from "@/lib/flows/flow-code-server";
import { readFlowCodeRequest } from "../request";

export async function POST(request: Request) {
  let account;
  try {
    account = await requireRole("agent");
  } catch (error) {
    return toErrorResponse(error);
  }
  const body = await readFlowCodeRequest(request, "preview");
  if (!body.ok) {
    return NextResponse.json({ code: body.code }, { status: body.status });
  }
  try {
    const catalog = await loadFlowCodeCatalog(
      supabaseAdmin(),
      account.accountId,
    );
    const { preview, graph } = previewFlowCode(
      body.document,
      catalog,
      undefined,
      body.resourceBindings,
    );
    return NextResponse.json({ ...preview, draft: graph }, {
      headers: { "Cache-Control": "private, no-store" },
    });
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
