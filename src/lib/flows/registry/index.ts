import { addTagNodeDescriptor } from "../nodes/add-tag";
import { assignConversationNodeDescriptor } from "../nodes/assign-conversation";
import { closeConversationNodeDescriptor } from "../nodes/close-conversation";
import { collectInputNodeDescriptor } from "../nodes/collect-input";
import { conditionNodeDescriptor } from "../nodes/condition";
import { createDealNodeDescriptor } from "../nodes/create-deal";
import { endNodeDescriptor } from "../nodes/end";
import { handoffNodeDescriptor } from "../nodes/handoff";
import { httpRequestNodeDescriptor } from "../nodes/http-request";
import { moveDealStageNodeDescriptor } from "../nodes/move-deal-stage";
import { removeTagNodeDescriptor } from "../nodes/remove-tag";
import { sendButtonsNodeDescriptor } from "../nodes/send-buttons";
import { sendListNodeDescriptor } from "../nodes/send-list";
import { sendMediaNodeDescriptor } from "../nodes/send-media";
import { sendMessageNodeDescriptor } from "../nodes/send-message";
import { sendTemplateNodeDescriptor } from "../nodes/send-template";
import { sendWebhookNodeDescriptor } from "../nodes/send-webhook";
import { setTagNodeDescriptor } from "../nodes/set-tag";
import { startNodeDescriptor } from "../nodes/start";
import { updateContactFieldNodeDescriptor } from "../nodes/update-contact-field";
import { variableSetNodeDescriptor } from "../nodes/variable-set";
import { waitNodeDescriptor } from "../nodes/wait";
import { switchNodeDescriptor } from "../nodes/switch";
import { conversationAssignedTriggerDescriptor } from "../triggers/conversation-assigned";
import { dealStageChangedTriggerDescriptor } from "../triggers/deal-stage-changed";
import { firstInboundMessageTriggerDescriptor } from "../triggers/first-inbound-message";
import { interactiveReplyTriggerDescriptor } from "../triggers/interactive-reply";
import { keywordMatchTriggerDescriptor } from "../triggers/keyword-match";
import { manualTriggerDescriptor } from "../triggers/manual";
import { newContactCreatedTriggerDescriptor } from "../triggers/new-contact-created";
import { newMessageReceivedTriggerDescriptor } from "../triggers/new-message-received";
import { tagAddedTriggerDescriptor } from "../triggers/tag-added";
import { timeBasedTriggerDescriptor } from "../triggers/time-based";
import type { NodeDescriptor } from "./types";

/**
 * Generated-style manifest: descriptor modules are the implementation units;
 * this is the only discoverability list. A build-time generator can replace
 * this manifest later without changing any consumer.
 */
export const FLOW_NODE_DESCRIPTORS = [
  startNodeDescriptor,
  sendMessageNodeDescriptor,
  sendButtonsNodeDescriptor,
  sendListNodeDescriptor,
  sendMediaNodeDescriptor,
  collectInputNodeDescriptor,
  conditionNodeDescriptor,
  setTagNodeDescriptor,
  handoffNodeDescriptor,
  endNodeDescriptor,
  sendTemplateNodeDescriptor,
  addTagNodeDescriptor,
  removeTagNodeDescriptor,
  assignConversationNodeDescriptor,
  updateContactFieldNodeDescriptor,
  createDealNodeDescriptor,
  moveDealStageNodeDescriptor,
  waitNodeDescriptor,
  httpRequestNodeDescriptor,
  switchNodeDescriptor,
  variableSetNodeDescriptor,
  sendWebhookNodeDescriptor,
  closeConversationNodeDescriptor,
  newMessageReceivedTriggerDescriptor,
  firstInboundMessageTriggerDescriptor,
  keywordMatchTriggerDescriptor,
  newContactCreatedTriggerDescriptor,
  conversationAssignedTriggerDescriptor,
  tagAddedTriggerDescriptor,
  timeBasedTriggerDescriptor,
  interactiveReplyTriggerDescriptor,
  dealStageChangedTriggerDescriptor,
  manualTriggerDescriptor,
] as const;

export type RegisteredNodeType = (typeof FLOW_NODE_DESCRIPTORS)[number]["id"];

const descriptorById = new Map<string, NodeDescriptor>(
  FLOW_NODE_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]),
);

const descriptorAliases = new Map<string, NodeDescriptor>([
  ["http_fetch", httpRequestNodeDescriptor],
]);

const compatibilityFlowTriggerByType = new Map(
  FLOW_NODE_DESCRIPTORS.flatMap((descriptor) =>
    descriptor.compatibilityFlowTriggerType
      ? [[descriptor.compatibilityFlowTriggerType, descriptor] as const]
      : [],
  ),
);

if (descriptorById.size !== FLOW_NODE_DESCRIPTORS.length) {
  throw new Error("Flow node registry contains duplicate descriptor ids.");
}

export function getNodeDescriptor(
  nodeType: string,
): NodeDescriptor | undefined {
  return descriptorById.get(nodeType) ?? descriptorAliases.get(nodeType);
}

export function isRegisteredNodeType(nodeType: string): boolean {
  return getNodeDescriptor(nodeType) !== undefined;
}

export function canonicalNodeType(
  nodeType: string,
): RegisteredNodeType | undefined {
  return getNodeDescriptor(nodeType)?.id as RegisteredNodeType | undefined;
}

export function isFlowRuntimeNodeType(nodeType: string): boolean {
  return getNodeDescriptor(nodeType)?.supportsFlowRuntime === true;
}

export function getCompatibilityFlowTriggerDescriptor(
  triggerType: "keyword" | "first_inbound_message" | "manual",
): NodeDescriptor | undefined {
  return compatibilityFlowTriggerByType.get(triggerType);
}

export function listBuilderNodeDescriptors(): NodeDescriptor[] {
  return FLOW_NODE_DESCRIPTORS.filter(
    (descriptor) => descriptor.builder.visible,
  );
}

export function getDeterministicSuccessEdgeTarget(
  nodeType: string,
  config: Record<string, unknown>,
): string | undefined {
  const descriptor = getNodeDescriptor(nodeType);
  if (!descriptor?.supportsDefaultValue) return undefined;
  const successEdges = descriptor
    .outgoingEdgeTargets(config)
    .filter(({ field }) => field !== "error_next_node_key");
  return successEdges.length === 1 ? successEdges[0].target : undefined;
}

export type {
  NodeBuilderDescriptor,
  NodeCategory,
  NodeDescriptor,
  NodeFormDescriptor,
  NodeFormField,
  NodeIconId,
  NodeExecutionPolicy,
  NodeDefaultValue,
  NodeDefaultValueType,
  NodeOnError,
  NodeRetryBackoff,
  PartialNodeExecutionPolicy,
  NodeLike,
  NodePortDescriptor,
  NodePortType,
  NodeRuntimeKind,
  NodeUiDescriptor,
  NodeValidationContext,
  NodeValidationConsumer,
  NodeValidationIssue,
  OutgoingEdgeTarget,
} from "./types";
