import type { CanonicalFlowGraph, CanonicalFlowGraphNode } from "./graph";
import { getNodeDescriptor, type RegisteredNodeType } from "./registry";

interface CompatibilityFlow {
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: Record<string, unknown>;
  entry_node_id: string | null;
}

interface CompatibilityFlowNode {
  node_key: string;
  node_type: RegisteredNodeType;
  config: Record<string, unknown>;
}

const TRIGGER_NODE_TYPES = {
  keyword: "trigger_keyword_match",
  first_inbound_message: "trigger_first_inbound_message",
  manual: "trigger_manual",
} as const satisfies Record<
  CompatibilityFlow["trigger_type"],
  RegisteredNodeType
>;

/**
 * Read adapter for the compatibility flow schema. No persistence changes are
 * required: the flow-level trigger columns are materialized as an entry node
 * whenever canonical graph consumers load an existing flow.
 */
export function flowToCanonicalGraph(
  flow: CompatibilityFlow,
  nodes: readonly CompatibilityFlowNode[],
): CanonicalFlowGraph {
  const triggerType = TRIGGER_NODE_TYPES[flow.trigger_type];
  const firstNode = flow.entry_node_id ?? "end";
  const trigger: CanonicalFlowGraphNode = {
    node_key: triggerType,
    node_type: triggerType,
    config: { ...flow.trigger_config, next_node_key: firstNode },
    source: "flow",
    runtime_hook: triggerType,
  };

  const canonicalNodes = nodes.map<CanonicalFlowGraphNode>((node) => ({
    ...node,
    source: "flow",
    runtime_hook:
      getNodeDescriptor(node.node_type)?.runtimeHook ?? "unknown_node",
  }));
  if (!flow.entry_node_id && !canonicalNodes.some(({ node_key }) => node_key === "end")) {
    canonicalNodes.push({
      node_key: "end",
      node_type: "end",
      config: {},
      source: "flow",
      runtime_hook: "end",
    });
  }

  return {
    entry_node_key: trigger.node_key,
    nodes: [trigger, ...canonicalNodes],
  };
}
