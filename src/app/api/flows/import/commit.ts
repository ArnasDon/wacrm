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

export async function commitFlowCode(args: {
  admin: SupabaseClient;
  actorId: string;
  accountId: string;
  document: string;
  previewDigest: string;
  flowId?: string;
  expectedDraftRevision?: number;
  resourceBindings?: Readonly<Record<string, string>>;
  secretBindings?: Readonly<Record<string, string>>;
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
    const requiredSecrets = new Set(
      parsedBeforeBinding.document.secret_requirements.map(({ name }) => name),
    );
    const suppliedSecrets = Object.keys(args.secretBindings ?? {});
    if (
      suppliedSecrets.some((name) => !requiredSecrets.has(name)) ||
      [...requiredSecrets].some((name) => !(name in (args.secretBindings ?? {})))
    ) {
      return NextResponse.json(
        { code: "INVALID_SECRET_BINDINGS" },
        { status: 422 },
      );
    }
    // Commit never trusts preview output: parse, canonicalize, resolve and
    // compile again against the current destination catalog. Secret values
    // exist only in this request scope and are never echoed.
    const { preview, graph } = previewFlowCode(
      args.document,
      catalog,
      args.flowId,
      args.resourceBindings,
      args.secretBindings ?? {},
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
    const resolvedIds = new Set(Object.values(preview.resolved));
    const allowedPersistenceIds = new Set<string>();
    const collectUuid = (value: string | null | undefined) => {
      for (const match of value?.matchAll(
        /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,
      ) ?? []) {
        allowedPersistenceIds.add(match[0].toLowerCase());
      }
    };
    for (const resource of catalog.resources) {
      if (!resolvedIds.has(resource.id)) continue;
      collectUuid(resource.id);
      collectUuid(resource.runtimeValue);
      collectUuid(resource.publishedVersionId);
    }
    for (const flow of catalog.flows) {
      if (!resolvedIds.has(flow.id)) continue;
      collectUuid(flow.id);
      collectUuid(flow.publishedVersionId);
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
      p_allowed_resource_ids: [...allowedPersistenceIds],
      p_allowed_secret_paths:
        parsedBeforeBinding.document.secret_requirements.map(
          ({ node_key, path }) => {
            const match = /^config\.([^.]+)\.(.+)$/.exec(path);
            if (!match) throw new FlowCodeError("INVALID_SECRET_PATH", path);
            return { node_key, path: ["config", match[1], match[2]] };
          },
        ),
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
