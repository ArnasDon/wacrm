import {
  CONTROL_INPUT,
  defineNodeDescriptor,
  executionPolicyEdgeTargets,
} from "../registry/types";
import { approvalConfigSchema } from "../registry/schemas";

export const approvalNodeDescriptor = defineNodeDescriptor({
  id: "approval",
  label: "Approval",
  category: "flow",
  icon: "list-checks",
  inputs: CONTROL_INPUT,
  outputs: [
    {
      id: "approved",
      label: "Approved",
      type: "control",
      cardinality: "one",
      required: true,
    },
    {
      id: "rejected",
      label: "Rejected",
      type: "control",
      cardinality: "one",
      required: true,
    },
  ],
  configSchema: approvalConfigSchema,
  flowConfigSchema: approvalConfigSchema,
  supportsFlowRuntime: true,
  supportsExecutionPolicy: true,
  supportsDefaultValue: true,
  validate: () => [],
  runtimeKind: "suspend",
  runtimeHook: "approval",
  form: { kind: "specialized", component: "approval" },
  builder: {
    visible: true,
    defaultConfig: {
      title: "Approval required",
      message: "Review this request before the flow continues.",
      assignee_user_id: "",
      timeout_hours: 24,
      approved_next: "",
      rejected_next: "",
    },
  },
  ui: {
    color: "text-amber-400",
    blurb: "Pauses until a teammate approves or rejects",
    hue: { l: 0.72, c: 0.14, h: 78 },
  },
  outgoingEdges: (config) => [
    ...[config.approved_next, config.rejected_next].filter(
      (value): value is string => typeof value === "string" && !!value,
    ),
    ...executionPolicyEdgeTargets(config).map(({ target }) => target),
  ],
  outgoingEdgeTargets: (config) => [
    ...(["approved_next", "rejected_next"] as const).flatMap((field) =>
      typeof config[field] === "string" && config[field]
        ? [{ target: config[field], field }]
        : [],
    ),
    ...executionPolicyEdgeTargets(config),
  ],
});
