import type {
  AutomationStepConfig,
  AutomationStepType,
  AutomationTriggerConfig,
  AutomationTriggerType,
} from "@/types";
import type { RegisteredNodeType } from "@/lib/flows/registry";
import type {
  CanonicalFlowGraph,
  CanonicalFlowGraphNode,
} from "@/lib/flows/graph";

export interface LegacyAutomationGraphStep {
  step_type: AutomationStepType;
  step_config: AutomationStepConfig;
  branch?: "yes" | "no" | null;
  parent_index?: number | null;
}

export interface AutomationGraphInput {
  trigger_type: AutomationTriggerType;
  trigger_config: AutomationTriggerConfig;
  steps: readonly LegacyAutomationGraphStep[];
}

const STEP_NODE_TYPES = {
  send_message: "send_message",
  send_buttons: "send_buttons",
  send_list: "send_list",
  send_template: "send_template",
  add_tag: "add_tag",
  remove_tag: "remove_tag",
  assign_conversation: "assign_conversation",
  update_contact_field: "update_contact_field",
  create_deal: "create_deal",
  move_deal_stage: "move_deal_stage",
  wait: "wait",
  condition: "condition",
  send_webhook: "send_webhook",
  close_conversation: "close_conversation",
} as const satisfies Record<AutomationStepType, RegisteredNodeType>;

const TRIGGER_NODE_TYPES = {
  new_message_received: "trigger_new_message_received",
  first_inbound_message: "trigger_first_inbound_message",
  keyword_match: "trigger_keyword_match",
  new_contact_created: "trigger_new_contact_created",
  conversation_assigned: "trigger_conversation_assigned",
  tag_added: "trigger_tag_added",
  time_based: "trigger_time_based",
  interactive_reply: "trigger_interactive_reply",
  deal_stage_changed: "trigger_deal_stage_changed",
} as const satisfies Record<AutomationTriggerType, RegisteredNodeType>;

export function automationStepNodeType(
  stepType: string,
): RegisteredNodeType | undefined {
  return STEP_NODE_TYPES[stepType as AutomationStepType];
}

export function automationTriggerNodeType(
  triggerType: string,
): RegisteredNodeType | undefined {
  return TRIGGER_NODE_TYPES[triggerType as AutomationTriggerType];
}

function stepKey(index: number, type: AutomationStepType): string {
  return `step_${index}_${type}`;
}

/**
 * Compatibility seam from the legacy automation tree to the canonical graph.
 * Keys depend only on stable input order/type, and branch leaves rejoin the
 * containing sequence's continuation.
 */
export function automationToFlowGraph(
  input: AutomationGraphInput,
): CanonicalFlowGraph {
  const nodesByIndex = new Map<number, CanonicalFlowGraphNode>();
  const children = new Map<
    number,
    { yes: number[]; no: number[] }
  >();
  const roots: number[] = [];

  input.steps.forEach((step, index) => {
    const parent = step.parent_index;
    const hasValidParent =
      typeof parent === "number" &&
      Number.isInteger(parent) &&
      parent >= 0 &&
      parent < index &&
      input.steps[parent]?.step_type === "condition";

    if (!hasValidParent) {
      roots.push(index);
      return;
    }
    const branches = children.get(parent) ?? { yes: [], no: [] };
    branches[step.branch === "no" ? "no" : "yes"].push(index);
    children.set(parent, branches);
  });

  const compileSequence = (
    indices: readonly number[],
    continuation: string,
  ): string => {
    let next = continuation;
    for (let cursor = indices.length - 1; cursor >= 0; cursor -= 1) {
      const index = indices[cursor]!;
      const step = input.steps[index]!;
      const nodeKey = stepKey(index, step.step_type);
      const config = { ...(step.step_config as Record<string, unknown>) };

      if (step.step_type === "condition") {
        const branchChildren = children.get(index) ?? { yes: [], no: [] };
        config.true_next = compileSequence(branchChildren.yes, next);
        config.false_next = compileSequence(branchChildren.no, next);
      } else {
        config.next_node_key = next;
      }

      nodesByIndex.set(index, {
        node_key: nodeKey,
        node_type: STEP_NODE_TYPES[step.step_type],
        config,
        source: "automation",
        runtime_hook: "legacy_automation_step",
        source_index: index,
      });
      next = nodeKey;
    }
    return next;
  };

  const firstStepKey = compileSequence(roots, "end");
  const triggerNodeType = TRIGGER_NODE_TYPES[input.trigger_type];
  const triggerNode: CanonicalFlowGraphNode = {
    node_key: triggerNodeType,
    node_type: triggerNodeType,
    config: {
      ...(input.trigger_config as Record<string, unknown>),
      next_node_key: firstStepKey,
    },
    source: "automation",
    runtime_hook: "legacy_automation_trigger",
  };

  return {
    entry_node_key: triggerNode.node_key,
    nodes: [
      triggerNode,
      ...input.steps.flatMap((_, index) => {
        const node = nodesByIndex.get(index);
        return node ? [node] : [];
      }),
      {
        node_key: "end",
        node_type: "end",
        config: {},
        source: "automation",
        runtime_hook: "end",
      },
    ],
  };
}

export type { CanonicalFlowGraph, CanonicalFlowGraphNode };
