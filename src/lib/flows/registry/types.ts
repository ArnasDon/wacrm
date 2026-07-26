import type { ZodType } from "zod";

export type NodeCategory = "trigger" | "messaging" | "logic" | "data" | "flow";
export type NodeRuntimeKind =
  "trigger" | "auto" | "suspend" | "terminal" | "legacy";

export type NodeRetryBackoff = "fixed" | "exponential";
export type NodeOnError = "fail_run" | "default_value" | "fail_branch";
export type NodeDefaultValueType =
  "string" | "number" | "boolean" | "object" | "array" | "null";

export interface NodeDefaultValue {
  key: string;
  type: NodeDefaultValueType;
  value: unknown;
}

export interface PartialNodeExecutionPolicy {
  retry?: {
    max_attempts: number;
    interval_ms: number;
    backoff: NodeRetryBackoff;
  };
  on_error?: NodeOnError;
  error_next_node_key?: string;
  timeout_ms?: number;
  default_value?: NodeDefaultValue;
}

export interface NodeExecutionPolicy {
  retry: {
    max_attempts: number;
    interval_ms: number;
    backoff: NodeRetryBackoff;
  };
  on_error: NodeOnError;
  error_next_node_key?: string;
  timeout_ms: number;
  default_value?: NodeDefaultValue;
}

export type NodeIconId =
  | "alarm-clock"
  | "archive-x"
  | "badge-plus"
  | "circle-user-round"
  | "clock"
  | "contact-round"
  | "flag"
  | "git-fork"
  | "inbox"
  | "list-checks"
  | "list-plus"
  | "message-circle"
  | "message-square-code"
  | "paperclip"
  | "play-circle"
  | "radio"
  | "send"
  | "tag"
  | "tags"
  | "user-plus"
  | "webhook"
  | "workflow";

export type NodePortType =
  | "control"
  | "string"
  | "number"
  | "boolean"
  | "json"
  | "contact"
  | "message"
  | "any";

export interface NodePortDescriptor {
  id: string;
  label: string;
  type: NodePortType;
  cardinality: "one" | "many";
  required?: boolean;
  /**
   * Marks config-driven handles such as `button:<reply_id>`. The port
   * contract remains registry-owned while each rendered handle keeps a
   * stable instance id.
   */
  handlePrefix?: string;
}

export interface NodeValidationIssue {
  severity?: "error" | "warning";
  field?: string;
  message: string;
}

export interface NodeValidationContext {
  knownNodeKeys: ReadonlySet<string>;
  consumer: NodeValidationConsumer;
}

export type NodeValidationConsumer = "flow" | "automation";

export interface NodeLike {
  node_key: string;
  node_type: string;
  config: Record<string, unknown>;
}

export type NodeFormField =
  | {
      kind: "text";
      key: string;
      label: string;
      placeholder?: string;
    }
  | {
      kind: "textarea";
      key: string;
      label: string;
      placeholder?: string;
      rows?: number;
    }
  | {
      kind: "number";
      key: string;
      label: string;
      min?: number;
    }
  | {
      kind: "select";
      key: string;
      label: string;
      options: readonly { value: string; label: string }[];
    }
  | {
      kind: "next-node";
      key: string;
      label: string;
    };

export type NodeFormDescriptor =
  | { kind: "fields"; fields: readonly NodeFormField[]; help?: string }
  | {
      kind: "specialized";
      component:
        | "send_buttons"
        | "send_list"
        | "send_media"
        | "condition"
        | "set_tag"
        | "switch"
        | "variable_set"
        | "http_request";
    };

export interface NodeUiDescriptor {
  color: string;
  blurb: string;
  hue: { l: number; c: number; h: number };
}

export interface NodeBuilderDescriptor {
  visible: boolean;
  defaultConfig: Readonly<Record<string, unknown>>;
}

export interface OutgoingEdgeTarget {
  target: string;
  field: string;
}

/**
 * The portable node contract. It deliberately contains no React components,
 * database clients, environment access, or server-only imports, so the same
 * registry can safely drive validation, runtime lookup, and client metadata.
 */
export interface NodeDescriptor<Id extends string = string> {
  id: Id;
  label: string;
  category: NodeCategory;
  icon: NodeIconId;
  inputs: readonly NodePortDescriptor[];
  outputs: readonly NodePortDescriptor[];
  configSchema: ZodType<Record<string, unknown>>;
  flowConfigSchema: ZodType<Record<string, unknown>>;
  supportsFlowRuntime: boolean;
  supportsExecutionPolicy: boolean;
  supportsDefaultValue: boolean;
  compatibilityFlowTriggerType?: "keyword" | "first_inbound_message" | "manual";
  validate: (
    node: NodeLike,
    ctx: NodeValidationContext,
  ) => readonly NodeValidationIssue[];
  runtimeKind: NodeRuntimeKind;
  runtimeHook: string;
  form: NodeFormDescriptor;
  builder: NodeBuilderDescriptor;
  ui: NodeUiDescriptor;
  outgoingEdges: (config: Record<string, unknown>) => readonly string[];
  outgoingEdgeTargets: (
    config: Record<string, unknown>,
  ) => readonly OutgoingEdgeTarget[];
}

export function defineNodeDescriptor<const Id extends string>(
  descriptor: NodeDescriptor<Id>,
): NodeDescriptor<Id> {
  return descriptor;
}

export const CONTROL_INPUT: readonly NodePortDescriptor[] = [
  {
    id: "in",
    label: "In",
    type: "control",
    cardinality: "many",
  },
];

export const CONTROL_OUTPUT: readonly NodePortDescriptor[] = [
  {
    id: "next",
    label: "Next",
    type: "control",
    cardinality: "one",
    required: true,
  },
];

export const NO_PORTS: readonly NodePortDescriptor[] = [];
export const noValidation = (): readonly NodeValidationIssue[] => [];

export function nextNodeEdges(config: Record<string, unknown>): string[] {
  return typeof config.next_node_key === "string" && config.next_node_key
    ? [config.next_node_key]
    : [];
}

export function nextNodeEdgeTargets(
  config: Record<string, unknown>,
): OutgoingEdgeTarget[] {
  return nextNodeEdges(config).map((target) => ({
    target,
    field: "next_node_key",
  }));
}

export function terminalEdges(): readonly string[] {
  return [];
}

export function terminalEdgeTargets(): readonly OutgoingEdgeTarget[] {
  return [];
}

export function executionPolicyEdgeTargets(
  config: Record<string, unknown>,
): OutgoingEdgeTarget[] {
  return config.on_error === "fail_branch" &&
    typeof config.error_next_node_key === "string" &&
    config.error_next_node_key
    ? [{ target: config.error_next_node_key, field: "error_next_node_key" }]
    : [];
}
