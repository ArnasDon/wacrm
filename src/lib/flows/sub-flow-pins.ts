import type { supabaseAdmin } from "./admin-client";
import {
  MAX_SUB_FLOW_DEPTH,
  validateSubFlowCallGraph,
} from "./composite-runtime";
import type { FlowVariableDeclaration } from "./runtime-primitives";
import { parseFlowVersionGraph } from "./versions";

interface SubFlowNode {
  node_key: string;
  node_type: string;
  config: Record<string, unknown>;
}

export interface PublishedFlowCatalogEntry {
  versionId: string;
  graph: {
    entry_node_key: string;
    variable_schema: readonly FlowVariableDeclaration[];
    nodes: readonly SubFlowNode[];
  };
}

function calledFlowIds(nodes: readonly SubFlowNode[]): string[] {
  return nodes.flatMap((node) =>
    node.node_type === "sub_flow" && typeof node.config.flow_id === "string"
      ? [node.config.flow_id]
      : [],
  );
}

interface SubFlowMapping {
  parent_key: string;
  child_key: string;
}

function mappings(
  node: SubFlowNode,
  key: "input_mapping" | "output_mapping",
): SubFlowMapping[] {
  const value = node.config[key] ?? [];
  if (!Array.isArray(value)) {
    throw new Error(`Sub-flow node "${node.node_key}" has an invalid ${key}.`);
  }
  return value.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof (entry as Record<string, unknown>).parent_key !== "string" ||
      typeof (entry as Record<string, unknown>).child_key !== "string"
    ) {
      throw new Error(`Sub-flow node "${node.node_key}" has an invalid ${key}.`);
    }
    return entry as SubFlowMapping;
  });
}

function validateMappings(
  node: SubFlowNode,
  parentSchema: readonly FlowVariableDeclaration[],
  childSchema: readonly FlowVariableDeclaration[],
): void {
  const parentVariables = new Map(
    parentSchema.map((declaration) => [declaration.key, declaration]),
  );
  const childVariables = new Map(
    childSchema.map((declaration) => [declaration.key, declaration]),
  );
  const validatePair = (
    mapping: SubFlowMapping,
    direction: "input" | "output",
  ) => {
    const parent = parentVariables.get(mapping.parent_key);
    const child = childVariables.get(mapping.child_key);
    if (!parent) {
      throw new Error(
        `Mapped parent variable "${mapping.parent_key}" does not exist for sub-flow node "${node.node_key}".`,
      );
    }
    if (!child) {
      throw new Error(
        `Mapped child variable "${mapping.child_key}" does not exist in flow "${String(node.config.flow_id)}".`,
      );
    }
    if (parent.type !== child.type) {
      throw new Error(
        `${direction} mapping "${mapping.parent_key}" to "${mapping.child_key}" has incompatible variable types (${parent.type} and ${child.type}).`,
      );
    }
  };
  mappings(node, "input_mapping").forEach((mapping) =>
    validatePair(mapping, "input"),
  );
  mappings(node, "output_mapping").forEach((mapping) =>
    validatePair(mapping, "output"),
  );
}

export function pinSubFlowNodesFromCatalog<T extends SubFlowNode>(
  parentFlowId: string,
  nodes: readonly T[],
  catalog: ReadonlyMap<string, PublishedFlowCatalogEntry>,
  parentVariableSchema: readonly FlowVariableDeclaration[] = [],
): T[] {
  const directChildren = calledFlowIds(nodes);
  if (directChildren.includes(parentFlowId)) {
    throw new Error("A flow cannot call itself.");
  }

  const reachable = new Set<string>([parentFlowId]);
  const queue: Array<{
    nodes: readonly SubFlowNode[];
    variableSchema: readonly FlowVariableDeclaration[];
  }> = [{ nodes, variableSchema: parentVariableSchema }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const node of current.nodes) {
      if (node.node_type !== "sub_flow") continue;
      const childId = node.config.flow_id;
      if (typeof childId !== "string") {
        throw new Error(`Sub-flow node "${node.node_key}" is missing a flow.`);
      }
      // The call-graph validator below owns recursion diagnostics. The parent
      // draft is intentionally absent from the published-child catalog.
      if (childId === parentFlowId) continue;
      const child = catalog.get(childId);
      if (!child) {
        throw new Error(
          `Sub-flow "${childId}" must be published in the same account.`,
        );
      }
      validateMappings(node, current.variableSchema, child.graph.variable_schema);
      if (!reachable.has(childId)) {
        reachable.add(childId);
        queue.push({
          nodes: child.graph.nodes,
          variableSchema: child.graph.variable_schema,
        });
      }
    }
  }

  const callGraph = new Map<string, readonly string[]>([
    [parentFlowId, directChildren],
    ...[...catalog.entries()].map(
      ([flowId, entry]) =>
        [flowId, calledFlowIds(entry.graph.nodes)] as const,
    ),
  ]);
  const validation = validateSubFlowCallGraph(callGraph, parentFlowId);
  if (!validation.ok) {
    throw new Error(
      validation.reason === "cycle"
        ? "Sub-flow call cycle detected."
        : `Sub-flow call depth exceeds ${MAX_SUB_FLOW_DEPTH}.`,
    );
  }

  return nodes.map((node) => {
    if (node.node_type !== "sub_flow") return structuredClone(node);
    const childId = node.config.flow_id as string;
    const child = catalog.get(childId)!;
    return {
      ...structuredClone(node),
      config: {
        ...structuredClone(node.config),
        flow_version_id: child.versionId,
        child_entry_node_key: child.graph.entry_node_key,
      },
    };
  });
}

type AdminClient = ReturnType<typeof supabaseAdmin>;

export async function resolveSubFlowPinsForPublish<T extends SubFlowNode>(
  db: AdminClient,
  accountId: string,
  parentFlowId: string,
  nodes: readonly T[],
  parentVariableSchema: readonly FlowVariableDeclaration[] = [],
): Promise<T[]> {
  if (!nodes.some((node) => node.node_type === "sub_flow")) {
    return nodes.map((node) => structuredClone(node));
  }
  const { data: flows, error: flowError } = await db
    .from("flows")
    .select("id, published_version_id")
    .eq("account_id", accountId)
    .not("published_version_id", "is", null);
  if (flowError) throw flowError;
  const flowRows = (flows ?? []) as Array<{
    id: string;
    published_version_id: string;
  }>;
  const versionIds = flowRows.map((flow) => flow.published_version_id);
  const { data: versions, error: versionError } = versionIds.length
    ? await db
        .from("flow_versions")
        .select("id, flow_id, graph")
        .in("id", versionIds)
    : { data: [], error: null };
  if (versionError) throw versionError;
  const versionsByFlow = new Map<string, PublishedFlowCatalogEntry>();
  for (const version of (versions ?? []) as Array<{
    id: string;
    flow_id: string;
    graph: unknown;
  }>) {
    try {
      versionsByFlow.set(version.flow_id, {
        versionId: version.id,
        graph: parseFlowVersionGraph(version.graph),
      });
    } catch {
      // A corrupt unrelated snapshot must not block publication. If this
      // version is reachable, the catalog traversal below reports it as
      // unavailable instead.
    }
  }
  return pinSubFlowNodesFromCatalog(
    parentFlowId,
    nodes,
    versionsByFlow,
    parentVariableSchema,
  );
}
