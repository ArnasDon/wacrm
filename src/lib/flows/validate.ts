/**
 * Flow activation validation.
 *
 * Descriptor schemas and descriptor validators own node-local rules. This
 * module owns only flow/trigger compatibility checks and graph topology:
 * entry, duplicate keys, edge targets, and reachability.
 */

import type { ZodIssue } from "zod";

import {
  getCompatibilityFlowTriggerDescriptor,
  getNodeDescriptor,
  type NodeValidationConsumer,
} from "./registry";

export interface ValidationIssue {
  severity: "error" | "warning";
  scope: "flow" | "trigger" | "node";
  node_key?: string;
  field?: string;
  message: string;
}

interface FlowInput {
  name: string;
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: Record<string, unknown>;
  entry_node_id: string | null;
}

interface NodeInput {
  node_key: string;
  node_type: string;
  config: Record<string, unknown>;
}

interface ValidationOptions {
  consumer?: NodeValidationConsumer;
}

export function validateFlowForActivation(
  flow: FlowInput,
  nodes: NodeInput[],
  options: ValidationOptions = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const consumer = options.consumer ?? "flow";

  if (!flow.name?.trim()) {
    issues.push({
      severity: "error",
      scope: "flow",
      field: "name",
      message: "Flow name is required.",
    });
  }
  issues.push(...validateTrigger(flow.trigger_type, flow.trigger_config));

  if (!flow.entry_node_id) {
    issues.push({
      severity: "error",
      scope: "flow",
      field: "entry_node_id",
      message: "Pick an entry node before activating.",
    });
  }

  if (nodes.length === 0) {
    issues.push({
      severity: "error",
      scope: "flow",
      message: "A flow needs at least one node before activation.",
    });
  }

  const keys = new Set(nodes.map((node) => node.node_key));
  if (flow.entry_node_id && !keys.has(flow.entry_node_id)) {
    issues.push({
      severity: "error",
      scope: "flow",
      field: "entry_node_id",
      message: `Entry node "${flow.entry_node_id}" doesn't exist.`,
    });
  }

  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.node_key)) {
      issues.push({
        severity: "error",
        scope: "node",
        node_key: node.node_key,
        message: `Duplicate node_key "${node.node_key}".`,
      });
    }
    seen.add(node.node_key);
  }

  for (const node of nodes) {
    issues.push(...validateNodeConfig(node, keys, consumer));
    issues.push(...validateEdgeTargets(node, keys));
  }

  if (flow.entry_node_id && keys.has(flow.entry_node_id)) {
    const reached = reachableFromEntry(flow.entry_node_id, nodes);
    for (const node of nodes) {
      if (!reached.has(node.node_key)) {
        issues.push({
          severity: "warning",
          scope: "node",
          node_key: node.node_key,
          message: `Node "${node.node_key}" is unreachable from the entry node.`,
        });
      }
    }
  }

  return issues;
}

function validateTrigger(
  triggerType: FlowInput["trigger_type"],
  triggerConfig: Record<string, unknown>,
): ValidationIssue[] {
  const descriptor = getCompatibilityFlowTriggerDescriptor(triggerType);
  if (!descriptor) return [];

  const parsed = descriptor.configSchema.safeParse({
    ...triggerConfig,
    next_node_key: "__entry__",
  });
  if (parsed.success) return [];

  const blanks =
    triggerType === "keyword" && Array.isArray(triggerConfig.keywords)
      ? triggerConfig.keywords.filter(
          (keyword) => typeof keyword !== "string" || !keyword.trim(),
        ).length
      : 0;
  const issues = parsed.error.issues
    .flatMap(flattenSchemaIssue)
    .filter(
      (issue) =>
        !(blanks > 0 && issue.path[0] === "keywords") &&
        issue.path[0] !== "next_node_key",
    )
    .map<ValidationIssue>((issue) => ({
      severity: "error",
      scope: "trigger",
      field: `trigger_config.${issue.path.map(String).join(".")}`,
      message: issue.message,
    }));

  if (blanks > 0) {
    issues.push({
      severity: "warning",
      scope: "trigger",
      field: "trigger_config.keywords",
      message: `${blanks} keyword${blanks === 1 ? " is" : "s are"} blank — they won't match anything.`,
    });
  }
  return issues;
}

function validateNodeConfig(
  node: NodeInput,
  knownNodeKeys: ReadonlySet<string>,
  consumer: NodeValidationConsumer,
): ValidationIssue[] {
  const descriptor = getNodeDescriptor(node.node_type);
  if (!descriptor) {
    return [
      {
        severity: "error",
        scope: "node",
        node_key: node.node_key,
        message: `Unknown node type "${node.node_type}".`,
      },
    ];
  }

  const issues: ValidationIssue[] = [];
  if (consumer === "flow" && !descriptor.supportsFlowRuntime) {
    issues.push({
      severity: "error",
      scope: "node",
      node_key: node.node_key,
      field: "node_type",
      message: `Node type "${node.node_type}" is not supported by the flow runtime.`,
    });
  }

  const schema =
    consumer === "flow"
      ? descriptor.flowConfigSchema
      : descriptor.configSchema;
  const parsed = schema.safeParse(node.config);
  const schemaIssues = parsed.success
    ? []
    : parsed.error.issues.flatMap(flattenSchemaIssue);
  issues.push(
    ...schemaIssues.map((issue) => ({
      severity: "error" as const,
      scope: "node" as const,
      node_key: node.node_key,
      field: issue.path.map(String).join(".") || undefined,
      message: issue.message,
    })),
  );

  issues.push(
    ...descriptor
      .validate(node, { knownNodeKeys, consumer })
      .map((issue) => ({
        severity: issue.severity ?? "error",
        scope: "node" as const,
        node_key: node.node_key,
        field: issue.field,
        message: issue.message,
      })),
  );
  return issues;
}

function flattenSchemaIssue(issue: ZodIssue): ZodIssue[] {
  if (issue.code !== "invalid_union") return [issue];
  return issue.errors.flatMap((branch) => branch.flatMap(flattenSchemaIssue));
}

function validateEdgeTargets(
  node: NodeInput,
  knownNodeKeys: ReadonlySet<string>,
): ValidationIssue[] {
  const descriptor = getNodeDescriptor(node.node_type);
  if (!descriptor) return [];

  const issues: ValidationIssue[] = [];
  for (const edge of descriptor.outgoingEdgeTargets(node.config)) {
    if (!knownNodeKeys.has(edge.target)) {
      issues.push({
        severity: "error",
        scope: "node",
        node_key: node.node_key,
        field: edge.field,
        message: `Edge points to non-existent node "${edge.target}".`,
      });
    }
  }
  return issues;
}

export function reachableFromEntry(
  entryKey: string,
  nodes: NodeInput[],
): Set<string> {
  const byKey = new Map(nodes.map((node) => [node.node_key, node]));
  const visited = new Set<string>();
  const queue = [entryKey];

  while (queue.length > 0) {
    const key = queue.shift()!;
    if (visited.has(key)) continue;
    visited.add(key);
    const node = byKey.get(key);
    if (!node) continue;
    const descriptor = getNodeDescriptor(node.node_type);
    if (!descriptor) continue;
    for (const target of descriptor.outgoingEdges(node.config)) {
      if (!visited.has(target)) queue.push(target);
    }
  }
  return visited;
}
