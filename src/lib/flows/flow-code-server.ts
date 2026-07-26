import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  canonicalFlowCodeText,
  compileFlowCode,
  digestFlowCode,
  parseFlowCodeInput,
  type CatalogResource,
  type FlowCodeCatalog,
  type FlowCodeIssue,
} from "@/lib/flows/flow-code";

export interface FlowCodePreview {
  normalized: string;
  digest: string;
  resolved: Record<string, string>;
  secret_requirements: Array<{
    name: string;
    node_key: string;
    path: string;
  }>;
  issues: FlowCodeIssue[];
}

export async function loadFlowCodeCatalog(
  admin: SupabaseClient,
  accountId: string,
): Promise<FlowCodeCatalog> {
  const [tags, fields, pipelines, members, flows] = await Promise.all([
    admin.from("tags").select("id, name").eq("account_id", accountId),
    admin
      .from("custom_fields")
      .select("id, field_name")
      .eq("account_id", accountId),
    admin.from("pipelines").select("id, name").eq("account_id", accountId),
    admin
      .from("profiles")
      .select("user_id, full_name")
      .eq("account_id", accountId),
    admin
      .from("flows")
      .select("id, name, published_version_id")
      .eq("account_id", accountId),
  ]);
  const failure = [tags, fields, pipelines, members, flows].find(
    (result) => result.error,
  );
  if (failure?.error) throw new Error("FLOW_CODE_CATALOG_UNAVAILABLE");
  const pipelineRows = (pipelines.data ?? []) as Array<{
    id: string;
    name: string;
  }>;
  const pipelineIds = pipelineRows.map(({ id }) => id);
  const stages =
    pipelineIds.length === 0
      ? { data: [], error: null }
      : await admin
          .from("pipeline_stages")
          .select("id, name, pipeline_id")
          .in("pipeline_id", pipelineIds);
  if (stages.error) throw new Error("FLOW_CODE_CATALOG_UNAVAILABLE");
  const flowRows = (flows.data ?? []) as Array<{
    id: string;
    name: string;
    published_version_id: string | null;
  }>;
  const versionIds = flowRows.flatMap((flow) =>
    flow.published_version_id ? [flow.published_version_id] : [],
  );
  const versions =
    versionIds.length === 0
      ? { data: [], error: null }
      : await admin
          .from("flow_versions")
          .select("id, graph")
          .in("id", versionIds);
  if (versions.error) throw new Error("FLOW_CODE_CATALOG_UNAVAILABLE");
  const assetPrefix = `account-${accountId}`;
  const assetBucket = admin.storage.from("flow-media");
  const assets = await assetBucket.list(assetPrefix, {
    limit: 500,
    sortBy: { column: "name", order: "asc" },
  });
  if (assets.error) throw new Error("FLOW_CODE_CATALOG_UNAVAILABLE");
  const versionById = new Map(
    ((versions.data ?? []) as Array<{
      id: string;
      graph: {
        entry_node_key?: unknown;
        nodes?: unknown;
      };
    }>).map((version) => [version.id, version]),
  );
  const resources: CatalogResource[] = [
    ...((tags.data ?? []) as Array<{ id: string; name: string }>).map(
      (row) => ({ id: row.id, kind: "tag" as const, name: row.name }),
    ),
    ...((fields.data ?? []) as Array<{
      id: string;
      field_name: string;
    }>).map((row) => ({
      id: row.id,
      kind: "custom_field" as const,
      name: row.field_name,
    })),
    ...pipelineRows.map((row) => ({
      id: row.id,
      kind: "pipeline" as const,
      name: row.name,
    })),
    ...((stages.data ?? []) as Array<{
      id: string;
      name: string;
      pipeline_id: string;
    }>).map((row) => ({
      id: row.id,
      kind: "stage" as const,
      name: row.name,
      parentId: row.pipeline_id,
    })),
    ...((members.data ?? []) as Array<{
      user_id: string;
      full_name: string;
    }>).map((row) => ({
      id: row.user_id,
      kind: "member" as const,
      name: row.full_name || "Unnamed member",
    })),
    ...((assets.data ?? []) as Array<{ name: string }>).flatMap((row) => {
      if (
        !row.name ||
        row.name === "." ||
        row.name === ".." ||
        row.name.includes("/") ||
        row.name.includes("\\")
      ) {
        return [];
      }
      const path = `${assetPrefix}/${row.name}`;
      const { data } = assetBucket.getPublicUrl(path);
      return [
        {
          id: `asset:${createHash("sha256").update(path).digest("hex")}`,
          kind: "asset" as const,
          name: row.name,
          runtimeValue: data.publicUrl,
        },
      ];
    }),
  ];
  return {
    resources,
    flows: flowRows.map((flow) => {
      const version = flow.published_version_id
        ? versionById.get(flow.published_version_id)
        : undefined;
      return {
        id: flow.id,
        name: flow.name,
        publishedVersionId: flow.published_version_id,
        entryNodeKey:
          typeof version?.graph?.entry_node_key === "string"
            ? version.graph.entry_node_key
            : null,
        dependencies: Array.isArray(version?.graph?.nodes)
          ? (
              version.graph.nodes as Array<{
                node_type?: unknown;
                config?: { flow_id?: unknown };
              }>
            ).flatMap((node) =>
              node.node_type === "sub_flow" &&
              typeof node.config?.flow_id === "string"
                ? [node.config.flow_id]
                : [],
            )
          : [],
      };
    }),
  };
}

export function previewFlowCode(
  text: string,
  catalog: FlowCodeCatalog,
  replacingFlowId?: string,
  resourceBindings: Readonly<Record<string, string>> = {},
  secretBindings: Readonly<Record<string, string>> = {},
): {
  preview: FlowCodePreview;
  graph: ReturnType<typeof compileFlowCode>["graph"];
} {
  const parsed = parseFlowCodeInput(text);
  const normalized = canonicalFlowCodeText(parsed.document);
  const compiled = compileFlowCode(parsed.document, catalog, {
    replacingFlowId,
    resourceBindings,
    secretBindings,
  });
  return {
    preview: {
      normalized,
      digest: digestFlowCode(normalized),
      resolved: compiled.resolved,
      secret_requirements: parsed.document.secret_requirements,
      issues: [...parsed.warnings, ...compiled.issues],
    },
    graph: compiled.graph,
  };
}

export function hasCommitBlockingIssues(issues: readonly FlowCodeIssue[]) {
  return issues.some(
    (issue) => issue.severity === "fatal" || issue.severity === "blocking",
  );
}

export function safeImportRpcError(message: string | undefined): {
  status: number;
  code: string;
} {
  if (message?.includes("draft_revision_conflict")) {
    return { status: 409, code: "DRAFT_REVISION_CONFLICT" };
  }
  if (message?.includes("import_flow_not_found")) {
    return { status: 404, code: "FLOW_NOT_FOUND" };
  }
  if (message?.includes("import_actor_forbidden")) {
    return { status: 403, code: "IMPORT_FORBIDDEN" };
  }
  if (
    message?.includes("import_payload_invalid") ||
    message?.includes("import_node_invalid") ||
    message?.includes("import_entry_node_missing") ||
    message?.includes("import_source_identifier_forbidden") ||
    message?.includes("import_secret_unbound")
  ) {
    return { status: 422, code: "IMPORT_INVALID" };
  }
  return { status: 500, code: "IMPORT_FAILED" };
}
