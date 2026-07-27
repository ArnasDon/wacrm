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
      max?: number;
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
        | "http_request"
        | "each"
        | "loop"
        | "sub_flow"
        | "ai_reply"
        | "approval";
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

export type PortableResourceKind =
  | "tag"
  | "member"
  | "pipeline"
  | "stage"
  | "custom_field"
  | "subflow"
  | "asset";

export interface NodePortabilityDescriptor {
  /** Top-level config keys which may cross an instance boundary. */
  portableFields: readonly string[];
  resourceRefs?: readonly {
    field: string;
    kind: PortableResourceKind;
    /** Stage resolution is constrained by its portable pipeline ref. */
    parentField?: string;
  }[];
  /** Map values are replaced by in-memory `$secret` requirements. */
  secretMaps?: readonly string[];
  /** Runtime pins or values recomputed by the destination compiler. */
  derivedFields?: readonly string[];
  /** Recursive allowlist; `json` is explicit arbitrary user data, never config. */
  configShape: PortableObjectShape;
}

export type PortableValueShape =
  | true
  | "json"
  | "string_map"
  | PortableObjectShape
  | readonly [PortableValueShape];

export interface PortableObjectShape {
  readonly [field: string]: PortableValueShape;
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
  compatibilityFlowTriggerType?:
    | "keyword"
    | "first_inbound_message"
    | "manual"
    | "time"
    | "webhook";
  validate: (
    node: NodeLike,
    ctx: NodeValidationContext,
  ) => readonly NodeValidationIssue[];
  runtimeKind: NodeRuntimeKind;
  runtimeHook: string;
  form: NodeFormDescriptor;
  builder: NodeBuilderDescriptor;
  portability: NodePortabilityDescriptor;
  ui: NodeUiDescriptor;
  outgoingEdges: (config: Record<string, unknown>) => readonly string[];
  outgoingEdgeTargets: (
    config: Record<string, unknown>,
  ) => readonly OutgoingEdgeTarget[];
  resolveOutput?: (
    config: Record<string, unknown>,
    portId: string,
    vars: Readonly<Record<string, unknown>>,
  ) => unknown;
  resolveDebugInput?: (
    config: Record<string, unknown>,
    portId: string,
    vars: Readonly<Record<string, unknown>>,
  ) => unknown;
}

export function defineNodeDescriptor<const Id extends string>(
  descriptor: Omit<NodeDescriptor<Id>, "portability"> & {
    portability?: NodePortabilityDescriptor;
  },
): NodeDescriptor<Id> {
  return {
    ...descriptor,
    portability: descriptor.portability ?? portabilityForNode(descriptor.id),
  };
}

const POLICY_FIELDS = [
  "retry",
  "on_error",
  "error_next_node_key",
  "timeout_ms",
  "default_value",
] as const;

function portable(
  fields: readonly string[],
  options: Omit<
    NodePortabilityDescriptor,
    "portableFields" | "configShape"
  > & { configShape?: PortableObjectShape } = {},
): NodePortabilityDescriptor {
  const { configShape = {}, ...rest } = options;
  const policyShape: PortableObjectShape = {
    retry: {
      max_attempts: true,
      interval_ms: true,
      backoff: true,
    },
    on_error: true,
    error_next_node_key: true,
    timeout_ms: true,
    default_value: {
      key: true,
      type: true,
      value: "json",
    },
  };
  return {
    portableFields: [...new Set([...fields, ...POLICY_FIELDS])],
    configShape: {
      ...Object.fromEntries(fields.map((field) => [field, true])),
      ...policyShape,
      ...configShape,
    },
    ...rest,
  };
}

/**
 * Pure, explicit portability allowlist. It intentionally lives beside the
 * descriptor contract rather than inferring keys from the permissive runtime
 * Zod schemas: adding a runtime field never makes it exportable by accident.
 */
