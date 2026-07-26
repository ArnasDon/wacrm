import {
  CONTROL_INPUT,
  defineNodeDescriptor,
  executionPolicyEdgeTargets,
} from "../registry/types";
import {
  conditionConfigSchema,
  flowConditionConfigSchema,
  withCommonExecutionPolicy,
} from "../registry/schemas";

export const conditionNodeDescriptor = defineNodeDescriptor({
  id: "condition",
  label: "If / else",
  category: "logic",
  icon: "git-fork",
  inputs: CONTROL_INPUT,
  outputs: [
    {
      id: "true",
      label: "True",
      kind: "control",
      cardinality: "one",
      required: true,
    },
    {
      id: "false",
      label: "False",
      kind: "control",
      cardinality: "one",
      required: true,
    },
  ],
  configSchema: withCommonExecutionPolicy(conditionConfigSchema),
  flowConfigSchema: withCommonExecutionPolicy(flowConditionConfigSchema),
  supportsFlowRuntime: true,
  supportsExecutionPolicy: true,
  validate: (node, ctx) => {
    const config = node.config;
    const subject = config.subject;
    if (ctx.consumer === "flow") {
      const issues = [];
      if (
        typeof config.subject_key !== "string" ||
        !config.subject_key.trim()
      ) {
        issues.push({
          field: "subject_key",
          message: "Condition needs a subject key.",
        });
      }
      if (
        config.operator !== "equals" &&
        config.operator !== "contains" &&
        config.operator !== "present" &&
        config.operator !== "absent"
      ) {
        issues.push({
          field: "operator",
          message: "Condition needs an operator.",
        });
      } else if (
        (config.operator === "equals" || config.operator === "contains") &&
        (config.value === undefined || config.value === "")
      ) {
        issues.push({
          severity: "warning" as const,
          field: "value",
          message: `Operator "${config.operator}" usually expects a comparison value.`,
        });
      }
      return issues;
    }
    if (
      subject === "message_content" &&
      (typeof config.value !== "string" || !config.value.trim())
    ) {
      return [
        {
          field: "value",
          message: "Message-content condition needs a value.",
        },
      ];
    }
    if (
      subject !== "message_content" &&
      (typeof config.operand !== "string" || !config.operand.trim())
    ) {
      return [
        {
          field: "operand",
          message: "Automation condition needs an operand.",
        },
      ];
    }
    return [];
  },
  runtimeKind: "auto",
  runtimeHook: "condition",
  form: { kind: "specialized", component: "condition" },
  builder: {
    visible: true,
    defaultConfig: {
      subject: "var",
      subject_key: "",
      operator: "equals",
      value: "",
      true_next: "",
      false_next: "",
    },
  },
  ui: {
    color: "text-fuchsia-400",
    blurb: "Branches on a rule",
    hue: { l: 0.72, c: 0.15, h: 65 },
  },
  outgoingEdges: (config) => [
    ...[config.true_next, config.false_next].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    ),
    ...executionPolicyEdgeTargets(config).map(({ target }) => target),
  ],
  outgoingEdgeTargets: (config) => [
    ...(["true_next", "false_next"] as const).flatMap((field) =>
      typeof config[field] === "string" && config[field]
        ? [{ target: config[field], field }]
        : [],
    ),
    ...executionPolicyEdgeTargets(config),
  ],
});
