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
import { pinnedSubFlowConfigSchema } from "./registry/schemas";
import type { FlowVariableDeclaration } from "./runtime-primitives";
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
  "time",
  "webhook",
]);

const storedNodeSchema = z.strictObject({
  node_key: z.string().trim().min(1),
  node_type: z.string().trim().min(1),
  config: z.record(z.string(), z.unknown()),
  position_x: z.number().finite(),
  position_y: z.number().finite(),
});

const variableKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/);

const objectValueSchema = z
  .record(z.string(), z.unknown())
  .or(z.array(z.unknown()));

const variableDeclarationSchema = z.discriminatedUnion("type", [
  z.strictObject({
    key: variableKeySchema,
    type: z.literal("string"),
    required: z.boolean().default(false),
    sensitive: z.boolean().optional(),
    default: z.string().optional(),
  }),
  z.strictObject({
    key: variableKeySchema,
    type: z.literal("number"),
    required: z.boolean().default(false),
    sensitive: z.boolean().optional(),
    default: z.number().finite().optional(),
  }),
  z.strictObject({
    key: variableKeySchema,
    type: z.literal("boolean"),
    required: z.boolean().default(false),
    sensitive: z.boolean().optional(),
    default: z.boolean().optional(),
  }),
  z.strictObject({
    key: variableKeySchema,
    type: z.literal("json"),
    required: z.boolean().default(false),
    sensitive: z.boolean().optional(),
    default: z.unknown().optional(),
  }),
  z.strictObject({
    key: variableKeySchema,
    type: z.literal("contact"),
    required: z.boolean().default(false),
    sensitive: z.boolean().optional(),
    default: objectValueSchema.optional(),
  }),
  z.strictObject({
    key: variableKeySchema,
    type: z.literal("message"),
    required: z.boolean().default(false),
    sensitive: z.boolean().optional(),
    default: objectValueSchema.optional(),
  }),
]);

const variableSchemaSchema = z
  .array(variableDeclarationSchema)
  .max(100)
  .superRefine((declarations, context) => {
    const keys = new Set<string>();
    declarations.forEach((declaration, index) => {
      if (keys.has(declaration.key)) {
        context.addIssue({
          code: "custom",
          message: `duplicate variable key "${declaration.key}"`,
          path: [index, "key"],
        });
      }
      keys.add(declaration.key);
    });
  });

const graphV1EnvelopeSchema = z.strictObject({
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
  variable_schema: variableSchemaSchema.optional().default([]),
  nodes: z.array(storedNodeSchema).min(1),
});

const graphV2EnvelopeSchema = z.strictObject({
  schema_version: z.literal(2),
  entry_node_key: z.string().trim().min(1),
  fallback_policy: z.strictObject({
    on_unknown_reply: z.enum(["reprompt", "handoff", "ignore"]),
    max_reprompts: z.number().int().nonnegative(),
    on_timeout_hours: z.number().positive(),
    on_exhaust: z.enum(["handoff", "end"]),
    execution: commonExecutionPolicySchema.optional(),
  }),
  variable_schema: variableSchemaSchema.optional().default([]),
  nodes: z.array(storedNodeSchema).min(2),
});

export interface FlowVersionGraphNode {
  node_key: string;
  node_type: RegisteredNodeType;
  config: Record<string, unknown>;
  position_x: number;
  position_y: number;
}

export interface FlowVersionGraph {
  schema_version: 2;
  entry_node_key: string;
  fallback_policy: FlowFallbackPolicy;
  variable_schema: FlowVariableDeclaration[];
  nodes: FlowVersionGraphNode[];
}

type DraftEnvelope = Pick<
  FlowRow,
  | "trigger_type"
  | "trigger_config"
  | "entry_node_id"
  | "fallback_policy"
  | "variable_schema"
>;

type DraftNode = Pick<
  FlowNodeRow,
  "node_key" | "node_type" | "config" | "position_x" | "position_y"
>;

function invalid(message: string): never {
  throw new Error(`Invalid flow version graph: ${message}`);
}

export function parseFlowVariableSchema(
  value: unknown,
): FlowVariableDeclaration[] {
  const parsed = variableSchemaSchema.safeParse(
    value === undefined ? [] : value,
  );
  if (!parsed.success) {
    throw new Error(
      `Invalid flow variable schema: ${parsed.error.issues[0]?.message ?? "invalid declaration"}`,
    );
  }
  return parsed.data;
}

