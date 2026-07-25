import type { RegisteredNodeType } from "./registry";

export interface CanonicalFlowGraphNode {
  node_key: string;
  node_type: RegisteredNodeType;
  config: Record<string, unknown>;
  source: "flow" | "automation";
  runtime_hook: string;
  source_index?: number;
}

export interface CanonicalFlowGraph {
  entry_node_key: string;
  nodes: CanonicalFlowGraphNode[];
}
