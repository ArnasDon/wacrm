import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  hasCommitBlockingIssues,
  loadFlowCodeCatalog,
  previewFlowCode,
  safeImportRpcError,
} from "@/lib/flows/flow-code-server";
import { FlowCodeError } from "@/lib/flows/flow-code";
import { parseFlowCodeInput } from "@/lib/flows/flow-code";
import { consumeSecretSidecar } from "@/lib/flows/flow-code-sidecars";

export async function commitFlowCode(args: {
  admin: SupabaseClient;
  actorId: string;
  accountId: string;
  document: string;
  previewDigest: string;
  flowId?: string;
  expectedDraftRevision?: number;
  resourceBindings?: Readonly<Record<string, string>>;
  bindingToken?: string;
}) {
  try {
    const catalog = await loadFlowCodeCatalog(args.admin, args.accountId);
    const parsedBeforeBinding = parseFlowCodeInput(args.document);
    if (parsedBeforeBinding.digest !== args.previewDigest) {
      return NextResponse.json(
        { code: "PREVIEW_DIGEST_MISMATCH" },
        { status: 409 },
      );
    }
    // Commit never trusts preview output: parse, canonicalize, resolve and
    // compile again against the current destination catalog.
    const secretBindings = args.bindingToken
      ? consumeSecretSidecar({
          token: args.bindingToken,
          actorId: args.actorId,
          accountId: args.accountId,
        })
      : {};
    if (args.bindingToken && !secretBindings) {
      return NextResponse.json(
        { code: "SECRET_SIDECAR_EXPIRED" },
        { status: 409 },
      );
    }
    const { preview, graph } = previewFlowCode(
      args.document,
      catalog,
      args.flowId,
      args.resourceBindings,
      secretBindings ?? {},
    );
    if (preview.digest !== args.previewDigest) {
      return NextResponse.json(
        { code: "PREVIEW_DIGEST_MISMATCH" },
        { status: 409 },
      );
    }
    if (hasCommitBlockingIssues(preview.issues)) {
      return NextResponse.json(
        { code: "IMPORT_BLOCKED", issues: preview.issues },
        { status: 422 },
      );
    }
    const { data, error } = await args.admin.rpc("import_flow_draft", {
      p_actor_id: args.actorId,
      p_account_id: args.accountId,
      p_flow_id: args.flowId ?? null,
      p_expected_revision: args.expectedDraftRevision ?? null,
      p_name: graph.name,
      p_description: graph.description,
      p_trigger_type: graph.trigger_type,
      p_trigger_config: graph.trigger_config,
      p_entry_node_id: graph.entry_node_id,
      p_fallback_policy: graph.fallback_policy,
      p_variable_schema: graph.variable_schema,
      p_nodes: graph.nodes,
    });
    if (error) {
      const mapped = safeImportRpcError(error.message);
      return NextResponse.json({ code: mapped.code }, { status: mapped.status });
    }
    const flow = Array.isArray(data) ? data[0] : data;
    if (!flow) {
      return NextResponse.json({ code: "IMPORT_FAILED" }, { status: 500 });
    }
    return NextResponse.json(
      { flow, warnings: preview.issues.filter((issue) => issue.severity === "warning") },
      {
        status: args.flowId ? 200 : 201,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    if (error instanceof FlowCodeError) {
      return NextResponse.json({ code: error.code }, { status: 400 });
    }
    return NextResponse.json({ code: "IMPORT_FAILED" }, { status: 500 });
  }
}