export function parseFlowVersionGraph(value: unknown): FlowVersionGraph {
  const version =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as { schema_version?: unknown }).schema_version
      : undefined;
  const parsed =
    version === 1
      ? graphV1EnvelopeSchema.safeParse(value)
      : graphV2EnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    invalid(parsed.error.issues[0]?.message ?? "invalid snapshot envelope");
  }
  const graph =
    parsed.data.schema_version === 1
      ? normalizeV1Graph(parsed.data)
      : parsed.data;
  const keys = new Set<string>();
  const triggerNodes: typeof graph.nodes = [];

  for (const node of graph.nodes) {
    if (keys.has(node.node_key)) {
      invalid(`duplicate node key "${node.node_key}"`);
    }
    keys.add(node.node_key);
    const descriptor = getNodeDescriptor(node.node_type);
    if (descriptor?.runtimeKind === "trigger") {
      triggerNodes.push(node);
    } else if (!isFlowRuntimeNodeType(node.node_type)) {
      invalid(
        `node type "${node.node_type}" is not supported by the flow runtime`,
      );
    }
  }
  if (!keys.has(graph.entry_node_key)) {
    invalid(`entry node "${graph.entry_node_key}" does not exist`);
  }
  if (triggerNodes.length !== 1) {
    invalid("schema v2 requires exactly one entry trigger node");
  }
  const triggerNode = triggerNodes[0];
  if (graph.entry_node_key !== triggerNode.node_key) {
    invalid("entry node must be the trigger node");
  }
  const triggerDescriptor = getNodeDescriptor(triggerNode.node_type);
  if (
    !triggerDescriptor?.compatibilityFlowTriggerType ||
    !triggerDescriptor.configSchema.safeParse(triggerNode.config).success
  ) {
    invalid("entry trigger config is invalid");
  }
  const nextNodeKey = triggerNode.config.next_node_key;
  if (
    typeof nextNodeKey !== "string" ||
    !keys.has(nextNodeKey) ||
    nextNodeKey === triggerNode.node_key
  ) {
    invalid("entry trigger next_node_key must point to a runtime node");
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

  for (const node of graph.nodes) {
    const descriptor = getNodeDescriptor(node.node_type);
    const configResult =
      descriptor?.runtimeKind === "trigger"
        ? descriptor.configSchema.safeParse(node.config)
        : descriptor?.flowConfigSchema.safeParse(node.config);
    if (!descriptor || !configResult?.success) {
      invalid(`config for node "${node.node_key}" is invalid`);
    }
    if (
      node.node_type === "sub_flow" &&
      !pinnedSubFlowConfigSchema.safeParse(node.config).success
    ) {
      invalid(`sub-flow "${node.node_key}" is not pinned to a published version`);
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
      if (edge.target === triggerNode.node_key) {
        invalid(
          `entry trigger "${triggerNode.node_key}" cannot have an inbound edge`,
        );
      }
    }
  }

  return graph as FlowVersionGraph;
}

function normalizeV1Graph(
  graph: z.infer<typeof graphV1EnvelopeSchema>,
): z.infer<typeof graphV2EnvelopeSchema> {
  const descriptor = getCompatibilityFlowTriggerDescriptor(graph.trigger.type);
  if (!descriptor) invalid("trigger type is not supported");
  const triggerKey = uniqueTriggerKey(
    new Set(graph.nodes.map((node) => node.node_key)),
  );
  const entry = graph.nodes.find(
    (node) => node.node_key === graph.entry_node_key,
  );
  return {
    schema_version: 2,
    entry_node_key: triggerKey,
    fallback_policy: graph.fallback_policy,
    variable_schema: graph.variable_schema,
    nodes: [
      {
        node_key: triggerKey,
        node_type: descriptor.id,
        config: {
          ...graph.trigger.config,
          next_node_key: graph.entry_node_key,
        },
        position_x: (entry?.position_x ?? 0) - 320,
        position_y: entry?.position_y ?? 0,
      },
      ...graph.nodes.map((node) => ({
        ...node,
        config: { ...node.config },
      })),
    ],
  };
}

function uniqueTriggerKey(keys: ReadonlySet<string>): string {
  if (!keys.has("trigger")) return "trigger";
  let suffix = 2;
  while (keys.has(`trigger_${suffix}`)) suffix += 1;
  return `trigger_${suffix}`;
}

export function getFlowEntryTrigger(graph: FlowVersionGraph): {
  node_key: string;
  type: FlowRow["trigger_type"];
  config: Record<string, unknown>;
  next_node_key: string;
} {
  const node = graph.nodes.find(
    (candidate) => candidate.node_key === graph.entry_node_key,
  );
  const descriptor = node ? getNodeDescriptor(node.node_type) : undefined;
  if (
    !node ||
    !descriptor?.compatibilityFlowTriggerType ||
    typeof node.config.next_node_key !== "string"
  ) {
    invalid("entry trigger is unavailable");
  }
  return {
    node_key: node.node_key,
    type: descriptor.compatibilityFlowTriggerType,
    config: node.config,
    next_node_key: node.config.next_node_key,
  };
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
  let variableSchema: FlowVariableDeclaration[];
  try {
    variableSchema = parseFlowVariableSchema(flow.variable_schema);
  } catch {
    invalid("variable schema is invalid");
  }
  return parseFlowVersionGraph({
    schema_version: 2,
    entry_node_key: "trigger",
    fallback_policy: resolveFallbackPolicy(flow.fallback_policy),
    variable_schema: variableSchema,
    nodes: [
      {
        node_key: "trigger",
        node_type:
          getCompatibilityFlowTriggerDescriptor(flow.trigger_type)?.id ??
          "trigger_manual",
        config: {
          ...flow.trigger_config,
          next_node_key: flow.entry_node_id,
        },
        position_x:
          (nodes.find((node) => node.node_key === flow.entry_node_id)
            ?.position_x ?? 0) - 320,
        position_y:
          nodes.find((node) => node.node_key === flow.entry_node_id)
            ?.position_y ?? 0,
      },
      ...nodes.map((node) => ({
        node_key: node.node_key,
        node_type: node.node_type,
        config: node.config,
        position_x: node.position_x ?? 0,
        position_y: node.position_y ?? 0,
      })),
    ],
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
  const trigger = getFlowEntryTrigger(graph);
  if (trigger.type === "manual" || trigger.type === "time" || trigger.type === "webhook") return false;
  if (trigger.type === "first_inbound_message") return isFirstInbound;

  const config = trigger.config as unknown as KeywordTriggerConfig;
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
