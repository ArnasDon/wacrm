import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  canonicalFlowCodeText,
  digestFlowCode,
  exportFlowCode,
  FlowCodeError,
  FLOW_CODE_LIMITS,
} from "@/lib/flows/flow-code";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { loadFlowCodeCatalog } from "@/lib/flows/flow-code-server";

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
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > FLOW_CODE_LIMITS.maxBytes) {
    return NextResponse.json(
      { code: "DOCUMENT_TOO_LARGE" },
      { status: 413 },
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { code: "INVALID_REQUEST_JSON" },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { code: "INVALID_EXPORT_REQUEST" },
      { status: 400 },
    );
  }
  const draft = body as Record<string, unknown>;
  const admin = supabaseAdmin();
  const { data: source } = await admin
    .from("flows")
    .select("id, account_id, user_id")
    .eq("id", id)
    .eq("account_id", account.accountId)
    .maybeSingle();
  if (!source) {
    return NextResponse.json({ code: "FLOW_NOT_FOUND" }, { status: 404 });
  }
  if (!Array.isArray(draft.nodes)) {
    return NextResponse.json(
      { code: "INVALID_EXPORT_REQUEST" },
      { status: 400 },
    );
  }
  try {
    const catalog = await loadFlowCodeCatalog(admin, account.accountId);
    const exported = exportFlowCode({
      flow: {
        id,
        account_id: account.accountId,
        user_id: source.user_id,
        name: String(draft.name ?? ""),
        description:
          typeof draft.description === "string" ? draft.description : null,
        trigger_type: draft.trigger_type as
          | "keyword"
          | "first_inbound_message"
          | "manual",
        trigger_config:
          draft.trigger_config &&
          typeof draft.trigger_config === "object" &&
          !Array.isArray(draft.trigger_config)
            ? (draft.trigger_config as Record<string, unknown>)
            : {},
        entry_node_id:
          typeof draft.entry_node_id === "string"
            ? draft.entry_node_id
            : null,
        fallback_policy: draft.fallback_policy as never,
        variable_schema: Array.isArray(draft.variable_schema)
          ? (draft.variable_schema as never)
          : [],
      },
      nodes: draft.nodes as never,
      resourceCatalog: catalog,
    });
    const normalized = canonicalFlowCodeText(exported.document);
    return NextResponse.json(
      {
        normalized,
        digest: digestFlowCode(normalized),
        warnings: exported.warnings,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof FlowCodeError) {
      return NextResponse.json({ code: error.code }, { status: 422 });
    }
    return NextResponse.json({ code: "EXPORT_FAILED" }, { status: 500 });
  }
}