export function portabilityForNode(id: string): NodePortabilityDescriptor {
  switch (id) {
    case "start":
    case "close_conversation":
    case "trigger_conversation_assigned":
    case "trigger_first_inbound_message":
    case "trigger_manual":
    case "trigger_new_contact_created":
    case "trigger_new_message_received":
      return portable(["next_node_key"]);
    case "send_message":
      return portable(["text", "next_node_key"]);
    case "send_buttons":
      return portable(["text", "header_text", "footer_text", "buttons"], {
        configShape: {
          buttons: [
            { reply_id: true, title: true, next_node_key: true },
          ],
        },
      });
    case "send_list":
      return portable([
        "text",
        "button_label",
        "header_text",
        "footer_text",
        "sections",
      ], {
        configShape: {
          sections: [
            {
              title: true,
              rows: [
                {
                  reply_id: true,
                  title: true,
                  description: true,
                  next_node_key: true,
                },
              ],
            },
          ],
        },
      });
    case "send_media":
      return portable(
        ["media_type", "media_url", "caption", "filename", "next_node_key"],
        { resourceRefs: [{ field: "media_url", kind: "asset" }] },
      );
    case "collect_input":
      return portable([
        "prompt_text",
        "var_key",
        "validation",
        "regex",
        "next_node_key",
      ]);
    case "condition":
      return portable([
        "subject",
        "subject_key",
        "operand",
        "operator",
        "value",
        "true_next",
        "false_next",
      ], {
        resourceRefs: [{ field: "subject_key", kind: "tag" }],
      });
    case "set_tag":
      return portable(["mode", "tag_id", "next_node_key"], {
        resourceRefs: [{ field: "tag_id", kind: "tag" }],
      });
    case "add_tag":
    case "remove_tag":
    case "trigger_tag_added":
      return portable(["tag_id", "next_node_key"], {
        resourceRefs: [{ field: "tag_id", kind: "tag" }],
      });
    case "handoff":
      return portable(["note", "assign_to"], {
        resourceRefs: [{ field: "assign_to", kind: "member" }],
      });
    case "end":
      return portable([]);
    case "send_template":
      return portable([
        "template_name",
        "language",
        "variables",
        "next_node_key",
      ], { configShape: { variables: "string_map" } });
    case "assign_conversation":
      return portable(["mode", "agent_id", "next_node_key"], {
        resourceRefs: [{ field: "agent_id", kind: "member" }],
      });
    case "update_contact_field":
      return portable(["field", "value", "next_node_key"], {
        configShape: { value: "json" },
        resourceRefs: [{ field: "field", kind: "custom_field" }],
      });
    case "create_deal":
    case "move_deal_stage":
      return portable(
        ["pipeline_id", "stage_id", "title", "value", "next_node_key"],
        {
          resourceRefs: [
            { field: "pipeline_id", kind: "pipeline" },
            { field: "stage_id", kind: "stage", parentField: "pipeline_id" },
          ],
        },
      );
    case "wait":
      return portable(["amount", "unit", "next_node_key"]);
    case "approval":
      return portable([
        "title",
        "message",
        "assignee_user_id",
        "timeout_hours",
        "approved_next",
        "rejected_next",
      ], {
        configShape: {
          retry: {
            max_attempts: true,
            interval_ms: true,
            backoff: true,
          },
          default_value: { key: true, type: true, value: "json" },
        },
        resourceRefs: [{ field: "assignee_user_id", kind: "member" }],
      });
    case "variable_set":
      return portable(["assignments", "next_node_key"], {
        configShape: {
          assignments: [{ key: true, type: true, value: "json" }],
        },
      });
    case "switch":
      return portable(["subject", "subject_key", "cases", "default_next"], {
        configShape: {
          cases: [
            {
              id: true,
              label: true,
              operator: true,
              value: "json",
              next: true,
            },
          ],
        },
      });
    case "http_request":
      return portable(
        [
          "method",
          "url",
          "headers",
          "query",
          "body",
          "response_var",
          "next_node_key",
        ],
        {
          secretMaps: ["headers", "query"],
          configShape: {
            headers: "string_map",
            query: "string_map",
          },
        },
      );
    case "each":
      return portable([
        "array_variable",
        "item_variable",
        "index_variable",
        "max_iterations",
        "body_next",
        "done_next",
      ]);
    case "loop":
      return portable([
        "subject",
        "subject_key",
        "operator",
        "value",
        "max_iterations",
        "body_next",
        "done_next",
      ], { configShape: { value: "json" } });
    case "sub_flow":
      return portable(
        [
          "flow_id",
          "input_mapping",
          "output_mapping",
          "max_depth",
          "next_node_key",
        ],
        {
          configShape: {
            input_mapping: [{ parent_key: true, child_key: true }],
            output_mapping: [{ parent_key: true, child_key: true }],
          },
          resourceRefs: [{ field: "flow_id", kind: "subflow" }],
          derivedFields: ["flow_version_id", "child_entry_node_key"],
        },
      );
    case "ai_reply":
      return portable([
        "system_prompt",
        "prompt",
        "input_variables",
        "output_variable",
        "max_tokens",
        "next_node_key",
      ], { configShape: { input_variables: [true] } });
    case "send_webhook":
      return portable(
        ["url", "headers", "body_template", "next_node_key"],
        {
          secretMaps: ["headers"],
          configShape: { headers: "string_map" },
        },
      );
    case "trigger_keyword_match":
      return portable([
        "keywords",
        "match_type",
        "case_sensitive",
        "next_node_key",
      ]);
    case "trigger_time_based":
      return portable(["schedule", "timezone", "next_node_key"]);
    case "trigger_interactive_reply":
      return portable(["reply_ids", "next_node_key"]);
    case "trigger_deal_stage_changed":
      return portable(["pipeline_id", "next_node_key"], {
        resourceRefs: [{ field: "pipeline_id", kind: "pipeline" }],
      });
    default:
      // An empty allowlist is fail-closed for an unrecognized descriptor.
      return portable([]);
  }
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
