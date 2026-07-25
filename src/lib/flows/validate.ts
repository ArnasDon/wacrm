/**
 * Flow activation validation.
 *
 * Descriptor schemas and descriptor validators own node-local rules. This
 * module owns only flow/trigger compatibility checks and graph topology:
 * entry, duplicate keys, edge targets, and reachability.
 */

import { getNodeDescriptor } from "./registry";
import type { ZodIssue } from "zod";

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

export function validateFlowForActivation(
  flow: FlowInput,
  nodes: NodeInput[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

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
    issues.push(...validateNodeConfig(node, keys));
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
  if (triggerType !== "keyword") return [];
  const keywords = Array.isArray(triggerConfig.keywords)
    ? triggerConfig.keywords
    : null;
  if (!keywords || keywords.length === 0) {
    return [
      {
        severity: "error",
        scope: "trigger",
        field: "trigger_config.keywords",
        message: "Keyword triggers need at least one keyword.",
      },
    ];
  }
  const blanks = keywords.filter(
    (keyword) => typeof keyword !== "string" || !keyword.trim(),
  ).length;
  return blanks > 0
    ? [
        {
          severity: "warning",
          scope: "trigger",
          field: "trigger_config.keywords",
          message: `${blanks} keyword${blanks === 1 ? " is" : "s are"} blank — they won't match anything.`,
        },
      ]
    : [];
}

function validateNodeConfig(
  node: NodeInput,
  knownNodeKeys: ReadonlySet<string>,
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

  const parsed = descriptor.configSchema.safeParse(node.config);
  const schemaIssues = parsed.success
    ? []
    : parsed.error.issues.flatMap(flattenSchemaIssue);
  const issues: ValidationIssue[] = schemaIssues.map((issue) => ({
        severity: "error",
        scope: "node",
        node_key: node.node_key,
        field: issue.path.map(String).join(".") || undefined,
        message: issue.message,
      }));

  issues.push(
    ...descriptor.validate(node, { knownNodeKeys }).map((issue) => ({
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
  for (const edge of outgoingEdgesWithFields(node)) {
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

function outgoingEdgesWithFields(
  node: NodeInput,
): Array<{ target: string; field: string }> {
  const config = node.config;
  if (
    (node.node_type === "send_buttons" || node.node_type === "send_list") &&
    typeof config.next_node_key === "string" &&
    config.next_node_key
  ) {
    return [{ target: config.next_node_key, field: "next_node_key" }];
  }
  if (node.node_type === "send_buttons" && Array.isArray(config.buttons)) {
    return config.buttons.flatMap((button, index) =>
      typeof button === "object" &&
      button !== null &&
      "next_node_key" in button &&
      typeof button.next_node_key === "string" &&
      button.next_node_key
        ? [
            {
              target: button.next_node_key,
              field: `buttons.${index}.next_node_key`,
            },
          ]
        : [],
    );
  }
  if (node.node_type === "send_list" && Array.isArray(config.sections)) {
    const edges: Array<{ target: string; field: string }> = [];
    config.sections.forEach((section, sectionIndex) => {
      if (
        typeof section !== "object" ||
        section === null ||
        !("rows" in section) ||
        !Array.isArray(section.rows)
      ) {
        return;
      }
      (section.rows as unknown[]).forEach((row, rowIndex) => {
        if (
          typeof row === "object" &&
          row !== null &&
          "next_node_key" in row &&
          typeof row.next_node_key === "string" &&
          row.next_node_key
        ) {
          edges.push({
            target: row.next_node_key,
            field: `sections.${sectionIndex}.rows.${rowIndex}.next_node_key`,
          });
        }
      });
    });
    return edges;
  }
  if (node.node_type === "condition") {
    return (["true_next", "false_next"] as const).flatMap((field) =>
      typeof config[field] === "string" && config[field]
        ? [{ target: config[field], field }]
        : [],
    );
  }
  return typeof config.next_node_key === "string" && config.next_node_key
    ? [{ target: config.next_node_key, field: "next_node_key" }]
    : [];
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
