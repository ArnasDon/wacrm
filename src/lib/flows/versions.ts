import { z } from "zod";

import { resolveFallbackPolicy } from "./fallback";
import {
  getCompatibilityFlowTriggerDescriptor,
  getDeterministicSuccessEdgeTarget,
  getNodeDescriptor,
  isFlowRuntimeNodeType,
  type RegisteredNodeType,
} from "./registry";
import { commonExecutionPolicySchema } from "./registry/schemas";
import type {
  FlowFallbackPolicy,
  FlowNodeRow,
  FlowRow,
  KeywordTriggerConfig,
} from "./types";

const triggerTypeSchema = z.enum([
  "keyword",
  "first_inbound_message",
  "manual",
]);

const storedNodeSchema = z.strictObject({
  node_key: z.string().trim().min(1),
  node_type: z.string().trim().min(1),
  config: z.record(z.string(), z.unknown()),
  position_x: z.number().finite(),
  position_y: z.number().finite(),
});

const graphEnvelopeSchema = z.strictObject({
  schema_version: z.literal(1),
  trigger: z.strictObject({
    type: triggerTypeSchema,
    config: z.record(z.string(), z.unknown()),
  }),
  entry_node_key: z.string().trim().min(1),
  fallback_policy: z.strictObject({
    on_unknown_reply: z.enum(["reprompt", "handoff", "ignore"]),
    max_reprompts: z.number().int().nonnegative(),
    on_timeout_hours: z.number().positive(),
    on_exhaust: z.enum(["handoff", "end"]),
    execution: commonExecutionPolicySchema.optional(),
  }),
  nodes: z.array(storedNodeSchema).min(1),
});

export interface FlowVersionGraphNode {
  node_key: string;
  node_type: RegisteredNodeType;
  config: Record<string, unknown>;
  position_x: number;
  position_y: number;
}

export interface FlowVersionGraph {
  schema_version: 1;
  trigger: {
    type: FlowRow["trigger_type"];
    config: Record<string, unknown>;
  };
  entry_node_key: string;
  fallback_policy: FlowFallbackPolicy;
  nodes: FlowVersionGraphNode[];
}

type DraftEnvelope = Pick<
  FlowRow,
  "trigger_type" | "trigger_config" | "entry_node_id" | "fallback_policy"
>;

type DraftNode = Pick<
  FlowNodeRow,
  "node_key" | "node_type" | "config" | "position_x" | "position_y"
>;

function invalid(message: string): never {
  throw new Error(`Invalid flow version graph: ${message}`);
}

export function parseFlowVersionGraph(value: unknown): FlowVersionGraph {
  const parsed = graphEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    invalid(parsed.error.issues[0]?.message ?? "invalid snapshot envelope");
  }
  const graph = parsed.data;
  const keys = new Set<string>();

  for (const node of graph.nodes) {
    if (keys.has(node.node_key)) {
      invalid(`duplicate node key "${node.node_key}"`);
    }
    keys.add(node.node_key);
    if (!isFlowRuntimeNodeType(node.node_type)) {
      invalid(
        `node type "${node.node_type}" is not supported by the flow runtime`,
      );
    }
  }
  if (!keys.has(graph.entry_node_key)) {
    invalid(`entry node "${graph.entry_node_key}" does not exist`);
  }
  if (
    graph.fallback_policy.execution?.on_error === "fail_branch" &&
    graph.fallback_policy.execution.error_next_node_key &&
    !keys.has(graph.fallback_policy.execution.error_next_node_key)
  ) {
    invalid(
      `global error branch "${graph.fallback_policy.execution.error_next_node_key}" does not exist`,
    );
  }

  const triggerDescriptor = getCompatibilityFlowTriggerDescriptor(
    graph.trigger.type,
  );
  const triggerResult = triggerDescriptor?.configSchema.safeParse({
    ...graph.trigger.config,
    next_node_key: graph.entry_node_key,
  });
  if (!triggerDescriptor || !triggerResult?.success) {
    invalid("trigger config is invalid");
  }

  for (const node of graph.nodes) {
    const descriptor = getNodeDescriptor(node.node_type);
    const configResult = descriptor?.flowConfigSchema.safeParse(node.config);
    if (!descriptor || !configResult?.success) {
      invalid(`config for node "${node.node_key}" is invalid`);
    }
    const issues = descriptor.validate(node, {
      consumer: "flow",
      knownNodeKeys: keys,
    });
    if (issues.some((issue) => (issue.severity ?? "error") === "error")) {
      invalid(`config for node "${node.node_key}" is invalid`);
    }
    const effectiveOnError =
      node.config.on_error ?? graph.fallback_policy.execution?.on_error;
    if (
      effectiveOnError === "default_value" &&
      !getDeterministicSuccessEdgeTarget(node.node_type, node.config)
    ) {
      invalid(
        `default value for node "${node.node_key}" requires exactly one deterministic success edge`,
      );
    }
    for (const edge of descriptor.outgoingEdgeTargets(node.config)) {
      if (!keys.has(edge.target)) {
        invalid(
          `node "${node.node_key}" points to missing node "${edge.target}"`,
        );
      }
    }
  }

  return graph as FlowVersionGraph;
}

export function buildFlowVersionGraph(
  flow: DraftEnvelope,
  nodes: readonly DraftNode[],
): FlowVersionGraph {
  if (!flow.entry_node_id) {
    invalid("entry node is required");
  }
  const rawFallback = flow.fallback_policy as FlowFallbackPolicy & {
    execution?: unknown;
  };
  if (
    rawFallback.execution !== undefined &&
    !commonExecutionPolicySchema.safeParse(rawFallback.execution).success
  ) {
    invalid("global node execution policy is invalid");
  }
  return parseFlowVersionGraph({
    schema_version: 1,
    trigger: {
      type: flow.trigger_type,
      config: flow.trigger_config,
    },
    entry_node_key: flow.entry_node_id,
    fallback_policy: resolveFallbackPolicy(flow.fallback_policy),
    nodes: nodes.map((node) => ({
      node_key: node.node_key,
      node_type: node.node_type,
      config: node.config,
      position_x: node.position_x ?? 0,
      position_y: node.position_y ?? 0,
    })),
  });
}

export function versionGraphNodes(
  graph: FlowVersionGraph,
  flowId: string,
): FlowNodeRow[] {
  return graph.nodes.map((node) => ({
    id: `${flowId}:${node.node_key}`,
    flow_id: flowId,
    ...node,
    created_at: "",
  }));
}

export function matchesFlowVersionTrigger(
  graph: FlowVersionGraph,
  message: { kind: "text"; text: string } | { kind: "interactive_reply" },
  isFirstInbound: boolean,
): boolean {
  if (message.kind !== "text") return false;
  if (graph.trigger.type === "manual") return false;
  if (graph.trigger.type === "first_inbound_message") return isFirstInbound;

  const config = graph.trigger.config as unknown as KeywordTriggerConfig;
  if (!message.text || !config.keywords?.length) return false;
  const haystack = config.case_sensitive
    ? message.text
    : message.text.toLowerCase();
  return config.keywords.some((raw) => {
    if (!raw) return false;
    const needle = config.case_sensitive ? raw : raw.toLowerCase();
    return config.match_type === "exact"
      ? haystack === needle
      : haystack.includes(needle);
  });
}
